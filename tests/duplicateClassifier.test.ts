import { describe, expect, it } from 'vitest'
import { partialPuzzle } from '../src/domain/fixtures'
import { extractPlayableContent, transformPlayableContent, type PlayableContent } from '../src/domain/identity'
import { classifyDuplicate, type HistoricalRecord } from '../src/domain/duplicateClassifier'
import type { RecordKey, Registry } from '../src/domain/registry'

const content = extractPlayableContent(partialPuzzle)
const first: RecordKey = { source: 'catalog', key: 'one' }
const second: RecordKey = { source: 'catalog', key: 'two' }
const observation: RecordKey = { source: 'incoming', key: 'new' }

function registry(associations: Registry['associations'] = []): Registry {
  return { schemaVersion: '1', namespace: 'killer-sudoku', identities: [
    { publicId: 'puzzle-1', firstAssignment: { recordKey: first, observationKey: 'obs-1' }, fingerprints: [], aliases: [], stateHistory: [{ state: 'current', observationKey: 'obs-1' }], currentState: 'current', currentStateObservation: 'obs-1' },
    { publicId: 'puzzle-2', firstAssignment: { recordKey: second, observationKey: 'obs-2' }, fingerprints: [], aliases: [], stateHistory: [{ state: 'current', observationKey: 'obs-2' }], currentState: 'current', currentStateObservation: 'obs-2' },
  ], associations, reservedIds: [], reservedAliases: [] }
}

function source(records: HistoricalRecord[]): { resolve: (key: RecordKey) => HistoricalRecord | 'missing' | 'ambiguous' } {
  return { resolve: (key) => records.find((record) => JSON.stringify(record.recordKey) === JSON.stringify(key)) ?? 'missing' }
}
const records = (one: PlayableContent = content, two: PlayableContent = content): HistoricalRecord[] => [{ recordKey: first, publicId: 'puzzle-1', content: one, references: ['catalog/one'] }, { recordKey: second, publicId: 'puzzle-2', content: two, references: ['catalog/two'] }]

describe('duplicate and historical association classification', () => {
  it('recognizes a new observation as a duplicate without requiring its key in the registry', () => {
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: source(records()) })
    expect(result.classification).toBe('ambiguità')
    expect(result.observationRecordKey).toEqual(observation)
  })
  it('covers D4 and keeps multiple records of one identity', () => {
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content: transformPlayableContent(content, 'rotate90'), registry: registry(), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-1', content }]) })
    expect(result).toMatchObject({ classification: 'duplicato', publicId: 'puzzle-1' })
    expect(result.matches).toHaveLength(2)
    expect(result.matches?.every((match) => match.transformations.length > 0)).toBe(true)
  })
  it('verifies an explicit proposal and limits its report to the selected candidate', () => {
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: source(records()), requestedPublicId: 'puzzle-2', candidateRecordKey: second })
    expect(result).toMatchObject({ classification: 'associazione proposta verificata', requestedPublicId: 'puzzle-2', candidateRecordKey: second })
    expect(result).not.toHaveProperty('matches')
    expect(result).not.toHaveProperty('publicId')
  })
  it('distinguishes unknown, foreign and non-equivalent candidates', () => {
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: registry(), historicalContentSource: source(records()) }
    expect(classifyDuplicate({ ...input, requestedPublicId: 'missing', candidateRecordKey: second }).diagnostic?.code).toBe('unknown-requested-public-id')
    expect(classifyDuplicate({ ...input, requestedPublicId: 'puzzle-1', candidateRecordKey: { source: 'catalog', key: 'absent' } }).diagnostic?.code).toBe('unknown-candidate-record')
    expect(classifyDuplicate({ ...input, requestedPublicId: 'puzzle-1', candidateRecordKey: second }).diagnostic?.code).toBe('candidate-identity-mismatch')
  })
  it('blocks missing, invalid and malformed historical data and fingerprints', () => {
    const missing = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: source([]) })
    expect(missing.diagnostic?.code).toBe('missing-historical-content')
    const invalid = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content: { bad: true } as never }, { recordKey: second, publicId: 'puzzle-2', content }]) })
    expect(invalid.diagnostic?.code).toBe('invalid-historical-content')
    const malformed = structuredClone(registry()); malformed.identities[0].fingerprints = [{ contract: 'legacy-sha256', kind: 'legacy', value: 'bad' }]
    expect(classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source([]) }).diagnostic?.code).toBe('invalid-fingerprint')
  })
  it('rejects malformed source references and preserves every input on failure', () => {
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: registry(), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content, references: ['bad reference'] }, { recordKey: second, publicId: 'puzzle-2', content }]) }
    const before = structuredClone(input)
    const result = classifyDuplicate(input)
    expect(result.diagnostic?.code).toBe('unknown-reference')
    expect(input).toEqual(before)
  })
  it('gives registered association precedence and reports a coherent explicit candidate', () => {
    const associations = [{ recordKey: observation, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current' as const, observationKey: 'incoming-1' }]
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: registry(associations), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-2', content }, { recordKey: observation, publicId: 'puzzle-1', content }]) }
    expect(classifyDuplicate(input).classification).toBe('associazione già registrata')
    expect(classifyDuplicate({ ...input, requestedPublicId: 'puzzle-1', candidateRecordKey: first })).toMatchObject({ classification: 'associazione già registrata', candidateRecordKey: first })
    expect(classifyDuplicate({ ...input, requestedPublicId: 'puzzle-2', candidateRecordKey: second }).diagnostic?.code).toBe('registered-association-conflict')
  })
  it('orders diagnostics independently of registry order', () => {
    const a = registry(); const b = structuredClone(a); b.identities.reverse()
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: a, historicalContentSource: source([]) }
    const other = { ...input, registry: b }
    expect(classifyDuplicate(input).diagnostic).toEqual(classifyDuplicate(other).diagnostic)
  })

  it('recognizes every D4 transformation while comparing complete content', () => {
    for (const transformation of ['identity', 'rotate90', 'rotate180', 'rotate270', 'reflectVertical', 'reflectHorizontal', 'reflectMainDiagonal', 'reflectAntiDiagonal'] as const) {
      const transformed = transformPlayableContent(content, transformation)
      const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content: transformed, registry: registry(), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }]) })
      expect(result.classification).toBe('duplicato')
      expect(result.matches?.[0].transformations).toContain(transformation)
    }
  })

  it('accepts unknown and legacy fingerprints as opaque index values', () => {
    const unknown = structuredClone(registry())
    unknown.identities[0].fingerprints = [{ contract: 'playable-content-v1', kind: 'current', value: `sha256-${'f'.repeat(64)}` }]
    const legacy = structuredClone(registry())
    legacy.identities[0].fingerprints = [{ contract: 'legacy-sha256', kind: 'legacy', value: `sha256-${'e'.repeat(64)}` }]
    for (const candidate of [unknown, legacy]) {
      const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: candidate, historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-2', content: transformPlayableContent(content, 'rotate90') }]) })
      expect(result.classification).toBe('ambiguità')
    }
  })

  it('rejects incomplete explicit selections and keeps successful inputs immutable', () => {
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: registry(), historicalContentSource: source(records()), requestedPublicId: 'puzzle-1', candidateRecordKey: first }
    const before = structuredClone(input)
    const result = classifyDuplicate(input)
    expect(result.classification).toBe('associazione proposta verificata')
    expect(input).toEqual(before)
    expect(classifyDuplicate({ ...input, requestedPublicId: undefined }).diagnostic?.code).toBe('invalid-input')
  })

  it('returns blocking diagnostics instead of throwing for malformed registry structures', () => {
    const base = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, historicalContentSource: source([]) }
    expect(() => classifyDuplicate({ ...base, registry: null as never })).not.toThrow()
    expect(classifyDuplicate({ ...base, registry: null as never }).classification).toBe('errore bloccante')

    const missingAssignment = structuredClone(registry())
    ;(missingAssignment.identities[0] as unknown as { firstAssignment?: unknown }).firstAssignment = undefined
    expect(() => classifyDuplicate({ ...base, registry: missingAssignment })).not.toThrow()
    expect(classifyDuplicate({ ...base, registry: missingAssignment }).classification).toBe('errore bloccante')

    const nullAssociation = structuredClone(registry())
    nullAssociation.associations = [null as never]
    expect(() => classifyDuplicate({ ...base, registry: nullAssociation })).not.toThrow()
    expect(classifyDuplicate({ ...base, registry: nullAssociation }).classification).toBe('errore bloccante')
  })

  it('keeps the complete diagnostic stable across permutations of all registry collections', () => {
    const malformed = structuredClone(registry())
    malformed.reservedIds = ['taken', 'taken']
    malformed.reservedAliases = ['z-alias', 'z-alias']
    malformed.identities[0].aliases = ['alias-b', 'alias-a']
    malformed.identities[0].fingerprints = [
      { contract: 'playable-content-v1', kind: 'current', value: `sha256-${'b'.repeat(64)}` },
      { contract: 'playable-content-v1', kind: 'current', value: `sha256-${'a'.repeat(64)}` },
    ]
    const permuted = structuredClone(malformed)
    permuted.reservedIds.reverse()
    permuted.reservedAliases.reverse()
    permuted.identities.reverse()
    permuted.identities[permuted.identities.length - 1].aliases.reverse()
    permuted.identities[permuted.identities.length - 1].fingerprints.reverse()
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, historicalContentSource: source([]) }
    expect(classifyDuplicate({ ...input, registry: malformed }).diagnostic).toEqual(classifyDuplicate({ ...input, registry: permuted }).diagnostic)
  })

  it('rejects incompatible and unknown historical references before classification', () => {
    const bad = source([{ recordKey: first, publicId: 'puzzle-1', content, references: ['catalog/one', 'catalog/missing'] }, { recordKey: second, publicId: 'puzzle-2', content }])
    expect(classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: bad }).diagnostic?.code).toBe('unknown-reference')
  })
})
