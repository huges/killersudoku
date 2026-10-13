import {
  type CellCoordinate,
  type CellValue,
  type PuzzleDefinition,
  type VerificationResult,
  type VerificationViolation,
} from './types'
import { validatePuzzle, validationError } from './validation'

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

function validateGrid(grid: unknown): asserts grid is CellValue[][] {
  if (!Array.isArray(grid) || grid.length !== 9) {
    validationError('initialGrid must be a 9x9 matrix containing null or integers from 1 to 9')
  }
  for (let rowIndex = 0; rowIndex < 9; rowIndex += 1) {
    const row = grid[rowIndex]
    if (!Array.isArray(row) || row.length !== 9) {
      validationError('initialGrid must be a 9x9 matrix containing null or integers from 1 to 9')
    }
    for (let colIndex = 0; colIndex < 9; colIndex += 1) {
      if (!Object.prototype.hasOwnProperty.call(row, colIndex)) {
        validationError('initialGrid must be a 9x9 matrix containing null or integers from 1 to 9')
      }
      const value = row[colIndex]
      if (value !== null
        && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 9)) {
        validationError('initialGrid must be a 9x9 matrix containing null or integers from 1 to 9')
      }
    }
  }
}

function deriveInitialGrid(puzzle: PuzzleDefinition): CellValue[][] {
  return puzzle.givens.map((row) => row.map((value) => value === null ? null : value))
}

function availableSums(count: number, available: number[]): Set<number> {
  const sums = new Set<number>()
  const visit = (start: number, remaining: number, sum: number): void => {
    if (remaining === 0) {
      sums.add(sum)
      return
    }
    for (let index = start; index <= available.length - remaining; index += 1) {
      visit(index + 1, remaining - 1, sum + available[index])
    }
  }
  visit(0, count, 0)
  return sums
}

function duplicateViolations(
  grid: CellValue[][],
  units: CellCoordinate[][],
  type: 'row_duplicate' | 'column_duplicate' | 'region_duplicate',
): VerificationViolation[] {
  const violations: VerificationViolation[] = []
  for (const unit of units) {
    const byValue = new Map<number, CellCoordinate[]>()
    for (const cell of unit) {
      const value = grid[cell.row][cell.col]
      if (value === null) continue
      const cells = byValue.get(value) ?? []
      cells.push({ ...cell })
      byValue.set(value, cells)
    }
    for (const cells of byValue.values()) {
      if (cells.length > 1) violations.push({ type, cells })
    }
  }
  return violations
}

export function verifyGame(
  puzzle: PuzzleDefinition,
  initialGrid?: CellValue[][],
): VerificationResult {
  validatePuzzle(puzzle)
  const grid = initialGrid === undefined ? deriveInitialGrid(puzzle) : initialGrid
  validateGrid(grid)

  for (let row = 0; row < 9; row += 1) for (let col = 0; col < 9; col += 1) {
    const given = puzzle.givens[row][col]
    if (given !== null && grid[row][col] !== given) validationError('initialGrid changes or removes a given')
  }

  const complete = grid.every((row) => row.every((value) => value !== null))
  const violations: VerificationViolation[] = []

  const rows = Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => ({ row, col })))
  const columns = Array.from({ length: 9 }, (_, col) => Array.from({ length: 9 }, (_, row) => ({ row, col })))
  const regions = Array.from({ length: 9 }, (_, region) => {
    const rowStart = Math.floor(region / 3) * 3
    const colStart = (region % 3) * 3
    return Array.from({ length: 9 }, (_, index) => ({
      row: rowStart + Math.floor(index / 3),
      col: colStart + index % 3,
    }))
  })
  violations.push(...duplicateViolations(grid, rows, 'row_duplicate'))
  violations.push(...duplicateViolations(grid, columns, 'column_duplicate'))
  violations.push(...duplicateViolations(grid, regions, 'region_duplicate'))

  for (const cage of puzzle.cages) {
    const values = cage.cells.map((cell) => grid[cell.row][cell.col])
    const present = values.filter((value): value is number => value !== null)
    const byValue = new Map<number, CellCoordinate[]>()
    for (const cell of cage.cells) {
      const value = grid[cell.row][cell.col]
      if (value === null) continue
      const cells = byValue.get(value) ?? []
      cells.push({ ...cell })
      byValue.set(value, cells)
    }
    for (const cells of byValue.values()) {
      if (cells.length > 1) violations.push({ type: 'cage_duplicate', cageId: cage.id, cells })
    }

    const actualSum = present.reduce((sum, value) => sum + value, 0)
    if (actualSum > cage.sum) {
      violations.push({ type: 'cage_sum_exceeded', cageId: cage.id, expectedSum: cage.sum, actualSum })
    }
    if (present.length === cage.cells.length) {
      if (actualSum !== cage.sum) {
        violations.push({ type: 'cage_sum_mismatch', cageId: cage.id, expectedSum: cage.sum, actualSum })
      }
    } else if (actualSum <= cage.sum) {
      const available = DIGITS.filter((digit) => !present.includes(digit))
      if (!availableSums(cage.cells.length - present.length, available).has(cage.sum - actualSum)) {
        violations.push({ type: 'cage_sum_unreachable', cageId: cage.id, expectedSum: cage.sum, actualSum })
      }
    }
  }

  return {
    status: violations.length > 0 ? 'CONFLITTO' : complete ? 'VALIDA' : 'INCOMPLETA',
    complete,
    violations,
  }
}
