import { describe, expect, it } from 'vitest'
import { analyzeLocalFeasibility } from '../src/domain/analysis'
import { editCell, newGame } from '../src/domain/game'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'
import { validateGameState, validatePuzzle } from '../src/domain/validation'

function analyzeValid(
  puzzle: Parameters<typeof analyzeLocalFeasibility>[0],
  game: Parameters<typeof analyzeLocalFeasibility>[1],
) {
  validatePuzzle(puzzle)
  validateGameState(puzzle, game)
  return analyzeLocalFeasibility(puzzle, game)
}

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

function candidateIsolationPuzzle(conflictCell: { row: number; col: number }, values: number[]) {
  const puzzle = structuredClone(partialPuzzle)
  puzzle.cages = puzzle.cages.filter((cage) => !['cage-0-2', 'cage-0-3'].includes(cage.id))
  const completion = Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => {
    const base = ((row * 3 + Math.floor(row / 3) + col) % 9)
    return values[base]
  }))
  puzzle.cages = puzzle.cages.map((cage) => ({
    ...cage,
    sum: completion[cage.cells[0].row][cage.cells[0].col],
  }))
  puzzle.cages.push({ id: 'pair-0', cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }], sum: 11 })
  puzzle.cages = puzzle.cages.filter((cage) => cage.id !== `cage-${conflictCell.row}-${conflictCell.col}`)
  puzzle.cages.push({ id: `cage-${conflictCell.row}-${conflictCell.col}`, cells: [conflictCell], sum: completion[conflictCell.row][conflictCell.col] })
  return puzzle
}

describe('analyzeLocalFeasibility', () => {
  it('returns combinations in residual-cell order and candidates constrained by the cage', () => {
    const puzzle = pairPuzzle()
    const result = analyzeValid(puzzle, newGame(puzzle))
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
    const result = analyzeValid(puzzle, game)
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
    const result = analyzeValid(solvedPuzzle, newGame(solvedPuzzle))
    expect(result.status).toBe('feasible')
    if (result.status === 'invalid_input') return
    expect(result.cages[0]).toMatchObject({ combinations: [[]], status: 'feasible', remainingCells: [] })
    expect(result.violations).toEqual([])
  })

  it('reports a complete cage sum mismatch without retaining candidates', () => {
    const game = editCell(partialPuzzle, newGame(partialPuzzle), { row: 0, col: 2 }, { value: 4, notes: [] })
    const result = analyzeValid(partialPuzzle, game)
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
    const result = analyzeValid(partialPuzzle, game)
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
    analyzeValid(puzzle, game)
    expect(puzzle).toEqual(puzzleBefore)
    expect(game).toEqual(gameBefore)
  })

  it.each([
    // Column fixture: before the injected 6 at (1,2), Sudoku candidates are
    // (0,2)=[3,5,6,7,8,9] and (0,3)=[3,4,5,6,7,8,9]. The distinct ordered
    // pairs summing to 11 are (2,9), (3,8), (4,7), (5,6), (6,5), (7,4),
    // (8,3), and (9,2); filtering by the Sudoku candidates leaves
    // (3,8), (5,6), (6,5), (7,4), and (8,3). The column 6 removes (6,5),
    // so (7,4) and (8,3) remain and the first cell's final candidates are
    // [3,5,7,8].
    ['column_duplicate', { row: 1, col: 2 }, [3, 5, 7, 8]],
    // Region fixture: before the injected 5 at (1,1), the same Sudoku
    // candidates and ordered pairs apply. The region 5 removes (5,6), while
    // (7,4) and (8,3) remain; the first cell's final candidates are
    // [3,6,7,8].
    ['region_duplicate', { row: 1, col: 1 }, [3, 6, 7, 8]],
  ] as const)('removes candidates eliminated by a %s', (_type, conflictingCell, expectedCandidates) => {
    const puzzle = candidateIsolationPuzzle(conflictingCell, [1, 2, 3, 4, 5, 6, 7, 8, 9])
    const game = editCell(
      puzzle,
      newGame(puzzle),
      conflictingCell,
      { value: puzzle.cages.find((cage) => cage.id === `cage-${conflictingCell.row}-${conflictingCell.col}`)?.sum ?? 0, notes: [] },
    )

    const result = analyzeValid(puzzle, game)
    expect(result.status).toBe('feasible')
    if (result.status === 'invalid_input') return
    expect(result.candidates.find(({ cell }) => cell.row === 0 && cell.col === 2)?.candidates)
      .toEqual(expectedCandidates)
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

    const result = analyzeValid(puzzle, game)
    expect(result.status).toBe('infeasible')
    if (result.status === 'invalid_input') return
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'column_duplicate',
      cells: [{ row: 0, col: 2 }, { row: 1, col: 2 }],
    }))
    // The given (0,0)=1 is in the same 3x3 region as both duplicate values;
    // all three cells therefore belong to the reported violation.
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: 'region_duplicate',
      cells: [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 1, col: 2 }],
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

    const result = analyzeValid(puzzle, game)
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
    const result = analyzeValid(partialPuzzle, game)
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
    const first = analyzeValid(puzzle, game)
    const second = analyzeValid(puzzle, game)
    expect(first).toEqual(second)
    expect(first.status).toBe('feasible')
    if (first.status === 'invalid_input') return
    const cage = first.cages.find(({ cageId }) => cageId === 'ordered-pair')
    expect(cage).toMatchObject({
      remainingCells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
      // Cell (0,2) cannot contain 4 because (1,0)=4 is in its region;
      // therefore the independent valid ordered pairs are (3,8), (5,6),
      // (6,5), (7,4), and (8,3), preserving each digit's cell association.
      combinations: [[3, 8], [5, 6], [6, 5], [7, 4], [8, 3]],
    })
    // For (0,2), the given 4 in (1,0) is in the same region, so 4 is
    // excluded; its positional cage candidates are [3,5,6,7,8]. Cell (0,3)
    // has no additional given in its region and Sudoku permits 7, but 7 only
    // occurs at the first position in the valid assignments. Its positional
    // candidates must therefore be [3,4,5,6,8], not the cage-wide union.
    expect(first.candidates.find(({ cell }) => cell.row === 0 && cell.col === 2)?.candidates)
      .toEqual([3, 5, 6, 7, 8])
    expect(first.candidates.find(({ cell }) => cell.row === 0 && cell.col === 3)?.candidates)
      .toEqual([3, 4, 5, 6, 8])
  })

  it('reports local feasibility without claiming global solvability', () => {
    const puzzle = pairPuzzle()
    puzzle.cages = puzzle.cages.filter((cage) => cage.id !== 'pair-0')
    puzzle.cages.push({ id: 'global-check-pair', cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }], sum: 11 })
    const game = newGame(puzzle)
    const result = analyzeValid(puzzle, game)
    expect(result.status).toBe('feasible')
    expect(game.status).toBe('not_started')
    expect(game.values.flat().some((value) => value === null)).toBe(true)
  })
})
