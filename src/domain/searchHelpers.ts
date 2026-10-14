import { type CellCoordinate, type CellValue, type Cage, type PuzzleDefinition } from './types'

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
export type SearchGrid = CellValue[][]

export function getSudokuCandidates(grid: SearchGrid, cell: CellCoordinate): number[] {
  if (grid[cell.row][cell.col] !== null) return [grid[cell.row][cell.col] as number]
  const excluded = new Set<number>()
  for (let i = 0; i < 9; i += 1) {
    const row = grid[cell.row][i]; const col = grid[i][cell.col]
    if (row !== null) excluded.add(row)
    if (col !== null) excluded.add(col)
  }
  const rs = Math.floor(cell.row / 3) * 3; const cs = Math.floor(cell.col / 3) * 3
  for (let r = rs; r < rs + 3; r += 1) for (let c = cs; c < cs + 3; c += 1) {
    const value = grid[r][c]; if (value !== null) excluded.add(value)
  }
  return DIGITS.filter((digit) => !excluded.has(digit))
}

function compareCells(a: CellCoordinate, b: CellCoordinate): number { return a.row - b.row || a.col - b.col }
function key(cell: CellCoordinate): string { return `${cell.row}:${cell.col}` }

export function getCageCombinations(grid: SearchGrid, cage: Cage): number[][] {
  const cells = [...cage.cells].sort(compareCells)
  const present = cells.map((cell) => grid[cell.row][cell.col]).filter((v): v is number => v !== null)
  const remaining = cells.filter((cell) => grid[cell.row][cell.col] === null)
  const sum = cage.sum - present.reduce((a, b) => a + b, 0)
  if (new Set(present).size !== present.length || sum < 0) return []
  const result: number[][] = []
  const visit = (index: number, left: number, available: number[], selected: number[]): void => {
    if (index === remaining.length) { if (left === 0) result.push([...selected]); return }
    const candidates = getSudokuCandidates(grid, remaining[index])
    for (const digit of available) if (candidates.includes(digit)) visit(index + 1, left - digit, available.filter((v) => v !== digit), [...selected, digit])
  }
  visit(0, sum, DIGITS.filter((d) => !present.includes(d)), [])
  return result.sort((a, b) => a.some((v, i) => v !== b[i]) ? a.findIndex((v, i) => v !== b[i]) : 0).sort((a, b) => { for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return 0 })
}

export function applyAssignment(grid: SearchGrid, cells: CellCoordinate[], assignment: number[]): SearchGrid {
  const next = grid.map((row) => [...row]); cells.forEach((cell, i) => { next[cell.row][cell.col] = assignment[i] }); return next
}

export function getAllSearchCandidates(grid: SearchGrid, puzzle: PuzzleDefinition): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const cage of puzzle.cages) {
    const ordered = [...cage.cells].sort(compareCells)
    const combinations = getCageCombinations(grid, cage)
    for (const cell of ordered) {
      if (grid[cell.row][cell.col] !== null) continue
      const index = ordered.findIndex((candidate) => key(candidate) === key(cell))
      const values = new Set(combinations.map((assignment) => assignment[index]))
      result.set(key(cell), [...values].sort((a, b) => a - b))
    }
  }
  return result
}

export function isCompleteGrid(grid: SearchGrid): boolean { return grid.every((row) => row.every((value) => value !== null)) }

export function isValidCompletedGrid(grid: SearchGrid, puzzle: PuzzleDefinition): boolean {
  if (!isCompleteGrid(grid)) return false
  for (let row = 0; row < 9; row += 1) {
    if (new Set(grid[row] as number[]).size !== 9) return false
    const column = grid.map((line) => line[row] as number)
    if (new Set(column).size !== 9) return false
  }
  for (let br = 0; br < 3; br += 1) for (let bc = 0; bc < 3; bc += 1) {
    const box: number[] = []
    for (let r = br * 3; r < br * 3 + 3; r += 1) for (let c = bc * 3; c < bc * 3 + 3; c += 1) box.push(grid[r][c] as number)
    if (new Set(box).size !== 9) return false
  }
  return puzzle.cages.every((cage) => {
    const values = cage.cells.map((cell) => grid[cell.row][cell.col] as number)
    return new Set(values).size === values.length && values.reduce((sum, value) => sum + value, 0) === cage.sum
  })
}
