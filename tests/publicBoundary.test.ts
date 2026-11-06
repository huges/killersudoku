import { describe, expect, it } from 'vitest'
import { extractPlayableContent, transformPlayableContent } from '../src/domain/identity'
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
    const result = lookupPublicId(registry, source, registry.identities[0].publicId)
    expect(result.content).toEqual(content)
    expect(result.recordKey).toEqual(key('feed', 'a'))
    expect(result.state).toBe('removed')
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
    expect(first).toBe(serializePublicExport(exported))
    expect(first).toContain('killer-sudoku-export')
    expect(first).not.toContain('solution')
    expect(first).not.toContain('session')
    expect(first).not.toContain('history')
    expect(deserializePublicExport(first)).toEqual(exported)
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
})
