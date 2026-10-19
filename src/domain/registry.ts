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
const generatedPattern = /^puzzle-(?:[0-9]{6})$/

const keys = (value: object): string[] => Object.keys(value)
const exact = (value: unknown, expected: string[]): value is Record<string, unknown> => typeof value === 'object' && value !== null && keys(value).length === expected.length && expected.every((key) => keys(value).includes(key))
const clone = <T>(value: T): T => structuredClone(value)
const recordText = (key: RecordKey): string => `${key.source}/${key.key}`
const recordCompare = (a: RecordKey, b: RecordKey): number => recordText(a) < recordText(b) ? -1 : recordText(a) > recordText(b) ? 1 : 0
const sortedRecords = (keys: RecordKey[]): RecordKey[] => keys.map(clone).sort(recordCompare)
const fpKey = (fp: FingerprintRef): string => `${fp.contract}|${fp.kind}|${fp.value}`
const publicIdKey = (id: string): string => `id|${id}`

function diagnostic(code: string, path: string, message: string, recordKeys: RecordKey[] = []): Diagnostic { return { code, path, recordKeys: sortedRecords(recordKeys), message } }
function failure(diagnostics: Diagnostic[]): AssignmentResult { return { registry: null, observations: [], diagnostics } }
function validRecordKey(value: unknown): value is RecordKey { return exact(value, ['source', 'key']) && typeof value.source === 'string' && typeof value.key === 'string' && recordPattern.test(value.source) && recordPattern.test(value.key) }
function validId(value: unknown): value is string { return typeof value === 'string' && idPattern.test(value) }
function validFingerprint(value: unknown): value is FingerprintRef {
  if (!exact(value, ['contract', 'kind', 'value']) || typeof value.contract !== 'string' || typeof value.kind !== 'string' || typeof value.value !== 'string' || !digestPattern.test(value.value)) return false
  return (value.contract === 'playable-content-v1' && value.kind === 'current') || (value.contract === 'legacy-sha256' && value.kind === 'legacy')
}
function validAlias(value: unknown): value is string { return typeof value === 'string' && aliasPattern.test(value) }
function emptyRegistry(): Registry { return { schemaVersion: '1', namespace: 'killer-sudoku', identities: [], associations: [], reservedIds: [], reservedAliases: [] } }
function sameRecord(a: RecordKey, b: RecordKey): boolean { return a.source === b.source && a.key === b.key }
function sameFp(a: FingerprintRef, b: FingerprintRef): boolean { return fpKey(a) === fpKey(b) }
function observationKey(input: AssignmentInput, derived: string | null): string {
  return JSON.stringify(['killer-sudoku', input.recordKey.source, input.recordKey.key, input.fingerprint ?? null, [...input.aliases].sort(), input.publicId ?? null, derived, input.state])
}
function generatedId(used: Set<string>): string | null { for (let n = 1; n <= 999999; n += 1) { const id = `puzzle-${String(n).padStart(6, '0')}`; if (!used.has(id)) return id } return null }
function sortRegistry(registry: Registry): Registry {
  registry.identities.sort((a, b) => a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0)
  registry.identities.forEach((identity) => { identity.fingerprints.sort((a, b) => fpKey(a) < fpKey(b) ? -1 : 1); identity.aliases.sort(); identity.stateHistory.sort((a, b) => a.observationKey < b.observationKey ? -1 : a.observationKey > b.observationKey ? 1 : 0) })
  registry.associations.sort((a, b) => a.observationKey < b.observationKey ? -1 : a.observationKey > b.observationKey ? 1 : 0)
  registry.reservedIds.sort(); registry.reservedAliases.sort(); return registry
}

export function assignIncremental(previousRegistry: Registry, input: readonly AssignmentInput[], options: AssignOptions): AssignmentResult {
  const errors: Diagnostic[] = []
  if (!exact(options, ['initialization']) || typeof options.initialization !== 'boolean') errors.push(diagnostic('invalid-structure', 'options', 'options must contain only initialization'))
  if (!exact(previousRegistry, ['schemaVersion', 'namespace', 'identities', 'associations', 'reservedIds', 'reservedAliases'])) errors.push(diagnostic('invalid-structure', 'previousRegistry', 'registry has an invalid structure'))
  if (!Array.isArray(input)) errors.push(diagnostic('invalid-structure', 'input', 'input must be an array'))
  if (errors.length) return failure(errors)
  const source = clone(previousRegistry)
  if (source.schemaVersion !== '1' || source.namespace !== 'killer-sudoku') errors.push(diagnostic('invalid-structure', 'previousRegistry', 'unsupported registry schema or namespace'))
  if (!Array.isArray(source.identities) || !Array.isArray(source.associations) || !Array.isArray(source.reservedIds) || !Array.isArray(source.reservedAliases)) errors.push(diagnostic('invalid-structure', 'previousRegistry', 'registry arrays are required'))
  if (errors.length) return failure(errors)
  if (source.identities.length === 0 && options.initialization !== true) errors.push(diagnostic('initialization-required', 'options.initialization', 'an empty registry requires explicit initialization'))
  const seenKeys = new Map<string, { key: RecordKey; observation: string }>()
  const records: { input: AssignmentInput; derived: string | null; observationKey: string }[] = []
  for (let index = 0; index < input.length; index += 1) {
    const raw: unknown = input[index]; const path = `input[${index}]`
    if (!exact(raw, ['recordKey', ...(Object.prototype.hasOwnProperty.call(raw, 'fingerprint') ? ['fingerprint'] : []), ...(Object.prototype.hasOwnProperty.call(raw, 'content') ? ['content'] : []), 'aliases', ...(Object.prototype.hasOwnProperty.call(raw, 'publicId') ? ['publicId'] : []), 'state'])) { errors.push(diagnostic('invalid-structure', path, 'assignment input has unknown or missing properties')); continue }
    const item = raw as AssignmentInput
    if (!validRecordKey(item.recordKey)) errors.push(diagnostic('invalid-record-key', `${path}.recordKey`, 'recordKey source and key are invalid', [item.recordKey as RecordKey]))
    if (!Array.isArray(item.aliases) || item.aliases.some((alias) => !validAlias(alias))) errors.push(diagnostic('invalid-alias', `${path}.aliases`, 'alias is invalid', validRecordKey(item.recordKey) ? [item.recordKey] : []))
    if (Array.isArray(item.aliases) && new Set(item.aliases).size !== item.aliases.length) errors.push(diagnostic('malformed-alias-list', `${path}.aliases`, 'aliases must be unique', validRecordKey(item.recordKey) ? [item.recordKey] : []))
    if (item.fingerprint !== undefined && !validFingerprint(item.fingerprint)) errors.push(diagnostic('invalid-fingerprint', `${path}.fingerprint`, 'fingerprint contract, kind or value is invalid', validRecordKey(item.recordKey) ? [item.recordKey] : []))
    if (item.publicId !== undefined && !validId(item.publicId)) errors.push(diagnostic('invalid-id', `${path}.publicId`, 'publicId is invalid', validRecordKey(item.recordKey) ? [item.recordKey] : []))
    if (item.state !== 'current' && item.state !== 'removed') errors.push(diagnostic('invalid-structure', `${path}.state`, 'state is invalid', validRecordKey(item.recordKey) ? [item.recordKey] : []))
    let derived: string | null = null
    if (item.content !== undefined) { try { derived = fingerprintPlayableContent(item.content) } catch { errors.push(diagnostic('invalid-structure', `${path}.content`, 'content is invalid', validRecordKey(item.recordKey) ? [item.recordKey] : [])) } }
    if (item.content !== undefined && item.fingerprint !== undefined && (!validFingerprint(item.fingerprint) || item.fingerprint.contract !== 'playable-content-v1' || item.fingerprint.kind !== 'current' || item.fingerprint.value !== derived)) errors.push(diagnostic('fingerprint-conflict', `${path}.fingerprint`, 'fingerprint does not match content', validRecordKey(item.recordKey) ? [item.recordKey] : []))
    if (validRecordKey(item.recordKey) && Array.isArray(item.aliases) && (item.state === 'current' || item.state === 'removed')) {
      const key = observationKey(item, derived); const stable = recordText(item.recordKey); const old = seenKeys.get(stable)
      if (old && old.observation !== key) errors.push(diagnostic('duplicate-record-key', path, 'recordKey has conflicting observations in this batch', [item.recordKey]))
      else if (!old) { seenKeys.set(stable, { key: item.recordKey, observation: key }); records.push({ input: clone(item), derived, observationKey: key }) }
    }
  }
  if (errors.length) return failure(errors)
  const idOwners = new Map<string, IdentityHistory>(); const fpOwners = new Map<string, IdentityHistory>(); const aliasOwners = new Map<string, IdentityHistory>(); const recordOwners = new Map<string, string>()
  for (const identity of source.identities) {
    if (!exact(identity, ['publicId', 'firstAssignment', 'fingerprints', 'aliases', 'stateHistory', 'currentState', 'currentStateObservation']) || !validId(identity.publicId)) return failure([diagnostic('invalid-structure', 'previousRegistry.identities', 'identity history is invalid')])
    if (idOwners.has(identity.publicId)) return failure([diagnostic('id-conflict', 'previousRegistry.identities', 'publicId belongs to multiple identities')])
    idOwners.set(identity.publicId, identity); for (const fp of identity.fingerprints) { if (!validFingerprint(fp)) return failure([diagnostic('invalid-fingerprint', 'previousRegistry.identities', 'historical fingerprint is invalid')]); const owner = fpOwners.get(fpKey(fp)); if (owner && owner.publicId !== identity.publicId) return failure([diagnostic('fingerprint-conflict', 'previousRegistry.identities', 'fingerprint belongs to multiple identities')]); fpOwners.set(fpKey(fp), identity) }
    for (const alias of identity.aliases) { if (!validAlias(alias)) return failure([diagnostic('invalid-alias', 'previousRegistry.identities', 'historical alias is invalid')]); const owner = aliasOwners.get(alias); if (owner && owner.publicId !== identity.publicId) return failure([diagnostic('ambiguous-identity', 'previousRegistry.identities', 'alias belongs to multiple identities')]); aliasOwners.set(alias, identity) }
  }
  for (const association of source.associations) { if (!exact(association, ['recordKey', 'publicId', 'observedPublicId', 'fingerprint', 'aliases', 'state', 'observationKey']) || !validRecordKey(association.recordKey) || !idOwners.has(association.publicId)) return failure([diagnostic('invalid-structure', 'previousRegistry.associations', 'association is invalid')]); const key = recordText(association.recordKey); const old = recordOwners.get(key); if (old && old !== association.publicId) return failure([diagnostic('identity-conflict', 'previousRegistry.associations', 'recordKey is assigned to different identities', [association.recordKey])]); recordOwners.set(key, association.publicId) }
  const used = new Set([...source.reservedIds, ...source.reservedAliases, ...source.identities.map((i) => i.publicId), ...source.identities.flatMap((i) => i.aliases), ...records.flatMap((r) => r.input.publicId ? [r.input.publicId] : []), ...records.flatMap((r) => r.input.aliases)])
  const plans: { record: typeof records[number]; identity: IdentityHistory | null }[] = []
  for (const record of records.sort((a, b) => a.observationKey < b.observationKey ? -1 : 1)) {
    const item = record.input; const candidates = new Map<string, IdentityHistory>(); const fps = item.fingerprint ? [item.fingerprint] : record.derived ? [{ contract: 'playable-content-v1', kind: 'current', value: record.derived } as FingerprintRef] : []
    for (const fp of fps) { const owner = fpOwners.get(fpKey(fp)); if (owner) candidates.set(owner.publicId, owner) }
    const aliases = item.aliases.map((a) => aliasOwners.get(a)).filter((x): x is IdentityHistory => Boolean(x)); const distinctAliases = new Set(aliases.map((x) => x.publicId)); aliases.forEach((x) => candidates.set(x.publicId, x))
    if (distinctAliases.size > 1 || candidates.size > 1) return failure([diagnostic('ambiguous-identity', 'input', 'references identify different historical identities', [item.recordKey])])
    const candidate = candidates.values().next().value as IdentityHistory | undefined
    if (item.fingerprint && !fpOwners.has(fpKey(item.fingerprint)) && aliases.length) return failure([diagnostic('fingerprint-alias-conflict', 'input', 'unknown fingerprint is incompatible with known alias', [item.recordKey])])
    if (!candidate && !fps.length) {
      if (item.publicId && idOwners.has(item.publicId)) {
        return failure([diagnostic('insufficient-identity-evidence', 'input', 'publicId alone cannot create a content identity', [item.recordKey])])
      }
      if (item.aliases.length || item.publicId) {
        return failure([diagnostic('insufficient-identity-evidence', 'input', 'new identity requires fingerprint or content', [item.recordKey])])
      }
      return failure([diagnostic('insufficient-identity-evidence', 'input', 'identity evidence is required', [item.recordKey])])
    }
    if (item.publicId && candidate && item.publicId !== candidate.publicId) return failure([diagnostic('public-id-conflict', 'input.publicId', 'publicId is assigned to another identity', [item.recordKey])])
    if (candidate && item.fingerprint && candidate.fingerprints.some((fp) => fp.contract === item.fingerprint?.contract && fp.value !== item.fingerprint?.value)) return failure([diagnostic('fingerprint-conflict', 'input.fingerprint', 'fingerprint conflicts with identity history', [item.recordKey])])
    plans.push({ record, identity: candidate ?? null })
  }
  const groups = new Map<string, typeof plans>(); for (const plan of plans) { const key = plan.identity?.publicId ?? `new:${plan.record.observationKey}`; const group = groups.get(key) ?? []; group.push(plan); groups.set(key, group) }
  for (const group of groups.values()) { if (new Set(group.map((p) => p.record.input.state)).size > 1) return failure([diagnostic('incompatible-state', 'input', 'one identity has incompatible states in the batch', group.map((p) => p.record.input.recordKey))]) }
  for (const plan of plans) { if (!plan.identity) { const requested = plan.record.input.publicId; let id: string | undefined = requested; if (!id) { const generated = generatedId(used); if (generated === null) return failure([diagnostic('id-exhausted', 'input', 'no generated puzzle ID is available', [plan.record.input.recordKey])]); id = generated; } if (used.has(id) && !idOwners.has(id)) return failure([diagnostic('id-conflict', 'input.publicId', 'publicId collides with a reserved value', [plan.record.input.recordKey])]); const identity: IdentityHistory = { publicId: id, firstAssignment: { recordKey: clone(plan.record.input.recordKey), observationKey: plan.record.observationKey }, fingerprints: [], aliases: [], stateHistory: [], currentState: plan.record.input.state, currentStateObservation: plan.record.observationKey }; plan.identity = identity; idOwners.set(id, identity); used.add(id); source.identities.push(identity) } }
  for (const plan of plans) { const item = plan.record.input; const identity = plan.identity as IdentityHistory; const existingAssociation = source.associations.find((a) => sameRecord(a.recordKey, item.recordKey)); const existingOwner = recordOwners.get(recordText(item.recordKey)); if (existingOwner && existingOwner !== identity.publicId) return failure([diagnostic('identity-conflict', 'input.recordKey', 'recordKey cannot be reassigned', [item.recordKey])]); if (!identity.fingerprints.some((fp) => item.fingerprint && sameFp(fp, item.fingerprint))) { if (item.fingerprint) identity.fingerprints.push(clone(item.fingerprint)); if (plan.record.derived) identity.fingerprints.push({ contract: 'playable-content-v1', kind: 'current', value: plan.record.derived }) } for (const alias of item.aliases) { const owner = aliasOwners.get(alias); if (owner && owner.publicId !== identity.publicId) return failure([diagnostic('alias-conflict', 'input.aliases', 'alias is assigned to another identity', [item.recordKey])]); if (!identity.aliases.includes(alias)) identity.aliases.push(alias); aliasOwners.set(alias, identity) } const association: Association = { recordKey: clone(item.recordKey), publicId: identity.publicId, observedPublicId: item.publicId === undefined ? null : item.publicId, fingerprint: item.fingerprint ? clone(item.fingerprint) : null, aliases: [...item.aliases].sort(), state: item.state, observationKey: plan.record.observationKey }; if (!existingAssociation) source.associations.push(association); else if (existingAssociation.observationKey !== association.observationKey) source.associations.push(association); if (!identity.stateHistory.some((s) => s.observationKey === association.observationKey)) identity.stateHistory.push({ state: item.state, observationKey: association.observationKey }); identity.currentState = item.state; identity.currentStateObservation = association.observationKey; recordOwners.set(recordText(item.recordKey), identity.publicId) }
  const result = sortRegistry(source); return { registry: clone(result), observations: plans.map((p) => ({ recordKey: clone(p.record.input.recordKey), publicId: (p.identity as IdentityHistory).publicId, observationKey: p.record.observationKey })).sort((a, b) => a.observationKey < b.observationKey ? -1 : 1), diagnostics: [] }
}

export function createEmptyRegistry(): Registry { return emptyRegistry() }
export function serializeRegistry(registry: Registry): string { return JSON.stringify(registry) }
