import { describe, expect, it, vi } from 'vitest'
import { analyze, resolveMaxNodes, solve } from '../src/domain/solver'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'
import * as searchHelpers from '../src/domain/searchHelpers'
import { getCageCombinations, getAllSearchCandidates, type SearchGrid } from '../src/domain/searchHelpers'
import { validatePuzzle } from '../src/domain/validation'
import { analyzeLocalFeasibility } from '../src/domain/analysis'
import { newGame } from '../src/domain/game'

const clone = <T>(value: T): T => structuredClone(value)

function locallyFeasibleUnsatisfiablePuzzle() {
  const puzzle = clone(partialPuzzle)
  puzzle.cages.find((cage) => cage.id === 'cage-0-2')!.sum = 3
  puzzle.cages.find((cage) => cage.id === 'cage-0-3')!.sum = 3
  return puzzle
}

function multiplePuzzle() {
  const puzzle = clone(solvedPuzzle)
  puzzle.givens = puzzle.givens.map((row, rowIndex) => rowIndex < 2 ? Array(9).fill(null) : [...row])
  const fixed = puzzle.cages.filter((cage) => cage.cells[0].row >= 2)
  const pairs = Array.from({ length: 9 }, (_, col) => ({
    id: `pair-${col}`,
    cells: [{ row: 0, col }, { row: 1, col }],
    sum: solvedPuzzle.givens[0][col]! + solvedPuzzle.givens[1][col]!,
  }))
  puzzle.cages = [...pairs, ...fixed]
  return puzzle
}

function ambiguousPairPuzzle() {
  return multiplePuzzle()
}

function assertCompleteSolution(puzzle: typeof solvedPuzzle, grid: number[][]) {
  expect(grid).toHaveLength(9)
  for (const row of grid) expect(new Set(row).size).toBe(9)
  for (let col = 0; col < 9; col += 1) expect(new Set(grid.map((row) => row[col])).size).toBe(9)
  for (let br = 0; br < 3; br += 1) for (let bc = 0; bc < 3; bc += 1) {
    const values: number[] = []
    for (let row = br * 3; row < br * 3 + 3; row += 1) for (let col = bc * 3; col < bc * 3 + 3; col += 1) values.push(grid[row][col])
    expect(new Set(values).size).toBe(9)
  }
  for (let row = 0; row < 9; row += 1) for (let col = 0; col < 9; col += 1) {
    const given = puzzle.givens[row][col]
    if (given !== null) expect(grid[row][col]).toBe(given)
  }
  for (const cage of puzzle.cages) {
    const values = cage.cells.map((cell) => grid[cell.row][cell.col])
    expect(new Set(values).size).toBe(values.length)
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(cage.sum)
  }
}

describe('deterministic solver', () => {
  it('validates fixtures explicitly and classifies the solved fixture as unique', () => {
    validatePuzzle(solvedPuzzle)
    const result = solve(solvedPuzzle)
    expect(result).toMatchObject({ status: 'unique', count: 1, complete: true })
    expect(result.solution).toEqual(solvedPuzzle.givens)
  })

  it('uses the same classification through analyze and defaults', () => {
    validatePuzzle(partialPuzzle)
    expect(analyze(partialPuzzle)).toEqual(solve(partialPuzzle, {}))
  })

  it('classifies valid local-feasible and multiple fixtures', () => {
    const impossible = locallyFeasibleUnsatisfiablePuzzle()
    validatePuzzle(impossible)
    const local = analyzeLocalFeasibility(impossible, newGame(impossible))
    expect(local).toMatchObject({ status: 'feasible', violations: [] })
    expect(solve(impossible)).toMatchObject({ status: 'unsatisfiable', count: 0, complete: true })

    const multiple = multiplePuzzle()
    validatePuzzle(multiple)
    const first = solvedPuzzle.givens.map((row) => [...row])
    const second = [first[1], first[0], ...first.slice(2)].map((row) => [...row])
    assertCompleteSolution(multiple, first)
    assertCompleteSolution(multiple, second)
    expect(second).not.toEqual(first)
    const result = solve(multiple)
    expect(result.status).toBe('multiple')
    expect(result.count).toBe(2)
    expect(result.complete).toBe(true)
    expect(result.solution).toBeDefined()
  })

  it('preserves local feasibility behavior through the shared helpers', () => {
    const game = newGame(solvedPuzzle)
    const result = analyzeLocalFeasibility(solvedPuzzle, game)
    expect(result).toMatchObject({ status: 'feasible', violations: [] })
    if (result.status !== 'invalid_input') {
      expect(result.cages[0]).toMatchObject({ remainingCells: [], combinations: [[]], status: 'feasible' })
      expect(result.candidates[0]).toEqual({ cell: { row: 0, col: 0 }, candidates: [1] })
    }
  })

  it('returns invalid without entering the search for malformed cages', () => {
    const invalid = clone(partialPuzzle)
    invalid.cages[0].cells = [{ row: -1, col: 0 }]
    const result = solve(invalid)
    expect(result).toMatchObject({ status: 'invalid', count: 0, complete: true, nodes: 0 })
    expect(result.reason).toMatch(/invalid|coordinate|cage/i)
  })

  it('enforces presence-sensitive maxNodes validation', () => {
    expect(resolveMaxNodes(undefined)).toBe(100000)
    expect(resolveMaxNodes({})).toBe(100000)
    expect(resolveMaxNodes({ maxNodes: 3 })).toBe(3)
    for (const value of [null, undefined, 0, -1, 1.5, NaN, Infinity, '3', 1n, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveMaxNodes({ maxNodes: value })).toThrow(TypeError)
    }
    expect(() => solve(solvedPuzzle, { maxNodes: null as never })).toThrow(TypeError)
    expect(() => resolveMaxNodes(null)).toThrow(TypeError)
    expect(() => resolveMaxNodes({ maxNodes: undefined })).toThrow(TypeError)
  })

  it('keeps cage assignments positional and candidate unions positional', () => {
    const puzzle = clone(partialPuzzle)
    puzzle.givens[0][0] = null
    puzzle.givens[0][1] = null
    puzzle.cages = puzzle.cages.filter((cage) => cage.id !== 'cage-0-0' && cage.id !== 'cage-0-1')
    puzzle.cages.push({ id: 'pair', cells: [{ row: 0, col: 1 }, { row: 0, col: 0 }], sum: 3 })
    validatePuzzle(puzzle)
    const grid = puzzle.givens.map((row) => [...row]) as SearchGrid
    const assignments = getCageCombinations(grid, puzzle.cages[puzzle.cages.length - 1])
    expect(assignments).toEqual([[1, 2]])
    const analyzedInitial = analyzeLocalFeasibility(puzzle, newGame(puzzle))
    expect(analyzedInitial.status).toBe('feasible')
    if (analyzedInitial.status !== 'invalid_input') {
      const pair = analyzedInitial.cages.find((cage) => cage.cageId === 'pair')!
      expect(pair.remainingCells).toEqual([{ row: 0, col: 1 }, { row: 0, col: 0 }])
      expect(pair.combinations).toEqual([[2, 1]])
    }
    expect(getAllSearchCandidates(grid, puzzle).get('0:0')).toEqual([1])
    expect(getAllSearchCandidates(grid, puzzle).get('0:1')).toEqual([2])

    puzzle.cages[puzzle.cages.length - 1].cells.reverse()
    const analyzed = analyzeLocalFeasibility(puzzle, newGame(puzzle))
    expect(analyzed.status).toBe('feasible')
    if (analyzed.status !== 'invalid_input') {
      const pair = analyzed.cages.find((cage) => cage.cageId === 'pair')!
      expect(pair.remainingCells).toEqual([{ row: 0, col: 0 }, { row: 0, col: 1 }])
      expect(pair.combinations).toEqual([[1, 2]])
      expect(analyzed.candidates[0]).toEqual({ cell: { row: 0, col: 0 }, candidates: [1] })
      expect(analyzed.candidates[1]).toEqual({ cell: { row: 0, col: 1 }, candidates: [2] })
    }

    puzzle.givens[0][0] = 1
    const partialGrid = puzzle.givens.map((row) => [...row]) as SearchGrid
    expect(getCageCombinations(partialGrid, puzzle.cages[puzzle.cages.length - 1])).toEqual([[2]])
    expect(getAllSearchCandidates(partialGrid, puzzle).get('0:1')).toEqual([2])
    const analyzedPartial = analyzeLocalFeasibility(puzzle, newGame(puzzle))
    expect(analyzedPartial.status).toBe('feasible')
    if (analyzedPartial.status !== 'invalid_input') {
      const pair = analyzedPartial.cages.find((cage) => cage.cageId === 'pair')!
      expect(pair.remainingCells).toEqual([{ row: 0, col: 1 }])
      expect(pair.combinations).toEqual([[2]])
    }
  })

  it('classifies deterministically and preserves an exact terminal node limit', () => {
    validatePuzzle(solvedPuzzle)
    const first = solve(solvedPuzzle, { maxNodes: 1 })
    const second = solve(solvedPuzzle, { maxNodes: 1 })
    expect(first).toEqual(second)
    expect(first).toMatchObject({ status: 'unique', count: 1, complete: true, nodes: 1 })
  })

  it('reports incomplete searches with count zero and count one', () => {
    const branching = multiplePuzzle()
    validatePuzzle(branching)
    expect(solve(branching, { maxNodes: 1 })).toMatchObject({
      status: 'incomplete', count: 0, complete: false, nodes: 1,
      reason: 'maxNodes reached before classification',
    })

    const ambiguous = ambiguousPairPuzzle()
    validatePuzzle(ambiguous)
    expect(solve(ambiguous, { maxNodes: 2 })).toMatchObject({
      status: 'incomplete', count: 1, complete: false, nodes: 2,
      reason: 'maxNodes reached before uniqueness was proven',
    })
  })

  it('stops on the second solution at the exact permitted node', () => {
    const puzzle = ambiguousPairPuzzle()
    validatePuzzle(puzzle)
    const result = solve(puzzle, { maxNodes: 3 })
    expect(result).toMatchObject({ status: 'multiple', count: 2, complete: true, nodes: 3 })
  })

  it('classifies an exhausted search conclusively at its exact node limit', () => {
    const puzzle = clone(solvedPuzzle)
    validatePuzzle(puzzle)
    expect(solve(puzzle, { maxNodes: 1 })).toMatchObject({
      status: 'unique', count: 1, complete: true, nodes: 1,
    })

    const impossible = locallyFeasibleUnsatisfiablePuzzle()
    validatePuzzle(impossible)
    expect(solve(impossible, { maxNodes: 1 })).toMatchObject({
      status: 'unsatisfiable', count: 0, complete: true, nodes: 1,
    })
  })

  it('propagates an unexpected helper error after fixture validation', () => {
    const failure = new Error('unexpected search helper failure')
    const spy = vi.spyOn(searchHelpers, 'getCageCombinations').mockImplementation(() => { throw failure })
    try {
      validatePuzzle(partialPuzzle)
      expect(() => solve(partialPuzzle, { maxNodes: 1 })).toThrow(failure)
    } finally {
      spy.mockRestore()
    }
  })

  it('propagates an unexpected search-candidate error after fixture validation', () => {
    const failure = new Error('unexpected search candidate failure')
    const spy = vi.spyOn(searchHelpers, 'getAllSearchCandidates').mockImplementation(() => { throw failure })
    try {
      validatePuzzle(partialPuzzle)
      expect(() => solve(partialPuzzle, { maxNodes: 1 })).toThrow(failure)
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps invalid structural variants out of the search', () => {
    for (const mutate of [
      (p: typeof partialPuzzle) => { p.cages[0].cells = [] },
      (p: typeof partialPuzzle) => { p.cages[0].cells = [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
      (p: typeof partialPuzzle) => { p.cages[0].cells = [{ row: 0, col: 0 }, { row: 0, col: 2 }] },
      (p: typeof partialPuzzle) => { p.cages[0].cells = [{ row: -1, col: 0 }] },
      (p: typeof partialPuzzle) => { p.cages = p.cages.slice(1) },
    ]) {
      const invalid = clone(partialPuzzle)
      mutate(invalid)
      const result = solve(invalid)
      expect(result.status).toBe('invalid')
      expect(result.nodes).toBe(0)
      expect(result.complete).toBe(true)
    }
  })

  it('propagates non-validation option errors and remains deterministic', () => {
    for (const options of [null, 0, '1', { maxNodes: undefined }]) {
      expect(() => solve(solvedPuzzle, options as never)).toThrow(TypeError)
    }
    const results = Array.from({ length: 3 }, () => solve(solvedPuzzle, { maxNodes: 1 }))
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
    expect(results[0].nodes).toBe(1)
  })
})
