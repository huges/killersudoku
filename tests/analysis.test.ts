import { describe, expect, it } from 'vitest'
import { analyzeLocalFeasibility } from '../src/domain/analysis'
import { editCell, newGame } from '../src/domain/game'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'
import { type CellValue } from '../src/domain/types'

function pairPuzzle() {
  const puzzle = structuredClone(partialPuzzle)
  puzzle.cages = puzzle.cages.filter((cage) => !['cage-0-2', 'cage-0-3'].includes(cage.id))
  puzzle.cages.push({
    id: 'pair-0',
    cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
    sum: 3,
  })
  return puzzle
}

describe('analyzeLocalFeasibility', () => {
  it('returns combinations in residual-cell order and candidates constrained by the cage', () => {
    const result = analyzeLocalFeasibility(pairPuzzle(), newGame(pairPuzzle()))
    expect(result.status).toBe('infeasible')
    if (result.status === 'invalid_input') return
    const cage = result.cages.find((candidate) => candidate.cageId === 'pair-0')
    expect(cage).toMatchObject({
      remainingCells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
      remainingSum: 3,
      combinations: [],
      cause: 'candidate_conflict',
    })
    expect(result.candidates.find(({ cell }) => cell.row === 0 && cell.col === 2)?.candidates).toEqual([])
    expect(result.candidates.find(({ cell }) => cell.row === 0 && cell.col === 3)?.candidates).toEqual([])
  })

  it('distinguishes an arithmetically impossible residual sum', () => {
    const puzzle = pairPuzzle()
    const game = editCell(puzzle, newGame(puzzle), { row: 0, col: 2 }, { value: 3, notes: [] })
    const result = analyzeLocalFeasibility(puzzle, game)
    expect(result.status).toBe('infeasible')
    if (result.status === 'invalid_input') return
    expect(result.cages.find(({ cageId }) => cageId === 'pair-0')).toMatchObject({
      remainingSum: 0,
      combinations: [],
      cause: 'residual_sum_impossible',
    })
    expect(result.violations).toContainEqual(expect.objectContaining({
      cause: 'residual_sum_impossible',
      cageId: 'pair-0',
      type: 'cage_sum_unreachable',
    }))
  })

  it('represents a complete valid cage with one empty assignment', () => {
    const result = analyzeLocalFeasibility(solvedPuzzle, newGame(solvedPuzzle))
    expect(result.status).toBe('feasible')
    if (result.status === 'invalid_input') return
    expect(result.cages[0]).toMatchObject({ combinations: [[]], status: 'feasible', remainingCells: [] })
    expect(result.violations).toEqual([])
  })

  it('reports a complete cage sum mismatch without retaining candidates', () => {
    const game = editCell(partialPuzzle, newGame(partialPuzzle), { row: 0, col: 2 }, { value: 4, notes: [] })
    const result = analyzeLocalFeasibility(partialPuzzle, game)
    expect(result.status).toBe('infeasible')
    if (result.status === 'invalid_input') return
    expect(result.cages.find(({ cageId }) => cageId === 'cage-0-2')).toMatchObject({
      combinations: [], status: 'infeasible', cause: 'cage_sum_mismatch',
    })
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'cage_sum_mismatch', cageId: 'cage-0-2', cells: [{ row: 0, col: 2 }],
    }))
  })

  it('uses verifyGame conflicts, including conflicts across cages', () => {
    const game = editCell(partialPuzzle, newGame(partialPuzzle), { row: 0, col: 2 }, { value: 1, notes: [] })
    const result = analyzeLocalFeasibility(partialPuzzle, game)
    expect(result.status).toBe('infeasible')
    if (result.status === 'invalid_input') return
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'row_duplicate', cells: [{ row: 0, col: 0 }, { row: 0, col: 2 }],
    }))
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'region_duplicate', cells: [{ row: 0, col: 0 }, { row: 0, col: 2 }],
    }))
  })

  it('returns invalid_input only for expected validation failures and preserves state', () => {
    const game = newGame(partialPuzzle)
    const before = structuredClone(game)
    const sparse = structuredClone(game)
    delete sparse.values[4][4]
    expect(analyzeLocalFeasibility(partialPuzzle, sparse)).toMatchObject({ status: 'invalid_input' })
    expect(game).toEqual(before)

    const changedGiven = structuredClone(game)
    changedGiven.values[0][0] = null
    expect(analyzeLocalFeasibility(partialPuzzle, changedGiven)).toMatchObject({ status: 'invalid_input' })
  })

  it('keeps the analysis separate from the editable game state', () => {
    const puzzle = pairPuzzle()
    const game = newGame(puzzle)
    const puzzleBefore = structuredClone(puzzle)
    const gameBefore = structuredClone(game)
    analyzeLocalFeasibility(puzzle, game)
    expect(puzzle).toEqual(puzzleBefore)
    expect(game).toEqual(gameBefore)
  })
})
