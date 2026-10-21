import { describe, expect, it } from 'vitest'
import {
  assignIncremental,
  createEmptyRegistry,
  type AssignmentInput,
  type FingerprintRef,
  type Registry,
} from '../src/domain/registry'

const fp = (hex: string) => ({ contract: 'legacy-sha256' as const, kind: 'legacy' as const, value: `sha256-${hex.repeat(64).slice(0, 64)}` })
const key = (source: string, value: string) => ({ source, key: value })
const input = (recordKey: ReturnType<typeof key>, fingerprint: FingerprintRef | undefined, extra: Partial<AssignmentInput> = {}): AssignmentInput => {
  const { content, publicId, ...rest } = extra
  const sanitizedExtra = { ...rest }
  return {
    recordKey,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    ...(content === undefined ? {} : { content }),
    aliases: [],
    state: 'current',
    ...sanitizedExtra,
    ...(publicId === undefined ? {} : { publicId }),
  }
}
const init = (): Registry => createEmptyRegistry()

describe('incremental historical registry', () => {
  it('resolves shared fingerprints across a batch before assigning one generated id', () => {
    const result = assignIncremental(init(), [
      input(key('feed', 'one'), fp('b'), { aliases: ['shared'] }),
      input(key('feed', 'two'), fp('b')),
    ], { initialization: true })
    expect(result.diagnostics).toEqual([])
    expect(result.registry?.identities).toHaveLength(1)
    expect(result.registry?.identities[0].publicId).toBe('puzzle-000001')
    expect(result.registry?.associations).toHaveLength(2)
  })

  it('uses a historical publicId only when the other evidence is compatible', () => {
    const first = assignIncremental(init(), [input(key('feed', 'one'), fp('c'))], { initialization: true })
    const registry = first.registry as Registry
    const updated = assignIncremental(registry, [input(key('feed', 'two'), fp('c'), { publicId: 'puzzle-000001' })], {})
    expect(updated.diagnostics).toEqual([])
    expect(updated.registry?.identities).toHaveLength(1)
    const conflict = assignIncremental(registry, [input(key('feed', 'three'), fp('d'), { publicId: 'puzzle-000001' })], {})
    expect(conflict.registry).toBeNull()
    expect(conflict.diagnostics[0].code).toBe('public-id-conflict')
  })

  it('reports ambiguous-identity when known fingerprint and known alias belong to different identities', () => {
    const first = assignIncremental(init(), [input(key('feed', 'fingerprint-owner'), fp('1'))], { initialization: true })
    const second = assignIncremental(first.registry as Registry, [input(key('feed', 'alias-owner'), fp('2'), { aliases: ['other-owner'] })], {})
    expect(second.diagnostics).toEqual([])
    const result = assignIncremental(second.registry as Registry, [input(key('feed', 'contradictory'), fp('1'), { aliases: ['other-owner'] })], {})
    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].code).toBe('ambiguous-identity')
  })

  it('chooses the minimum observation key for a compatible batch state', () => {
    const result = assignIncremental(init(), [
      input(key('z', 'later'), fp('e')),
      input(key('a', 'earlier'), fp('e')),
    ], { initialization: true })
    const identity = result.registry?.identities[0]
    expect(identity?.currentStateObservation).toBe([...result.observations].sort((a, b) => a.observationKey.localeCompare(b.observationKey))[0].observationKey)
  })

  it('preserves A, applies B, and reactivates A without duplicating history', () => {
    const a = input(key('feed', 'stable'), fp('f'), { aliases: ['stable'] })
    const first = assignIncremental(init(), [a], { initialization: true })
    const second = assignIncremental(first.registry as Registry, [{ ...a, state: 'removed' }], {})
    const third = assignIncremental(second.registry as Registry, [a], {})
    const identity = third.registry?.identities[0]
    expect(third.diagnostics).toEqual([])
    expect(identity?.currentState).toBe('current')
    expect(identity?.firstAssignment).toEqual(first.registry?.identities[0].firstAssignment)
    expect(identity?.stateHistory).toHaveLength(2)
    expect(third.registry?.associations).toHaveLength(2)
  })

  it('fails atomically for malformed nested input and ambiguous record keys', () => {
    const malformed = assignIncremental(init(), [null as unknown as AssignmentInput], { initialization: true })
    expect(malformed).toEqual(expect.objectContaining({ registry: null, observations: [] }))
    expect(malformed.diagnostics[0].code).toBe('invalid-structure')
    const collision = assignIncremental(init(), [
      input(key('a/b', 'c'), fp('1')),
      input(key('a', 'b/c'), fp('2')),
    ], { initialization: true })
    expect(collision.diagnostics).toEqual([])
    expect(collision.registry?.identities).toHaveLength(2)
  })

  it('preserves the public schema, observed public ID, and legacy fingerprint contract', () => {
    const result = assignIncremental(init(), [input(key('feed', 'schema'), fp('9'), { publicId: 'fixture-partial', aliases: ['Alias'] })], { initialization: true })
    expect(result.diagnostics).toEqual([])
    expect(Object.keys(result.registry!)).toEqual(['schemaVersion', 'namespace', 'identities', 'associations', 'reservedIds', 'reservedAliases'])
    expect(Object.keys(result.registry!.identities[0])).toEqual(['publicId', 'firstAssignment', 'fingerprints', 'aliases', 'stateHistory', 'currentState', 'currentStateObservation'])
    expect(result.registry!.identities[0].fingerprints[0]).toEqual(fp('9'))
    expect(result.registry!.associations[0].observedPublicId).toBe('fixture-partial')
    expect(result.registry!.associations[0].fingerprint).toEqual(fp('9'))
    expect(JSON.parse(serialize(result.registry!))).toEqual(result.registry)
  })

  it('rejects duplicate aliases and keeps assignment atomic', () => {
    const result = assignIncremental(init(), [input(key('feed', 'bad'), fp('a'), { aliases: ['same', 'same'] })], { initialization: true })
    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics[0].code).toBe('malformed-alias-list')
  })

  it('is independent of batch input order', () => {
    const values = [input(key('z', 'two'), fp('b'), { aliases: ['shared'] }), input(key('a', 'one'), fp('b'))]
    const left = assignIncremental(init(), values, { initialization: true })
    const right = assignIncremental(init(), [...values].reverse(), { initialization: true })
    expect(JSON.stringify(left)).toBe(JSON.stringify(right))
  })

  it('covers evidence and public-id diagnostics without partial results', () => {
    const aliasOnlyInput = input(key('feed', 'alias-only'), undefined, { aliases: ['unknown'] })
    expect(aliasOnlyInput).not.toHaveProperty('fingerprint')
    expect(aliasOnlyInput).not.toHaveProperty('content')
    const aliasOnly = assignIncremental(init(), [aliasOnlyInput], { initialization: true })
    expect(aliasOnly.registry).toBeNull()
    expect(aliasOnly.diagnostics[0].code).toBe('insufficient-identity-evidence')

    const first = assignIncremental(init(), [input(key('feed', 'owner'), fp('c'), { aliases: ['known'] })], { initialization: true })
    const registry = first.registry as Registry
    const unknownFingerprint = assignIncremental(registry, [input(key('feed', 'new'), fp('d'), { aliases: ['known'] })], {})
    expect(unknownFingerprint.registry).toBeNull()
    expect(unknownFingerprint.diagnostics[0].code).toBe('fingerprint-alias-conflict')

    const publicConflict = assignIncremental(registry, [input(key('feed', 'other'), fp('d'), { publicId: registry.identities[0].publicId })], {})
    expect(publicConflict.registry).toBeNull()
    expect(publicConflict.diagnostics[0].code).toBe('public-id-conflict')
  })

  it('rejects incompatible states and preserves reserved IDs and aliases', () => {
    const first = assignIncremental(init(), [input(key('feed', 'one'), fp('e'), { publicId: 'fixture-partial', aliases: ['historical-alias'] })], { initialization: true })
    const registry = first.registry as Registry
    registry.reservedIds.push('puzzle-000001', 'puzzle-000002')
    registry.reservedAliases.push('reserved-alias')
    const conflictingState = assignIncremental(registry, [
      input(key('feed', 'two'), fp('e'), { state: 'current' }),
      input(key('feed', 'three'), fp('e'), { state: 'removed' }),
    ], {})
    expect(conflictingState.registry).toBeNull()
    expect(conflictingState.diagnostics[0].code).toBe('incompatible-state')

    const next = assignIncremental(registry, [input(key('feed', 'new'), fp('f'))], {})
    expect(next.diagnostics).toEqual([])
    expect(next.registry?.identities.some((identity) => identity.publicId === 'puzzle-000003')).toBe(true)
    expect(next.registry?.reservedAliases).toContain('reserved-alias')
  })

  it('rejects malformed stateHistory elements atomically without mutating the registry', () => {
    const base = assignIncremental(init(), [input(key('feed', 'history'), fp('a'))], { initialization: true })
    const registry = base.registry as Registry
    const malformedEntries: unknown[] = [null, undefined, {}, { state: 'current' }, { observationKey: 'missing-state' }, { state: 'invalid', observationKey: 'observation' }]

    for (const entry of malformedEntries) {
      const malformed = structuredClone(registry) as Registry
      malformed.identities[0].stateHistory = [entry as never]
      const before = JSON.stringify(malformed)
      const result = assignIncremental(malformed, [], {})
      expect(result.registry).toBeNull()
      expect(result.observations).toEqual([])
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-structure')).toBe(true)
      expect(JSON.stringify(malformed)).toBe(before)
    }

    const sparse = structuredClone(registry) as Registry
    const sparseHistory = new Array(1) as Array<never>
    sparse.identities[0].stateHistory = sparseHistory
    const sparseBefore = JSON.stringify(sparse)
    const sparseResult = assignIncremental(sparse, [], {})
    expect(sparseResult.registry).toBeNull()
    expect(sparseResult.observations).toEqual([])
    expect(sparseResult.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-structure')).toBe(true)
    expect(JSON.stringify(sparse)).toBe(sparseBefore)
    expect(0 in sparseHistory).toBe(false)
  })

  it('rejects malformed identities and associations atomically, including sparse arrays', () => {
    const base = assignIncremental(init(), [input(key('feed', 'structural-boundary'), fp('b'))], { initialization: true })
    const registry = base.registry as Registry

    const identityCases: unknown[] = [
      null,
      undefined,
      { publicId: registry.identities[0].publicId },
      { ...registry.identities[0], firstAssignment: null },
    ]
    for (const entry of identityCases) {
      const malformed = structuredClone(registry) as Registry
      malformed.identities = [entry as never]
      const before = structuredClone(malformed)
      expect(() => assignIncremental(malformed, [], {})).not.toThrow()
      const result = assignIncremental(malformed, [], {})
      expect(result.registry).toBeNull()
      expect(result.observations).toEqual([])
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-structure')).toBe(true)
      expect(malformed).toEqual(before)
    }

    const sparseIdentities = structuredClone(registry) as Registry
    const missingIdentity = new Array(1) as Array<never>
    sparseIdentities.identities = missingIdentity as never
    const identitiesBefore = structuredClone(sparseIdentities)
    const sparseIdentityResult = assignIncremental(sparseIdentities, [], {})
    expect(sparseIdentityResult.registry).toBeNull()
    expect(sparseIdentityResult.observations).toEqual([])
    expect(sparseIdentityResult.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-structure')).toBe(true)
    expect(sparseIdentities).toEqual(identitiesBefore)
    expect(0 in missingIdentity).toBe(false)

    const associationCases: unknown[] = [
      null,
      undefined,
      { recordKey: registry.associations[0].recordKey },
      { ...registry.associations[0], recordKey: null },
    ]
    for (const entry of associationCases) {
      const malformed = structuredClone(registry) as Registry
      malformed.associations = [entry as never]
      const before = structuredClone(malformed)
      expect(() => assignIncremental(malformed, [], {})).not.toThrow()
      const result = assignIncremental(malformed, [], {})
      expect(result.registry).toBeNull()
      expect(result.observations).toEqual([])
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-structure')).toBe(true)
      expect(malformed).toEqual(before)
    }

    const sparseAssociations = structuredClone(registry) as Registry
    const missingAssociation = new Array(1) as Array<never>
    sparseAssociations.associations = missingAssociation as never
    const associationsBefore = structuredClone(sparseAssociations)
    const sparseAssociationResult = assignIncremental(sparseAssociations, [], {})
    expect(sparseAssociationResult.registry).toBeNull()
    expect(sparseAssociationResult.observations).toEqual([])
    expect(sparseAssociationResult.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-structure')).toBe(true)
    expect(sparseAssociations).toEqual(associationsBefore)
    expect(0 in missingAssociation).toBe(false)
  })

  it('rejects sparse and explicitly undefined nested arrays before validation can skip elements', () => {
    const base = assignIncremental(init(), [input(key('feed', 'nested-arrays'), fp('c'), { aliases: ['known'] })], { initialization: true })
    const registry = base.registry as Registry

    const cases: Array<(candidate: Registry) => void> = [
      (candidate) => { candidate.identities[0].fingerprints = new Array(2) as Array<never>; candidate.identities[0].fingerprints[1] = fp('d') as never },
      (candidate) => { candidate.identities[0].aliases = new Array(2) as Array<never>; candidate.identities[0].aliases[1] = 'known' as never },
      (candidate) => { candidate.identities[0].fingerprints = [undefined as never] },
      (candidate) => { candidate.identities[0].aliases = [undefined as never] },
    ]

    for (const mutate of cases) {
      const malformed = structuredClone(registry) as Registry
      mutate(malformed)
      const before = structuredClone(malformed)
      expect(() => assignIncremental(malformed, [], {})).not.toThrow()
      const result = assignIncremental(malformed, [], {})
      expect(result.registry).toBeNull()
      expect(result.observations).toEqual([])
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-structure')).toBe(true)
      expect(malformed).toEqual(before)
    }

    const inputCases: AssignmentInput[] = [
      input(key('feed', 'sparse-input'), fp('e'), { aliases: Object.assign(new Array(2), { 1: 'alias' }) as string[] }),
      input(key('feed', 'mixed-input'), fp('f'), { aliases: Object.assign(['alias'], { length: 2 }) as string[] }),
      input(key('feed', 'undefined-input'), fp('g'), { aliases: [undefined as never] }),
    ]
    for (const candidate of inputCases) {
      const before = structuredClone(candidate)
      expect(() => assignIncremental(init(), [candidate], { initialization: true })).not.toThrow()
      const result = assignIncremental(init(), [candidate], { initialization: true })
      expect(result.registry).toBeNull()
      expect(result.observations).toEqual([])
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-structure')).toBe(true)
      expect(candidate).toEqual(before)
      if (candidate.aliases.length === 2) expect(0 in candidate.aliases).toBe(true)
    }
  })

  it('rejects invalid fingerprint contracts and malformed runtime structures before assignment', () => {
    const invalidFingerprint = assignIncremental(init(), [input(key('feed', 'bad'), { contract: 'playable-content-v1', kind: 'legacy', value: fp('a').value } as never)], { initialization: true })
    expect(invalidFingerprint.registry).toBeNull()
    expect(invalidFingerprint.observations).toEqual([])
    expect(invalidFingerprint.diagnostics[0].code).toBe('invalid-fingerprint')

    const invalidExtraFingerprint = { contract: 'playable-content-v1', kind: 'legacy', value: fp('b').value } as never
    const preservedExtra = input(key('feed', 'extra-fingerprint'), undefined, { fingerprint: invalidExtraFingerprint })
    expect(preservedExtra).toHaveProperty('fingerprint', invalidExtraFingerprint)
    const invalidExtraResult = assignIncremental(init(), [preservedExtra], { initialization: true })
    expect(invalidExtraResult.registry).toBeNull()
    expect(invalidExtraResult.diagnostics[0].code).toBe('invalid-fingerprint')

    const malformedRegistry = assignIncremental({ identities: null } as never, [], { initialization: true })
    expect(malformedRegistry.registry).toBeNull()
    expect(malformedRegistry.diagnostics[0].code).toBe('invalid-structure')

    const malformedInput = assignIncremental(init(), [{ recordKey: key('feed', 'nested'), aliases: null, state: 'current' } as never], { initialization: true })
    expect(malformedInput.registry).toBeNull()
    expect(malformedInput.diagnostics[0].code).toBe('invalid-alias')
  })

  it('covers explicit new IDs, public-id-only evidence, and contract separation', () => {
    const adopted = assignIncremental(init(), [input(key('feed', 'adopted'), fp('1'), { publicId: 'catalog-custom-7' })], { initialization: true })
    expect(adopted.diagnostics).toEqual([])
    expect(adopted.registry?.identities[0].publicId).toBe('catalog-custom-7')
    expect(adopted.registry?.associations[0].observedPublicId).toBe('catalog-custom-7')

    const compatibleShared = assignIncremental(init(), [
      input(key('feed', 'adopted-one'), fp('1'), { publicId: 'catalog-custom-8' }),
      input(key('feed', 'adopted-two'), fp('1'), { publicId: 'catalog-custom-8' }),
    ], { initialization: true })
    expect(compatibleShared.diagnostics).toEqual([])
    expect(compatibleShared.registry?.identities).toHaveLength(1)
    expect(compatibleShared.registry?.identities[0].publicId).toBe('catalog-custom-8')
    expect(compatibleShared.registry?.associations).toHaveLength(2)

    const reserved = createEmptyRegistry()
    reserved.reservedIds.push('catalog-reserved')
    const reservedResult = assignIncremental(reserved, [input(key('feed', 'reserved'), fp('1'), { publicId: 'catalog-reserved' })], { initialization: true })
    expect(reservedResult.registry).toBeNull()
    expect(reservedResult.observations).toEqual([])
    expect(reservedResult.diagnostics[0].code).toBe('id-conflict')

    const publicOnlyInput = input(key('feed', 'public-only'), undefined, { publicId: 'catalog-custom-9' })
    expect(publicOnlyInput).not.toHaveProperty('fingerprint')
    expect(publicOnlyInput).not.toHaveProperty('content')
    const publicOnly = assignIncremental(init(), [publicOnlyInput], { initialization: true })
    expect(publicOnly.registry).toBeNull()
    expect(publicOnly.diagnostics[0].code).toBe('insufficient-identity-evidence')

    const current = input(key('feed', 'current'), { contract: 'playable-content-v1', kind: 'current', value: fp('2').value } as never)
    const legacy = input(key('feed', 'legacy'), fp('2'))
    const result = assignIncremental(init(), [current, legacy], { initialization: true })
    expect(result.diagnostics).toEqual([])
    expect(result.registry?.identities).toHaveLength(2)
  })

  it('keeps explicit-ID resolution deterministic under batch reversal and rejects incompatible owners atomically', () => {
    const compatible = [
      input(key('feed', 'compatible-one'), fp('a'), { publicId: 'catalog-deterministic' }),
      input(key('feed', 'compatible-two'), fp('a'), { publicId: 'catalog-deterministic' }),
    ]
    const forward = assignIncremental(init(), compatible, { initialization: true })
    const reversed = assignIncremental(init(), [...compatible].reverse(), { initialization: true })
    expect(forward.diagnostics).toEqual([])
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed))

    const incompatible = [
      input(key('feed', 'incompatible-one'), fp('b'), { publicId: 'catalog-incompatible' }),
      input(key('feed', 'incompatible-two'), fp('c'), { publicId: 'catalog-incompatible' }),
    ]
    const conflictForward = assignIncremental(init(), incompatible, { initialization: true })
    const conflictReversed = assignIncremental(init(), [...incompatible].reverse(), { initialization: true })
    for (const result of [conflictForward, conflictReversed]) {
      expect(result.registry).toBeNull()
      expect(result.observations).toEqual([])
      expect(result.diagnostics[0].code).toBe('id-conflict')
    }
    expect(JSON.stringify(conflictForward)).toBe(JSON.stringify(conflictReversed))
  })

  it('honors global reservations and reports exhaustion without partial output', () => {
    const reserved = assignIncremental(init(), [input(key('feed', 'first'), fp('3'))], { initialization: true })
    const registry = reserved.registry as Registry
    registry.reservedIds.push('puzzle-000002')
    const next = assignIncremental(registry, [input(key('feed', 'second'), fp('4'))], {})
    expect(next.diagnostics).toEqual([])
    expect(next.registry?.identities.some((identity) => identity.publicId === 'puzzle-000003')).toBe(true)

    const exhausted: Registry = { ...init(), reservedIds: Array.from({ length: 999999 }, (_, index) => `puzzle-${String(index + 1).padStart(6, '0')}`) }
    const result = assignIncremental(exhausted, [input(key('feed', 'exhausted'), fp('5'))], { initialization: true })
    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics[0].code).toBe('id-exhausted')
  })

  it('covers alias-only updates, unknown public IDs, and explicit public-id conflicts', () => {
    const first = assignIncremental(init(), [input(key('feed', 'owner'), fp('6'), { aliases: ['KnownAlias'] })], { initialization: true })
    const registry = first.registry as Registry
    const aliasUpdate = assignIncremental(registry, [input(key('feed', 'alias-update'), undefined, { aliases: ['KnownAlias'] })], {})
    expect(aliasUpdate.diagnostics).toEqual([])
    expect(aliasUpdate.registry?.identities).toHaveLength(1)

    const unknownId = assignIncremental(registry, [input(key('feed', 'unknown-id'), fp('7'), { publicId: 'catalog-new-7' })], {})
    expect(unknownId.diagnostics).toEqual([])
    expect(unknownId.registry?.identities.some((identity) => identity.publicId === 'catalog-new-7')).toBe(true)

    const conflict = assignIncremental(registry, [input(key('feed', 'conflicting-id'), fp('7'), { publicId: registry.identities[0].publicId })], {})
    expect(conflict.registry).toBeNull()
    expect(conflict.observations).toEqual([])
    expect(conflict.diagnostics[0].code).toBe('public-id-conflict')
  })

  it('distinguishes case-sensitive aliases and rejects runtime option and registry properties', () => {
    const caseSensitive = assignIncremental(init(), [input(key('feed', 'case'), fp('8'), { aliases: ['Alias'] })], { initialization: true })
    expect(caseSensitive.diagnostics).toEqual([])
    const unknownCase = assignIncremental(caseSensitive.registry as Registry, [input(key('feed', 'other'), undefined, { aliases: ['alias'] })], {})
    expect(unknownCase.registry).toBeNull()
    expect(unknownCase.diagnostics[0].code).toBe('insufficient-identity-evidence')

    const badOptions = assignIncremental(init(), [input(key('feed', 'bad-options'), fp('9'))], { initialization: true, extra: true } as never)
    expect(badOptions.registry).toBeNull()
    expect(badOptions.diagnostics[0].code).toBe('invalid-structure')

    const badRegistry = assignIncremental({ ...init(), identities: [{ ...init().identities, unexpected: true }] } as never, [], { initialization: true })
    expect(badRegistry.registry).toBeNull()
    expect(badRegistry.diagnostics[0].code).toBe('invalid-structure')
  })

  it('reports duplicate record keys and identity conflicts atomically', () => {
    const duplicate = assignIncremental(init(), [
      input(key('feed', 'same'), fp('a')),
      input(key('feed', 'same'), fp('b')),
    ], { initialization: true })
    expect(duplicate.registry).toBeNull()
    expect(duplicate.observations).toEqual([])
    expect(duplicate.diagnostics[0].code).toBe('duplicate-record-key')

    const first = assignIncremental(init(), [input(key('feed', 'owner-a'), fp('c'), { aliases: ['owner-a'] })], { initialization: true })
    const second = assignIncremental(first.registry as Registry, [input(key('feed', 'owner-b'), fp('d'))], {})
    const knownFingerprintWithNewAlias = assignIncremental(second.registry as Registry, [
      input(key('feed', 'known-fingerprint'), fp('c'), { aliases: ['missing'] }),
    ], {})
    expect(knownFingerprintWithNewAlias.diagnostics).toEqual([])
    expect(knownFingerprintWithNewAlias.registry?.identities).toHaveLength(2)
    expect(knownFingerprintWithNewAlias.registry?.identities.some((identity) => identity.aliases.includes('missing'))).toBe(true)

    const incompatibleFingerprintWithKnownAlias = assignIncremental(second.registry as Registry, [
      input(key('feed', 'contradiction'), fp('e'), { aliases: ['owner-a'] }),
    ], {})
    expect(incompatibleFingerprintWithKnownAlias.registry).toBeNull()
    expect(incompatibleFingerprintWithKnownAlias.observations).toEqual([])
    expect(incompatibleFingerprintWithKnownAlias.diagnostics[0].code).toBe('fingerprint-alias-conflict')
  })

  it('keeps new shared aliases from merging distinct fingerprints', () => {
    const result = assignIncremental(init(), [
      input(key('feed', 'alias-one'), fp('1'), { aliases: ['new-shared-alias'] }),
      input(key('feed', 'alias-two'), fp('2'), { aliases: ['new-shared-alias'] }),
    ], { initialization: true })

    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics[0].code).toBe('alias-conflict')
    expect(result.diagnostics[0].code).not.toBe('fingerprint-conflict')
  })

  it('does not merge distinct fingerprints through a new shared public ID', () => {
    const result = assignIncremental(init(), [
      input(key('feed', 'public-one'), fp('3'), { publicId: 'new-shared-id' }),
      input(key('feed', 'public-two'), fp('4'), { publicId: 'new-shared-id' }),
    ], { initialization: true })

    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics[0].code).toBe('id-conflict')
  })

  it('rejects divergent content and preserves input objects on failure', () => {
    const content = { size: 1, clues: [{ row: 0, column: 0, value: 1 }], cages: [] } as never
    const observed = input(key('feed', 'content'), fp('a'), { content })
    const before = JSON.stringify(observed)
    const result = assignIncremental(init(), [observed], { initialization: true })
    expect(result.registry).toBeNull()
    expect(result.diagnostics[0].code).toBe('fingerprint-conflict')
    expect(JSON.stringify(observed)).toBe(before)
  })

  it('distinguishes identity conflicts from ambiguous historical references', () => {
    const first = assignIncremental(init(), [input(key('feed', 'first'), fp('a'))], { initialization: true })
    const second = assignIncremental(first.registry as Registry, [input(key('feed', 'second'), fp('b'))], {})
    const registry = second.registry as Registry
    const result = assignIncremental(registry, [
      input(key('feed', 'first'), fp('b')),
    ], {})
    expect(result.registry).toBeNull()
    expect(result.diagnostics[0].code).toBe('identity-conflict')
  })

  it('keeps cumulative fingerprints, aliases, states, and null optional observations', () => {
    const first = assignIncremental(init(), [input(key('feed', 'one'), fp('a'), { aliases: ['first'] })], { initialization: true })
    const registry = first.registry as Registry
    // A new fingerprint cannot be migrated onto an existing identity through an alias.
    // Reuse the known fingerprint while adding the alias and state observation.
    const second = assignIncremental(registry, [input(key('feed', 'two'), fp('a'), { aliases: ['second'], state: 'removed' })], {})
    expect(second.diagnostics).toEqual([])
    const identity = second.registry!.identities[0]
    expect(identity.fingerprints.map((value) => value.value)).toEqual([fp('a').value])
    expect(identity.aliases).toEqual(expect.arrayContaining(['first', 'second']))
    expect(identity.stateHistory.map((value) => value.state)).toEqual(expect.arrayContaining(['current', 'removed']))
    expect(second.registry!.associations.every((association) => association.observedPublicId === null)).toBe(true)
    expect(second.registry!.associations.every((association) => association.fingerprint !== null)).toBe(true)
  })

  it('returns public-id-conflict for a historical public ID with incompatible fingerprint evidence', () => {
    const first = assignIncremental(init(), [input(key('feed', 'first'), fp('c'))], { initialization: true })
    const second = assignIncremental(first.registry as Registry, [input(key('feed', 'second'), fp('d'))], {})
    const registry = second.registry as Registry
    const result = assignIncremental(registry, [input(key('feed', 'new'), fp('e'), { publicId: registry.identities[0].publicId })], {})
    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics[0].code).toBe('public-id-conflict')
  })

  it('returns public-id-conflict before identity-conflict for known fingerprint and another historical ID', () => {
    const first = assignIncremental(init(), [input(key('feed', 'owner-a'), fp('a'))], { initialization: true })
    const second = assignIncremental(first.registry as Registry, [input(key('feed', 'owner-b'), fp('b'))], {})
    const registry = second.registry as Registry
    const ownerA = registry.identities.find((identity) => identity.fingerprints.some((fingerprint) => fingerprint.value === fp('a').value))
    const ownerB = registry.identities.find((identity) => identity.fingerprints.some((fingerprint) => fingerprint.value === fp('b').value))
    expect(ownerA).toBeDefined()
    expect(ownerB).toBeDefined()
    expect(ownerA?.publicId).not.toBe(ownerB?.publicId)
    const result = assignIncremental(registry, [input(key('feed', 'new'), fp('a'), { publicId: ownerB!.publicId })], {})
    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics[0].code).toBe('public-id-conflict')
  })

  it('orders validation diagnostics canonically regardless of collection order', () => {
    const malformedAlias = input(key('feed', 'zeta'), fp('a'), { aliases: ['dup', 'dup'] })
    const malformedFingerprint = input(key('feed', 'alpha'), { contract: 'playable-content-v1', kind: 'legacy', value: fp('b').value } as never)
    const result = assignIncremental(init(), [malformedAlias, malformedFingerprint], { initialization: true })
    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['invalid-fingerprint', 'malformed-alias-list'])
    expect(result.diagnostics[0].recordKeys).toEqual([key('feed', 'alpha')])
    expect(result.diagnostics[1].recordKeys).toEqual([key('feed', 'zeta')])

    const reversed = assignIncremental(init(), [malformedFingerprint, malformedAlias], { initialization: true })
    expect(reversed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['invalid-fingerprint', 'malformed-alias-list'])
  })

  it('rejects a first assignment that does not belong to its identity', () => {
    const base = assignIncremental(init(), [input(key('feed', 'first-assignment'), fp('a'))], { initialization: true })
    const registry = base.registry as Registry
    const malformed = {
      ...registry,
      identities: registry.identities.map((identity) => ({
        ...identity,
        firstAssignment: { ...identity.firstAssignment, observationKey: 'not-an-association' },
      })),
    }
    const result = assignIncremental(malformed, [], {})
    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.path === 'previousRegistry.identities.firstAssignment' && diagnostic.code === 'invalid-structure')).toBe(true)
  })

  it('rejects an association without matching state history for its identity', () => {
    const base = assignIncremental(init(), [input(key('feed', 'missing-history'), fp('b'))], { initialization: true })
    const registry = base.registry as Registry
    const malformed = {
      ...registry,
      identities: registry.identities.map((identity) => ({ ...identity, stateHistory: [] })),
    }
    const result = assignIncremental(malformed, [], {})
    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.path === 'previousRegistry.associations' && diagnostic.code === 'invalid-structure')).toBe(true)
  })

  it('rejects duplicate identity IDs instead of comparing an owner to itself', () => {
    const base = assignIncremental(init(), [input(key('feed', 'duplicate-id'), fp('c'))], { initialization: true })
    const registry = base.registry as Registry
    const duplicateIdentity = { ...registry.identities[0], firstAssignment: { ...registry.identities[0].firstAssignment, recordKey: key('feed', 'other') } }
    const malformed = { ...registry, identities: [...registry.identities, duplicateIdentity] }
    const result = assignIncremental(malformed, [], {})
    expect(result.registry).toBeNull()
    expect(result.observations).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'id-conflict')).toBe(true)
  })

  it('rejects duplicate registry reservations, association observations, and cross-namespace reserved collisions', () => {
    const base = assignIncremental(init(), [input(key('feed', 'valid'), fp('a'), { aliases: ['valid-alias'] })], { initialization: true })
    const registry = base.registry as Registry

    const duplicateReservation = { ...registry, reservedIds: ['reserved-id', 'reserved-id'] }
    const reservationResult = assignIncremental(duplicateReservation, [], {})
    expect(reservationResult.registry).toBeNull()
    expect(reservationResult.diagnostics.some((diagnostic) => diagnostic.code === 'id-conflict')).toBe(true)

    const duplicateAssociation = { ...registry, associations: [...registry.associations, { ...registry.associations[0] }] }
    const associationResult = assignIncremental(duplicateAssociation, [], {})
    expect(associationResult.registry).toBeNull()
    expect(associationResult.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-structure')).toBe(true)

    const reservedAliasAsId = { ...registry, reservedIds: ['valid-alias'] }
    const collisionResult = assignIncremental(reservedAliasAsId, [], {})
    expect(collisionResult.registry).toBeNull()
    expect(collisionResult.diagnostics.some((diagnostic) => diagnostic.code === 'id-conflict')).toBe(true)
  })
})

function serialize(registry: Registry): string {
  return JSON.stringify(registry)
}
