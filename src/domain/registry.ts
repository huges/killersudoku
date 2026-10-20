import { fingerprintPlayableContent, type PlayableContent } from './identity'

export const REGISTRY_SCHEMA_VERSION = '1' as const
export const REGISTRY_NAMESPACE = 'killer-sudoku' as const

export type RecordKey = { source: string; key: string }
export type FingerprintRef = { contract: 'playable-content-v1' | 'legacy-sha256'; kind: 'current' | 'legacy'; value: string }
export type AssignmentState = 'current' | 'removed'
export type AssignmentInput = { recordKey: RecordKey; fingerprint?: FingerprintRef; content?: PlayableContent; aliases: readonly string[]; publicId?: string; state: AssignmentState }
export type AssignOptions = { initialization?: boolean }
export type FirstAssignment = { recordKey: RecordKey; observationKey: string }
export type StateObservation = { state: AssignmentState; observationKey: string }
export type IdentityHistory = { publicId: string; firstAssignment: FirstAssignment; fingerprints: FingerprintRef[]; aliases: string[]; stateHistory: StateObservation[]; currentState: AssignmentState; currentStateObservation: string }
export type Association = { recordKey: RecordKey; publicId: string; observedPublicId: string | null; fingerprint: FingerprintRef | null; aliases: string[]; state: AssignmentState; observationKey: string }
export type Registry = { schemaVersion: '1'; namespace: 'killer-sudoku'; identities: IdentityHistory[]; associations: Association[]; reservedIds: string[]; reservedAliases: string[] }
export type Observation = { recordKey: RecordKey; publicId: string; observationKey: string }
export type DiagnosticCode = string
export type Diagnostic = { code: DiagnosticCode; path: string; recordKeys: RecordKey[]; message: string }
export type AssignmentResult = { registry: Registry | null; observations: Observation[]; diagnostics: Diagnostic[] }

const recordPattern = /^[A-Za-z0-9._/-]+$/
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const aliasPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const digestPattern = /^sha256-[0-9a-f]{64}$/
const clone = <T>(value: T): T => structuredClone(value)
const exact = (value: unknown, names: string[]): value is globalThis.Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === names.length && names.every((name) => actual.includes(name))
}
const recordText = (key: RecordKey): string => JSON.stringify([key.source, key.key])
const recordCompare = (a: RecordKey, b: RecordKey): number => recordText(a).localeCompare(recordText(b))
const sortedRecords = (keys: RecordKey[]): RecordKey[] => keys.map(clone).sort(recordCompare)
const fpKey = (fp: FingerprintRef): string => JSON.stringify([fp.contract, fp.kind, fp.value])
const sameFp = (a: FingerprintRef, b: FingerprintRef): boolean => fpKey(a) === fpKey(b)
const diagnostic = (code: string, path: string, message: string, recordKeys: RecordKey[] = []): Diagnostic => ({ code, path, recordKeys: sortedRecords(recordKeys), message })
const failure = (diagnostics: Diagnostic[]): AssignmentResult => ({ registry: null, observations: [], diagnostics })
const validRecordKey = (value: unknown): value is RecordKey => exact(value, ['source', 'key']) && typeof value.source === 'string' && typeof value.key === 'string' && recordPattern.test(value.source) && recordPattern.test(value.key)
const validId = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value)
const validAlias = (value: unknown): value is string => typeof value === 'string' && aliasPattern.test(value)
const validFingerprint = (value: unknown): value is FingerprintRef => exact(value, ['contract', 'kind', 'value']) && typeof value.contract === 'string' && typeof value.kind === 'string' && typeof value.value === 'string' && digestPattern.test(value.value) && ((value.contract === 'playable-content-v1' && value.kind === 'current') || (value.contract === 'legacy-sha256' && value.kind === 'legacy'))
const generatedId = (used: Set<string>): string | null => { for (let n = 1; n <= 999999; n += 1) { const id = `puzzle-${String(n).padStart(6, '0')}`; if (!used.has(id)) return id } return null }
const emptyRegistry = (): Registry => ({ schemaVersion: '1', namespace: REGISTRY_NAMESPACE, identities: [], associations: [], reservedIds: [], reservedAliases: [] })
const observationKey = (item: AssignmentInput, derived: string | null): string => JSON.stringify([REGISTRY_NAMESPACE, item.recordKey.source, item.recordKey.key, item.fingerprint ? [item.fingerprint.contract, item.fingerprint.kind, item.fingerprint.value] : null, [...item.aliases].sort(), item.publicId ?? null, derived, item.state])

function validateRegistry(value: unknown): Diagnostic[] {
  const errors: Diagnostic[] = []
  if (!exact(value, ['schemaVersion', 'namespace', 'identities', 'associations', 'reservedIds', 'reservedAliases'])) return [diagnostic('invalid-structure', 'previousRegistry', 'registry has an invalid structure')]
  const r = value as Registry
  if (r.schemaVersion !== '1' || r.namespace !== REGISTRY_NAMESPACE) errors.push(diagnostic('invalid-structure', 'previousRegistry', 'unsupported registry schema or namespace'))
  if (!Array.isArray(r.identities) || !Array.isArray(r.associations) || !Array.isArray(r.reservedIds) || !Array.isArray(r.reservedAliases)) return errors.concat(diagnostic('invalid-structure', 'previousRegistry', 'registry arrays are required'))
  const ids = new Map<string, IdentityHistory>(); const fps = new Map<string, string>(); const aliases = new Map<string, string>(); const records = new Map<string, string>()
  for (const id of r.reservedIds) if (!validId(id)) errors.push(diagnostic('invalid-id', 'previousRegistry.reservedIds', 'reserved ID is invalid'))
  for (const alias of r.reservedAliases) if (!validAlias(alias)) errors.push(diagnostic('invalid-alias', 'previousRegistry.reservedAliases', 'reserved alias is invalid'))
  for (const identity of r.identities) {
    if (!exact(identity, ['publicId', 'firstAssignment', 'fingerprints', 'aliases', 'stateHistory', 'currentState', 'currentStateObservation']) || !validId(identity.publicId) || !exact(identity.firstAssignment, ['recordKey', 'observationKey']) || !validRecordKey(identity.firstAssignment.recordKey) || typeof identity.firstAssignment.observationKey !== 'string' || !Array.isArray(identity.fingerprints) || !Array.isArray(identity.aliases) || !Array.isArray(identity.stateHistory) || (identity.currentState !== 'current' && identity.currentState !== 'removed') || typeof identity.currentStateObservation !== 'string') { errors.push(diagnostic('invalid-structure', 'previousRegistry.identities', 'identity history is invalid')); continue }
    if (ids.has(identity.publicId)) errors.push(diagnostic('id-conflict', 'previousRegistry.identities', 'publicId belongs to multiple identities'))
    ids.set(identity.publicId, identity)
    for (const fp of identity.fingerprints) { if (!validFingerprint(fp)) errors.push(diagnostic('invalid-fingerprint', 'previousRegistry.identities', 'historical fingerprint is invalid')); else { const old = fps.get(fpKey(fp)); if (old && old !== identity.publicId) errors.push(diagnostic('fingerprint-conflict', 'previousRegistry.identities', 'fingerprint belongs to multiple identities')); fps.set(fpKey(fp), identity.publicId) } }
    for (const alias of identity.aliases) { if (!validAlias(alias)) errors.push(diagnostic('invalid-alias', 'previousRegistry.identities', 'historical alias is invalid')); else { const old = aliases.get(alias); if (old && old !== identity.publicId) errors.push(diagnostic('ambiguous-identity', 'previousRegistry.identities', 'alias belongs to multiple identities')); aliases.set(alias, identity.publicId) } }
    for (const state of identity.stateHistory) if (!exact(state, ['state', 'observationKey']) || (state.state !== 'current' && state.state !== 'removed') || typeof state.observationKey !== 'string') errors.push(diagnostic('invalid-structure', 'previousRegistry.identities', 'state history is invalid'))
  }
  for (const association of r.associations) {
    if (!exact(association, ['recordKey', 'publicId', 'observedPublicId', 'fingerprint', 'aliases', 'state', 'observationKey']) || !validRecordKey(association.recordKey) || !validId(association.publicId) || (association.observedPublicId !== null && !validId(association.observedPublicId)) || (association.fingerprint !== null && !validFingerprint(association.fingerprint)) || !Array.isArray(association.aliases) || association.aliases.some((a) => !validAlias(a)) || (association.state !== 'current' && association.state !== 'removed') || typeof association.observationKey !== 'string') { errors.push(diagnostic('invalid-structure', 'previousRegistry.associations', 'association is invalid')); continue }
    if (!ids.has(association.publicId)) errors.push(diagnostic('invalid-structure', 'previousRegistry.associations', 'association references an unknown identity', [association.recordKey]))
    const key = recordText(association.recordKey); const old = records.get(key); if (old && old !== association.publicId) errors.push(diagnostic('identity-conflict', 'previousRegistry.associations', 'recordKey is assigned to different identities', [association.recordKey])); records.set(key, association.publicId)
  }
  const reservedIds = new Set(r.reservedIds); const reservedAliases = new Set(r.reservedAliases)
  for (const identity of r.identities) { if (reservedIds.has(identity.publicId) && !r.reservedIds.includes(identity.publicId)) errors.push(diagnostic('id-conflict', 'previousRegistry.reservedIds', 'reserved ID conflict')); for (const alias of identity.aliases) if (reservedAliases.has(alias) && !r.reservedAliases.includes(alias)) errors.push(diagnostic('alias-conflict', 'previousRegistry.reservedAliases', 'reserved alias conflict')) }
  return errors
}

function validateRegistryGlobal(r: Registry): Diagnostic[] {
  const errors: Diagnostic[] = []
  const idOwners = new Map<string, string>()
  const aliasOwners = new Map<string, string>()
  const fpOwners = new Map<string, string>()
  const recordOwners = new Map<string, string>()
  const reservedIds = new Set(r.reservedIds)
  const reservedAliases = new Set(r.reservedAliases)
  for (const identity of r.identities) {
    const priorId = idOwners.get(identity.publicId)
    if (priorId && priorId !== identity.publicId) errors.push(diagnostic('id-conflict', 'registry.identities', 'publicId is assigned more than once'))
    idOwners.set(identity.publicId, identity.publicId)
    for (const alias of identity.aliases) {
      const priorAlias = aliasOwners.get(alias)
      if (priorAlias && priorAlias !== identity.publicId) errors.push(diagnostic('alias-conflict', 'registry.identities', 'alias is assigned to multiple identities'))
      aliasOwners.set(alias, identity.publicId)
      if (reservedAliases.has(alias) === false) continue
    }
    for (const fingerprint of identity.fingerprints) {
      const key = fpKey(fingerprint)
      const priorFingerprint = fpOwners.get(key)
      if (priorFingerprint && priorFingerprint !== identity.publicId) errors.push(diagnostic('fingerprint-conflict', 'registry.identities', 'fingerprint is assigned to multiple identities'))
      fpOwners.set(key, identity.publicId)
    }
    const historyKeys = new Set<string>()
    for (const state of identity.stateHistory) {
      if (historyKeys.has(state.observationKey)) errors.push(diagnostic('invalid-structure', 'registry.identities.stateHistory', 'state observation is duplicated'))
      historyKeys.add(state.observationKey)
    }
  }
  for (const association of r.associations) {
    const key = recordText(association.recordKey)
    const prior = recordOwners.get(key)
    if (prior && prior !== association.publicId) errors.push(diagnostic('identity-conflict', 'registry.associations', 'recordKey is assigned to multiple identities', [association.recordKey]))
    recordOwners.set(key, association.publicId)
    if (!idOwners.has(association.publicId)) errors.push(diagnostic('invalid-structure', 'registry.associations', 'association references an unknown identity', [association.recordKey]))
    for (const alias of association.aliases) {
      const owner = aliasOwners.get(alias)
      if (owner && owner !== association.publicId) errors.push(diagnostic('alias-conflict', 'registry.associations', 'association alias has another owner', [association.recordKey]))
    }
    if (association.fingerprint) {
      const owner = fpOwners.get(fpKey(association.fingerprint))
      if (owner && owner !== association.publicId) errors.push(diagnostic('fingerprint-conflict', 'registry.associations', 'association fingerprint has another owner', [association.recordKey]))
    }
  }
  for (const id of reservedIds) {
    const owner = idOwners.get(id)
    const aliasOwner = aliasOwners.get(id)
    if (aliasOwner && aliasOwner !== owner) errors.push(diagnostic('id-conflict', 'registry.reservedIds', 'reserved ID collides with an alias owned by another identity'))
  }
  for (const alias of reservedAliases) {
    const owner = aliasOwners.get(alias)
    const idOwner = idOwners.get(alias)
    if (idOwner && idOwner !== owner) errors.push(diagnostic('alias-conflict', 'registry.reservedAliases', 'reserved alias collides with an ID owned by another identity'))
  }
  return errors
}

function sortRegistry(r: Registry): Registry {
  r.identities.sort((a, b) => a.publicId.localeCompare(b.publicId))
  for (const identity of r.identities) { identity.fingerprints.sort((a, b) => fpKey(a).localeCompare(fpKey(b))); identity.aliases.sort(); identity.stateHistory.sort((a, b) => a.observationKey.localeCompare(b.observationKey)) }
  r.associations.sort((a, b) => a.observationKey.localeCompare(b.observationKey)); r.reservedIds.sort(); r.reservedAliases.sort(); return r
}

type Record = { input: AssignmentInput; derived: string | null; observationKey: string }
type Plan = { record: Record; identity: IdentityHistory | null; group: string }

export function assignIncremental(previousRegistry: Registry, input: readonly AssignmentInput[], options: AssignOptions): AssignmentResult {
  const structure: Diagnostic[] = []
  const optionsValue: unknown = options
  const optionsValid = exact(optionsValue, []) || (exact(optionsValue, ['initialization']) && typeof (optionsValue as { initialization?: unknown }).initialization === 'boolean')
  if (!optionsValid) structure.push(diagnostic('invalid-structure', 'options', 'options must contain only optional initialization'))
  structure.push(...validateRegistry(previousRegistry))
  if (!Array.isArray(input)) structure.push(diagnostic('invalid-structure', 'input', 'input must be an array'))
  if (structure.length) return failure(structure)
  const source = clone(previousRegistry)
  const initialization = exact(optionsValue, ['initialization']) && (optionsValue as { initialization?: unknown }).initialization === true
  if (source.identities.length === 0 && !initialization) return failure([diagnostic('initialization-required', 'options.initialization', 'an empty registry requires explicit initialization')])
  const errors: Diagnostic[] = []; const records: Record[] = []; const seen = new Map<string, string>()
  for (let index = 0; index < input.length; index += 1) {
    const raw: unknown = input[index]; const path = `input[${index}]`; if (!exact(raw, ['recordKey', ...(typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, 'fingerprint') ? ['fingerprint'] : []), ...(typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, 'content') ? ['content'] : []), 'aliases', ...(typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, 'publicId') ? ['publicId'] : []), 'state'])) { errors.push(diagnostic('invalid-structure', path, 'assignment input has unknown or missing properties')); continue }
    const item = raw as AssignmentInput; const keyOk = validRecordKey(item.recordKey); if (!keyOk) errors.push(diagnostic('invalid-record-key', `${path}.recordKey`, 'recordKey source and key are invalid'))
    const aliasesOk = Array.isArray(item.aliases) && item.aliases.every(validAlias); if (!aliasesOk) errors.push(diagnostic('invalid-alias', `${path}.aliases`, 'alias is invalid', keyOk ? [item.recordKey] : [])); if (Array.isArray(item.aliases) && new Set(item.aliases).size !== item.aliases.length) errors.push(diagnostic('malformed-alias-list', `${path}.aliases`, 'aliases must be unique', keyOk ? [item.recordKey] : []))
    const fpOk = item.fingerprint === undefined || validFingerprint(item.fingerprint); if (!fpOk) errors.push(diagnostic('invalid-fingerprint', `${path}.fingerprint`, 'fingerprint is invalid', keyOk ? [item.recordKey] : []))
    if (item.publicId !== undefined && !validId(item.publicId)) errors.push(diagnostic('invalid-id', `${path}.publicId`, 'publicId is invalid', keyOk ? [item.recordKey] : []))
    if (item.state !== 'current' && item.state !== 'removed') errors.push(diagnostic('invalid-structure', `${path}.state`, 'state is invalid', keyOk ? [item.recordKey] : []))
    let derived: string | null = null; if (item.content !== undefined) { try { derived = fingerprintPlayableContent(item.content) } catch { errors.push(diagnostic('invalid-structure', `${path}.content`, 'content is invalid', keyOk ? [item.recordKey] : [])) } }
    if (item.content !== undefined && item.fingerprint !== undefined && (!fpOk || item.fingerprint.contract !== 'playable-content-v1' || item.fingerprint.kind !== 'current' || item.fingerprint.value !== derived)) errors.push(diagnostic('fingerprint-conflict', `${path}.fingerprint`, 'fingerprint does not match content', keyOk ? [item.recordKey] : []))
    if (keyOk && aliasesOk && fpOk && (item.state === 'current' || item.state === 'removed')) { const obs = observationKey(item, derived); const stable = recordText(item.recordKey); const old = seen.get(stable); if (old && old !== obs) errors.push(diagnostic('duplicate-record-key', path, 'recordKey has conflicting observations in this batch', [item.recordKey])); else if (!old) { seen.set(stable, obs); records.push({ input: clone(item), derived, observationKey: obs }) } }
  }
  if (errors.length) return failure(errors)
  const idOwners = new Map<string, IdentityHistory>(); const fpOwners = new Map<string, IdentityHistory>(); const aliasOwners = new Map<string, IdentityHistory>(); const recordOwners = new Map<string, string>()
  for (const identity of source.identities) { idOwners.set(identity.publicId, identity); for (const fp of identity.fingerprints) fpOwners.set(fpKey(fp), identity); for (const alias of identity.aliases) aliasOwners.set(alias, identity) }
  for (const association of source.associations) { const old = recordOwners.get(recordText(association.recordKey)); if (old && old !== association.publicId) return failure([diagnostic('identity-conflict', 'previousRegistry.associations', 'recordKey is assigned to different identities', [association.recordKey])]); recordOwners.set(recordText(association.recordKey), association.publicId) }
  const used = new Set([...source.reservedIds, ...source.reservedAliases, ...source.identities.map((i) => i.publicId), ...source.identities.flatMap((i) => i.aliases), ...records.flatMap((r) => r.input.publicId ? [r.input.publicId] : []), ...records.flatMap((r) => r.input.aliases)])
  const historicalCandidates = (record: Record): Set<string> => { const result = new Set<string>(); const fps = record.input.fingerprint ? [record.input.fingerprint] : record.derived ? [{ contract: 'playable-content-v1', kind: 'current', value: record.derived } as FingerprintRef] : []; for (const fp of fps) { const owner = fpOwners.get(fpKey(fp)); if (owner) result.add(owner.publicId) } for (const alias of record.input.aliases) { const owner = aliasOwners.get(alias); if (owner) result.add(owner.publicId) } if (record.input.publicId && idOwners.has(record.input.publicId)) result.add(record.input.publicId); return result }
  const parent = new Map<string, string>(); const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const root = find(p); parent.set(x, root); return root }; const union = (a: string, b: string): void => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra) }
  const tokenOwner = new Map<string, string>(); const tokens = (record: Record): string[] => { const values: string[] = []; if (record.input.fingerprint) values.push(`fp:${fpKey(record.input.fingerprint)}`); else if (record.derived) values.push(`fp:${fpKey({ contract: 'playable-content-v1', kind: 'current', value: record.derived })}`); for (const alias of record.input.aliases) values.push(`alias:${alias}`); return values }
  for (const record of records) { const rk = record.observationKey; parent.set(rk, rk); for (const token of tokens(record)) { const old = tokenOwner.get(token); if (old) union(rk, old); else tokenOwner.set(token, rk) } if (record.input.publicId) { const token = `id:${record.input.publicId}`; const old = tokenOwner.get(token); if (old) union(rk, old); else tokenOwner.set(token, rk) } }
  for (const record of records) { for (const candidate of historicalCandidates(record)) { const token = `historical:${candidate}`; const old = tokenOwner.get(token); if (old) union(record.observationKey, old); else tokenOwner.set(token, record.observationKey) } }
  const groups = new Map<string, Record[]>(); for (const record of records) { const root = find(record.observationKey); const group = groups.get(root) ?? []; group.push(record); groups.set(root, group) }
  const plans: Plan[] = []; const usedAssigned = new Set(used)
  const batchReservationOwners = new Map<string, Set<string>>()
  for (const record of records) {
    const reservationValues = [...record.input.aliases, ...(record.input.publicId ? [record.input.publicId] : [])]
    for (const value of reservationValues) {
      const owners = batchReservationOwners.get(value) ?? new Set<string>()
      owners.add(find(record.observationKey))
      batchReservationOwners.set(value, owners)
    }
  }
  for (const group of [...groups.values()].sort((a, b) => a.map((r) => r.observationKey).sort()[0].localeCompare(b.map((r) => r.observationKey).sort()[0]))) {
    const candidateIds = new Set(group.flatMap((record) => [...historicalCandidates(record)])); const existingKeys = new Set(group.map((record) => recordOwners.get(recordText(record.input.recordKey))).filter((x): x is string => Boolean(x))); for (const id of existingKeys) candidateIds.add(id)
    const knownAliasOwners = new Set(group.flatMap((record) => record.input.aliases.map((alias) => aliasOwners.get(alias)?.publicId).filter((id): id is string => Boolean(id))))
    const knownFingerprintOwners = new Set(group.flatMap((record) => { const fp = record.input.fingerprint ?? (record.derived ? { contract: 'playable-content-v1', kind: 'current', value: record.derived } as FingerprintRef : null); const owner = fp ? fpOwners.get(fpKey(fp))?.publicId : undefined; return owner ? [owner] : [] }))
    if (knownAliasOwners.size > 1 || knownFingerprintOwners.size > 1) return failure([diagnostic('ambiguous-identity', 'input', 'references identify different historical identities', group.map((r) => r.input.recordKey))])
    if (candidateIds.size > 1) return failure([diagnostic('identity-conflict', 'input', 'batch references incompatible identities', group.map((r) => r.input.recordKey))])
    const identityId = candidateIds.values().next().value as string | undefined; const identity = identityId ? idOwners.get(identityId) : undefined
    if (identityId && !identity) return failure([diagnostic('invalid-structure', 'input', 'candidate identity is unavailable', group.map((r) => r.input.recordKey))])
    const fingerprints = new Set(group.flatMap((record) => { const fp = record.input.fingerprint ?? (record.derived ? { contract: 'playable-content-v1', kind: 'current', value: record.derived } as FingerprintRef : null); return fp ? [fpKey(fp)] : [] })); if (fingerprints.size > 1) return failure([diagnostic(identity ? 'fingerprint-conflict' : 'identity-conflict', 'input.fingerprint', 'batch contains incompatible fingerprints', group.map((r) => r.input.recordKey))])
    if (identity && group.some((record) => { const fp = record.input.fingerprint ?? (record.derived ? { contract: 'playable-content-v1', kind: 'current', value: record.derived } as FingerprintRef : null); return Boolean(fp && identity.fingerprints.some((old) => old.contract === fp.contract && old.value !== fp.value)) })) return failure([diagnostic('fingerprint-conflict', 'input.fingerprint', 'fingerprint conflicts with identity history', group.map((r) => r.input.recordKey))])
    const knownAliases = group.flatMap((record) => record.input.aliases.filter((alias) => aliasOwners.has(alias)))
    const hasUnknownFingerprint = group.some((record) => {
      const fp = record.input.fingerprint ?? (record.derived ? { contract: 'playable-content-v1', kind: 'current', value: record.derived } as FingerprintRef : null)
      return Boolean(fp && !fpOwners.has(fpKey(fp)))
    })
    if (knownAliases.length > 0 && hasUnknownFingerprint) return failure([diagnostic('fingerprint-alias-conflict', 'input', 'unknown content cannot use a known alias', group.map((r) => r.input.recordKey))])
    if (identity && hasUnknownFingerprint) return failure([diagnostic('fingerprint-conflict', 'input.fingerprint', 'fingerprint is incompatible with the historical identity', group.map((r) => r.input.recordKey))])
    if (!identity && group.every((record) => !record.input.fingerprint && !record.derived)) return failure([diagnostic('insufficient-identity-evidence', 'input', 'identity evidence is required', group.map((r) => r.input.recordKey))])
    const requested = new Set(group.map((r) => r.input.publicId).filter((id): id is string => Boolean(id))); if (requested.size > 1) return failure([diagnostic('public-id-conflict', 'input.publicId', 'one identity has multiple public IDs', group.map((r) => r.input.recordKey))]); if (identity && requested.size && [...requested][0] !== identity.publicId) return failure([diagnostic('public-id-conflict', 'input.publicId', 'publicId is assigned to another identity', group.map((r) => r.input.recordKey))])
    const states = new Set(group.map((r) => r.input.state)); if (states.size > 1) return failure([diagnostic('incompatible-state', 'input.state', 'one identity has incompatible states in the batch', group.map((r) => r.input.recordKey))])
    let assigned = identity; if (!assigned) { const requestedId = [...requested][0]; const id = requestedId ?? generatedId(usedAssigned); if (!id) return failure([diagnostic('id-exhausted', 'input', 'no generated puzzle ID is available', group.map((r) => r.input.recordKey))]); const root = find(group[0].observationKey); const batchOwners = batchReservationOwners.get(id) ?? new Set<string>(); const permittedBatchReservation = requestedId !== undefined && batchOwners.size > 0 && [...batchOwners].every((owner) => owner === root); if (usedAssigned.has(id) && !permittedBatchReservation) return failure([diagnostic('id-conflict', 'input.publicId', 'publicId collides with a reserved value', group.map((r) => r.input.recordKey))]); usedAssigned.add(id); const first = [...group].sort((a, b) => a.observationKey.localeCompare(b.observationKey))[0]; assigned = { publicId: id, firstAssignment: { recordKey: clone(first.input.recordKey), observationKey: first.observationKey }, fingerprints: [], aliases: [], stateHistory: [], currentState: first.input.state, currentStateObservation: first.observationKey }; source.identities.push(assigned); idOwners.set(id, assigned) }
    for (const record of group) plans.push({ record, identity: assigned, group: assigned.publicId })
  }
  const byIdentity = new Map<string, Plan[]>(); for (const plan of plans) { const list = byIdentity.get(plan.identity!.publicId) ?? []; list.push(plan); byIdentity.set(plan.identity!.publicId, list) }
  for (const plan of plans) { const item = plan.record.input; const identity = plan.identity!; const owner = recordOwners.get(recordText(item.recordKey)); if (owner && owner !== identity.publicId) return failure([diagnostic('identity-conflict', 'input.recordKey', 'recordKey cannot be reassigned', [item.recordKey])]); for (const alias of item.aliases) { const old = aliasOwners.get(alias); if (old && old.publicId !== identity.publicId) return failure([diagnostic('alias-conflict', 'input.aliases', 'alias is assigned to another identity', [item.recordKey])]); if (!identity.aliases.includes(alias)) identity.aliases.push(alias); aliasOwners.set(alias, identity) } const observedFp = item.fingerprint ? clone(item.fingerprint) : plan.record.derived ? { contract: 'playable-content-v1', kind: 'current', value: plan.record.derived } as FingerprintRef : null; if (observedFp && !identity.fingerprints.some((fp) => sameFp(fp, observedFp))) identity.fingerprints.push(observedFp); const association: Association = { recordKey: clone(item.recordKey), publicId: identity.publicId, observedPublicId: item.publicId === undefined ? null : item.publicId, fingerprint: item.fingerprint ? clone(item.fingerprint) : null, aliases: [...item.aliases].sort(), state: item.state, observationKey: plan.record.observationKey }; if (!source.associations.some((old) => old.observationKey === association.observationKey)) source.associations.push(association); if (!identity.stateHistory.some((old) => old.observationKey === association.observationKey)) identity.stateHistory.push({ state: item.state, observationKey: association.observationKey }); recordOwners.set(recordText(item.recordKey), identity.publicId) }
  for (const [publicId, group] of byIdentity) { const identity = idOwners.get(publicId)!; const current = [...group].sort((a, b) => a.record.observationKey.localeCompare(b.record.observationKey))[0]; identity.currentState = current.record.input.state; identity.currentStateObservation = current.record.observationKey }
  const finalErrors = [...validateRegistry(source), ...validateRegistryGlobal(source)]; if (finalErrors.length) return failure(finalErrors)
  const result = clone(sortRegistry(source)); const observations = plans.map((p) => ({ recordKey: clone(p.record.input.recordKey), publicId: p.identity!.publicId, observationKey: p.record.observationKey })).sort((a, b) => a.observationKey.localeCompare(b.observationKey)); return { registry: result, observations, diagnostics: [] }
}

export function createEmptyRegistry(): Registry { return emptyRegistry() }
export function serializeRegistry(registry: Registry): string { return JSON.stringify(registry) }
