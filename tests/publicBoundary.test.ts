import { describe, expect, it } from 'vitest'
import { arePlayableContentsD4Equivalent, extractPlayableContent, transformPlayableContent, type D4Transformation } from '../src/domain/identity'
import { type HistoricalContentSource } from '../src/domain/duplicateClassifier'
import { assignIncremental, createEmptyRegistry, type Registry } from '../src/domain/registry'
import {
  deserializePublicExport,
  lookupPublicId,
  lookupPublicQr,
  parsePublicQr,
  serializePublicExport,
  toPublicExport,
} from '../src/domain/publicBoundary'
import { partialPuzzle } from '../src/domain/fixtures'

const key = (source: string, value: string) => ({ source, key: value })
const fingerprint = { contract: 'legacy-sha256' as const, kind: 'legacy' as const, value: `sha256-${'a'.repeat(64)}` }

function historicalSource(registry: Registry, content: ReturnType<typeof extractPlayableContent>): HistoricalContentSource {
  const records = new Map(registry.associations.map((association) => [JSON.stringify(association.recordKey), {
    recordKey: association.recordKey,
    publicId: association.publicId,
    content,
  }]))
  return { resolve: (recordKey) => records.get(JSON.stringify(recordKey)) ?? 'missing' }
}

function registryFor(state: 'current' | 'removed' = 'current'): { registry: Registry; source: HistoricalContentSource; content: ReturnType<typeof extractPlayableContent> } {
  const content = extractPlayableContent(partialPuzzle)
  const assigned = assignIncremental(createEmptyRegistry(), [{ recordKey: key('feed', 'a'), fingerprint, aliases: [], state }], { initialization: true })
  expect(assigned.diagnostics).toEqual([])
  const registry = assigned.registry as Registry
  return { registry, source: historicalSource(registry, content), content }
}

describe('M2-4E public boundary', () => {
  it('resolves the first observation and preserves original content when current state is removed', () => {
    const { registry, source, content } = registryFor('removed')
    const id = registry.identities[0].publicId
    const result = lookupPublicId(registry, source, id)
    expect(result.content).toEqual(content)
    expect(result.recordKey).toEqual(key('feed', 'a'))
    expect(result.state).toBe('removed')
    expect(lookupPublicQr(registry, source, JSON.stringify({ format: 'killer-sudoku-qr', version: 1, id }))).toEqual(result)
  })

  it('uses observationKey rather than array order and rejects inconsistent references', () => {
    const { registry, source } = registryFor()
    const reversed = { ...registry, associations: [...registry.associations].reverse() }
    const result = lookupPublicId(reversed, source, reversed.identities[0].publicId)
    expect(result.observationKey).toBe(reversed.identities[0].firstAssignment.observationKey)
    const malformed = { ...registry, associations: registry.associations.map((association) => ({ ...association, recordKey: key('feed', 'other') })) }
    expect(() => lookupPublicId(malformed, source, registry.identities[0].publicId)).toThrow('INCONSISTENT_REFERENCE')
  })

  it('shares ID resolution with the versioned QR parser and rejects extra fields', () => {
    const { registry, source } = registryFor()
    const id = registry.identities[0].publicId
    expect(parsePublicQr(JSON.stringify({ format: 'killer-sudoku-qr', version: 1, id }))).toEqual({ format: 'killer-sudoku-qr', version: 1, id })
    expect(lookupPublicQr(registry, source, JSON.stringify({ format: 'killer-sudoku-qr', version: 1, id }))).toEqual(lookupPublicId(registry, source, id))
    expect(() => parsePublicQr(JSON.stringify({ format: 'killer-sudoku-qr', version: 1, id, extra: true }))).toThrow('EXTRA_FIELD')
  })

  it('writes a strict deterministic export without user or solution state', () => {
    const { registry, source } = registryFor()
    const exported = toPublicExport(lookupPublicId(registry, source, registry.identities[0].publicId))
    const first = serializePublicExport(exported)
    const reordered = { ...exported, record: { ...exported.record, identity: { ...exported.record.identity, aliases: [...(exported.record.identity.aliases ?? [])].reverse() }, content: { ...exported.record.content, clues: [...exported.record.content.clues].reverse(), cages: [...exported.record.content.cages].reverse().map((cage) => ({ ...cage, cells: [...cage.cells].reverse() })) } } }
    expect(first).toBe(serializePublicExport(exported))
    expect(first).toBe(serializePublicExport(reordered))
    expect(first).toContain('killer-sudoku-export')
    expect(first).not.toContain('solution')
    expect(first).not.toContain('session')
    expect(first).not.toContain('history')
    const roundTripped = deserializePublicExport(first)
    expect(serializePublicExport(roundTripped)).toBe(first)
    expect(roundTripped.record.identity.id).toBe(exported.record.identity.id)
    expect(roundTripped.record.content).toEqual(JSON.parse(first).record.content)
    expect(() => deserializePublicExport(JSON.stringify({ ...exported, extra: true }))).toThrow('EXTRA_FIELD')
  })

  it('resolves first assignment A in an A-current/B-removed/A-current history', () => {
    const content = extractPlayableContent(partialPuzzle)
    const first = assignIncremental(createEmptyRegistry(), [{ recordKey: key('feed', 'a'), fingerprint, aliases: [], state: 'current' }], { initialization: true })
    const second = assignIncremental(first.registry as Registry, [{ recordKey: key('feed', 'b'), fingerprint, aliases: [], state: 'removed' }], {})
    const third = assignIncremental(second.registry as Registry, [{ recordKey: key('feed', 'a'), fingerprint, aliases: [], state: 'current' }], {})
    expect(third.diagnostics).toEqual([])
    const registry = third.registry as Registry
    const source: HistoricalContentSource = {
      resolve: (recordKey) => recordKey.key === 'a'
        ? { recordKey, publicId: registry.identities[0].publicId, content }
        : { recordKey, publicId: registry.identities[0].publicId, content },
    }
    const id = registry.identities[0].publicId
    expect(lookupPublicId(registry, source, id).recordKey).toEqual(key('feed', 'a'))
    expect(lookupPublicQr(registry, source, JSON.stringify({ format: 'killer-sudoku-qr', version: 1, id })).recordKey).toEqual(key('feed', 'a'))
  })

  it('does not return a D4-transformed lookup payload', () => {
    const { registry, source, content } = registryFor()
    const transformed = transformPlayableContent(content, 'rotate90')
    const result = lookupPublicId(registry, source, registry.identities[0].publicId)
    expect(result.content).not.toEqual(transformed)
  })

  it('verifies all eight D4 transformations without changing returned content', () => {
    const { registry, source, content } = registryFor()
    const transformations: D4Transformation[] = ['identity', 'rotate90', 'rotate180', 'rotate270', 'reflectVertical', 'reflectHorizontal', 'reflectMainDiagonal', 'reflectAntiDiagonal']
    for (const transformation of transformations) {
      expect(arePlayableContentsD4Equivalent(transformPlayableContent(content, transformation), content)).toBe(true)
    }
    expect(lookupPublicId(registry, source, registry.identities[0].publicId).content).toEqual(content)
  })

  it('resolves removed first assignments through QR and preserves opaque fingerprints, including absence', () => {
    const removed = registryFor('removed')
    const id = removed.registry.identities[0].publicId
    const qr = JSON.stringify({ format: 'killer-sudoku-qr', version: 1, id })
    expect(lookupPublicQr(removed.registry, removed.source, qr).fingerprint).toEqual(fingerprint)
    const withoutFingerprint = {
      ...removed.registry,
      associations: removed.registry.associations.map((association) => ({ ...association, fingerprint: null })),
    }
    expect(lookupPublicQr(withoutFingerprint, removed.source, qr).fingerprint).toBeUndefined()
  })

  it('rejects missing, incoherent, duplicate, divergent and ambiguous historical references without fallback', () => {
    const { registry, source } = registryFor()
    const id = registry.identities[0].publicId
    expect(() => lookupPublicId({ ...registry, identities: [{ ...registry.identities[0], firstAssignment: { ...registry.identities[0].firstAssignment, observationKey: '' } }] }, source, id)).toThrow('INCONSISTENT_REFERENCE')
    expect(() => lookupPublicId({ ...registry, associations: [...registry.associations, { ...registry.associations[0] }] }, source, id)).toThrow('AMBIGUOUS_PUBLIC_REFERENCE')
    expect(() => lookupPublicId({ ...registry, associations: [{ ...registry.associations[0], publicId: 'other-id' }] }, source, id)).toThrow('INCONSISTENT_REFERENCE')
    expect(() => lookupPublicId(registry, { resolve: () => 'missing' }, id)).toThrow('INCONSISTENT_REFERENCE')
    expect(() => lookupPublicId(registry, { resolve: () => 'ambiguous' }, id)).toThrow('INCONSISTENT_REFERENCE')
  })
})
