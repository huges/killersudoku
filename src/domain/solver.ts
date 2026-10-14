import { type PuzzleDefinition } from './types'
import { ValidationError, validatePuzzle } from './validation'
import { type SearchGrid, getAllSearchCandidates, getCageCombinations, applyAssignment, isCompleteGrid, isValidCompletedGrid } from './searchHelpers'

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
    const candidates = getAllSearchCandidates(grid, puzzle)
    for (const cage of puzzle.cages) {
      const cells = [...cage.cells].sort((a, b) => a.row - b.row || a.col - b.col)
      const combinations = getCageCombinations(grid, cage)
      if (combinations.length === 0 && cells.some((cell) => grid[cell.row][cell.col] === null)) return
      if (combinations.length === 1) {
        const next = applyAssignment(grid, cells, combinations[0])
        if (next.some((row, r) => row.some((value, c) => value !== grid[r][c]))) { visit(next); if (solutions.length >= 2 || stopped) return }
      }
    }
    if (isCompleteGrid(grid)) {
      if (isValidCompletedGrid(grid, puzzle) && !solutions.some((solution) => JSON.stringify(solution) === JSON.stringify(grid))) solutions.push(cloneGrid(grid))
      return
    }
    const available = [...candidates.entries()]
      .filter(([key]) => grid[Number(key.split(':')[0])][Number(key.split(':')[1])] === null)
      .sort(([a], [b]) => { const [ar, ac] = a.split(':').map(Number); const [br, bc] = b.split(':').map(Number); return (candidates.get(a)?.length ?? 0) - (candidates.get(b)?.length ?? 0) || ar - br || ac - bc })
    const choice = available.find(([, values]) => values.length > 0)
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
