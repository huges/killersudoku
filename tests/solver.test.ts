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
  return ambiguousPairPuzzle()
}

function ambiguousPairPuzzle() {
  const puzzle = clone(solvedPuzzle)
  puzzle.givens[0][0] = null
  puzzle.givens[0][1] = null
  puzzle.cages = puzzle.cages.filter((cage) => !['cage-0-0', 'cage-0-1'].includes(cage.id))
  puzzle.cages.push({ id: 'ambiguous-pair', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }], sum: 3 })
  return puzzle
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
    const result = solve(multiple)
    expect(result.status).toBe('multiple')
    expect(result.count).toBe(2)
    expect(result.complete).toBe(true)
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
    puzzle.cages = puzzle.cages.filter((cage) => cage.id !== 'cage-0-0' && cage.id !== 'cage-0-1')
    puzzle.cages.push({ id: 'pair', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }], sum: 3 })
    validatePuzzle(puzzle)
    const grid = puzzle.givens.map((row) => [...row]) as SearchGrid
    const assignments = getCageCombinations(grid, puzzle.cages[puzzle.cages.length - 1])
    expect(assignments).toEqual([[1, 2]])
    expect(getAllSearchCandidates(grid, puzzle).get('0:0')).toEqual([1])
    expect(getAllSearchCandidates(grid, puzzle).get('0:1')).toEqual([2])
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
