import { type PuzzleDefinition } from './types'
import { ValidationError, validatePuzzle } from './validation'
import { type SearchGrid, getAllSearchCandidates, isCompleteGrid, isConsistentSearchGrid, isValidCompletedGrid } from './searchHelpers'

export type SolverOptions = { maxNodes?: number }
export type SolverStatus = 'invalid' | 'unsatisfiable' | 'unique' | 'multiple' | 'incomplete'
export type SolverResult = { status: SolverStatus; count: 0 | 1 | 2; complete: boolean; nodes: number; reason?: string; solution?: number[][] }
const DEFAULT_MAX_NODES = 100000

export function resolveMaxNodes(options: unknown): number {
  if (options === undefined) return DEFAULT_MAX_NODES
  if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object')
  if (!Object.prototype.hasOwnProperty.call(options, 'maxNodes')) return DEFAULT_MAX_NODES
  const value = (options as { maxNodes?: unknown }).maxNodes
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new TypeError('maxNodes must be a positive safe integer')
  return value
}

export function solve(puzzle: PuzzleDefinition, options?: SolverOptions): SolverResult {
  const maxNodes = resolveMaxNodes(options)
  try { validatePuzzle(puzzle) } catch (error) {
    if (error instanceof ValidationError) return { status: 'invalid', count: 0, complete: true, nodes: 0, reason: error.message }
    throw error
  }
  return search(puzzle, maxNodes)
}

export const analyze = solve

function cloneGrid(grid: SearchGrid): number[][] { return grid.map((row) => row.map((value) => value as number)) }

function search(puzzle: PuzzleDefinition, maxNodes: number): SolverResult {
  const root: SearchGrid = puzzle.givens.map((row) => [...row])
  let nodes = 0
  const solutions: number[][][] = []
  let stopped = false

  const visit = (grid: SearchGrid): void => {
    if (solutions.length >= 2 || stopped) return
    if (nodes >= maxNodes) { stopped = true; return }
    nodes += 1
    let changed = true
    while (changed) {
      changed = false
      for (const cage of puzzle.cages) {
        const cells = [...cage.cells].sort((a, b) => a.row - b.row || a.col - b.col)
        const remaining = cells.filter((cell) => grid[cell.row][cell.col] === null)
        const combinations = getCageCombinations(grid, cage)
        if (combinations.length === 0 && remaining.length > 0) return
        if (combinations.length === 1 && remaining.length > 0) {
          const next = applyAssignment(grid, remaining, combinations[0])
          if (next.some((row, r) => row.some((value, c) => value !== grid[r][c]))) { grid = next; changed = true }
        }
      }
    }
    if (!isConsistentSearchGrid(grid)) return
    let candidates = getAllSearchCandidates(grid, puzzle)
    let propagated = true
    while (propagated && !isCompleteGrid(grid)) {
      propagated = false
      for (const [cellKey, values] of candidates) {
        const [row, col] = cellKey.split(':').map(Number)
        if (grid[row][col] === null && values.length === 0) return
        if (grid[row][col] === null && values.length === 1) {
          const next = grid.map((line) => [...line])
          next[row][col] = values[0]
          if (!isConsistentSearchGrid(next)) return
          grid = next
          propagated = true
          break
        }
      }
      if (propagated) candidates = getAllSearchCandidates(grid, puzzle)
    }
    if ([...candidates.values()].some((values) => values.length === 0)) return
    if (isCompleteGrid(grid)) {
      if (isValidCompletedGrid(grid, puzzle) && !solutions.some((solution) => JSON.stringify(solution) === JSON.stringify(grid))) solutions.push(cloneGrid(grid))
      return
    }
    const available = [...candidates.entries()]
      .filter(([cellKey]) => { const [row, col] = cellKey.split(':').map(Number); return grid[row][col] === null })
      .sort(([a, av], [b, bv]) => { const [ar, ac] = a.split(':').map(Number); const [br, bc] = b.split(':').map(Number); return av.length - bv.length || ar - br || ac - bc })
    const choice = available[0]
    if (!choice || choice[1].length === 0) return
    const [keyName, values] = choice; const [row, col] = keyName.split(':').map(Number)
    for (const value of values) {
      const next = grid.map((line) => [...line]); next[row][col] = value; visit(next)
      if (solutions.length >= 2 || stopped) return
    }
  }
  visit(root)
  const solution = solutions[0]
  if (solutions.length >= 2) return { status: 'multiple', count: 2, complete: true, nodes, solution }
  if (stopped) return { status: 'incomplete', count: solutions.length as 0 | 1, complete: false, nodes, reason: solutions.length === 0 ? 'maxNodes reached before classification' : 'maxNodes reached before uniqueness was proven', ...(solution ? { solution } : {}) }
  if (solutions.length === 1) return { status: 'unique', count: 1, complete: true, nodes, solution }
  return { status: 'unsatisfiable', count: 0, complete: true, nodes }
}
