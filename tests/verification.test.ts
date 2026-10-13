import { describe, expect, it } from 'vitest'
import { partialPuzzle, referenceValue, solvedPuzzle } from '../src/domain/fixtures'
import { verifyGame } from '../src/domain/verification'
import { type CellValue } from '../src/domain/types'

function referenceGrid(): CellValue[][] {
  return Array.from({ length: 9 }, (_, row) =>
    Array.from({ length: 9 }, (_, col) => referenceValue(row, col)),
  )
}

describe('verifyGame', () => {
  it('derives givens when the grid is omitted and reports a coherent partial game', () => {
    const result = verifyGame(partialPuzzle)
    expect(result.status).toBe('INCOMPLETA')
    expect(result.complete).toBe(false)
    expect(result.violations).toEqual([])
  })

  it.each([
    ['row_duplicate', (grid: CellValue[][]) => { grid[0][2] = 1 }],
    ['column_duplicate', (grid: CellValue[][]) => { grid[2][0] = 1 }],
    ['region_duplicate', (grid: CellValue[][]) => { grid[1][1] = 1 }],
  ])('detects a %s', (type, mutate) => {
    const grid = referenceGrid()
    mutate(grid)
    const result = verifyGame(partialPuzzle, grid)
    expect(result.status).toBe('CONFLITTO')
    expect(result.violations.some((violation) => violation.type === type)).toBe(true)
  })

  it('detects duplicate values within a cage', () => {
    const puzzle = structuredClone(partialPuzzle)
    puzzle.cages = puzzle.cages.filter((cage) => !['cage-0-2', 'cage-0-3'].includes(cage.id))
    puzzle.cages.push({
      id: 'pair',
      cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
      sum: 6,
    })
    const grid = referenceGrid()
    grid[0][3] = 3
    const result = verifyGame(puzzle, grid)
    expect(result.violations.some((violation) => violation.type === 'cage_duplicate')).toBe(true)
  })

  it('reports complete cage sum errors and locally unreachable partial sums', () => {
    const complete = referenceGrid()
    complete[0][2] = 4
    const mismatch = verifyGame(partialPuzzle, complete)
    expect(mismatch.violations.some((violation) => violation.type === 'cage_sum_mismatch')).toBe(true)

    const puzzle = structuredClone(partialPuzzle)
    puzzle.givens = Array.from({ length: 9 }, () => Array<CellValue>(9).fill(null))
    puzzle.cages = puzzle.cages.filter((cage) => !['cage-3-0', 'cage-3-1', 'cage-3-2'].includes(cage.id))
    puzzle.cages.push({
      id: 'unreachable',
      cells: [{ row: 3, col: 0 }, { row: 3, col: 1 }, { row: 3, col: 2 }],
      sum: 6,
    })

    const unreachable = Array.from({ length: 9 }, () => Array<CellValue>(9).fill(null))
    unreachable[3][0] = 1
    unreachable[3][1] = 4
    expect(verifyGame(puzzle, unreachable).violations.some((violation) =>
      violation.type === 'cage_sum_unreachable' && violation.cageId === 'unreachable',
    )).toBe(true)

    const reachable = Array.from({ length: 9 }, () => Array<CellValue>(9).fill(null))
    reachable[3][0] = 1
    reachable[3][1] = 2
    const reachableResult = verifyGame(puzzle, reachable)
    expect(reachableResult).toMatchObject({ status: 'INCOMPLETA', complete: false, violations: [] })
  })

  it('reports a partial cage sum that exceeds its target', () => {
    const puzzle = structuredClone(partialPuzzle)
    puzzle.givens = Array.from({ length: 9 }, () => Array<CellValue>(9).fill(null))
    puzzle.cages = puzzle.cages.filter((cage) => !['cage-3-0', 'cage-3-1', 'cage-3-2'].includes(cage.id))
    puzzle.cages.push({
      id: 'exceeded',
      cells: [{ row: 3, col: 0 }, { row: 3, col: 1 }, { row: 3, col: 2 }],
      sum: 6,
    })
    const grid = Array.from({ length: 9 }, () => Array<CellValue>(9).fill(null))
    grid[3][0] = 3
    grid[3][1] = 4
    const result = verifyGame(puzzle, grid)
    expect(result.status).toBe('CONFLITTO')
    expect(result.violations).toContainEqual(expect.objectContaining({ type: 'cage_sum_exceeded', cageId: 'exceeded' }))
  })

  it('rejects malformed, sparse, non-integer, and out-of-range grids and protects givens', () => {
    const empty = () => Array.from({ length: 9 }, () => Array<CellValue>(9).fill(null))
    const sparse = empty()
    delete sparse[4][4]
    expect(() => verifyGame(partialPuzzle, sparse)).toThrow()
    expect(() => verifyGame(partialPuzzle, Array.from({ length: 9 }, () => Array(9).fill(1.5)))).toThrow()
    expect(() => verifyGame(partialPuzzle, Array.from({ length: 9 }, () => Array(9).fill(0)))).toThrow()
    expect(() => verifyGame(partialPuzzle, Array.from({ length: 9 }, () => Array(9).fill(10)))).toThrow()

    const changed = partialPuzzle.givens.map((row) => [...row])
    changed[0][0] = 2
    expect(() => verifyGame(partialPuzzle, changed)).toThrow()
    const deleted = partialPuzzle.givens.map((row) => [...row])
    deleted[0][0] = null
    expect(() => verifyGame(partialPuzzle, deleted)).toThrow()
  })

  it('accepts a complete valid grid', () => {
    expect(verifyGame(solvedPuzzle, referenceGrid())).toMatchObject({ status: 'VALIDA', complete: true, violations: [] })
  })

  it('does not mutate puzzle or supplied grid and keeps verification out of saves', () => {
    const puzzle = structuredClone(partialPuzzle)
    const grid = referenceGrid()
    const puzzleBefore = structuredClone(puzzle)
    const gridBefore = structuredClone(grid)
    verifyGame(puzzle, grid)
    expect(puzzle).toEqual(puzzleBefore)
    expect(grid).toEqual(gridBefore)
  })
})
