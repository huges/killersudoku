import { type PuzzleDefinition } from './types'

export function referenceValue(row: number, col: number): number {
  return ((row * 3 + Math.floor(row / 3) + col) % 9) + 1
}

function createPuzzle(givens: (number | null)[][], puzzleId: string): PuzzleDefinition {
  return {
    schemaVersion: '1.0',
    puzzleId,
    difficulty: 'easy',
    size: 9,
    givens,
    cages: Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => ({
      id: `cage-${row}-${col}`,
      cells: [{ row, col }],
      sum: referenceValue(row, col),
    }))).flat(),
  }
}

const partialGivens = Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => {
  if (row === 0 && col === 0) return 1
  if (row === 0 && col === 1) return 2
  if (row === 1 && col === 0) return 4
  return null
}))

export const partialPuzzle = createPuzzle(partialGivens, 'fixture-partial')

export const solvedPuzzle = createPuzzle(
  Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => referenceValue(row, col))),
  'fixture-solved',
)

/** A structurally valid puzzle whose cage constraints have no compatible solution. */
export function unsatisfiablePuzzle(): PuzzleDefinition {
  const puzzle = structuredClone(partialPuzzle)
  puzzle.cages.find((cage) => cage.id === 'cage-0-2')!.sum = 3
  puzzle.cages.find((cage) => cage.id === 'cage-0-3')!.sum = 3
  return puzzle
}

/** A structurally valid puzzle with the two independent first rows used by solver tests. */
export function multipleSolutionPuzzle(): PuzzleDefinition {
  const puzzle = structuredClone(solvedPuzzle)
  puzzle.puzzleId = 'fixture-multiple'
  puzzle.givens = puzzle.givens.map((row, rowIndex) => rowIndex < 2 ? Array(9).fill(null) : [...row])
  const fixed = puzzle.cages.filter((cage) => cage.cells[0].row >= 2)
  puzzle.cages = [
    { id: 'row-0', cells: Array.from({ length: 9 }, (_, col) => ({ row: 0, col })), sum: 45 },
    { id: 'row-1', cells: Array.from({ length: 9 }, (_, col) => ({ row: 1, col })), sum: 45 },
    ...fixed,
  ]
  return puzzle
}
