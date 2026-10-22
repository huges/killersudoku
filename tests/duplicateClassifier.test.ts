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
  return {
    schemaVersion: '1', namespace: 'killer-sudoku',
    identities: [
      { publicId: 'puzzle-1', firstAssignment: { recordKey: first, observationKey: 'obs-1' }, fingerprints: [], aliases: [], stateHistory: [{ state: 'current', observationKey: 'obs-1' }], currentState: 'current', currentStateObservation: 'obs-1' },
      { publicId: 'puzzle-2', firstAssignment: { recordKey: second, observationKey: 'obs-2' }, fingerprints: [], aliases: [], stateHistory: [{ state: 'current', observationKey: 'obs-2' }], currentState: 'current', currentStateObservation: 'obs-2' },
    ], associations, reservedIds: [], reservedAliases: [],
  }
}

function source(records: HistoricalRecord[]): { resolve: (key: RecordKey) => HistoricalRecord | 'missing' | 'ambiguous' } {
  return { resolve: (key) => records.find((record) => JSON.stringify(record.recordKey) === JSON.stringify(key)) ?? 'missing' }
}

describe('duplicate and historical association classification', () => {
  it('recognizes a new observation as a duplicate without requiring its record key in the registry', () => {
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }]) })
    expect(result.classification).toBe('duplicato')
    expect(result.publicId).toBe('puzzle-1')
    expect(result.observationRecordKey).toEqual(observation)
  })

  it('compares all D4 transformations and retains multiple records of one identity', () => {
    const transformed = transformPlayableContent(content, 'rotate90')
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content: transformed, registry: registry(), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-1', content }]) })
    expect(result.classification).toBe('duplicato')
    expect(result.publicId).toBe('puzzle-1')
    expect(result.matches).toHaveLength(2)
  })

  it('preserves ambiguity across identities and verifies a selected association', () => {
    const ambiguous = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-2', content }]) })
    expect(ambiguous.classification).toBe('ambiguità')
    expect(ambiguous.equivalentPublicIds).toEqual(['puzzle-1', 'puzzle-2'])
    const proposed = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-2', content }]), requestedPublicId: 'puzzle-2', candidateRecordKey: second })
    expect(proposed).toMatchObject({ classification: 'associazione proposta verificata', requestedPublicId: 'puzzle-2', candidateRecordKey: second })
    expect(proposed).not.toHaveProperty('matches')
  })

  it('blocks missing historical content and malformed fingerprints', () => {
    const missing = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: source([]) })
    expect(missing.diagnostic?.code).toBe('missing-historical-content')
    const malformed = structuredClone(registry())
    malformed.identities[0].fingerprints = [{ contract: 'legacy-sha256', kind: 'legacy', value: 'bad' }]
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source([]) })
    expect(result.diagnostic?.code).toBe('invalid-fingerprint')
  })

  it('gives registered association precedence and blocks contradictory selection', () => {
    const associations = [{ recordKey: observation, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current' as const, observationKey: 'incoming-1' }]
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: registry(associations), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }]) }
    expect(classifyDuplicate(input).classification).toBe('errore bloccante')
    const coherent = classifyDuplicate({ ...input, requestedPublicId: 'puzzle-1', candidateRecordKey: first })
    expect(coherent.classification).toBe('associazione già registrata')
    const contradictory = classifyDuplicate({ ...input, requestedPublicId: 'puzzle-2', candidateRecordKey: second })
    expect(contradictory.diagnostic?.code).toBe('registered-association-conflict')
  })
})
