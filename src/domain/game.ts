import {
  type CellCoordinate,
  type CellSnapshot,
  type GameState,
  type PuzzleDefinition,
} from './types'
import { validateCellSnapshot, validateGameState, validatePuzzle, validationError, isValidCoordinate } from './validation'

function cloneSnapshot(snapshot: CellSnapshot): CellSnapshot {
  return { value: snapshot.value, notes: [...snapshot.notes] }
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    values: state.values.map((row) => [...row]),
    notes: state.notes.map((row) => row.map((notes) => [...notes])),
    history: state.history.map((entry) => ({
      ...entry,
      cell: { ...entry.cell },
      before: cloneSnapshot(entry.before),
      after: cloneSnapshot(entry.after),
    })),
  }
}

function snapshotAt(state: GameState, coordinate: CellCoordinate): CellSnapshot {
  return {
    value: state.values[coordinate.row][coordinate.col],
    notes: [...state.notes[coordinate.row][coordinate.col]],
  }
}

function sameSnapshot(left: CellSnapshot, right: CellSnapshot): boolean {
  return left.value === right.value
    && left.notes.length === right.notes.length
    && left.notes.every((note, index) => note === right.notes[index])
}

function applySnapshot(state: GameState, coordinate: CellCoordinate, snapshot: CellSnapshot): void {
  state.values[coordinate.row][coordinate.col] = snapshot.value
  state.notes[coordinate.row][coordinate.col] = [...snapshot.notes]
}

export function newGame(puzzle: PuzzleDefinition): GameState {
  validatePuzzle(puzzle)
  const state: GameState = {
    schemaVersion: '1.0',
    puzzleId: puzzle.puzzleId,
    values: puzzle.givens.map((row) => [...row]),
    notes: puzzle.givens.map((row) => row.map(() => [])),
    elapsedSeconds: 0,
    status: 'not_started',
    history: [],
    historyIndex: -1,
  }
  return state
}

export function editCell(
  puzzle: PuzzleDefinition,
  state: GameState,
  coordinate: CellCoordinate,
  snapshot: CellSnapshot,
): GameState {
  validatePuzzle(puzzle)
  validateGameState(puzzle, state)
  if (!isValidCoordinate(coordinate)) validationError('invalid edit coordinate')
  if (state.status === 'paused' || state.status === 'completed') validationError('editing is not allowed in this state')
  if (puzzle.givens[coordinate.row][coordinate.col] !== null) validationError('cannot edit a given')
  validateCellSnapshot(snapshot)

  const before = snapshotAt(state, coordinate)
  if (snapshot.value === before.value
    && snapshot.notes.length === before.notes.length
    && snapshot.notes.every((note, index) => note === before.notes[index])) return cloneState(state)

  const next = cloneState(state)
  const retainedHistory = next.history.slice(0, next.historyIndex + 1)
  const entry = {
    id: `edit-${retainedHistory.length}-${coordinate.row}-${coordinate.col}`,
    type: 'edit_cell' as const,
    cell: { ...coordinate },
    before: cloneSnapshot(before),
    after: cloneSnapshot(snapshot),
    elapsedSecondsAfter: state.elapsedSeconds,
  }
  next.history = [...retainedHistory, entry]
  next.historyIndex = next.history.length - 1
  applySnapshot(next, coordinate, snapshot)
  if (next.status === 'not_started') next.status = 'in_progress'
  return next
}

export function undo(puzzle: PuzzleDefinition, state: GameState): GameState {
  validatePuzzle(puzzle)
  validateGameState(puzzle, state)
  if (state.status === 'completed') validationError('undo is not allowed when completed')
  if (state.status !== 'in_progress' && state.status !== 'paused') validationError('undo is not allowed in this state')
  if (state.historyIndex < 0) return cloneState(state)
  const next = cloneState(state)
  const entry = next.history[next.historyIndex]
  applySnapshot(next, entry.cell, entry.before)
  next.historyIndex -= 1
  return next
}

export function redo(puzzle: PuzzleDefinition, state: GameState): GameState {
  validatePuzzle(puzzle)
  validateGameState(puzzle, state)
  if (state.status === 'completed') validationError('redo is not allowed when completed')
  if (state.status !== 'in_progress' && state.status !== 'paused') validationError('redo is not allowed in this state')
  if (state.historyIndex >= state.history.length - 1) return cloneState(state)
  const next = cloneState(state)
  const entry = next.history[next.historyIndex + 1]
  applySnapshot(next, entry.cell, entry.after)
  next.historyIndex += 1
  return next
}

export function pause(state: GameState): GameState {
  if (state.status !== 'in_progress') validationError('pause requires an in-progress game')
  return { ...cloneState(state), status: 'paused' }
}

export function resume(state: GameState): GameState {
  if (state.status !== 'paused') validationError('resume requires a paused game')
  return { ...cloneState(state), status: 'in_progress' }
}

export function complete(puzzle: PuzzleDefinition, state: GameState): GameState {
  validatePuzzle(puzzle)
  validateGameState(puzzle, state)
  if (state.status !== 'in_progress' && state.status !== 'paused') validationError('complete requires an active game')
  const next = cloneState(state)
  next.status = 'completed'
  validateGameState(puzzle, next)
  return next
}

export { sameSnapshot }
