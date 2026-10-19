import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { type CellCoordinate, type PuzzleDefinition } from './types'
import { validatePuzzle, ValidationError } from './validation'

export interface PlayableClue {
  row: number
  col: number
  value: number
}

export interface PlayableCage {
  cells: CellCoordinate[]
  sum: number
}

export interface PlayableContent {
  size: 9
  clues: PlayableClue[]
  cages: PlayableCage[]
}

const gridSize = 9
const clueKeys = ['row', 'col', 'value']
const cageKeys = ['cells', 'sum']
const contentKeys = ['size', 'clues', 'cages']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function coordinateKey(cell: CellCoordinate): string {
  return `${cell.row}:${cell.col}`
}

function validateCoordinate(value: unknown, path: string): asserts value is CellCoordinate {
  if (!isRecord(value) || !hasOnlyKeys(value, ['row', 'col'])
    || !isInteger(value.row) || !isInteger(value.col)
    || value.row < 0 || value.row >= gridSize || value.col < 0 || value.col >= gridSize) {
    const location = isRecord(value) && isInteger(value.row) && isInteger(value.col)
      ? ` (${value.row},${value.col})`
      : ''
    throw new ValidationError(`${path}${location}: coordinate is outside the grid or malformed`)
  }
}

function distinctSums(count: number, available: number[]): Set<number> {
  const result = new Set<number>()
  const visit = (start: number, left: number, sum: number): void => {
    if (left === 0) { result.add(sum); return }
    for (let index = start; index <= available.length - left; index += 1) {
      visit(index + 1, left - 1, sum + available[index])
    }
  }
  visit(0, count, 0)
  return result
}

function connected(cells: CellCoordinate[]): boolean {
  const remaining = new Set(cells.map(coordinateKey))
  const queue = [cells[0]]
  remaining.delete(coordinateKey(cells[0]))
  while (queue.length > 0) {
    const current = queue.shift() as CellCoordinate
    for (const next of [
      { row: current.row - 1, col: current.col }, { row: current.row + 1, col: current.col },
      { row: current.row, col: current.col - 1 }, { row: current.row, col: current.col + 1 },
    ]) {
      const key = coordinateKey(next)
      if (remaining.has(key)) { remaining.delete(key); queue.push(next) }
    }
  }
  return remaining.size === 0
}

function validateContent(value: unknown): asserts value is PlayableContent {
  if (!isRecord(value) || !hasOnlyKeys(value, contentKeys) || value.size !== gridSize) {
    throw new ValidationError('content.size: must be the integer 9 and content must contain only size, clues and cages')
  }
  if (!Array.isArray(value.clues)) throw new ValidationError('content.clues: must be an array')
  const rowSets = Array.from({ length: gridSize }, () => new Set<number>())
  const colSets = Array.from({ length: gridSize }, () => new Set<number>())
  const regionSets = Array.from({ length: gridSize }, () => new Set<number>())
  const clueCells = new Map<string, number>()
  for (let index = 0; index < value.clues.length; index += 1) {
    const path = `content.clues[${index}]`
    if (!(index in value.clues)) throw new ValidationError(`${path}: array element is missing`)
    const clue: unknown = value.clues[index]
    if (clue === undefined || clue === null) throw new ValidationError(`${path}: array element is missing`)
    if (!isRecord(clue) || !hasOnlyKeys(clue, clueKeys)) throw new ValidationError(`${path}: must contain only row, col and value`)
    if (!isInteger(clue.row) || clue.row < 0 || clue.row >= gridSize) throw new ValidationError(`${path}.row: must be an integer from 0 to 8`)
    if (!isInteger(clue.col) || clue.col < 0 || clue.col >= gridSize) throw new ValidationError(`${path}.col: must be an integer from 0 to 8`)
    if (!isInteger(clue.value) || clue.value < 1 || clue.value > 9) throw new ValidationError(`${path}.value: must be an integer from 1 to 9`)
    const key = `${clue.row}:${clue.col}`
    if (clueCells.has(key)) throw new ValidationError(`${path} (${clue.row},${clue.col}): duplicate clue coordinate`)
    const region = Math.floor(clue.row / 3) * 3 + Math.floor(clue.col / 3)
    if (rowSets[clue.row].has(clue.value) || colSets[clue.col].has(clue.value) || regionSets[region].has(clue.value)) {
      throw new ValidationError(`${path} (${clue.row},${clue.col}): conflicts with another clue`)
    }
    clueCells.set(key, clue.value)
    rowSets[clue.row].add(clue.value); colSets[clue.col].add(clue.value); regionSets[region].add(clue.value)
  }
  if (!Array.isArray(value.cages)) throw new ValidationError('content.cages: must be an array')
  const covered = new Set<string>()
  for (let cageIndex = 0; cageIndex < value.cages.length; cageIndex += 1) {
    const path = `content.cages[${cageIndex}]`
    if (!(cageIndex in value.cages)) throw new ValidationError(`${path}: array element is missing`)
    const cage: unknown = value.cages[cageIndex]
    if (cage === undefined || cage === null) throw new ValidationError(`${path}: array element is missing`)
    if (!isRecord(cage) || !hasOnlyKeys(cage, cageKeys)) throw new ValidationError(`${path}: must contain only cells and sum`)
    if (!Array.isArray(cage.cells) || cage.cells.length === 0) throw new ValidationError(`${path}.cells: must not be empty`)
    if (!isInteger(cage.sum)) throw new ValidationError(`${path}.sum: must be an integer`)
    const local = new Set<string>()
    for (let cellIndex = 0; cellIndex < cage.cells.length; cellIndex += 1) {
      const cellPath = `${path}.cells[${cellIndex}]`
      if (!(cellIndex in cage.cells)) throw new ValidationError(`${cellPath}: array element is missing`)
      const cell = cage.cells[cellIndex]
      validateCoordinate(cell, cellPath)
      const key = coordinateKey(cell)
      if (local.has(key)) throw new ValidationError(`${cellPath} (${cell.row},${cell.col}): duplicate coordinate`)
      if (covered.has(key)) throw new ValidationError(`${cellPath} (${cell.row},${cell.col}): overlaps another cage`)
      local.add(key); covered.add(key)
    }
    if (!connected(cage.cells)) throw new ValidationError(`${path}.cells: cage is not connected`)
    const count = cage.cells.length
    if (count > 9) throw new ValidationError(`${path}.cells: cannot contain more than 9 cells`)
    const fixed = cage.cells.map((cell) => clueCells.get(coordinateKey(cell))).filter((item): item is number => item !== undefined)
    const fixedSum = fixed.reduce((sum, item) => sum + item, 0)
    if (new Set(fixed).size !== fixed.length || fixedSum > cage.sum) throw new ValidationError(`${path}.sum: incompatible with fixed clues`)
    const minimum = count * (count + 1) / 2
    const maximum = count * (19 - count) / 2
    if (cage.sum < minimum || cage.sum > maximum) throw new ValidationError(`${path}.sum: outside distinct-digit bounds`)
    const available = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((digit) => !fixed.includes(digit))
    if (!distinctSums(count - fixed.length, available).has(cage.sum - fixedSum)) throw new ValidationError(`${path}.sum: incompatible with fixed clues`)
  }
  if (covered.size !== gridSize * gridSize) throw new ValidationError('content.cages: must cover all 81 cells exactly')
}

export function extractPlayableContent(originalPuzzle: PuzzleDefinition): PlayableContent {
  validatePuzzle(originalPuzzle)
  const clues: PlayableClue[] = []
  for (let row = 0; row < gridSize; row += 1) for (let col = 0; col < gridSize; col += 1) {
    const value = originalPuzzle.givens[row][col]
    if (value !== null) clues.push({ row, col, value })
  }
  return normalizedContent({
    size: 9,
    clues,
    cages: originalPuzzle.cages.map((cage) => ({
      cells: cage.cells.map((cell) => ({ row: cell.row, col: cell.col })),
      sum: cage.sum,
    })),
  })
}

function compareCoordinates(left: CellCoordinate, right: CellCoordinate): number {
  return left.row - right.row || left.col - right.col
}

function compareCages(left: PlayableCage, right: PlayableCage): number {
  const cellCount = Math.min(left.cells.length, right.cells.length)
  for (let index = 0; index < cellCount; index += 1) {
    const comparison = compareCoordinates(left.cells[index], right.cells[index])
    if (comparison !== 0) return comparison
  }
  if (left.cells.length !== right.cells.length) return left.cells.length - right.cells.length
  return left.sum - right.sum
}

function normalizedContent(content: PlayableContent): PlayableContent {
  return {
    size: 9,
    clues: content.clues.map((clue) => ({ ...clue })).sort((left, right) => left.row - right.row || left.col - right.col),
    cages: content.cages.map((cage) => ({
      cells: cage.cells.map((cell) => ({ ...cell })).sort(compareCoordinates),
      sum: cage.sum,
    })).sort(compareCages),
  }
}

export function canonicalizePlayableContent(content: PlayableContent): string {
  validateContent(content)
  return JSON.stringify(normalizedContent(content))
}

export function fingerprintPlayableContent(content: PlayableContent): string {
  const canonical = canonicalizePlayableContent(content)
  return `sha256-${bytesToHex(sha256(new TextEncoder().encode(canonical)))}`
}
