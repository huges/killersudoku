import { createHash } from 'node:crypto'
import { type PuzzleDefinition } from './types'
import { solve, resolveMaxNodes, type SolverResult } from './solver'
import { verifyGame } from './verification'
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
  verifierVersion: string
  maxNodes: number
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

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function error(control: string, field: string, cause: string): string {
  return `${control}|${field}|${cause}`
}

export function canonicalizePuzzle(validatedPuzzle: PuzzleDefinition): string {
  validatePuzzle(validatedPuzzle)
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
      .sort((left, right) => compare(left.id, right.id)),
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
  const maxNodes = resolveMaxNodes(options.maxNodes === undefined ? undefined : { maxNodes: options.maxNodes })
  const records: CatalogPuzzleRecord[] = []
  const errors: string[] = []
  const seenIds = new Set<string>()
  for (const candidate of input) {
    try {
      validatePuzzle(candidate as PuzzleDefinition)
      const puzzle = candidate as PuzzleDefinition
      if (seenIds.has(puzzle.puzzleId)) throw new Error(error('identifier', 'puzzleId', 'duplicate identifier in catalog'))
      seenIds.add(puzzle.puzzleId)
      const fingerprint = fingerprintPuzzle(canonicalizePuzzle(puzzle))
      if (options.identity !== undefined && Object.hasOwn(options.identity, puzzle.puzzleId) && options.identity[puzzle.puzzleId] !== fingerprint) {
        throw new Error(error('identity-lock', 'puzzleId', 'historical fingerprint mismatch'))
      }
      const solved = solve(puzzle, { maxNodes })
      const solver = { status: solved.status, count: solved.count, complete: solved.complete, nodes: solved.nodes }
      const record: CatalogPuzzleRecord = { puzzleId: puzzle.puzzleId, fingerprint, structural: 'valid', solver, complete: solved.complete, nodes: solved.nodes, errors: [] }
      if (solved.status !== 'unique' || solved.count !== 1 || !solved.complete || !solved.solution) {
        record.errors = [error('solver', puzzle.puzzleId, `${solved.status}; count=${solved.count}; complete=${solved.complete}`)]
      }
      if (record.errors.length === 0 && verifyGame(puzzle, solved.solution).status !== 'VALIDA') {
        record.errors.push(error('solver', puzzle.puzzleId, 'returned solution violates puzzle'))
      }
      records.push(record)
    } catch (caught) {
      const message = caught instanceof ValidationError || caught instanceof Error ? caught.message : String(caught)
      const record = invalidRecord(candidate, [message])
      records.push(record)
    }
  }
  records.sort((left, right) => compare(left.puzzleId, right.puzzleId))
  for (const record of records) for (const item of record.errors) errors.push(`${record.puzzleId}|${item}`)
  if (input.length === 0) errors.push('catalog|inputs|empty sample is not verified')
  return { formatVersion: options.formatVersion ?? '1', sampleVersion: options.sampleVersion ?? 'technical-1', verifierVersion: '1', maxNodes, puzzles: records, errors: errors.sort(compare) }
}

export function compareReference(actual: CatalogVerificationResult, expected: CatalogVerificationResult): CatalogComparisonResult {
  const actualText = `${JSON.stringify(actual)}\n`
  const expectedText = `${JSON.stringify(expected)}\n`
  return actualText === expectedText ? { equal: true, errors: [] } : { equal: false, errors: [error('reference', 'result', 'byte-for-byte mismatch')] }
}
