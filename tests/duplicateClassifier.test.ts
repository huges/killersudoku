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
})
