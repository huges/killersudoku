import {
  type CellCoordinate,
  type GameState,
  type PuzzleDefinition,
  type VerificationViolationType,
} from './types'
import { validateGameState, validatePuzzle, ValidationError } from './validation'
import { verifyGame } from './verification'
import { getCageCombinations, getSudokuCandidates, hasArithmeticCombination, type SearchGrid } from './searchHelpers'

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

type LocalCause = 'residual_sum_impossible' | 'candidate_conflict'
type CageCause = LocalCause | 'cage_duplicate' | 'cage_sum_mismatch'

export interface CageFeasibility {
  cageId: string
  remainingCells: CellCoordinate[]
  remainingSum: number
  combinations: number[][]
  status: 'feasible' | 'infeasible'
  cause?: CageCause
}

export interface CellCandidates {
  cell: CellCoordinate
  candidates: number[]
}

export interface AnalysisViolation {
  // `cage_sum_unreachable` is already part of VerificationViolationType (M1-2).
  // Keep the existing domain union; local causes remain distinguished by `cause`.
  type: VerificationViolationType | 'cage_duplicate' | 'cage_sum_mismatch'
  cause?: LocalCause
  cells: CellCoordinate[]
  cageId?: string
  expectedSum?: number
  actualSum?: number
}

export type LocalFeasibilityResult =
  | { status: 'invalid_input'; error: string }
  | {
      status: 'feasible' | 'infeasible'
      cages: CageFeasibility[]
      candidates: CellCandidates[]
      violations: AnalysisViolation[]
    }

function coordinateKey(cell: CellCoordinate): string {
  return `${cell.row}:${cell.col}`
}

function compareCells(left: CellCoordinate, right: CellCoordinate): number {
  return left.row - right.row || left.col - right.col
}

function cloneCells(cells: CellCoordinate[]): CellCoordinate[] {
  return cells.map((cell) => ({ ...cell }))
}

function canonicalCells(cells: CellCoordinate[]): CellCoordinate[] {
  return cloneCells(cells).sort(compareCells)
}

function remapAssignments(
  assignments: number[][],
  canonical: CellCoordinate[],
  historical: CellCoordinate[],
): number[][] {
  return assignments.map((assignment) => historical.map((cell) => {
    const index = canonical.findIndex((candidate) => coordinateKey(candidate) === coordinateKey(cell))
    return assignment[index]
  }))
}

function sameViolation(left: AnalysisViolation, right: AnalysisViolation): boolean {
  return left.type === right.type
    && left.cause === right.cause
    && left.cageId === right.cageId
    && left.expectedSum === right.expectedSum
    && left.actualSum === right.actualSum
    && left.cells.length === right.cells.length
    && left.cells.every((cell, index) => (
      cell.row === right.cells[index]?.row && cell.col === right.cells[index]?.col
    ))
}

function appendUniqueViolation(
  violations: AnalysisViolation[],
  violation: AnalysisViolation,
): void {
  if (!violations.some((existing) => sameViolation(existing, violation))) {
    violations.push(violation)
  }
}

function sudokuCandidates(game: GameState, cell: CellCoordinate): number[] {
  return getSudokuCandidates(game.values as SearchGrid, cell)
}

function verificationViolations(
  puzzle: PuzzleDefinition,
  violations: ReturnType<typeof verifyGame>['violations'],
): AnalysisViolation[] {
  return violations.map((violation) => ({
    type: violation.type,
    cells: canonicalCells(violation.cells ?? (violation.cageId
      ? puzzle.cages.find((cage) => cage.id === violation.cageId)?.cells ?? []
      : [])),
    ...(violation.cageId === undefined ? {} : { cageId: violation.cageId }),
    ...(violation.expectedSum === undefined ? {} : { expectedSum: violation.expectedSum }),
    ...(violation.actualSum === undefined ? {} : { actualSum: violation.actualSum }),
  }))
}

export function analyzeLocalFeasibility(
  puzzle: PuzzleDefinition,
  game: GameState,
): LocalFeasibilityResult {
  try {
    validatePuzzle(puzzle)
    validateGameState(puzzle, game)
  } catch (error) {
    if (error instanceof ValidationError) return { status: 'invalid_input', error: error.message }
    throw error
  }

  const verification = verifyGame(puzzle, game.values)
  const violations = verificationViolations(puzzle, verification.violations)
  const sudokuByCell = new Map<string, number[]>()
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const cell = { row, col }
      sudokuByCell.set(coordinateKey(cell), sudokuCandidates(game, cell))
    }
  }

  const cages: CageFeasibility[] = []
  const cageCandidates = new Map<string, Set<number>>()
  for (const cage of puzzle.cages) {
    const cells = canonicalCells(cage.cells)
    const remainingCells = cloneCells(cage.cells).filter((cell) => game.values[cell.row][cell.col] === null)
    const canonicalRemainingCells = cells.filter((cell) => game.values[cell.row][cell.col] === null)
    const present = cells
      .map((cell) => game.values[cell.row][cell.col])
      .filter((value): value is number => value !== null)
    const remainingSum = cage.sum - present.reduce((total, value) => total + value, 0)
    const duplicate = verification.violations.some((violation) =>
      violation.type === 'cage_duplicate' && violation.cageId === cage.id,
    )
    let combinations: number[][] = []
    let cause: CageCause | undefined

    if (duplicate) {
      cause = 'cage_duplicate'
    } else if (remainingCells.length === 0) {
      if (remainingSum === 0) combinations = [[]]
      else {
        cause = 'cage_sum_mismatch'
        appendUniqueViolation(violations, {
          type: 'cage_sum_mismatch',
          cells,
          cageId: cage.id,
          expectedSum: cage.sum,
          actualSum: present.reduce((total, value) => total + value, 0),
        })
      }
    } else {
      const canonicalCombinations = getCageCombinations(game.values as SearchGrid, cage)
      combinations = remapAssignments(canonicalCombinations, canonicalRemainingCells, remainingCells)
      if (combinations.length === 0) {
        const available = DIGITS.filter((digit) => !present.includes(digit))
        const arithmeticExists = hasArithmeticCombination(remainingCells.length, remainingSum, available)
        cause = arithmeticExists ? 'candidate_conflict' : 'residual_sum_impossible'
        appendUniqueViolation(violations, { type: 'cage_sum_unreachable', cause, cells: cloneCells(remainingCells), cageId: cage.id, expectedSum: cage.sum, actualSum: cage.sum - remainingSum })
      }
    }

    for (let index = 0; index < remainingCells.length; index += 1) {
      const candidateDigits = new Set(combinations.map((assignment) => assignment[index]))
      cageCandidates.set(coordinateKey(remainingCells[index]), candidateDigits)
    }
    cages.push({
      cageId: cage.id,
      remainingCells,
      remainingSum,
      combinations,
      status: combinations.length > 0 ? 'feasible' : 'infeasible',
      ...(cause === undefined ? {} : { cause }),
    })
  }

  const candidates: CellCandidates[] = []
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const cell = { row, col }
      const value = game.values[row][col]
      const cellHasConflict = violations.some((violation) => violation.cells.some((candidate) =>
        candidate.row === row && candidate.col === col))
      const finalCandidates = value !== null
        ? cellHasConflict ? [] : [value]
        : [...(cageCandidates.get(coordinateKey(cell)) ?? [])]
          .filter((digit) => (sudokuByCell.get(coordinateKey(cell)) ?? []).includes(digit))
          .sort((left, right) => left - right)
      candidates.push({ cell, candidates: finalCandidates })
    }
  }

  return {
    status: verification.violations.length === 0 && cages.every((cage) => cage.status === 'feasible')
      ? 'feasible'
      : 'infeasible',
    cages,
    candidates,
    violations,
  }
}
