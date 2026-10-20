import { describe, expect, it } from 'vitest'
import {
  assignIncremental,
  createEmptyRegistry,
  type AssignmentInput,
  type Registry,
} from '../src/domain/registry'

const fp = (hex: string) => ({ contract: 'legacy-sha256' as const, kind: 'legacy' as const, value: `sha256-${hex.repeat(64).slice(0, 64)}` })
const key = (source: string, value: string) => ({ source, key: value })
const input = (recordKey: ReturnType<typeof key>, fingerprint = fp('a'), extra: Partial<AssignmentInput> = {}): AssignmentInput => ({ recordKey, fingerprint, aliases: [], state: 'current', ...extra })
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
    expect(conflict.diagnostics[0].code).toBe('fingerprint-conflict')
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
})

function serialize(registry: Registry): string {
  return JSON.stringify(registry)
}
