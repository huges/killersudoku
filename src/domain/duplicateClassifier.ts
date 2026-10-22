import { canonicalizePlayableContent, transformPlayableContent, type PlayableContent, type D4Transformation } from './identity'
import { type Association, type FingerprintRef, type RecordKey, type Registry } from './registry'

export const DUPLICATE_CLASSIFICATION_ALGORITHM = 'd4-v1' as const
export type DuplicateClassification = 'nuovo contenuto' | 'duplicato' | 'associazione proposta verificata' | 'associazione già registrata' | 'ambiguità' | 'errore bloccante'

export type HistoricalRecord = { recordKey: RecordKey; publicId: string; content: PlayableContent; references?: readonly string[] }
export type HistoricalContentSource = { resolve: (recordKey: RecordKey) => HistoricalRecord | 'missing' | 'ambiguous' }
export type DuplicateInput = { namespace: 'killer-sudoku'; observationRecordKey: RecordKey; content: PlayableContent; registry: Registry; historicalContentSource: HistoricalContentSource; requestedPublicId?: string; candidateRecordKey?: RecordKey }
export type DuplicateDiagnostic = { code: string; path: string; recordKeys: RecordKey[]; message: string }
export type DuplicateMatch = { recordKey: RecordKey; publicId: string; transformations: string[] }
export type DuplicateResult = { classification: DuplicateClassification; algorithmVersion: typeof DUPLICATE_CLASSIFICATION_ALGORITHM; observationRecordKey: RecordKey; requestedPublicId?: string; registeredAssociation?: Association; candidateRecordKey?: RecordKey; publicId?: string; matches?: DuplicateMatch[]; equivalentPublicIds?: string[]; diagnostic?: DuplicateDiagnostic }

const recordPattern = /^[A-Za-z0-9._/-]+$/
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const aliasPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const fingerprintPattern = /^sha256-[0-9a-f]{64}$/
const transformations = ['identity', 'rotate90', 'rotate180', 'rotate270', 'reflectVertical', 'reflectHorizontal', 'reflectMainDiagonal', 'reflectAntiDiagonal'] as const
const clone = <T>(value: T): T => structuredClone(value)
const recordText = (key: RecordKey): string => JSON.stringify([key.source, key.key])
const sameRecord = (left: RecordKey, right: RecordKey): boolean => recordText(left) === recordText(right)
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const sortRecords = (keys: RecordKey[]): RecordKey[] => keys.map(clone).sort((a, b) => compareText(recordText(a), recordText(b)))
const stableValueText = (value: unknown): string => {
  try { return JSON.stringify(value) } catch { return String(value) }
}
const sortedIdentities = (registry: Registry): Registry['identities'] => [...registry.identities].sort((a, b) => compareText(stableValueText(a), stableValueText(b)))
const sortedAssociations = (registry: Registry): Registry['associations'] => [...registry.associations].sort((a, b) => compareText(stableValueText(a), stableValueText(b)))
const error = (observationRecordKey: RecordKey, code: string, path: string, message: string, recordKeys: RecordKey[] = []): DuplicateResult => ({ classification: 'errore bloccante', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observationRecordKey), diagnostic: { code, path, recordKeys: sortRecords(recordKeys), message } })
const validRecordKey = (value: unknown): value is RecordKey => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 2 && typeof (value as RecordKey).source === 'string' && typeof (value as RecordKey).key === 'string' && recordPattern.test((value as RecordKey).source) && recordPattern.test((value as RecordKey).key)
const validId = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value)
const validAlias = (value: unknown): value is string => typeof value === 'string' && aliasPattern.test(value)
const validFingerprint = (value: unknown): value is FingerprintRef => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 3) return false
  const fingerprint = value as FingerprintRef
  return ((fingerprint.contract === 'playable-content-v1' && fingerprint.kind === 'current') || (fingerprint.contract === 'legacy-sha256' && fingerprint.kind === 'legacy')) && typeof fingerprint.value === 'string' && fingerprintPattern.test(fingerprint.value)
}
const fingerprintKey = (fingerprint: FingerprintRef): string => JSON.stringify({ contract: fingerprint.contract, kind: fingerprint.kind, value: fingerprint.value })
const referencePattern = /^[A-Za-z0-9._/-]+$/
const validReferences = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((reference) => typeof reference === 'string' && referencePattern.test(reference))
const referenceFor = (key: RecordKey): string => `${key.source}/${key.key}`
const referencesMatchRecord = (record: HistoricalRecord): boolean => record.references === undefined || record.references.includes(referenceFor(record.recordKey))
const validAssociationShape = (association: Association): boolean => Array.isArray(association.aliases) && association.aliases.every(validAlias) && typeof association.observationKey === 'string' && (association.state === 'current' || association.state === 'removed')
const validHistoricalRecord = (value: unknown): value is HistoricalRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as HistoricalRecord
  return validRecordKey(record.recordKey) && validId(record.publicId) && record.content !== undefined && (record.references === undefined || validReferences(record.references))
}
const firstDiagnostic = (diagnostics: DuplicateDiagnostic[]): DuplicateDiagnostic => [...diagnostics].sort((left, right) => compareText(JSON.stringify([left.code, left.path, left.recordKeys.map(recordText), left.message]), JSON.stringify([right.code, right.path, right.recordKeys.map(recordText), right.message])))[0]

function diagnosticForRegistry(registry: Registry): DuplicateDiagnostic | null {
  if (registry === null || typeof registry !== 'object' || registry.schemaVersion !== '1' || registry.namespace !== 'killer-sudoku' || !Array.isArray(registry.identities) || !Array.isArray(registry.associations) || !Array.isArray(registry.reservedIds) || !Array.isArray(registry.reservedAliases)) return { code: 'invalid-input', path: 'registry', recordKeys: [], message: 'registry structure or namespace is invalid' }
  const ids = new Set<string>(); const aliases = new Map<string, string>(); const fingerprints = new Map<string, string>(); const records = new Map<string, string>(); const observations = new Map<string, string>()
  for (const identity of [...registry.identities].sort((left, right) => {
    const byId = compareText(String(left?.publicId), String(right?.publicId))
    if (byId !== 0) return byId
    return compareText(recordText(left?.firstAssignment?.recordKey), recordText(right?.firstAssignment?.recordKey))
  })) {
    if (typeof identity !== 'object' || identity === null || !Array.isArray(identity.fingerprints) || !Array.isArray(identity.aliases) || !Array.isArray(identity.stateHistory) || typeof identity.firstAssignment !== 'object' || identity.firstAssignment === null || !validId(identity.publicId) || !validRecordKey(identity.firstAssignment.recordKey)) return { code: 'invalid-input', path: 'registry.identities', recordKeys: [], message: 'identity history structure is invalid' }
    if (ids.has(identity.publicId)) return { code: 'identity-conflict', path: 'registry.identities', recordKeys: [identity.firstAssignment.recordKey], message: 'public ID is duplicated' }; ids.add(identity.publicId)
    const firstKey = recordText(identity.firstAssignment.recordKey)
    const firstOwner = records.get(firstKey)
    if (firstOwner && firstOwner !== identity.publicId) return { code: 'record-conflict', path: 'registry.identities.firstAssignment.recordKey', recordKeys: [identity.firstAssignment.recordKey], message: 'first-assignment RecordKey belongs to multiple identities' }
    if (firstOwner === identity.publicId) return { code: 'record-conflict', path: 'registry.identities.firstAssignment.recordKey', recordKeys: [identity.firstAssignment.recordKey], message: 'first-assignment RecordKey is duplicated' }
    records.set(firstKey, identity.publicId)
    for (const alias of identity.aliases) { if (!validAlias(alias)) return { code: 'invalid-alias', path: 'registry.identities', recordKeys: [identity.firstAssignment.recordKey], message: 'alias is invalid' }; const old = aliases.get(alias); if (old && old !== identity.publicId) return { code: 'alias-conflict', path: 'registry.identities', recordKeys: [identity.firstAssignment.recordKey], message: 'alias belongs to multiple identities' }; aliases.set(alias, identity.publicId) }
    for (const fingerprint of identity.fingerprints) { if (!validFingerprint(fingerprint)) return { code: 'invalid-fingerprint', path: 'registry.identities', recordKeys: [identity.firstAssignment.recordKey], message: 'fingerprint is malformed' }; const key = fingerprintKey(fingerprint); const old = fingerprints.get(key); if (old && old !== identity.publicId) return { code: 'fingerprint-conflict', path: 'registry.identities', recordKeys: [identity.firstAssignment.recordKey], message: 'fingerprint belongs to multiple identities' }; fingerprints.set(key, identity.publicId) }
  }
  for (const association of sortedAssociations(registry)) {
    if (!validRecordKey(association.recordKey) || !validId(association.publicId) || !validAssociationShape(association) || (association.observedPublicId !== null && !validId(association.observedPublicId)) || (association.fingerprint !== null && !validFingerprint(association.fingerprint))) return { code: 'invalid-input', path: 'registry.associations', recordKeys: validRecordKey(association.recordKey) ? [association.recordKey] : [], message: 'association identifier, aliases, state, or fingerprint is invalid' }
    if (!ids.has(association.publicId)) return { code: 'unknown-reference', path: 'registry.associations.publicId', recordKeys: [association.recordKey], message: 'association references an unknown identity' }
    const key = recordText(association.recordKey); const old = records.get(key); if (old && old !== association.publicId) return { code: 'identity-conflict', path: 'registry.associations.recordKey', recordKeys: [association.recordKey], message: 'record is associated with multiple identities' }; records.set(key, association.publicId)
    const previous = observations.get(association.observationKey); if (previous && previous !== association.publicId) return { code: 'association-conflict', path: 'registry.associations.observationKey', recordKeys: [association.recordKey], message: 'observation is associated with multiple identities' }; observations.set(association.observationKey, association.publicId)
    if (association.fingerprint !== null) { const owner = fingerprints.get(fingerprintKey(association.fingerprint)); if (owner && owner !== association.publicId) return { code: 'fingerprint-conflict', path: 'registry.associations.fingerprint', recordKeys: [association.recordKey], message: 'fingerprint belongs to multiple identities' }; fingerprints.set(fingerprintKey(association.fingerprint), association.publicId) }
  }
  for (const identity of [...registry.identities].sort((left, right) => {
    const byId = compareText(String(left?.publicId), String(right?.publicId))
    if (byId !== 0) return byId
    return compareText(recordText(left?.firstAssignment?.recordKey), recordText(right?.firstAssignment?.recordKey))
  })) {
    for (const alias of identity.aliases) { const owner = aliases.get(alias); if (owner && owner !== identity.publicId) return { code: 'alias-conflict', path: 'registry.identities.aliases', recordKeys: [identity.firstAssignment.recordKey], message: 'alias belongs to multiple identities' } }
  }
  return null
}

function allHistoricalKeys(registry: Registry): RecordKey[] {
  const values = [...registry.identities.map((identity) => identity.firstAssignment.recordKey), ...registry.associations.map((association) => association.recordKey)]
  return [...new Map(values.map((key) => [recordText(key), clone(key)])).values()].sort((a, b) => compareText(recordText(a), recordText(b)))
}

export function classifyDuplicate(input: DuplicateInput): DuplicateResult {
  const observation = input?.observationRecordKey
  if (!validRecordKey(observation)) return error(observation ?? { source: '', key: '' }, 'invalid-record-key', 'observationRecordKey', 'observationRecordKey is required and invalid')
  if (!input || input.namespace !== 'killer-sudoku') return error(observation, 'invalid-input', 'namespace', 'namespace must be killer-sudoku')
  const explicit = input.requestedPublicId !== undefined || input.candidateRecordKey !== undefined
  if (explicit && (!validId(input.requestedPublicId) || !validRecordKey(input.candidateRecordKey))) return error(observation, 'invalid-input', 'selection', 'requestedPublicId and candidateRecordKey must be supplied together and valid')
  try { canonicalizePlayableContent(input.content) } catch { return error(observation, 'invalid-input', 'content', 'observed PlayableContent is invalid') }
  const registryError = diagnosticForRegistry(input.registry); if (registryError) return { classification: 'errore bloccante', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observation), diagnostic: registryError }
  const matches: DuplicateMatch[] = []
  for (const key of allHistoricalKeys(input.registry)) {
    let resolved: HistoricalRecord | 'missing' | 'ambiguous'
    try { resolved = input.historicalContentSource.resolve(clone(key)) } catch { resolved = 'ambiguous' }
    if (resolved === 'missing') return error(observation, 'missing-historical-content', 'historicalContentSource', 'historical content is missing', [key])
    if (resolved === 'ambiguous' || !resolved) return error(observation, resolved === 'ambiguous' ? 'ambiguous-historical-reference' : 'invalid-historical-content', 'historicalContentSource', 'historical record cannot be associated unambiguously', [key])
    if (!validHistoricalRecord(resolved) || !sameRecord(resolved.recordKey, key) || !validId(resolved.publicId)) return error(observation, 'invalid-historical-content', 'historicalContentSource', 'historical record structure is invalid', [key])
    if (resolved.references !== undefined && (!validReferences(resolved.references) || !referencesMatchRecord(resolved))) return error(observation, 'unknown-reference', 'historicalContentSource.references', 'historical references are malformed, unknown, or inconsistent with the record key', [key])
    if (!input.registry.identities.some((identity) => identity.publicId === resolved.publicId)) return error(observation, 'unknown-reference', 'historicalContentSource.publicId', 'historical record references an unknown public ID', [key])
    const owningIdentity = input.registry.identities.find((identity) => sameRecord(identity.firstAssignment.recordKey, key))
    const owningAssociation = input.registry.associations.find((association) => sameRecord(association.recordKey, key))
    const owners = new Set([...(owningIdentity ? [owningIdentity.publicId] : []), ...(owningAssociation ? [owningAssociation.publicId] : [])])
    if (owners.size > 0 && (owners.size !== 1 || !owners.has(resolved.publicId))) return error(observation, 'identity-conflict', 'historicalContentSource.publicId', 'historical record public ID conflicts with registry ownership', [key])
    try { canonicalizePlayableContent(resolved.content) } catch { return error(observation, 'invalid-historical-content', 'historicalContentSource.content', 'historical PlayableContent is invalid', [key]) }
    const equivalentTransformations = transformations.filter((transformation) => {
      try {
        return canonicalizePlayableContent(transformPlayableContent(input.content, transformation as D4Transformation)) === canonicalizePlayableContent(resolved.content)
      } catch {
        return false
      }
    })
    if (equivalentTransformations.length > 0) matches.push({ recordKey: clone(key), publicId: resolved.publicId, transformations: equivalentTransformations })
  }
  matches.sort((a, b) => compareText(recordText(a.recordKey), recordText(b.recordKey)))
  const equivalentPublicIds = [...new Set(matches.map((match) => match.publicId))].sort()
  const registered = input.registry.associations.find((association) => sameRecord(association.recordKey, observation))
  if (registered) {
    const registeredMatch = matches.find((match) => sameRecord(match.recordKey, registered.recordKey) && match.publicId === registered.publicId)
    const selectedContradiction = explicit && input.requestedPublicId !== registered.publicId
    if (explicit && input.requestedPublicId !== undefined && !input.registry.identities.some((identity) => identity.publicId === input.requestedPublicId)) return error(observation, 'unknown-requested-public-id', 'requestedPublicId', 'requested public ID does not exist')
    if (explicit && input.candidateRecordKey !== undefined && !allHistoricalKeys(input.registry).some((key) => sameRecord(key, input.candidateRecordKey!))) return error(observation, 'unknown-candidate-record', 'candidateRecordKey', 'candidate record is not represented by the registry', [input.candidateRecordKey])
    const selectedCandidate = explicit ? matches.find((match) => sameRecord(match.recordKey, input.candidateRecordKey!)) : undefined
    if (explicit && selectedCandidate !== undefined && selectedCandidate.publicId !== input.requestedPublicId) return error(observation, 'candidate-identity-mismatch', 'candidateRecordKey', 'candidate belongs to another identity', [input.candidateRecordKey!])
    if (explicit && selectedCandidate === undefined) return error(observation, 'candidate-not-equivalent', 'candidateRecordKey', 'candidate is not D4-equivalent', [input.candidateRecordKey!])
    const fingerprintCoherent = registered.fingerprint === null || registeredMatch !== undefined
    if (selectedContradiction || !fingerprintCoherent || registeredMatch === undefined) return error(observation, 'registered-association-conflict', 'registeredAssociation', 'registered association is inconsistent with content or selection', [registered.recordKey])
    return { classification: 'associazione già registrata', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observation), registeredAssociation: clone(registered), ...(explicit ? { requestedPublicId: input.requestedPublicId, candidateRecordKey: clone(input.candidateRecordKey) } : {}) }
  }
  if (explicit) {
    const candidateRepresented = allHistoricalKeys(input.registry).some((key) => sameRecord(key, input.candidateRecordKey!))
    const candidate = matches.find((match) => sameRecord(match.recordKey, input.candidateRecordKey!))
    if (!input.registry.identities.some((identity) => identity.publicId === input.requestedPublicId)) return error(observation, 'unknown-requested-public-id', 'requestedPublicId', 'requested public ID does not exist')
    if (!candidateRepresented) return error(observation, 'unknown-candidate-record', 'candidateRecordKey', 'candidate record is not represented by the registry', [input.candidateRecordKey!])
    if (!candidate) return error(observation, 'candidate-not-equivalent', 'candidateRecordKey', 'candidate is not D4-equivalent', [input.candidateRecordKey!])
    if (candidate.publicId !== input.requestedPublicId) return error(observation, 'candidate-identity-mismatch', 'candidateRecordKey', 'candidate belongs to another identity', [input.candidateRecordKey!])
    return { classification: 'associazione proposta verificata', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observation), requestedPublicId: input.requestedPublicId, candidateRecordKey: clone(input.candidateRecordKey) }
  }
  if (equivalentPublicIds.length === 0) return { classification: 'nuovo contenuto', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observation) }
  if (equivalentPublicIds.length === 1) return { classification: 'duplicato', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observation), publicId: equivalentPublicIds[0], matches: matches.map(clone) }
  return { classification: 'ambiguità', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observation), matches: matches.map(clone), equivalentPublicIds }
}
