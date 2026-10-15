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
