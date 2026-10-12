import {
  type CellCoordinate,
  type CellSnapshot,
  type GameState,
  type PuzzleDefinition,
  type SaveDocument,
  GRID_SIZE,
  SCHEMA_VERSION,
} from './types'

const difficulties = new Set(['easy', 'medium', 'hard', 'expert'])
const statuses = new Set(['not_started', 'in_progress', 'paused', 'completed'])

export function validationError(message: string): never {
  throw new Error(`Invalid domain data: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

export function isValidCoordinate(value: unknown): value is CellCoordinate {
  return isRecord(value) && isInteger(value.row) && isInteger(value.col)
    && value.row >= 0 && value.row < GRID_SIZE
    && value.col >= 0 && value.col < GRID_SIZE
}

function coordinateKey(coordinate: CellCoordinate): string {
  return `${coordinate.row}:${coordinate.col}`
}

function sameSnapshot(left: CellSnapshot, right: CellSnapshot): boolean {
  return left.value === right.value
    && left.notes.length === right.notes.length
    && left.notes.every((note, index) => note === right.notes[index])
}

function validateMatrix<T>(matrix: unknown, name: string, validCell: (value: unknown) => boolean): asserts matrix is T[][] {
  if (!Array.isArray(matrix) || matrix.length !== GRID_SIZE
    || matrix.some((row) => !Array.isArray(row) || row.length !== GRID_SIZE
      || row.some((value) => !validCell(value)))) {
    validationError(`${name} must be a ${GRID_SIZE}x${GRID_SIZE} matrix`)
  }
}

function isCellValue(value: unknown): value is number | null {
  return value === null || (isInteger(value) && value >= 1 && value <= 9)
}

function validateNotes(notes: unknown, name: string): asserts notes is number[] {
  if (!Array.isArray(notes) || notes.some((note) => !isInteger(note) || note < 1 || note > 9)
    || notes.some((note, index) => index > 0 && notes[index - 1] >= note)) {
    validationError(`${name} must contain distinct notes from 1 to 9 in ascending order`)
  }
}

function validateSnapshot(snapshot: unknown, name: string): asserts snapshot is CellSnapshot {
  if (!isRecord(snapshot) || !isCellValue(snapshot.value)) validationError(`${name}.value is invalid`)
  validateNotes(snapshot.notes, `${name}.notes`)
  if (snapshot.value !== null && snapshot.notes.length > 0) {
    validationError(`${name} cannot contain notes with a value`)
  }
}

function validateCoordinateList(cells: unknown, name: string): asserts cells is CellCoordinate[] {
  if (!Array.isArray(cells) || cells.length === 0) validationError(`${name} must not be empty`)
  const seen = new Set<string>()
  let previous: CellCoordinate | undefined
  for (const cell of cells) {
    if (!isValidCoordinate(cell)) validationError(`${name} contains an invalid coordinate`)
    const key = coordinateKey(cell)
    if (seen.has(key)) validationError(`${name} contains duplicate coordinates`)
    seen.add(key)
    if (previous && (cell.row < previous.row || (cell.row === previous.row && cell.col < previous.col))) {
      validationError(`${name} must use canonical row/column order`)
    }
    previous = cell
  }
}

function orthogonallyConnected(cells: CellCoordinate[]): boolean {
  const remaining = new Set(cells.map(coordinateKey))
  const queue = [cells[0]]
  remaining.delete(coordinateKey(cells[0]))
  while (queue.length > 0) {
    const current = queue.shift() as CellCoordinate
    for (const next of [{ row: current.row - 1, col: current.col }, { row: current.row + 1, col: current.col }, { row: current.row, col: current.col - 1 }, { row: current.row, col: current.col + 1 }]) {
      const key = coordinateKey(next)
      if (remaining.has(key)) {
        remaining.delete(key)
        queue.push(next)
      }
    }
  }
  return remaining.size === 0
}

function possibleDistinctSums(count: number, available: number[]): Set<number> {
  const result = new Set<number>()
  const visit = (start: number, left: number, sum: number): void => {
    if (left === 0) {
      result.add(sum)
      return
    }
    for (let index = start; index <= available.length - left; index += 1) {
      visit(index + 1, left - 1, sum + available[index])
    }
  }
  visit(0, count, 0)
  return result
}

export function validatePuzzle(puzzle: PuzzleDefinition): void {
  if (!isRecord(puzzle) || puzzle.schemaVersion !== SCHEMA_VERSION || typeof puzzle.puzzleId !== 'string' || puzzle.puzzleId.length === 0
    || !difficulties.has(puzzle.difficulty) || puzzle.size !== GRID_SIZE) validationError('invalid puzzle metadata')
  validateMatrix(puzzle.givens, 'givens', isCellValue)
  const rowSets = Array.from({ length: GRID_SIZE }, () => new Set<number>())
  const colSets = Array.from({ length: GRID_SIZE }, () => new Set<number>())
  const regionSets = Array.from({ length: GRID_SIZE }, () => new Set<number>())
  for (let row = 0; row < GRID_SIZE; row += 1) for (let col = 0; col < GRID_SIZE; col += 1) {
    const value = puzzle.givens[row][col]
    if (value !== null) {
      const region = Math.floor(row / 3) * 3 + Math.floor(col / 3)
      if (rowSets[row].has(value) || colSets[col].has(value) || regionSets[region].has(value)) validationError('duplicate given')
      rowSets[row].add(value); colSets[col].add(value); regionSets[region].add(value)
    }
  }
  if (!Array.isArray(puzzle.cages)) validationError('cages must be an array')
  const ids = new Set<string>(); const covered = new Set<string>()
  for (const cage of puzzle.cages) {
    if (!isRecord(cage) || typeof cage.id !== 'string' || cage.id.length === 0 || ids.has(cage.id) || !isInteger(cage.sum)) validationError('invalid cage')
    ids.add(cage.id); validateCoordinateList(cage.cells, `cage ${cage.id}.cells`)
    if (!orthogonallyConnected(cage.cells)) validationError('cage is not connected')
    const count = cage.cells.length
    const min = count * (count + 1) / 2; const max = count * (19 - count) / 2
    if (count > 9 || cage.sum < min || cage.sum > max) validationError('cage sum is outside its bounds')
    const givens: number[] = []
    for (const cell of cage.cells) {
      const key = coordinateKey(cell)
      if (covered.has(key)) validationError('cages overlap')
      covered.add(key)
      const value = puzzle.givens[cell.row][cell.col]
      if (value !== null) givens.push(value)
    }
    if (new Set(givens).size !== givens.length || givens.reduce((sum, value) => sum + value, 0) > cage.sum) validationError('incompatible cage givens')
    const missing = count - givens.length
    const available = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((value) => !givens.includes(value))
    if (!possibleDistinctSums(missing, available).has(cage.sum - givens.reduce((sum, value) => sum + value, 0))) validationError('cage sum is locally incompatible')
  }
  if (covered.size !== GRID_SIZE * GRID_SIZE) validationError('cages must cover the grid exactly')
}

export function validateCellSnapshot(snapshot: unknown, name = 'snapshot'): asserts snapshot is CellSnapshot {
  validateSnapshot(snapshot, name)
}

export function validateGameState(puzzle: PuzzleDefinition, game: GameState): void {
  validatePuzzle(puzzle)
  if (!isRecord(game) || !Array.isArray(game.history) || game.schemaVersion !== SCHEMA_VERSION || game.puzzleId !== puzzle.puzzleId
    || !statuses.has(game.status) || !isInteger(game.elapsedSeconds) || game.elapsedSeconds < 0
    || !isInteger(game.historyIndex) || game.historyIndex < -1 || game.historyIndex >= game.history.length) validationError('invalid game metadata')
  validateMatrix(game.values, 'values', isCellValue)
  validateMatrix(game.notes, 'notes', (value) => Array.isArray(value))
  for (let row = 0; row < GRID_SIZE; row += 1) for (let col = 0; col < GRID_SIZE; col += 1) {
    const value = game.values[row][col]; const notes = game.notes[row][col]
    validateNotes(notes, `notes[${row}][${col}]`)
    if (puzzle.givens[row][col] !== null && value !== puzzle.givens[row][col]) validationError('given was changed')
    if (puzzle.givens[row][col] !== null && notes.length > 0) validationError('given has notes')
    if (value !== null && notes.length > 0) validationError('valued cell has notes')
  }
  if (game.status === 'not_started' && (game.elapsedSeconds !== 0 || game.history.length !== 0 || game.historyIndex !== -1
    || game.values.some((row, r) => row.some((value, c) => value !== puzzle.givens[r][c]))
    || game.notes.some((row) => row.some((notes) => notes.length !== 0)))) validationError('invalid not_started state')
  const replayValues = puzzle.givens.map((row) => [...row])
  const replayNotes = puzzle.givens.map((row) => row.map(() => [] as number[]))
  let maxElapsed = 0
  const historyIds = new Set<string>()
  for (let index = 0; index < game.history.length; index += 1) {
    const entry = game.history[index]
    if (!isRecord(entry) || entry.type !== 'edit_cell' || typeof entry.id !== 'string' || entry.id.length === 0 || historyIds.has(entry.id)
      || !isValidCoordinate(entry.cell) || !isInteger(entry.elapsedSecondsAfter) || entry.elapsedSecondsAfter < maxElapsed) validationError('invalid history entry')
    historyIds.add(entry.id)
    validateSnapshot(entry.before, 'history.before')
    validateSnapshot(entry.after, 'history.after')
    if (puzzle.givens[entry.cell.row][entry.cell.col] !== null) validationError('history changes a given')
    const before = { value: replayValues[entry.cell.row][entry.cell.col], notes: replayNotes[entry.cell.row][entry.cell.col] }
    if (!sameSnapshot(before, entry.before)) validationError('history before does not match replay')
    replayValues[entry.cell.row][entry.cell.col] = entry.after.value
    replayNotes[entry.cell.row][entry.cell.col] = [...entry.after.notes]
    maxElapsed = entry.elapsedSecondsAfter
  }
  if (game.elapsedSeconds < maxElapsed) validationError('elapsed time precedes history')

  const currentValues = puzzle.givens.map((row) => [...row])
  const currentNotes = puzzle.givens.map((row) => row.map(() => [] as number[]))
  for (let index = 0; index <= game.historyIndex; index += 1) {
    const entry = game.history[index]
    currentValues[entry.cell.row][entry.cell.col] = entry.after.value
    currentNotes[entry.cell.row][entry.cell.col] = [...entry.after.notes]
  }
  for (let row = 0; row < GRID_SIZE; row += 1) for (let col = 0; col < GRID_SIZE; col += 1) {
    if (game.values[row][col] !== currentValues[row][col]
      || !sameSnapshot({ value: game.values[row][col], notes: game.notes[row][col] }, { value: currentValues[row][col], notes: currentNotes[row][col] })) {
      validationError('game state does not match history replay')
    }
  }
  if (game.status === 'completed') validateCompleted(puzzle, game)
}

function validateCompleted(puzzle: PuzzleDefinition, game: GameState): void {
  for (const row of game.values) if (row.some((value) => value === null)) validationError('completed game is incomplete')
  for (let row = 0; row < 9; row += 1) {
    if (new Set(game.values[row] as number[]).size !== 9) validationError('completed rows conflict')
    const column = game.values.map((line) => line[row]) as number[]
    if (new Set(column).size !== 9) validationError('completed columns conflict')
  }
  for (let boxRow = 0; boxRow < 3; boxRow += 1) for (let boxCol = 0; boxCol < 3; boxCol += 1) {
    const box: number[] = []
    for (let row = boxRow * 3; row < boxRow * 3 + 3; row += 1) for (let col = boxCol * 3; col < boxCol * 3 + 3; col += 1) box.push(game.values[row][col] as number)
    if (new Set(box).size !== 9) validationError('completed regions conflict')
  }
  for (const cage of puzzle.cages) {
    const values = cage.cells.map((cell) => game.values[cell.row][cell.col] as number)
    if (new Set(values).size !== values.length || values.reduce((sum, value) => sum + value, 0) !== cage.sum) validationError('completed cage is invalid')
  }
}

export function validateSaveDocument(document: SaveDocument): void {
  if (!isRecord(document) || document.format !== 'killer-sudoku-save' || document.schemaVersion !== SCHEMA_VERSION) validationError('invalid save document')
  validatePuzzle(document.puzzle); validateGameState(document.puzzle, document.game)
}
