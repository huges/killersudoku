export const SCHEMA_VERSION = '1.0' as const
export const GRID_SIZE = 9 as const

export type SchemaVersion = typeof SCHEMA_VERSION
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'
export type GameStatus = 'not_started' | 'in_progress' | 'paused' | 'completed'
export type CellValue = number | null

export interface CellCoordinate {
  row: number
  col: number
}

export interface Cage {
  id: string
  cells: CellCoordinate[]
  sum: number
}

export interface PuzzleDefinition {
  schemaVersion: SchemaVersion
  puzzleId: string
  difficulty: Difficulty
  size: typeof GRID_SIZE
  givens: CellValue[][]
  cages: Cage[]
}

export interface CellSnapshot {
  value: CellValue
  notes: number[]
}

export interface HistoryEntry {
  id: string
  type: 'edit_cell'
  cell: CellCoordinate
  before: CellSnapshot
  after: CellSnapshot
  elapsedSecondsAfter: number
}

export interface GameState {
  schemaVersion: SchemaVersion
  puzzleId: string
  values: CellValue[][]
  notes: number[][][]
  elapsedSeconds: number
  status: GameStatus
  history: HistoryEntry[]
  historyIndex: number
}

export interface SaveDocument {
  format: 'killer-sudoku-save'
  schemaVersion: SchemaVersion
  puzzle: PuzzleDefinition
  game: GameState
}

export interface DerivedCageData {
  labelAnchor: CellCoordinate
  label: string
}
