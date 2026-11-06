import { canonicalizePlayableContent, type PlayableContent } from './identity'
import { type HistoricalContentSource, type HistoricalRecord } from './duplicateClassifier'
import { type Association, type FingerprintRef, type RecordKey, type Registry } from './registry'

export type PublicDiagnosticCode =
  | 'UNKNOWN_FORMAT' | 'UNSUPPORTED_VERSION' | 'AMBIGUOUS_FORMAT' | 'MISSING_FIELD'
  | 'INVALID_FIELD' | 'EXTRA_FIELD' | 'INVALID_CONTENT' | 'INCONSISTENT_REFERENCE'
  | 'UNKNOWN_PUBLIC_ID' | 'AMBIGUOUS_PUBLIC_REFERENCE' | 'MALFORMED_QR'
  | 'SERIALIZATION_FAILED'

export class PublicBoundaryError extends Error {
  constructor(public readonly code: PublicDiagnosticCode, public readonly path: string, message: string) {
    super(`${code} at ${path}: ${message}`)
    this.name = 'PublicBoundaryError'
  }
}

export type PublicLookupResult = {
  identity: { id: string; aliases: string[] }
  observationKey: string
  recordKey: RecordKey
  fingerprint?: FingerprintRef
  content: PlayableContent
  state: 'current' | 'removed'
}

export type PublicExport = {
  format: 'killer-sudoku-export'
  version: 1
  record: {
    identity: { id: string; aliases?: string[] }
    recordKey: RecordKey
    fingerprint?: FingerprintRef
    content: PlayableContent
    metadata?: { difficulty?: 'easy' | 'medium' | 'hard' | 'expert' }
  }
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const recordPattern = /^[A-Za-z0-9._/-]+$/
const clone = <T>(value: T): T => structuredClone(value)
const recordText = (key: RecordKey): string => JSON.stringify([key.source, key.key])
const sameRecord = (left: RecordKey, right: RecordKey): boolean => recordText(left) === recordText(right)
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
const validRecordKey = (value: unknown): value is RecordKey => exactKeys(value, ['source', 'key']) && typeof value.source === 'string' && typeof value.key === 'string' && recordPattern.test(value.source) && recordPattern.test(value.key)
const validId = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value)
const validFingerprint = (value: unknown): value is FingerprintRef => exactKeys(value, ['contract', 'kind', 'value']) && ((value.contract === 'playable-content-v1' && value.kind === 'current') || (value.contract === 'legacy-sha256' && value.kind === 'legacy')) && typeof value.value === 'string' && /^sha256-[0-9a-f]{64}$/.test(value.value)

function fail(code: PublicDiagnosticCode, path: string, message: string): never { throw new PublicBoundaryError(code, path, message) }

function resolveAssociation(registry: Registry, identityId: string, recordKey: RecordKey, observationKey: string): Association {
  const matches = registry.associations.filter((association) => association.observationKey === observationKey)
  if (matches.length !== 1) fail(matches.length === 0 ? 'INCONSISTENT_REFERENCE' : 'AMBIGUOUS_PUBLIC_REFERENCE', 'registry.associations', 'first assignment observation must resolve to exactly one association')
  const association = matches[0]
  if (association.publicId !== identityId || !sameRecord(association.recordKey, recordKey)) fail('INCONSISTENT_REFERENCE', 'registry.identities.firstAssignment', 'association identity and RecordKey do not match firstAssignment')
  return association
}

export function lookupPublicId(registry: Registry, historicalContentSource: HistoricalContentSource, publicId: string): PublicLookupResult {
  if (!validId(publicId)) fail('INVALID_FIELD', 'id', 'public ID is invalid')
  const identities = registry.identities.filter((identity) => identity.publicId === publicId)
  if (identities.length === 0) fail('UNKNOWN_PUBLIC_ID', 'id', 'public ID is not registered')
  if (identities.length !== 1) fail('AMBIGUOUS_PUBLIC_REFERENCE', 'registry.identities', 'public ID resolves to multiple identities')
  const identity = identities[0]
  if (!identity.firstAssignment || typeof identity.firstAssignment.observationKey !== 'string' || !validRecordKey(identity.firstAssignment.recordKey)) fail('INCONSISTENT_REFERENCE', 'registry.identities.firstAssignment', 'firstAssignment is incomplete')
  const association = resolveAssociation(registry, publicId, identity.firstAssignment.recordKey, identity.firstAssignment.observationKey)
  let historical: HistoricalRecord | 'missing' | 'ambiguous'
  try { historical = historicalContentSource.resolve(clone(identity.firstAssignment.recordKey)) } catch { historical = 'ambiguous' }
  if (historical === 'missing') fail('INCONSISTENT_REFERENCE', 'historicalContentSource', 'first-assignment content is missing')
  if (historical === 'ambiguous' || !historical || historical.publicId !== publicId || !sameRecord(historical.recordKey, association.recordKey)) fail('INCONSISTENT_REFERENCE', 'historicalContentSource', 'historical content does not match the canonical association')
  try { canonicalizePlayableContent(historical.content) } catch { fail('INVALID_CONTENT', 'historicalContentSource.content', 'historical content is invalid') }
  return {
    identity: { id: identity.publicId, aliases: [...identity.aliases].sort() },
    observationKey: association.observationKey,
    recordKey: clone(association.recordKey),
    ...(association.fingerprint === null ? {} : { fingerprint: clone(association.fingerprint) }),
    content: clone(historical.content),
    state: association.state,
  }
}

export type PublicQrPayload = { format: 'killer-sudoku-qr'; version: 1; id: string }

export function parsePublicQr(input: string): PublicQrPayload {
  if (typeof input !== 'string') fail('MALFORMED_QR', '$', 'QR payload must be UTF-8 JSON text')
  let value: unknown
  try { value = JSON.parse(input) } catch { fail('MALFORMED_QR', '$', 'QR payload is not valid JSON') }
  if (!exactKeys(value, ['format', 'version', 'id'])) fail('EXTRA_FIELD', '$', 'QR payload must contain exactly format, version and id')
  if (value.format !== 'killer-sudoku-qr') fail('UNKNOWN_FORMAT', 'format', 'unsupported QR marker')
  if (value.version !== 1) fail('UNSUPPORTED_VERSION', 'version', 'unsupported QR version')
  if (!validId(value.id)) fail('INVALID_FIELD', 'id', 'QR public ID is invalid')
  return { format: 'killer-sudoku-qr', version: 1, id: value.id }
}

export function lookupPublicQr(registry: Registry, historicalContentSource: HistoricalContentSource, input: string): PublicLookupResult {
  return lookupPublicId(registry, historicalContentSource, parsePublicQr(input).id)
}

function validateExport(value: unknown): asserts value is PublicExport {
  if (!exactKeys(value, ['format', 'version', 'record'])) fail('EXTRA_FIELD', '$', 'export contains unknown fields')
  if (value.format !== 'killer-sudoku-export') fail('UNKNOWN_FORMAT', 'format', 'unsupported export marker')
  if (value.version !== 1) fail('UNSUPPORTED_VERSION', 'version', 'unsupported export version')
  if (!isObject(value.record)) fail('INVALID_FIELD', 'record', 'export record must be an object')
  const record = value.record
  if (!exactKeys(record, ['identity', 'recordKey', 'content', ...(Object.prototype.hasOwnProperty.call(record, 'fingerprint') ? ['fingerprint'] : []), ...(Object.prototype.hasOwnProperty.call(record, 'metadata') ? ['metadata'] : [])])) fail('EXTRA_FIELD', 'record', 'export record contains unknown fields')
  if (!isObject(record.identity)) fail('INVALID_FIELD', 'record.identity', 'identity projection is invalid')
  const identity = record.identity
  const identityKeys = ['id', ...(Object.prototype.hasOwnProperty.call(identity, 'aliases') ? ['aliases'] : [])]
  if (!exactKeys(identity, identityKeys) || !validId(identity.id)) fail('INVALID_FIELD', 'record.identity', 'identity projection is invalid')
  if (identity.aliases !== undefined && (!Array.isArray(identity.aliases) || identity.aliases.some((alias) => typeof alias !== 'string'))) fail('INVALID_FIELD', 'record.identity.aliases', 'aliases are invalid')
  if (!validRecordKey(record.recordKey)) fail('INVALID_FIELD', 'record.recordKey', 'RecordKey is invalid')
  if (record.fingerprint !== undefined && !validFingerprint(record.fingerprint)) fail('INVALID_FIELD', 'record.fingerprint', 'fingerprint is invalid')
  const content = record.content
  try { canonicalizePlayableContent(content as PlayableContent) } catch { fail('INVALID_CONTENT', 'record.content', 'export content is invalid') }
  if (record.metadata !== undefined && (!isObject(record.metadata) || Object.keys(record.metadata).some((key) => key !== 'difficulty') || (record.metadata.difficulty !== undefined && !['easy', 'medium', 'hard', 'expert'].includes(record.metadata.difficulty as string)))) fail('EXTRA_FIELD', 'record.metadata', 'metadata is outside the public allowlist')
}

export function serializePublicExport(value: PublicExport): string {
  validateExport(value)
  return JSON.stringify({ format: 'killer-sudoku-export', version: 1, record: {
    identity: { id: value.record.identity.id, ...(value.record.identity.aliases === undefined ? {} : { aliases: [...value.record.identity.aliases] }) },
    recordKey: { source: value.record.recordKey.source, key: value.record.recordKey.key },
    ...(value.record.fingerprint === undefined ? {} : { fingerprint: clone(value.record.fingerprint) }),
    content: clone(value.record.content),
    ...(value.record.metadata === undefined ? {} : { metadata: { ...(value.record.metadata.difficulty === undefined ? {} : { difficulty: value.record.metadata.difficulty }) } }),
  } })
}

export function deserializePublicExport(input: string): PublicExport {
  let parsed: unknown
  try { parsed = JSON.parse(input) } catch { fail('SERIALIZATION_FAILED', '$', 'export is not valid JSON') }
  validateExport(parsed)
  return clone(parsed)
}

export function toPublicExport(result: PublicLookupResult, metadata?: PublicExport['record']['metadata']): PublicExport {
  return { format: 'killer-sudoku-export', version: 1, record: {
    identity: { id: result.identity.id, ...(result.identity.aliases.length === 0 ? {} : { aliases: [...result.identity.aliases] }) },
    recordKey: clone(result.recordKey),
    ...(result.fingerprint === undefined ? {} : { fingerprint: clone(result.fingerprint) }),
    content: clone(result.content),
    ...(metadata === undefined ? {} : { metadata: { ...(metadata.difficulty === undefined ? {} : { difficulty: metadata.difficulty }) } }),
  } }
}
