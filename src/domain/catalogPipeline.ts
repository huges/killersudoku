import { createHash } from 'node:crypto'
import { type PuzzleDefinition } from './types'
import { solve, type SolverResult } from './solver'
import { ValidationError, validatePuzzle } from './validation'

export type CatalogPuzzleInput = unknown

export type CatalogPuzzleRecord = {
  puzzleId: string
  fingerprint?: string
  structural: 'valid' | 'invalid'
  solver: { status: SolverResult['status']; count: 0 | 1 | 2; complete: boolean; nodes?: number }
  complete: boolean
  nodes?: number
  errors: string[]
}

export type CatalogVerificationResult = {
  formatVersion: string
  sampleVersion: string
  puzzles: CatalogPuzzleRecord[]
  errors: string[]
}

export type CatalogVerificationOptions = {
  formatVersion?: string
  sampleVersion?: string
  maxNodes?: number
  identity?: Record<string, string>
}

export type CatalogComparisonResult = { equal: boolean; errors: string[] }

const allowedPuzzleKeys = new Set(['schemaVersion', 'puzzleId', 'difficulty', 'size', 'givens', 'cages'])
const allowedCageKeys = new Set(['id', 'cells', 'sum'])
const puzzleIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const cageIdPattern = /^cage-[a-z0-9]+(?:-[a-z0-9]+)*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function error(control: string, field: string, cause: string): string {
  return `${control}|${field}|${cause}`
}

function validateRawShape(input: unknown): asserts input is PuzzleDefinition {
  if (!isRecord(input)) throw new Error(error('schema', 'puzzle', 'must be an object'))
  const unknownPuzzleKeys = Object.keys(input).filter((key) => !allowedPuzzleKeys.has(key)).sort()
  if (unknownPuzzleKeys.length > 0) throw new Error(error('schema', unknownPuzzleKeys[0], 'unknown field'))
  if (!Array.isArray(input.cages)) throw new Error(error('schema', 'cages', 'must be an array'))
  for (let index = 0; index < input.cages.length; index += 1) {
    const cage = input.cages[index]
    if (!isRecord(cage)) throw new Error(error('schema', `cages[${index}]`, 'must be an object'))
    const unknownKeys = Object.keys(cage).filter((key) => !allowedCageKeys.has(key)).sort()
    if (unknownKeys.length > 0) throw new Error(error('schema', `cages[${index}].${unknownKeys[0]}`, 'unknown field'))
  }
}

function validateNamespaces(puzzle: PuzzleDefinition): void {
  if (!puzzleIdPattern.test(puzzle.puzzleId)) throw new Error(error('identifier', 'puzzleId', 'invalid namespace format'))
  const ids = new Set<string>()
  for (const cage of puzzle.cages) {
    if (!cageIdPattern.test(cage.id)) throw new Error(error('identifier', `cages.${cage.id}`, 'invalid namespace format'))
    if (ids.has(cage.id)) throw new Error(error('identifier', `cages.${cage.id}`, 'duplicate identifier'))
    ids.add(cage.id)
  }
}

export function canonicalizePuzzle(validatedPuzzle: PuzzleDefinition): string {
  const canonical = {
    schemaVersion: validatedPuzzle.schemaVersion,
    puzzleId: validatedPuzzle.puzzleId,
    difficulty: validatedPuzzle.difficulty,
    size: validatedPuzzle.size,
    givens: validatedPuzzle.givens.map((row) => [...row]),
    cages: validatedPuzzle.cages
      .map((cage) => ({
        id: cage.id,
        sum: cage.sum,
        cells: cage.cells
          .map((cell) => ({ row: cell.row, col: cell.col }))
          .sort((left, right) => left.row - right.row || left.col - right.col),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }
  return stable(canonical)
}

export function fingerprintPuzzle(canonicalPuzzle: string): string {
  return `sha256-${createHash('sha256').update(canonicalPuzzle, 'utf8').digest('hex')}`
}

function invalidRecord(input: unknown, errors: string[]): CatalogPuzzleRecord {
  const puzzleId = isRecord(input) && typeof input.puzzleId === 'string' ? input.puzzleId : '<unknown>'
  return { puzzleId, structural: 'invalid', solver: { status: 'invalid', count: 0, complete: true }, complete: true, errors: [...errors].sort() }
}

export function verifyCatalog(input: CatalogPuzzleInput[], options: CatalogVerificationOptions = {}): CatalogVerificationResult {
  const records: CatalogPuzzleRecord[] = []
  const errors: string[] = []
  const seenIds = new Set<string>()
  for (const candidate of input) {
    try {
      validateRawShape(candidate)
      validatePuzzle(candidate)
      validateNamespaces(candidate)
      if (seenIds.has(candidate.puzzleId)) throw new Error(error('identifier', 'puzzleId', 'duplicate identifier in catalog'))
      seenIds.add(candidate.puzzleId)
      const fingerprint = fingerprintPuzzle(canonicalizePuzzle(candidate))
      if (options.identity?.[candidate.puzzleId] !== undefined && options.identity[candidate.puzzleId] !== fingerprint) {
        throw new Error(error('identity-lock', 'puzzleId', 'historical fingerprint mismatch'))
      }
      const solved = solve(candidate, options.maxNodes === undefined ? undefined : { maxNodes: options.maxNodes })
      const solver = { status: solved.status, count: solved.count, complete: solved.complete, nodes: solved.nodes }
      const record: CatalogPuzzleRecord = { puzzleId: candidate.puzzleId, fingerprint, structural: 'valid', solver, complete: solved.complete, nodes: solved.nodes, errors: [] }
      if (solved.status !== 'unique' || solved.count !== 1 || !solved.complete || !solved.solution) {
        record.errors = [error('solver', candidate.puzzleId, `${solved.status}; count=${solved.count}; complete=${solved.complete}`)]
      }
      records.push(record)
    } catch (caught) {
      const message = caught instanceof ValidationError || caught instanceof Error ? caught.message : String(caught)
      const record = invalidRecord(candidate, [message])
      records.push(record)
    }
  }
  records.sort((left, right) => left.puzzleId.localeCompare(right.puzzleId))
  for (const record of records) for (const item of record.errors) errors.push(`${record.puzzleId}|${item}`)
  return { formatVersion: options.formatVersion ?? '1', sampleVersion: options.sampleVersion ?? 'technical-1', puzzles: records, errors: errors.sort() }
}

export function compareReference(actual: CatalogVerificationResult, expected: CatalogVerificationResult): CatalogComparisonResult {
  const actualText = `${JSON.stringify(actual)}\n`
  const expectedText = `${JSON.stringify(expected)}\n`
  return actualText === expectedText ? { equal: true, errors: [] } : { equal: false, errors: [error('reference', 'result', 'byte-for-byte mismatch')] }
}
