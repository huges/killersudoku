import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { canonicalizePlayableContent, extractPlayableContent, fingerprintPlayableContent, type PlayableContent } from './identity'
import { classifyDuplicate, type DuplicateResult, type HistoricalContentSource, type HistoricalReference } from './duplicateClassifier'
import { assignIncremental, type AssignmentInput, type Registry, type RecordKey } from './registry'
import { type PuzzleDefinition } from './types'
import { validatePuzzle } from './validation'
import { solve } from './solver'
import { readVerifiedDocument, type PublicExport } from './publicBoundary'
import { SCHEMA_VERSION, type Difficulty, type SaveDocument } from './types'

export const MIGRATION_NAMESPACE = 'killer-sudoku' as const
export const MIGRATION_ALGORITHM = 'd4-v1' as const
export type MigrationCommand = 'verify' | 'migrate' | 'generate-catalog' | 'generate-identities' | 'generate-references' | 'dry-run'
export type MigrationOutcome = 'pass' | 'duplicate' | 'associated' | 'candidate' | 'ambiguous' | 'collision' | 'error'
export type LegacyRecord = {
  recordKey: RecordKey
  puzzle: PuzzleDefinition
  publicId?: string
  aliases?: string[]
  legacyFingerprint?: string | null
  versions?: Record<string, string | null>
  references?: string[]
}
export type CandidateRecord = {
  recordKey: RecordKey
  publicId?: string
  aliases: string[]
  legacyFingerprint: string | null
  content: PlayableContent | null
  currentFingerprint: string | null
  versions: Record<string, string | null>
  references: string[]
}
export type MigrationDiagnostic = { code: string; path: string; recordKey?: RecordKey; message: string }
export type MigrationReportRecord = CandidateRecord & { outcome: MigrationOutcome; algorithm: typeof MIGRATION_ALGORITHM; diagnostics: MigrationDiagnostic[]; duplicate?: DuplicateResult }
export type ReferenceCandidate = { recordKey: RecordKey; reference: string; resolvedRecordKey: RecordKey | null; publicId: string | null; currentFingerprint: string | null; outcome: 'candidate' | 'error' }
export type MigrationResult = { command: MigrationCommand; records: MigrationReportRecord[]; candidate: CandidateRecord[] | ReferenceCandidate[]; diff: unknown[]; diagnostics: MigrationDiagnostic[] }

const clone = <T>(value: T): T => structuredClone(value)
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const keyText = (key: RecordKey): string => JSON.stringify([key.source, key.key])
const diagnostic = (code: string, path: string, message: string, recordKey?: RecordKey): MigrationDiagnostic => ({ code, path, ...(recordKey ? { recordKey: clone(recordKey) } : {}), message })
const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort(compare).map((key) => [key, item[key]])) : item)

function puzzleFromPublicExport(document: PublicExport): LegacyRecord {
  const content = document.record.content
  const difficulty = document.record.metadata?.difficulty ?? 'easy'
  return {
    recordKey: clone(document.record.recordKey),
    publicId: document.record.identity.id,
    aliases: [...(document.record.identity.aliases ?? [])],
    legacyFingerprint: document.record.fingerprint?.kind === 'legacy' ? document.record.fingerprint.value : null,
    versions: { export: '1' },
    references: [],
    puzzle: {
      schemaVersion: SCHEMA_VERSION, puzzleId: document.record.identity.id, difficulty, size: 9,
      givens: Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => content.clues.find((clue) => clue.row === row && clue.col === col)?.value ?? null)),
      cages: content.cages.map((cage, index) => ({ id: `migration-cage-${index}`, cells: clone(cage.cells), sum: cage.sum })),
    },
  }
}

export function parseMigrationInput(value: unknown): LegacyRecord[] {
  const list = Array.isArray(value) ? value : [value]
  if (list.length === 0) throw new Error('input|records|empty input')
  const ordered = list.map((original, index) => {
    if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error(`input|records[${index}]|record must be an object`)
    let item = original
    const originalRecord = original as Record<string, unknown>
    if (originalRecord.format === 'killer-sudoku-export') {
      try { item = puzzleFromPublicExport(readVerifiedDocument(JSON.stringify(original)) as PublicExport) }
      catch (error) { throw new Error(`input|records[${index}]|documented export is invalid: ${error instanceof Error ? error.message : String(error)}`) }
    } else if (originalRecord.format === 'killer-sudoku-save' || Object.hasOwn(originalRecord, 'schemaVersion')) {
      // Save and PuzzleDefinition readers are supported, but neither format carries a RecordKey.
      // Do not invent one from puzzleId: migration identity requires an independently sourced key.
      try { readVerifiedDocument(JSON.stringify(original)) }
      catch (error) { throw new Error(`input|records[${index}]|documented document is invalid: ${error instanceof Error ? error.message : String(error)}`) }
      throw new Error(`input|records[${index}].recordKey|documented save/puzzle format has no RecordKey`)
    }
    const raw = item as Record<string, unknown>
    if (Object.keys(raw).some((key) => !['recordKey', 'puzzle', 'publicId', 'aliases', 'legacyFingerprint', 'versions', 'references'].includes(key))) throw new Error(`input|records[${index}]|unknown field`)
    const key = raw.recordKey
    if (typeof key !== 'object' || key === null || Array.isArray(key)) throw new Error(`input|records[${index}].recordKey|invalid record key`)
    const keyRecord = key as RecordKey
    if (Object.keys(key).length !== 2 || !Object.hasOwn(key, 'source') || !Object.hasOwn(key, 'key') || typeof keyRecord.source !== 'string' || typeof keyRecord.key !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(keyRecord.source) || !/^[A-Za-z0-9._/-]+$/.test(keyRecord.key)) throw new Error(`input|records[${index}].recordKey|invalid record key`)
    if (!raw.puzzle || typeof raw.puzzle !== 'object' || Array.isArray(raw.puzzle)) throw new Error(`input|records[${index}].puzzle|puzzle is required`)
    if (raw.publicId !== undefined && (typeof raw.publicId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw.publicId))) throw new Error(`input|records[${index}].publicId|invalid public ID`)
    if (raw.aliases !== undefined && (!Array.isArray(raw.aliases) || raw.aliases.some((alias) => typeof alias !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(alias)) || new Set(raw.aliases).size !== raw.aliases.length)) throw new Error(`input|records[${index}].aliases|invalid aliases`)
    if (raw.legacyFingerprint !== undefined && raw.legacyFingerprint !== null && typeof raw.legacyFingerprint !== 'string') throw new Error(`input|records[${index}].legacyFingerprint|invalid fingerprint`)
    if (raw.versions !== undefined && (!raw.versions || typeof raw.versions !== 'object' || Array.isArray(raw.versions) || Object.values(raw.versions).some((version) => version !== null && typeof version !== 'string'))) throw new Error(`input|records[${index}].versions|invalid versions`)
    if (raw.references !== undefined && (!Array.isArray(raw.references) || raw.references.some((reference) => typeof reference !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(reference)) || new Set(raw.references).size !== raw.references.length)) throw new Error(`input|records[${index}].references|invalid references`)
    return clone({ recordKey: keyRecord, puzzle: raw.puzzle as PuzzleDefinition, publicId: raw.publicId as string | undefined, aliases: raw.aliases as string[] | undefined, legacyFingerprint: raw.legacyFingerprint as string | null | undefined, versions: raw.versions as Record<string, string | null> | undefined, references: raw.references as string[] | undefined })
  }).sort((a, b) => compare(keyText(a.recordKey), keyText(b.recordKey)))
  for (let index = 1; index < ordered.length; index += 1) {
    if (keyText(ordered[index - 1].recordKey) === keyText(ordered[index].recordKey)) throw new Error(`input|records[${index}].recordKey|duplicate RecordKey`)
  }
  return ordered
}

function candidateOf(record: LegacyRecord): CandidateRecord {
  validatePuzzle(record.puzzle)
  const verification = solve(record.puzzle)
  if (verification.status !== 'unique' || verification.count !== 1 || !verification.complete || !verification.solution) {
    throw new Error(`solver|${record.recordKey.key}|${verification.status}; count=${verification.count}; complete=${verification.complete}`)
  }
  const content = extractPlayableContent(record.puzzle)
  return { recordKey: clone(record.recordKey), ...(record.publicId ? { publicId: record.publicId } : {}), aliases: [...(record.aliases ?? [])].sort(compare), legacyFingerprint: record.legacyFingerprint ?? null, content, currentFingerprint: fingerprintPlayableContent(content), versions: Object.fromEntries(Object.entries(record.versions ?? {}).sort(([a], [b]) => compare(a, b))), references: [...(record.references ?? [])].sort(compare) }
}

function outcomeFor(result: DuplicateResult): MigrationOutcome {
  if (result.classification === 'nuovo contenuto') return 'candidate'
  if (result.classification === 'duplicato') return 'duplicate'
  if (result.classification === 'associazione proposta verificata' || result.classification === 'associazione già registrata') return 'associated'
  if (result.classification === 'ambiguità') return 'ambiguous'
  const code = result.diagnostic?.code
  const path = result.diagnostic?.path
  return code?.includes('conflict') || (code === 'unknown-reference' && path === 'historicalContentSource.publicId') ? 'collision' : 'error'
}

function sourceFor(source: HistoricalContentSource | undefined): HistoricalContentSource {
  if (source) return source
  return { resolve: () => 'missing' }
}

export function runMigration(command: MigrationCommand, input: readonly LegacyRecord[], options: { registry?: Registry; historicalContentSource?: HistoricalContentSource; dryRun?: boolean } = {}): MigrationResult {
  const records: MigrationReportRecord[] = []
  const candidates: CandidateRecord[] = []
  const diagnostics: MigrationDiagnostic[] = []
  const source = sourceFor(options.historicalContentSource)
  const registry = options.registry
  // Keep the authoritative result used during validation; resolving again while
  // constructing the diff could yield a different record from a stateful reader.
  const resolvedReferences = new Map<string, HistoricalReference>()
  const referenceKey = (recordKey: RecordKey, reference: string): string => JSON.stringify([keyText(recordKey), reference])
  const ordered = parseMigrationInput(input)
  const requiresHistoricalClassification = command === 'generate-catalog' || command === 'generate-references'
  const requiresRegistry = command === 'generate-catalog' || command === 'generate-identities' || command === 'generate-references'
  const missingPrerequisite = requiresHistoricalClassification && (!registry || !options.historicalContentSource)
    ? diagnostic('missing-historical-content', 'historicalContentSource', 'catalog and reference generation require an independent historical content source and Registry')
    : command === 'generate-references' && typeof options.historicalContentSource?.resolveReference !== 'function'
      ? diagnostic('missing-reference-resolver', 'historicalContentSource.resolveReference', 'reference generation requires an authoritative reference resolver')
      : requiresRegistry && !registry
        ? diagnostic('missing-registry', 'registry', 'identity generation requires an authoritative Registry v1 input')
        : null
  if (missingPrerequisite) {
    diagnostics.push(missingPrerequisite)
    for (const record of ordered) records.push({ recordKey: clone(record.recordKey), ...(record.publicId ? { publicId: record.publicId } : {}), aliases: [...(record.aliases ?? [])].sort(compare), legacyFingerprint: record.legacyFingerprint ?? null, content: null, currentFingerprint: null, versions: Object.fromEntries(Object.entries(record.versions ?? {}).sort(([a], [b]) => compare(a, b))), references: [...(record.references ?? [])].sort(compare), outcome: 'error', algorithm: MIGRATION_ALGORITHM, diagnostics: [diagnostic(missingPrerequisite.code, missingPrerequisite.path, missingPrerequisite.message, record.recordKey)] })
    return { command, records, candidate: [], diff: [], diagnostics }
  }
  for (const record of ordered) {
    try {
      const candidate = candidateOf(record)
      const content = candidate.content
      const currentFingerprint = candidate.currentFingerprint
      if (content === null || currentFingerprint === null) throw new Error('candidate|content|validated content identity is unavailable')
      let duplicate: DuplicateResult | undefined
      // Identity generation consumes Registry as assignment history; historical content is
      // not required for that operation. Other generators classify against an independent source.
      if (registry && command !== 'generate-identities') duplicate = classifyDuplicate({ namespace: MIGRATION_NAMESPACE, observationRecordKey: candidate.recordKey, content, registry, historicalContentSource: source })
      let referenceError: MigrationDiagnostic | null = null
      if (command === 'generate-references') {
        const resolveReference = options.historicalContentSource?.resolveReference
        if (!resolveReference && candidate.references.length > 0) {
          referenceError = diagnostic('missing-reference-resolver', 'historicalContentSource.resolveReference', 'reference generation requires an authoritative reference resolver', candidate.recordKey)
        } else if (resolveReference) {
          for (const reference of candidate.references) {
            let resolved
            try { resolved = resolveReference.call(options.historicalContentSource, reference) } catch { resolved = 'ambiguous' as const }
            if (resolved === 'missing' || resolved === 'ambiguous' || !resolved || resolved.reference !== reference) {
              referenceError = diagnostic(resolved === 'ambiguous' ? 'ambiguous-reference' : 'unknown-reference', 'references', `reference ${reference} is not uniquely resolved`, candidate.recordKey)
              break
            }
            const matches = duplicate?.matches ?? (duplicate?.registeredAssociation ? [{ recordKey: duplicate.registeredAssociation.recordKey, publicId: duplicate.registeredAssociation.publicId }] : [])
            const matchedIdentity = matches.some((match) => keyText(match.recordKey) === keyText(resolved.recordKey) && (!candidate.publicId || candidate.publicId === match.publicId))
            if (!matchedIdentity) {
              referenceError = diagnostic('reference-content-conflict', 'references', `reference ${reference} does not identify equivalent verified content`, candidate.recordKey)
              break
            }
            resolvedReferences.set(referenceKey(candidate.recordKey, reference), clone(resolved))
          }
        }
      }
      const classifiedOutcome = referenceError ? 'collision' : duplicate ? outcomeFor(duplicate) : 'candidate'
      // Verification must not mask a failed historical/identity check as pass. A clean
      // non-duplicate record passes verification; resolved recurrence remains visible.
      const outcome = command === 'verify'
        ? duplicate && classifiedOutcome !== 'candidate' ? classifiedOutcome : 'pass'
        : classifiedOutcome
      const recordDiagnostics = [
        ...(duplicate?.diagnostic ? [diagnostic(duplicate.diagnostic.code, duplicate.diagnostic.path, duplicate.diagnostic.message, candidate.recordKey)] : []),
        ...(referenceError ? [referenceError] : []),
      ].sort((left, right) => compare(stableJson(left), stableJson(right)))
      const item: MigrationReportRecord = { ...clone(candidate), outcome, algorithm: MIGRATION_ALGORITHM, diagnostics: recordDiagnostics, ...(duplicate ? { duplicate } : {}) }
      records.push(item)
      const referenceEligible = command === 'generate-references' && (outcome === 'duplicate' || outcome === 'associated')
      if (command !== 'verify' && (outcome === 'candidate' || referenceEligible)) candidates.push(clone(candidate))
      if (outcome === 'ambiguous' || outcome === 'collision' || outcome === 'error') diagnostics.push(...item.diagnostics)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      records.push({ recordKey: clone(record.recordKey), aliases: [...(record.aliases ?? [])].sort(compare), legacyFingerprint: record.legacyFingerprint ?? null, content: null, currentFingerprint: null, versions: Object.fromEntries(Object.entries(record.versions ?? {}).sort(([a], [b]) => compare(a, b))), references: [...(record.references ?? [])].sort(compare), outcome: 'error', algorithm: MIGRATION_ALGORITHM, diagnostics: [diagnostic('invalid-record', 'record', message, record.recordKey)] })
      diagnostics.push(diagnostic('invalid-record', 'record', message, record.recordKey))
    }
  }
  // Candidate generation is transactional: one invalid, ambiguous, colliding, or
  // historically unclassifiable record blocks the whole candidate set. Reports still
  // retain per-record diagnostics so callers can repair inputs without partial output.
  if (command !== 'verify' && diagnostics.length > 0) candidates.length = 0
  const referenceCandidates: ReferenceCandidate[] = command === 'generate-references'
    ? records.filter((record) => record.outcome === 'duplicate' || record.outcome === 'associated').flatMap((record) => {
      const matches = record.duplicate?.matches ?? (record.duplicate?.registeredAssociation ? [{ recordKey: record.duplicate.registeredAssociation.recordKey, publicId: record.duplicate.registeredAssociation.publicId }] : [])
      return record.references.map((reference) => {
        const resolved = resolvedReferences.get(referenceKey(record.recordKey, reference))
        const match = resolved
          ? matches.find((item) => keyText(item.recordKey) === keyText(resolved.recordKey) && (!record.publicId || item.publicId === record.publicId))
          : undefined
        const outcome = match ? 'candidate' : 'error'
        if (!match) diagnostics.push(diagnostic('reference-candidate-conflict', 'references', `reference ${reference} has no verified historical identity`, record.recordKey))
        return { recordKey: record.recordKey, reference, resolvedRecordKey: match && resolved ? clone(resolved.recordKey) : null, publicId: match?.publicId ?? null, currentFingerprint: record.currentFingerprint, outcome }
      })
    })
    : []
  if (command === 'generate-references' && diagnostics.length > 0) { candidates.length = 0; referenceCandidates.length = 0 }
  const diff = command === 'generate-references'
    ? referenceCandidates
    : command === 'dry-run' || command === 'generate-identities'
      ? records.filter((record) => record.outcome !== 'pass').map((record) => ({ recordKey: record.recordKey, outcome: record.outcome, publicId: record.publicId ?? null }))
      : []
  return { command, records, candidate: command === 'generate-references' ? referenceCandidates : candidates, diff, diagnostics: diagnostics.sort((a, b) => compare(stableJson(a), stableJson(b))) }
}

export function generateIdentityCandidate(previous: Registry, records: readonly CandidateRecord[]): { registry: Registry | null; diagnostics: MigrationDiagnostic[] } {
  const inputs: AssignmentInput[] = records.map((record) => {
    if (record.content === null || record.currentFingerprint === null) throw new Error('candidate|content|identity generation requires validated content and current fingerprint')
    return { recordKey: clone(record.recordKey), aliases: [...record.aliases], state: 'current', ...(record.publicId ? { publicId: record.publicId } : {}), fingerprint: { contract: 'playable-content-v1', kind: 'current', value: record.currentFingerprint }, content: clone(record.content) }
  })
  const result = assignIncremental(previous, inputs, { initialization: previous.identities.length === 0 })
  return { registry: result.registry, diagnostics: result.diagnostics.map((item) => diagnostic(item.code, item.path, item.message, item.recordKeys[0])) }
}

export function stableMigrationJson(result: MigrationResult): string {
  return `${JSON.stringify(result, null, 2)}\n`
}

export function readMigrationJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function digestMigration(value: unknown): string {
  return `sha256-${createHash('sha256').update(stableJson(value), 'utf8').digest('hex')}`
}

export function contentCanonicalText(content: PlayableContent): string { return canonicalizePlayableContent(content) }
