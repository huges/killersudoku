import { describe, expect, it } from 'vitest'
import { analyzeLocalFeasibility } from '../src/domain/analysis'
import { editCell, newGame } from '../src/domain/game'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'

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

  it.each([
    ['column_duplicate', { row: 1, col: 2 }, 3],
    ['region_duplicate', { row: 1, col: 1 }, 3],
  ] as const)('removes candidates eliminated by a %s', (_type, conflictingCell, value) => {
    const puzzle = pairPuzzle()
    const targetCage = puzzle.cages.find((cage) => cage.id === 'pair-0')
    if (!targetCage) throw new Error('missing fixture cage pair-0')
    targetCage.sum = 11
    const conflictingCageId = `cage-${conflictingCell.row}-${conflictingCell.col}`
    const conflictingCage = puzzle.cages.find((cage) => cage.id === conflictingCageId)
    if (!conflictingCage) throw new Error(`missing fixture cage ${conflictingCageId}`)
    conflictingCage.sum = value

    const game = editCell(
      puzzle,
      newGame(puzzle),
      conflictingCell,
      { value, notes: [] },
    )

    const result = analyzeLocalFeasibility(puzzle, game)
    expect(result.status).toBe('feasible')
    if (result.status === 'invalid_input') return
    expect(result.candidates.find(({ cell }) => cell.row === 0 && cell.col === 2)?.candidates)
      .toEqual([4, 5, 6, 7, 8])
    expect(result.violations).not.toContainEqual(expect.objectContaining({ type: _type }))
  })

  it('reports column, region and cage duplicates with all involved cells', () => {
    const puzzle = structuredClone(partialPuzzle)
    puzzle.cages = puzzle.cages.filter((cage) => !['cage-0-2', 'cage-0-3'].includes(cage.id))
    puzzle.cages.push({
      id: 'duplicate-pair',
      cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
      sum: 3,
    })
    let game = newGame(puzzle)
    game = editCell(puzzle, game, { row: 0, col: 2 }, { value: 1, notes: [] })
    game = editCell(puzzle, game, { row: 0, col: 3 }, { value: 1, notes: [] })
    game = editCell(puzzle, game, { row: 1, col: 2 }, { value: 1, notes: [] })

    const result = analyzeLocalFeasibility(puzzle, game)
    expect(result.status).toBe('infeasible')
    if (result.status === 'invalid_input') return
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'column_duplicate',
      cells: [{ row: 0, col: 2 }, { row: 1, col: 2 }],
    }))
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'region_duplicate',
      cells: [{ row: 0, col: 2 }, { row: 1, col: 2 }],
    }))
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'cage_duplicate',
      cageId: 'duplicate-pair',
      cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
    }))
    const cage = result.cages.find(({ cageId }) => cageId === 'duplicate-pair')
    expect(cage).toMatchObject({ combinations: [], status: 'infeasible', cause: 'cage_duplicate' })
    expect(result.candidates.find(({ cell }) => cell.row === 0 && cell.col === 2)?.candidates).toEqual([])
    expect(result.candidates.find(({ cell }) => cell.row === 0 && cell.col === 3)?.candidates).toEqual([])
    expect(result.violations.slice(0, 3).map(({ type }) => type)).toEqual([
      'row_duplicate',
      'column_duplicate',
      'region_duplicate',
    ])
    expect(result.violations.find(({ type, cageId }) => type === 'cage_duplicate' && cageId === 'duplicate-pair')?.cells)
      .toEqual([{ row: 0, col: 2 }, { row: 0, col: 3 }])
    expect(result.cages.map(({ cageId }) => cageId)).toEqual(puzzle.cages.map(({ id }) => id))
    expect(result.candidates[0]?.cell).toEqual({ row: 0, col: 0 })
    expect(result.candidates.at(-1)?.cell).toEqual({ row: 8, col: 8 })
  })

  it('reports a partial cage duplicate with empty combinations and candidates', () => {
    const puzzle = structuredClone(partialPuzzle)
    puzzle.cages = puzzle.cages.filter((cage) => !['cage-0-2', 'cage-0-3', 'cage-0-4'].includes(cage.id))
    puzzle.cages.push({
      id: 'partial-duplicate',
      cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }, { row: 0, col: 4 }],
      sum: 12,
    })
    let game = newGame(puzzle)
    game = editCell(puzzle, game, { row: 0, col: 2 }, { value: 5, notes: [] })
    game = editCell(puzzle, game, { row: 0, col: 3 }, { value: 5, notes: [] })

    const result = analyzeLocalFeasibility(puzzle, game)
    expect(result.status).toBe('infeasible')
    if (result.status === 'invalid_input') return
    expect(result.cages.find(({ cageId }) => cageId === 'partial-duplicate')).toMatchObject({
      remainingCells: [{ row: 0, col: 4 }],
      combinations: [],
      status: 'infeasible',
      cause: 'cage_duplicate',
    })
    expect(result.candidates.find(({ cell }) => cell.row === 0 && cell.col === 4)?.candidates).toEqual([])
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'cage_duplicate',
      cageId: 'partial-duplicate',
      cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
    }))
  })

  it('deduplicates a cage sum mismatch already reported by verifyGame', () => {
    const game = editCell(partialPuzzle, newGame(partialPuzzle), { row: 0, col: 2 }, { value: 4, notes: [] })
    const result = analyzeLocalFeasibility(partialPuzzle, game)
    expect(result.status).toBe('infeasible')
    if (result.status === 'invalid_input') return
    const mismatches = result.violations.filter((violation) =>
      violation.type === 'cage_sum_mismatch' && violation.cageId === 'cage-0-2',
    )
    expect(mismatches).toHaveLength(1)
  })

  it('keeps cage and combination ordering deterministic without losing cell association', () => {
    const puzzle = structuredClone(partialPuzzle)
    puzzle.cages = puzzle.cages.filter((cage) => !['cage-0-2', 'cage-0-3'].includes(cage.id))
    puzzle.cages.push({
      id: 'ordered-pair',
      cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
      sum: 11,
    })
    const game = newGame(puzzle)
    const first = analyzeLocalFeasibility(puzzle, game)
    const second = analyzeLocalFeasibility(puzzle, game)
    expect(first).toEqual(second)
    expect(first.status).toBe('feasible')
    if (first.status === 'invalid_input') return
    const cage = first.cages.find(({ cageId }) => cageId === 'ordered-pair')
    expect(cage).toMatchObject({
      remainingCells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
      combinations: [[3, 8], [4, 7], [5, 6], [6, 5], [7, 4], [8, 3]],
    })
    expect(first.candidates.find(({ cell }) => cell.row === 0 && cell.col === 2)?.candidates)
      .toEqual([3, 4, 5, 6, 7, 8])
    expect(first.candidates.find(({ cell }) => cell.row === 0 && cell.col === 3)?.candidates)
      .toEqual([3, 4, 5, 6, 7, 8])
  })

  it('reports local feasibility without claiming global solvability', () => {
    const puzzle = pairPuzzle()
    puzzle.cages = puzzle.cages.filter((cage) => cage.id !== 'pair-0')
    puzzle.cages.push({ id: 'global-check-pair', cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }], sum: 11 })
    const game = newGame(puzzle)
    const result = analyzeLocalFeasibility(puzzle, game)
    expect(result.status).toBe('feasible')
    expect(game.status).toBe('not_started')
    expect(game.values.flat().some((value) => value === null)).toBe(true)
  })
})
