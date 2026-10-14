import { describe, expect, it } from 'vitest'
import { analyze, resolveMaxNodes, solve } from '../src/domain/solver'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'
import { getCageCombinations, getAllSearchCandidates } from '../src/domain/searchHelpers'
import { validatePuzzle } from '../src/domain/validation'

const clone = <T>(value: T): T => structuredClone(value)

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

  it('keeps invalid structural variants out of the search', () => {
    for (const mutate of [
      (p: typeof partialPuzzle) => { p.cages[0].cells = [] },
      (p: typeof partialPuzzle) => { p.cages[0].cells = [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
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
