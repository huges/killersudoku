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
const input = (recordKey: ReturnType<typeof key>, fingerprint: FingerprintRef | undefined = fp('a'), extra: Partial<AssignmentInput> = {}): AssignmentInput => {
  const { content, publicId, ...rest } = extra
  const sanitizedExtra = { ...rest }
  delete sanitizedExtra.fingerprint
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
    const aliasOnly = assignIncremental(init(), [input(key('feed', 'alias-only'), undefined, { aliases: ['unknown'] })], { initialization: true })
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
    registry.reservedIds.push('puzzle-000002')
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

  it('rejects invalid fingerprint contracts and malformed runtime structures before assignment', () => {
    const invalidFingerprint = assignIncremental(init(), [input(key('feed', 'bad'), { contract: 'playable-content-v1', kind: 'legacy', value: fp('a').value } as never)], { initialization: true })
    expect(invalidFingerprint.registry).toBeNull()
    expect(invalidFingerprint.observations).toEqual([])
    expect(invalidFingerprint.diagnostics[0].code).toBe('invalid-fingerprint')

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

    const publicOnly = assignIncremental(init(), [input(key('feed', 'public-only'), undefined, { publicId: 'catalog-custom-8' })], { initialization: true })
    expect(publicOnly.registry).toBeNull()
    expect(publicOnly.diagnostics[0].code).toBe('insufficient-identity-evidence')

    const current = input(key('feed', 'current'), { contract: 'playable-content-v1', kind: 'current', value: fp('2').value } as never)
    const legacy = input(key('feed', 'legacy'), fp('2'))
    const result = assignIncremental(init(), [current, legacy], { initialization: true })
    expect(result.diagnostics).toEqual([])
    expect(result.registry?.identities).toHaveLength(2)
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

    const first = assignIncremental(init(), [input(key('feed', 'owner-a'), fp('c'))], { initialization: true })
    const second = assignIncremental(first.registry as Registry, [input(key('feed', 'owner-b'), fp('d'))], {})
    const conflict = assignIncremental(second.registry as Registry, [
      input(key('feed', 'contradiction'), fp('c'), { aliases: ['missing'] }),
    ], {})
    expect(conflict.registry).toBeNull()
    expect(conflict.observations).toEqual([])
    expect(conflict.diagnostics[0].code).toBe('insufficient-identity-evidence')
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
    const second = assignIncremental(registry, [input(key('feed', 'two'), fp('b'), { aliases: ['second'], state: 'removed' })], {})
    expect(second.diagnostics).toEqual([])
    const identity = second.registry!.identities[0]
    expect(identity.fingerprints.map((value) => value.value)).toEqual(expect.arrayContaining([fp('a').value, fp('b').value]))
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
