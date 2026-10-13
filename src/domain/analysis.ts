import {
  type CellCoordinate,
  type GameState,
  type PuzzleDefinition,
  type VerificationViolationType,
} from './types'
import { validateGameState, validatePuzzle, ValidationError } from './validation'
import { verifyGame } from './verification'

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

function cloneCells(cells: CellCoordinate[]): CellCoordinate[] {
  return cells.map((cell) => ({ ...cell }))
}

function sudokuCandidates(game: GameState, cell: CellCoordinate): number[] {
  const value = game.values[cell.row][cell.col]
  if (value !== null) return [value]

  const excluded = new Set<number>()
  for (let index = 0; index < 9; index += 1) {
    const rowValue = game.values[cell.row][index]
    const columnValue = game.values[index][cell.col]
    if (rowValue !== null) excluded.add(rowValue)
    if (columnValue !== null) excluded.add(columnValue)
  }
  const rowStart = Math.floor(cell.row / 3) * 3
  const colStart = Math.floor(cell.col / 3) * 3
  for (let row = rowStart; row < rowStart + 3; row += 1) {
    for (let col = colStart; col < colStart + 3; col += 1) {
      const regionValue = game.values[row][col]
      if (regionValue !== null) excluded.add(regionValue)
    }
  }
  return DIGITS.filter((digit) => !excluded.has(digit))
}

function arithmeticCombinations(count: number, sum: number, available: number[]): number[][] {
  const combinations: number[][] = []
  const visit = (start: number, remaining: number, left: number, selected: number[]): void => {
    if (remaining === 0) {
      if (left === 0) combinations.push([...selected])
      return
    }
    for (let index = start; index <= available.length - remaining; index += 1) {
      visit(index + 1, remaining - 1, left - available[index], [...selected, available[index]])
    }
  }
  visit(0, count, sum, [])
  return combinations
}

function compatibleCombinations(
  arithmetic: number[][],
  remainingCells: CellCoordinate[],
  sudokuByCell: Map<string, number[]>,
): number[][] {
  return arithmetic.filter((combination) => combination.every((digit, index) =>
    (sudokuByCell.get(coordinateKey(remainingCells[index])) ?? []).includes(digit),
  ))
}

function verificationViolations(
  puzzle: PuzzleDefinition,
  violations: ReturnType<typeof verifyGame>['violations'],
): AnalysisViolation[] {
  return violations.map((violation) => ({
    type: violation.type,
    cells: cloneCells(violation.cells ?? (violation.cageId
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
    const cells = cloneCells(cage.cells)
    const present = cells
      .map((cell) => game.values[cell.row][cell.col])
      .filter((value): value is number => value !== null)
    const remainingCells = cells.filter((cell) => game.values[cell.row][cell.col] === null)
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
        violations.push({ type: 'cage_sum_mismatch', cells, cageId: cage.id, expectedSum: cage.sum, actualSum: present.reduce((total, value) => total + value, 0) })
      }
    } else {
      const available = DIGITS.filter((digit) => !present.includes(digit))
      const arithmetic = arithmeticCombinations(remainingCells.length, remainingSum, available)
      if (arithmetic.length === 0) {
        cause = 'residual_sum_impossible'
        violations.push({ type: 'cage_sum_unreachable', cause, cells: cloneCells(remainingCells), cageId: cage.id, expectedSum: cage.sum, actualSum: cage.sum - remainingSum })
      } else {
        combinations = compatibleCombinations(arithmetic, remainingCells, sudokuByCell)
        if (combinations.length === 0) {
          cause = 'candidate_conflict'
          violations.push({ type: 'cage_sum_unreachable', cause, cells: cloneCells(remainingCells), cageId: cage.id, expectedSum: cage.sum, actualSum: cage.sum - remainingSum })
        }
      }
    }

    const candidateDigits = new Set(combinations.flat())
    for (const cell of remainingCells) cageCandidates.set(coordinateKey(cell), candidateDigits)
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
