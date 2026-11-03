import { canonicalizePlayableContent, transformPlayableContent, type PlayableContent, type D4Transformation } from './identity'
import { type Association, type FingerprintRef, type RecordKey, type Registry } from './registry'

export const DUPLICATE_CLASSIFICATION_ALGORITHM = 'd4-v1' as const
export type DuplicateClassification = 'nuovo contenuto' | 'duplicato' | 'associazione proposta verificata' | 'associazione già registrata' | 'ambiguità' | 'errore bloccante'

export type HistoricalReference = { reference: string; recordKey: RecordKey }
export type HistoricalRecord = { recordKey: RecordKey; publicId: string; content: PlayableContent; references?: readonly string[] }
export type HistoricalContentSource = {
  resolve: (recordKey: RecordKey) => HistoricalRecord | 'missing' | 'ambiguous'
  resolveReference?: (reference: string) => HistoricalReference | 'missing' | 'ambiguous'
}
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
const recordText = (key: RecordKey | null | undefined): string => JSON.stringify([key?.source ?? '', key?.key ?? ''])
const sameRecord = (left: RecordKey, right: RecordKey): boolean => recordText(left) === recordText(right)
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const sortRecords = (keys: RecordKey[]): RecordKey[] => keys.map(clone).sort((a, b) => compareText(recordText(a), recordText(b)))
const stableValueText = (value: unknown): string => {
  try { return JSON.stringify(value) } catch { return String(value) }
}
const sortedAssociations = (registry: Registry): Registry['associations'] => [...registry.associations].sort((a, b) => {
  const aValidKey = typeof a === 'object' && a !== null && validRecordKey((a as { recordKey?: unknown }).recordKey)
  const bValidKey = typeof b === 'object' && b !== null && validRecordKey((b as { recordKey?: unknown }).recordKey)
  if (aValidKey !== bValidKey) return aValidKey ? -1 : 1
  const aKey = aValidKey ? recordText((a as { recordKey: RecordKey }).recordKey) : ''
  const bKey = bValidKey ? recordText((b as { recordKey: RecordKey }).recordKey) : ''
  const byKey = compareText(aKey, bKey)
  return byKey !== 0 ? byKey : compareText(stableValueText(a), stableValueText(b))
})
const error = (observationRecordKey: RecordKey, code: string, path: string, message: string, recordKeys: RecordKey[] = []): DuplicateResult => ({ classification: 'errore bloccante', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observationRecordKey), diagnostic: { code, path, recordKeys: sortRecords(recordKeys), message } })
const validRecordKey = (value: unknown): value is RecordKey => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 2 && typeof (value as RecordKey).source === 'string' && typeof (value as RecordKey).key === 'string' && recordPattern.test((value as RecordKey).source) && recordPattern.test((value as RecordKey).key)
const validId = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value)
const validAlias = (value: unknown): value is string => typeof value === 'string' && aliasPattern.test(value)
const validFingerprint = (value: unknown): value is FingerprintRef => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 3) return false
  const fingerprint = value as FingerprintRef
  return ((fingerprint.contract === 'playable-content-v1' && fingerprint.kind === 'current') || (fingerprint.contract === 'legacy-sha256' && fingerprint.kind === 'legacy')) && typeof fingerprint.value === 'string' && fingerprintPattern.test(fingerprint.value)
}
const fingerprintKey = (fingerprint: FingerprintRef | unknown): string => {
  if (!validFingerprint(fingerprint)) return stableValueText(fingerprint)
  return JSON.stringify({ contract: fingerprint.contract, kind: fingerprint.kind, value: fingerprint.value })
}
const referencePattern = /^[A-Za-z0-9._/-]+$/
const validReferences = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((reference) => typeof reference === 'string' && referencePattern.test(reference))
const historicalReferenceDiagnostic = (record: HistoricalRecord, source: HistoricalContentSource, key: RecordKey): DuplicateDiagnostic | null => {
  if (record.references === undefined) return null
  if (typeof source.resolveReference !== 'function') return { code: 'unknown-reference', path: 'historicalContentSource.references', recordKeys: [key], message: 'declared historical references require an authorized resolver' }
  for (const reference of [...record.references].sort(compareText)) {
    let resolved: HistoricalReference | 'missing' | 'ambiguous'
    try { resolved = source.resolveReference(reference) } catch { resolved = 'ambiguous' }
    if (resolved === 'missing') return { code: 'unknown-reference', path: 'historicalContentSource.references', recordKeys: [key], message: `historical reference ${reference} does not exist` }
    if (resolved === 'ambiguous') return { code: 'ambiguous-historical-reference', path: 'historicalContentSource.references', recordKeys: [key], message: `historical reference ${reference} is ambiguous` }
    if (!resolved || !validRecordKey(resolved.recordKey) || !sameRecord(resolved.recordKey, key)) return { code: 'identity-conflict', path: 'historicalContentSource.references', recordKeys: [key], message: `historical reference ${reference} is incoherent with its record` }
  }
  return null
}
const validAssociationShape = (association: unknown): association is Association => typeof association === 'object' && association !== null && !Array.isArray(association) && Object.keys(association).length === 7 && Array.isArray((association as Association).aliases) && (association as Association).aliases.every(validAlias) && typeof (association as Association).observationKey === 'string' && ((association as Association).state === 'current' || (association as Association).state === 'removed')
const validHistoricalRecord = (value: unknown): value is HistoricalRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as HistoricalRecord
  return validRecordKey(record.recordKey) && validId(record.publicId) && record.content !== undefined
}
const validStateHistory = (value: unknown): value is readonly { state: 'current' | 'removed'; observationKey: string }[] => {
  if (!Array.isArray(value) || value.length === 0) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) return false
    const entry = value[index]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || Object.keys(entry).length !== 2) return false
    const state = entry as { state?: unknown; observationKey?: unknown }
    if ((state.state !== 'current' && state.state !== 'removed') || typeof state.observationKey !== 'string') return false
  }
  return true
}
const firstDiagnostic = (diagnostics: DuplicateDiagnostic[]): DuplicateDiagnostic => [...diagnostics].sort((left, right) => compareText(JSON.stringify([left.code, left.path, left.recordKeys.map(recordText), left.message]), JSON.stringify([right.code, right.path, right.recordKeys.map(recordText), right.message])))[0]

function diagnosticForRegistry(registry: Registry): DuplicateDiagnostic | null {
  if (registry === null || typeof registry !== 'object' || registry.schemaVersion !== '1' || registry.namespace !== 'killer-sudoku' || !Array.isArray(registry.identities) || !Array.isArray(registry.associations) || !Array.isArray(registry.reservedIds) || !Array.isArray(registry.reservedAliases)) return { code: 'invalid-input', path: 'registry', recordKeys: [], message: 'registry structure or namespace is invalid' }
  const ids = new Set<string>(); const aliases = new Map<string, string>(); const fingerprints = new Map<string, string>(); const records = new Map<string, string>(); const associationObservations = new Map<string, { publicId: string; recordKey: RecordKey }>(); const associationRecords = new Map<string, { publicId: string; recordKey: RecordKey }>(); const associationAliases = new Map<string, string>()
  const reservedIds = new Set<string>()
  const reservedIdValues = [...registry.reservedIds].sort(compareText)
  for (const value of reservedIdValues) {
    if (!validId(value)) return { code: 'invalid-public-id', path: 'registry.reservedIds', recordKeys: [], message: 'reserved public ID is invalid' }
    if (reservedIds.has(value)) return { code: 'id-conflict', path: 'registry.reservedIds', recordKeys: [], message: 'reserved public ID is duplicated' }
    reservedIds.add(value)
  }
  const reservedAliases = new Set<string>()
  const reservedAliasValues = [...registry.reservedAliases].sort(compareText)
  for (const value of reservedAliasValues) {
    if (!validAlias(value)) return { code: 'invalid-alias', path: 'registry.reservedAliases', recordKeys: [], message: 'reserved alias is invalid' }
    if (reservedAliases.has(value)) return { code: 'alias-conflict', path: 'registry.reservedAliases', recordKeys: [], message: 'reserved alias is duplicated' }
    reservedAliases.add(value)
  }
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
    const identityAliases = new Set<string>()
    for (const alias of [...identity.aliases].sort(compareText)) { if (!validAlias(alias)) return { code: 'invalid-alias', path: 'registry.identities', recordKeys: [identity.firstAssignment.recordKey], message: 'alias is invalid' }; if (identityAliases.has(alias)) return { code: 'alias-conflict', path: 'registry.identities.aliases', recordKeys: [identity.firstAssignment.recordKey], message: 'alias is duplicated' }; identityAliases.add(alias); const old = aliases.get(alias); if (old && old !== identity.publicId) return { code: 'alias-conflict', path: 'registry.identities', recordKeys: [identity.firstAssignment.recordKey], message: 'alias belongs to multiple identities' }; if (reservedAliases.has(alias)) return { code: 'alias-conflict', path: 'registry.identities.aliases', recordKeys: [identity.firstAssignment.recordKey], message: 'alias is reserved' }; aliases.set(alias, identity.publicId) }
    const identityFingerprints = new Set<string>()
    for (const fingerprint of [...identity.fingerprints].sort((left, right) => compareText(fingerprintKey(left), fingerprintKey(right)))) { if (!validFingerprint(fingerprint)) return { code: 'invalid-fingerprint', path: 'registry.identities', recordKeys: [identity.firstAssignment.recordKey], message: 'fingerprint is malformed' }; const key = fingerprintKey(fingerprint); if (identityFingerprints.has(key)) return { code: 'fingerprint-conflict', path: 'registry.identities.fingerprints', recordKeys: [identity.firstAssignment.recordKey], message: 'fingerprint is duplicated' }; identityFingerprints.add(key); const old = fingerprints.get(key); if (old && old !== identity.publicId) return { code: 'fingerprint-conflict', path: 'registry.identities', recordKeys: [identity.firstAssignment.recordKey], message: 'fingerprint belongs to multiple identities' }; fingerprints.set(key, identity.publicId) }
  }
  for (const reservedId of reservedIds) {
    if (ids.has(reservedId)) return { code: 'id-conflict', path: 'registry.reservedIds', recordKeys: [], message: 'reserved public ID is active' }
  }
  for (const reservedAlias of reservedAliases) {
    if (aliases.has(reservedAlias)) return { code: 'alias-conflict', path: 'registry.reservedAliases', recordKeys: [], message: 'reserved alias is active' }
  }
  for (const association of sortedAssociations(registry)) {
    if (!validAssociationShape(association)) return { code: 'invalid-input', path: 'registry.associations', recordKeys: typeof association === 'object' && association !== null && validRecordKey((association as { recordKey?: unknown }).recordKey) ? [(association as { recordKey: RecordKey }).recordKey] : [], message: 'association structure is invalid' }
  }
  const associationsByObservation = new Map<string, Association>()
  for (const association of sortedAssociations(registry)) {
    const previous = associationsByObservation.get(association.observationKey)
    if (previous) return { code: 'association-conflict', path: 'registry.associations.observationKey', recordKeys: [previous.recordKey, association.recordKey], message: 'observation has multiple registered associations' }
    associationsByObservation.set(association.observationKey, association)
  }
  const observations = new Map<string, string>()
  for (const identity of [...registry.identities].sort((left, right) => compareText(String(left?.publicId), String(right?.publicId)))) {
    const identityRecordKey = identity && typeof identity === 'object' && identity.firstAssignment && typeof identity.firstAssignment === 'object' ? identity.firstAssignment.recordKey : undefined
    if (typeof identity?.publicId !== 'string' || !identity.firstAssignment || typeof identity.firstAssignment !== 'object' || typeof identity.firstAssignment.observationKey !== 'string' || typeof identity.currentStateObservation !== 'string' || !validStateHistory(identity.stateHistory) || !['current', 'removed'].includes(identity.currentState as string)) return { code: 'invalid-input', path: 'registry.identities.stateHistory', recordKeys: validRecordKey(identityRecordKey) ? [identityRecordKey] : [], message: 'identity state history is invalid' }
    const history = identity.stateHistory
    for (const entry of history) {
      const previous = observations.get(entry.observationKey)
      if (previous !== undefined) return { code: 'identity-conflict', path: 'registry.identities.stateHistory', recordKeys: validRecordKey(identityRecordKey) ? [identityRecordKey] : [], message: 'identity observation is duplicated in state history' }
      observations.set(entry.observationKey, entry.state)
    }
    const firstAssociation = associationsByObservation.get(identity.firstAssignment.observationKey)
    if (!firstAssociation || firstAssociation.publicId !== identity.publicId || !sameRecord(firstAssociation.recordKey, identity.firstAssignment.recordKey)) return { code: 'identity-conflict', path: 'registry.identities.firstAssignment', recordKeys: validRecordKey(identityRecordKey) ? [identityRecordKey] : [], message: 'first assignment does not match an association' }
    const currentAssociation = associationsByObservation.get(identity.currentStateObservation)
    if (!currentAssociation || currentAssociation.publicId !== identity.publicId || currentAssociation.state !== identity.currentState) return { code: 'identity-conflict', path: 'registry.identities.currentStateObservation', recordKeys: validRecordKey(identityRecordKey) ? [identityRecordKey] : [], message: 'current state observation does not match the identity' }
    for (const entry of history) {
      const association = associationsByObservation.get(entry.observationKey)
      if (!association || association.publicId !== identity.publicId || association.state !== entry.state) return { code: 'identity-conflict', path: 'registry.identities.stateHistory', recordKeys: validRecordKey(identityRecordKey) ? [identityRecordKey] : [], message: 'state history does not match an association' }
    }
    if (!history.some((entry) => entry.observationKey === identity.firstAssignment.observationKey)) return { code: 'identity-conflict', path: 'registry.identities.firstAssignment.observationKey', recordKeys: validRecordKey(identityRecordKey) ? [identityRecordKey] : [], message: 'first assignment is absent from state history' }
    if (!history.some((entry) => entry.observationKey === identity.currentStateObservation)) return { code: 'identity-conflict', path: 'registry.identities.currentStateObservation', recordKeys: validRecordKey(identityRecordKey) ? [identityRecordKey] : [], message: 'current state observation is absent from state history' }
    for (const association of sortedAssociations(registry).filter((candidate) => candidate.publicId === identity.publicId)) {
      if (!history.some((entry) => entry.observationKey === association.observationKey && entry.state === association.state)) return { code: 'identity-conflict', path: 'registry.associations', recordKeys: validRecordKey(association.recordKey) ? [association.recordKey] : [], message: 'association is absent from state history' }
    }
  }
  const associationFingerprintOwners = new Map<string, string>()
  for (const association of sortedAssociations(registry)) {
    if (typeof association !== 'object' || association === null || !validRecordKey(association.recordKey) || !validId(association.publicId) || !validAssociationShape(association) || (association.observedPublicId !== null && !validId(association.observedPublicId)) || (association.fingerprint !== null && !validFingerprint(association.fingerprint))) return { code: 'invalid-input', path: 'registry.associations', recordKeys: typeof association === 'object' && association !== null && validRecordKey(association.recordKey) ? [association.recordKey] : [], message: 'association identifier, aliases, state, or fingerprint is invalid' }
    if (!ids.has(association.publicId)) return { code: 'unknown-reference', path: 'registry.associations.publicId', recordKeys: [association.recordKey], message: 'association references an unknown identity' }
    if (association.observedPublicId !== null && association.observedPublicId !== association.publicId) return { code: 'association-conflict', path: 'registry.associations.observedPublicId', recordKeys: [association.recordKey], message: 'observed public ID disagrees with association identity' }
    const key = recordText(association.recordKey); const firstAssignmentOwner = records.get(key); if (firstAssignmentOwner && firstAssignmentOwner !== association.publicId) return { code: 'identity-conflict', path: 'registry.associations.recordKey', recordKeys: [association.recordKey], message: 'record is associated with multiple identities' }; const old = associationRecords.get(key); if (old && old.publicId !== association.publicId) return { code: 'identity-conflict', path: 'registry.associations.recordKey', recordKeys: [old.recordKey, association.recordKey], message: 'record is associated with multiple identities' }; associationRecords.set(key, { publicId: association.publicId, recordKey: association.recordKey })
    const previousAssociation = associationObservations.get(association.observationKey); if (previousAssociation) return { code: 'association-conflict', path: 'registry.associations.observationKey', recordKeys: [previousAssociation.recordKey, association.recordKey], message: 'observation has multiple registered associations' }; associationObservations.set(association.observationKey, { publicId: association.publicId, recordKey: association.recordKey })
    const identity = registry.identities.find((candidate) => candidate.publicId === association.publicId); if (!identity) return { code: 'unknown-reference', path: 'registry.associations.publicId', recordKeys: [association.recordKey], message: 'association references an unknown identity' }; const seenAliases = new Set<string>(); for (const alias of [...association.aliases].sort(compareText)) { if (seenAliases.has(alias)) return { code: 'alias-conflict', path: 'registry.associations.aliases', recordKeys: [association.recordKey], message: 'association alias is duplicated' }; seenAliases.add(alias); if (reservedAliases.has(alias)) return { code: 'alias-conflict', path: 'registry.associations.aliases', recordKeys: [association.recordKey], message: 'association alias is reserved' }; const owner = associationAliases.get(alias); if (owner && owner !== association.publicId) return { code: 'alias-conflict', path: 'registry.associations.aliases', recordKeys: [association.recordKey], message: 'association alias belongs to multiple identities' }; if (!identity.aliases.includes(alias)) return { code: 'association-conflict', path: 'registry.associations.aliases', recordKeys: [association.recordKey], message: 'association alias is absent from identity history' }; associationAliases.set(alias, association.publicId) }
    if (association.fingerprint !== null) { const key = fingerprintKey(association.fingerprint); const identityOwner = fingerprints.get(key); if (identityOwner && identityOwner !== association.publicId) return { code: 'fingerprint-conflict', path: 'registry.associations.fingerprint', recordKeys: [association.recordKey], message: 'association fingerprint belongs to another identity' }; if (!identity.fingerprints.some((fingerprint) => fingerprintKey(fingerprint) === key)) return { code: 'fingerprint-conflict', path: 'registry.associations.fingerprint', recordKeys: [association.recordKey], message: 'association fingerprint is absent from identity history' }; const owner = associationFingerprintOwners.get(key); if (owner && owner !== association.publicId) return { code: 'fingerprint-conflict', path: 'registry.associations.fingerprint', recordKeys: [association.recordKey], message: 'fingerprint belongs to multiple identities' }; associationFingerprintOwners.set(key, association.publicId) }
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
  if (!input.historicalContentSource || typeof input.historicalContentSource !== 'object' || typeof input.historicalContentSource.resolve !== 'function') return error(observation, 'invalid-input', 'historicalContentSource', 'historicalContentSource.resolve must be callable')
  const registryError = diagnosticForRegistry(input.registry); if (registryError) return { classification: 'errore bloccante', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observation), diagnostic: firstDiagnostic([registryError]) }
  const matches: DuplicateMatch[] = []
  for (const key of allHistoricalKeys(input.registry)) {
    let resolved: HistoricalRecord | 'missing' | 'ambiguous'
    try { resolved = input.historicalContentSource.resolve(clone(key)) } catch { resolved = 'ambiguous' }
    if (resolved === 'missing') return error(observation, 'missing-historical-content', 'historicalContentSource', 'historical content is missing', [key])
    if (resolved === 'ambiguous' || !resolved) return error(observation, resolved === 'ambiguous' ? 'ambiguous-historical-reference' : 'invalid-historical-content', 'historicalContentSource', 'historical record cannot be associated unambiguously', [key])
    if (!validHistoricalRecord(resolved) || !sameRecord(resolved.recordKey, key) || !validId(resolved.publicId)) return error(observation, 'invalid-historical-content', 'historicalContentSource', 'historical record structure is invalid', [key])
    if (resolved.references !== undefined && !validReferences(resolved.references)) return error(observation, 'invalid-input', 'historicalContentSource.references', 'historical references are malformed', [key])
    if (resolved.references !== undefined) {
      const referenceDiagnostic = historicalReferenceDiagnostic(resolved, input.historicalContentSource, key)
      if (referenceDiagnostic) return { classification: 'errore bloccante', algorithmVersion: DUPLICATE_CLASSIFICATION_ALGORITHM, observationRecordKey: clone(observation), diagnostic: firstDiagnostic([referenceDiagnostic]) }
    }
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
  const registered = sortedAssociations(input.registry).find((association) => sameRecord(association.recordKey, observation))
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
