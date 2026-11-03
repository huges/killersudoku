import { describe, expect, it } from 'vitest'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'
import { extractPlayableContent, fingerprintPlayableContent, transformPlayableContent, type PlayableContent } from '../src/domain/identity'
import { classifyDuplicate, type HistoricalRecord } from '../src/domain/duplicateClassifier'
import { assignIncremental, createEmptyRegistry, type AssignmentInput, type RecordKey, type Registry } from '../src/domain/registry'

const content = extractPlayableContent(partialPuzzle)
const first: RecordKey = { source: 'catalog', key: 'one' }
const second: RecordKey = { source: 'catalog', key: 'two' }
const observation: RecordKey = { source: 'incoming', key: 'new' }

function registry(extraAssociations: Registry['associations'] = []): Registry {
  const associations: Registry['associations'] = [
    { recordKey: first, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'obs-1' },
    { recordKey: second, publicId: 'puzzle-2', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'obs-2' },
    ...extraAssociations,
  ]
  const identities: Registry['identities'] = [
    { publicId: 'puzzle-1', firstAssignment: { recordKey: first, observationKey: 'obs-1' }, fingerprints: [], aliases: [], stateHistory: [{ state: 'current', observationKey: 'obs-1' }], currentState: 'current', currentStateObservation: 'obs-1' },
    { publicId: 'puzzle-2', firstAssignment: { recordKey: second, observationKey: 'obs-2' }, fingerprints: [], aliases: [], stateHistory: [{ state: 'current', observationKey: 'obs-2' }], currentState: 'current', currentStateObservation: 'obs-2' },
  ]
  for (const association of extraAssociations) {
    const identity = association && typeof association === 'object' ? identities.find((candidate) => candidate.publicId === association.publicId) : undefined
    if (identity && !identity.stateHistory.some((entry) => entry.observationKey === association.observationKey)) {
      identity.stateHistory = [...identity.stateHistory, { state: association.state, observationKey: association.observationKey }]
      if (association.state === 'current') {
        identity.currentState = 'current'
        identity.currentStateObservation = association.observationKey
      }
    }
  }
  return { schemaVersion: '1', namespace: 'killer-sudoku', identities, associations, reservedIds: [], reservedAliases: [] }
}

function serializableInput(input: { content: unknown; registry: unknown; observationRecordKey: unknown }): unknown {
  return { content: structuredClone(input.content), registry: structuredClone(input.registry), observationRecordKey: structuredClone(input.observationRecordKey) }
}

function source(records: HistoricalRecord[]): { resolve: (key: RecordKey) => HistoricalRecord | 'missing' | 'ambiguous'; resolveReference: (reference: string) => { reference: string; recordKey: RecordKey } | 'missing' | 'ambiguous' } {
  return {
    resolve: (key) => records.find((record) => JSON.stringify(record.recordKey) === JSON.stringify(key)) ?? 'missing',
    resolveReference: (reference) => {
      const owner = records.find((record) => record.references?.includes(reference))
      return owner ? { reference, recordKey: owner.recordKey } : 'missing'
    },
  }
}
const records = (one: PlayableContent = content, two: PlayableContent = content): HistoricalRecord[] => [{ recordKey: first, publicId: 'puzzle-1', content: one, references: ['catalog/one'] }, { recordKey: second, publicId: 'puzzle-2', content: two, references: ['catalog/two'] }]

describe('duplicate and historical association classification', () => {
  it('recognizes a new observation as a duplicate without requiring its key in the registry', () => {
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: source(records()) })
    expect(result.classification).toBe('ambiguità')
    expect(result.observationRecordKey).toEqual(observation)
  })
  it('covers D4 and keeps multiple records of one identity', () => {
    const sameIdentity = registry()
    sameIdentity.identities = [sameIdentity.identities[0]]
    sameIdentity.associations = [sameIdentity.associations[0]]
    sameIdentity.identities[0].firstAssignment = { recordKey: first, observationKey: 'obs-1' }
    sameIdentity.identities[0].stateHistory = [...sameIdentity.identities[0].stateHistory, { state: 'current', observationKey: 'obs-2' }]
    sameIdentity.identities[0].currentStateObservation = 'obs-2'
    sameIdentity.associations = [
      sameIdentity.associations[0],
      { recordKey: second, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'obs-2' },
    ]
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content: transformPlayableContent(content, 'rotate90'), registry: sameIdentity, historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-1', content }]) })
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
    const before = serializableInput(input)
    const result = classifyDuplicate(input)
    expect(result.diagnostic?.code).toBe('invalid-input')
    expect({ content: input.content, registry: input.registry, observationRecordKey: input.observationRecordKey }).toEqual(before)
  })
  it('accepts historical references that resolve coherently without adding source/key rules', () => {
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: registry(), historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content, references: ['catalog/one'] }, { recordKey: second, publicId: 'puzzle-2', content, references: ['catalog/two'] }]) }
    const before = serializableInput(input)
    const result = classifyDuplicate(input)
    expect(result.classification).toBe('ambiguità')
    expect({ content: input.content, registry: input.registry, observationRecordKey: input.observationRecordKey }).toEqual(before)
  })
  it('gives registered association precedence and reports a coherent explicit candidate', () => {
    const associations = [{ recordKey: observation, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current' as const, observationKey: 'incoming-1' }]
    const coherentRegistry = registry(associations)
    coherentRegistry.identities[0] = { ...coherentRegistry.identities[0], stateHistory: [{ state: 'current', observationKey: 'obs-1' }, { state: 'current', observationKey: 'incoming-1' }] }
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: coherentRegistry, historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-2', content }, { recordKey: observation, publicId: 'puzzle-1', content }]) }
    expect(classifyDuplicate(input).classification).toBe('associazione già registrata')
    expect(classifyDuplicate({ ...input, requestedPublicId: 'puzzle-1', candidateRecordKey: first })).toMatchObject({ classification: 'associazione già registrata', candidateRecordKey: first })
    expect(classifyDuplicate({ ...input, requestedPublicId: 'puzzle-2', candidateRecordKey: second }).diagnostic?.code).toBe('registered-association-conflict')
  })
  it('accepts canonical state history in non-chronological order, including current/removed/current', () => {
    const firstAssociation = { recordKey: first, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current' as const, observationKey: 'obs-1' }
    const removedAssociation = { recordKey: { source: 'catalog', key: 'removed' }, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'removed' as const, observationKey: 'obs-removed' }
    const currentAssociation = { recordKey: { source: 'catalog', key: 'current' }, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current' as const, observationKey: 'obs-current' }
    const base = registry()
    base.identities[0] = { ...base.identities[0], stateHistory: [
      { state: 'current', observationKey: 'obs-1' },
      { state: 'removed', observationKey: 'obs-removed' },
      { state: 'current', observationKey: 'obs-current' },
    ], currentState: 'current', currentStateObservation: 'obs-current' }
    base.associations = [firstAssociation, removedAssociation, currentAssociation, base.associations[1]]
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content: transformPlayableContent(content, 'rotate90'), registry: base, historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: removedAssociation.recordKey, publicId: 'puzzle-1', content }, { recordKey: currentAssociation.recordKey, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-2', content }]) })
    expect(result.classification).toBe('ambiguità')
  })

  it('orders diagnostics independently of registry order', () => {
    const a = registry(); const b = structuredClone(a); b.identities.reverse()
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: a, historicalContentSource: source([]) }
    const other = { ...input, registry: b }
    expect(classifyDuplicate(input).diagnostic).toEqual(classifyDuplicate(other).diagnostic)
  })

  it('recognizes every D4 transformation while comparing complete content', () => {
    // Matches express the transform from observed content back to historical content.
    const inverseTransformation = {
      identity: 'identity',
      rotate90: 'rotate270',
      rotate180: 'rotate180',
      rotate270: 'rotate90',
      reflectVertical: 'reflectVertical',
      reflectHorizontal: 'reflectHorizontal',
      reflectMainDiagonal: 'reflectMainDiagonal',
      reflectAntiDiagonal: 'reflectAntiDiagonal',
    } as const
    const nonEquivalent = extractPlayableContent(solvedPuzzle)
    const sameIdentity = registry()
    sameIdentity.identities = [sameIdentity.identities[0]]
    sameIdentity.associations = [sameIdentity.associations[0]]
    sameIdentity.identities[0].stateHistory = [...sameIdentity.identities[0].stateHistory, { state: 'current', observationKey: 'obs-2' }]
    sameIdentity.identities[0].currentStateObservation = 'obs-2'
    sameIdentity.associations = [
      sameIdentity.associations[0],
      { recordKey: second, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'obs-2' },
    ]
    for (const transformation of ['identity', 'rotate90', 'rotate180', 'rotate270', 'reflectVertical', 'reflectHorizontal', 'reflectMainDiagonal', 'reflectAntiDiagonal'] as const) {
      const transformed = transformPlayableContent(content, transformation)
      const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content: transformed, registry: sameIdentity, historicalContentSource: source([{ recordKey: first, publicId: 'puzzle-1', content }, { recordKey: second, publicId: 'puzzle-1', content: nonEquivalent }]) })
      expect(result.classification).toBe('duplicato')
      expect(result.matches?.[0].transformations).toContain(inverseTransformation[transformation])
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
    const historicalRecords = records()
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: registry(), historicalContentSource: source(historicalRecords), requestedPublicId: 'puzzle-1', candidateRecordKey: first }
    const before = serializableInput(input)
    const historicalBefore = structuredClone(historicalRecords)
    const selectionBefore = structuredClone({ requestedPublicId: input.requestedPublicId, candidateRecordKey: input.candidateRecordKey })
    const result = classifyDuplicate(input)
    expect(result.classification).toBe('associazione proposta verificata')
    expect({ content: input.content, registry: input.registry, observationRecordKey: input.observationRecordKey }).toEqual(before)
    expect(historicalRecords).toEqual(historicalBefore)
    expect({ requestedPublicId: input.requestedPublicId, candidateRecordKey: input.candidateRecordKey }).toEqual(selectionBefore)
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

    const primitiveAssociation = structuredClone(registry())
    primitiveAssociation.associations = ['malformed' as never]
    expect(() => classifyDuplicate({ ...base, registry: primitiveAssociation })).not.toThrow()
    expect(classifyDuplicate({ ...base, registry: primitiveAssociation }).classification).toBe('errore bloccante')
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

  it('rejects sparse, null, undefined, and nested malformed stateHistory deterministically', () => {
    const malformedHistories: Array<Registry['identities'][number]['stateHistory']> = []
    const sparse = new Array<Registry['identities'][number]['stateHistory'][number]>(2)
    sparse[1] = { state: 'current', observationKey: 'obs-1' }
    malformedHistories.push(sparse)
    malformedHistories.push([undefined as never])
    malformedHistories.push([null as never])
    malformedHistories.push([{ state: 'current', observationKey: { nested: true } } as never])
    malformedHistories.push([{ state: 'current', observationKey: 'obs-1', extra: true } as never])

    for (const stateHistory of malformedHistories) {
      const malformed = registry()
      malformed.identities[0].stateHistory = stateHistory
      const before = structuredClone(malformed)
      expect(() => classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source([]) })).not.toThrow()
      const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source([]) })
      expect(result).toMatchObject({ classification: 'errore bloccante', algorithmVersion: 'd4-v1', observationRecordKey: observation, diagnostic: { code: 'invalid-input', path: 'registry.identities.stateHistory', recordKeys: [{ source: 'catalog', key: 'one' }] } })
      expect(malformed).toEqual(before)
    }

    const first = registry()
    first.identities[0].stateHistory = [{ state: 'current', observationKey: 'obs-1' }, { state: 'bad' as never, observationKey: 'obs-bad' } as never]
    const second = registry()
    second.identities[0].stateHistory = [...first.identities[0].stateHistory].reverse()
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, historicalContentSource: source([]) }
    expect(classifyDuplicate({ ...input, registry: first }).diagnostic).toEqual(classifyDuplicate({ ...input, registry: second }).diagnostic)
  })

  it('makes association diagnostics invariant under permutation of distinct invalid associations', () => {
    const nullAssociation = null as never
    const incompleteAssociation = { recordKey: { source: 'catalog', key: 'a-malformed' } } as never
    const firstOrder = registry([incompleteAssociation, nullAssociation])
    const secondOrder = registry([nullAssociation, incompleteAssociation])
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, historicalContentSource: source([]) }
    const firstResult = classifyDuplicate({ ...input, registry: firstOrder })
    const secondResult = classifyDuplicate({ ...input, registry: secondOrder })
    expect(firstResult).toEqual(secondResult)
    expect(firstResult.diagnostic).toMatchObject({ code: 'invalid-input', path: 'registry.associations', recordKeys: [{ source: 'catalog', key: 'a-malformed' }] })
  })

  it('makes state-history association diagnostics invariant under permutation of valid incoherent associations', () => {
    const missingA = { recordKey: { source: 'catalog', key: 'a-missing' }, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current' as const, observationKey: 'missing-a' }
    const missingB = { recordKey: { source: 'catalog', key: 'b-missing' }, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current' as const, observationKey: 'missing-b' }
    // Do not let registry() repair the missing stateHistory entries for this negative test.
    const firstOrder = registry()
    firstOrder.associations.push(missingB, missingA)
    const secondOrder = registry()
    secondOrder.associations.push(missingA, missingB)
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, historicalContentSource: source([]) }
    const firstResult = classifyDuplicate({ ...input, registry: firstOrder })
    const secondResult = classifyDuplicate({ ...input, registry: secondOrder })
    expect(firstResult).toEqual(secondResult)
    expect(firstResult.diagnostic).toMatchObject({ code: 'identity-conflict', path: 'registry.associations', recordKeys: [{ source: 'catalog', key: 'a-missing' }] })
  })

  it('blocks an explicitly declared historical reference that cannot be resolved', () => {
    const sourceWithUnknownReference = source([{ recordKey: first, publicId: 'puzzle-1', content, references: ['catalog/one', 'catalog/missing'] }, { recordKey: second, publicId: 'puzzle-2', content }])
    sourceWithUnknownReference.resolveReference = (reference) => reference === 'catalog/missing' ? 'missing' : { reference, recordKey: first }
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: registry(), historicalContentSource: sourceWithUnknownReference })
    expect(result.classification).toBe('errore bloccante')
    expect(result.diagnostic).toMatchObject({ code: 'unknown-reference', path: 'historicalContentSource.references', recordKeys: [first] })
  })

  it('blocks non-equivalent explicit candidates and keeps failed inputs immutable', () => {
    const single = registry()
    single.identities = [single.identities[0]]
    single.associations = [single.associations[0]]
    const historicalRecords = [{ recordKey: first, publicId: 'puzzle-1', content: extractPlayableContent(solvedPuzzle) }]
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: single, historicalContentSource: source(historicalRecords), requestedPublicId: 'puzzle-1', candidateRecordKey: first }
    const before = serializableInput(input)
    const historicalBefore = structuredClone(historicalRecords)
    const selectionBefore = structuredClone({ requestedPublicId: input.requestedPublicId, candidateRecordKey: input.candidateRecordKey })
    expect(classifyDuplicate(input).diagnostic?.code).toBe('candidate-not-equivalent')
    expect({ content: input.content, registry: input.registry, observationRecordKey: input.observationRecordKey }).toEqual(before)
    expect(historicalRecords).toEqual(historicalBefore)
    expect({ requestedPublicId: input.requestedPublicId, candidateRecordKey: input.candidateRecordKey }).toEqual(selectionBefore)
  })

  it('blocks malformed source responses without throwing', () => {
    const malformed = { resolve: () => ({ recordKey: first, publicId: 'puzzle-1', content: { malformed: true } } as never) }
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: registry(), historicalContentSource: malformed }
    expect(() => classifyDuplicate(input)).not.toThrow()
    expect(classifyDuplicate(input).diagnostic?.code).toBe('invalid-historical-content')
  })

  it('reports each required registry collision as a blocking diagnostic', () => {
    const cases: Array<[string, (value: Registry) => void]> = [
      ['identity-conflict', (value) => { value.identities.push(structuredClone(value.identities[0])) }],
      ['alias-conflict', (value) => { value.identities[0].aliases = ['shared']; value.identities[1].aliases = ['shared'] }],
      ['record-conflict', (value) => { value.identities[1].firstAssignment.recordKey = structuredClone(first) }],
      ['fingerprint-conflict', (value) => { const fp = { contract: 'playable-content-v1' as const, kind: 'current' as const, value: `sha256-${'a'.repeat(64)}` }; value.identities[0].fingerprints = [fp]; value.identities[1].fingerprints = [fp] }],
      ['association-conflict', (value) => { value.associations = [{ recordKey: first, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'same' }, { recordKey: second, publicId: 'puzzle-2', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'same' }] }],
    ]
    for (const [code, mutate] of cases) {
      const malformed = registry()
      mutate(malformed)
      expect(classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source([]) }).diagnostic?.code).toBe(code)
    }
  })

  it('rejects an association RecordKey owned by a different identity, while allowing same-identity recurrence', () => {
    const malformed = registry([{ recordKey: first, publicId: 'puzzle-2', observedPublicId: 'puzzle-2', fingerprint: null, aliases: [], state: 'current', observationKey: 'incoming-1' }])
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: malformed, historicalContentSource: source(records()) }
    const before = serializableInput(input)
    const result = classifyDuplicate(input)
    expect(result.classification).toBe('errore bloccante')
    expect(result.diagnostic?.code).toBe('identity-conflict')
    expect(result.diagnostic?.path).toBe('registry.associations.recordKey')
    expect({ content: input.content, registry: input.registry, observationRecordKey: input.observationRecordKey }).toEqual(before)

    const legitimate = registry([{ recordKey: first, publicId: 'puzzle-1', observedPublicId: 'puzzle-1', fingerprint: null, aliases: [], state: 'current', observationKey: 'incoming-1' }])
    expect(classifyDuplicate({ ...input, registry: legitimate }).diagnostic?.code).not.toBe('identity-conflict')

    const permuted = structuredClone(malformed)
    permuted.identities.reverse()
    permuted.associations.reverse()
    expect(classifyDuplicate({ ...input, registry: permuted }).diagnostic).toEqual(result.diagnostic)
  })

  it('rejects association alias, fingerprint, reserved-id and observed-id inconsistencies deterministically', () => {
    const aliasCollision = registry([{ recordKey: observation, publicId: 'puzzle-1', observedPublicId: 'puzzle-1', fingerprint: null, aliases: ['reserved'], state: 'current', observationKey: 'incoming-1' }])
    aliasCollision.reservedAliases = ['reserved']
    expect(classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: aliasCollision, historicalContentSource: source([]) }).diagnostic?.code).toBe('alias-conflict')
    const duplicateFingerprint = registry([
      { recordKey: observation, publicId: 'puzzle-1', observedPublicId: null, fingerprint: { contract: 'playable-content-v1', kind: 'current', value: `sha256-${'a'.repeat(64)}` }, aliases: [], state: 'current', observationKey: 'incoming-1' },
      { recordKey: { source: 'incoming', key: 'other' }, publicId: 'puzzle-1', observedPublicId: null, fingerprint: { contract: 'playable-content-v1', kind: 'current', value: `sha256-${'a'.repeat(64)}` }, aliases: [], state: 'current', observationKey: 'incoming-2' },
    ])
    expect(classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: duplicateFingerprint, historicalContentSource: source([]) }).diagnostic?.code).toBe('fingerprint-conflict')
    const observedMismatch = registry([{ recordKey: observation, publicId: 'puzzle-1', observedPublicId: 'puzzle-2', fingerprint: null, aliases: [], state: 'current', observationKey: 'incoming-1' }])
    expect(classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: observedMismatch, historicalContentSource: source([]) }).diagnostic?.code).toBe('association-conflict')
  })

  it('blocks inconsistent identity history and invalid observation content without mutating input', () => {
    const malformed = registry()
    malformed.identities[0].currentState = 'removed'
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: malformed, historicalContentSource: source([]) }
    const before = serializableInput(input)
    expect(classifyDuplicate(input).diagnostic?.code).toBe('identity-conflict')
    expect({ content: input.content, registry: input.registry, observationRecordKey: input.observationRecordKey }).toEqual(before)
    expect(classifyDuplicate({ ...input, content: { invalid: true } as never }).diagnostic?.code).toBe('invalid-input')
  })

  function assigned(previous: Registry, inputs: AssignmentInput[], initialization = false): Registry {
    const result = assignIncremental(previous, inputs, initialization ? { initialization: true } : {})
    expect(result.diagnostics).toEqual([])
    expect(result.registry).not.toBeNull()
    return result.registry as Registry
  }

  function sourceFor(registryValue: Registry, historicalContent: PlayableContent = content): { records: HistoricalRecord[]; source: { resolve: (key: RecordKey) => HistoricalRecord | 'missing' | 'ambiguous' } } {
    const recordsByKey = new Map<string, HistoricalRecord>()
    for (const identity of registryValue.identities) {
      recordsByKey.set(JSON.stringify(identity.firstAssignment.recordKey), {
        recordKey: structuredClone(identity.firstAssignment.recordKey),
        publicId: identity.publicId,
        content: historicalContent,
      })
    }
    for (const association of registryValue.associations) {
      recordsByKey.set(JSON.stringify(association.recordKey), {
        recordKey: structuredClone(association.recordKey),
        publicId: association.publicId,
        content: historicalContent,
      })
    }
    const recordsList = [...recordsByKey.values()]
    return { records: recordsList, source: source(recordsList) }
  }

  function expectSourceCoverage(registryValue: Registry, historical: ReturnType<typeof sourceFor>): void {
    const required = new Set(registryValue.identities.map((identity) => JSON.stringify(identity.firstAssignment.recordKey)))
    for (const association of registryValue.associations) required.add(JSON.stringify(association.recordKey))
    const resolvable = new Set(historical.records.map((record) => JSON.stringify(record.recordKey)))
    expect(historical.records).toHaveLength(resolvable.size)
    expect([...required].sort()).toEqual([...resolvable].sort())
    for (const record of historical.records) {
      const key = JSON.stringify(record.recordKey)
      const identityOwner = registryValue.identities.find((identity) => JSON.stringify(identity.firstAssignment.recordKey) === key)?.publicId
      const associationOwner = registryValue.associations.find((association) => JSON.stringify(association.recordKey) === key)?.publicId
      expect([identityOwner, associationOwner].filter((owner): owner is string => owner !== undefined)).toContain(record.publicId)
      expect(historical.source.resolve(structuredClone(record.recordKey))).toEqual(record)
    }
    for (const key of required) {
      const parsed = JSON.parse(key) as RecordKey
      expect(historical.source.resolve(parsed)).not.toBe('missing')
    }
  }

  it('classifies a first assignment registry built by assignIncremental and preserves registry and source data', () => {
    const built = assigned(createEmptyRegistry(), [{ recordKey: { source: 'integration', key: 'first' }, content, aliases: ['first-alias'], state: 'current' }], true)
    const historical = sourceFor(built)
    expectSourceCoverage(built, historical)
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content, registry: built, historicalContentSource: historical.source }
    const registryBefore = structuredClone(built)
    const recordsBefore = structuredClone(historical.records)
    expect(classifyDuplicate(input).classification).toBe('duplicato')
    expect(built).toEqual(registryBefore)
    expect(historical.records).toEqual(recordsBefore)
  })

  it('accepts cumulative associations for one identity when the registry is built incrementally', () => {
    const fingerprint = { contract: 'playable-content-v1' as const, kind: 'current' as const, value: fingerprintPlayableContent(content) }
    const firstAssignment = assigned(createEmptyRegistry(), [{ recordKey: { source: 'integration', key: 'one' }, content, fingerprint, aliases: ['shared-alias'], state: 'current' }], true)
    const cumulative = assigned(firstAssignment, [{ recordKey: { source: 'integration', key: 'two' }, content, fingerprint, aliases: ['shared-alias'], state: 'current' }])
    const historical = sourceFor(cumulative)
    expectSourceCoverage(cumulative, historical)
    const before = structuredClone(cumulative)
    const sourceBefore = structuredClone(historical.records)
    expect(classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: cumulative, historicalContentSource: historical.source }).classification).toBe('duplicato')
    expect(cumulative).toEqual(before)
    expect(historical.records).toEqual(sourceBefore)
  })

  it('accepts legitimate alias and fingerprint recurrences and the A-current/B-removed/A-current sequence', () => {
    const first = assigned(createEmptyRegistry(), [{ recordKey: { source: 'integration', key: 'a' }, content, aliases: ['recurring'], state: 'current' }], true)
    const removed = assigned(first, [{ recordKey: { source: 'integration', key: 'b' }, content, aliases: ['recurring'], state: 'removed' }])
    const reactivated = assigned(removed, [{ recordKey: { source: 'integration', key: 'a' }, content, aliases: ['recurring'], state: 'current' }])
    const historical = sourceFor(reactivated)
    const registryBefore = structuredClone(reactivated)
    const recordsBefore = structuredClone(historical.records)
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: reactivated, historicalContentSource: historical.source })
    expect(result.classification).toBe('duplicato')
    expect(reactivated).toEqual(registryBefore)
    expect(historical.records).toEqual(recordsBefore)
  })

  it('accepts a registry with owner-consistent reservations built through assignIncremental', () => {
    const seeded = assigned(createEmptyRegistry(), [{ recordKey: { source: 'integration', key: 'owner' }, content, publicId: 'puzzle-000001', aliases: ['owned-alias'], state: 'current' }], true)
    seeded.reservedIds = ['puzzle-000002']
    seeded.reservedAliases = ['reserved-alias']
    const built = assigned(seeded, [{ recordKey: { source: 'integration', key: 'next' }, content, aliases: [], state: 'current' }])
    const historical = sourceFor(built)
    expect(classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: built, historicalContentSource: historical.source }).classification).toBe('duplicato')
    expect(built.reservedIds).toEqual(['puzzle-000002'])
    expect(built.reservedAliases).toEqual(['reserved-alias'])
  })

  it('rejects missing and malformed observationRecordKey independently from content validation', () => {
    const base = { namespace: 'killer-sudoku' as const, content, registry: registry(), historicalContentSource: source(records()) }
    const missing = classifyDuplicate(base as never)
    expect(missing.diagnostic?.code).toBe('invalid-record-key')
    expect(missing.diagnostic?.path).toBe('observationRecordKey')

    const malformed = classifyDuplicate({ ...base, observationRecordKey: { source: 'bad key!', key: 'new' } } as never)
    expect(malformed.diagnostic?.code).toBe('invalid-record-key')
    expect(malformed.diagnostic?.path).toBe('observationRecordKey')
  })

  it('rejects an invalid observed content with a valid observationRecordKey', () => {
    const input = { namespace: 'killer-sudoku' as const, observationRecordKey: observation, content: { invalid: true } as never, registry: registry(), historicalContentSource: source(records()) }
    const result = classifyDuplicate(input)
    expect(result.diagnostic?.code).toBe('invalid-input')
    expect(result.diagnostic?.path).toBe('content')
  })

  it('rejects a firstAssignment that is not the identity-owned association', () => {
    const malformed = registry()
    malformed.identities[0].firstAssignment.observationKey = 'not-registered'
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source(records()) })
    expect(result.diagnostic?.code).toBe('identity-conflict')
    expect(result.diagnostic?.path).toBe('registry.identities.firstAssignment')
  })

  it('rejects a currentStateObservation that disagrees with current state', () => {
    const malformed = registry()
    malformed.identities[0].currentStateObservation = 'obs-2'
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source(records()) })
    expect(result.diagnostic?.code).toBe('identity-conflict')
    expect(result.diagnostic?.path).toBe('registry.identities.currentStateObservation')
  })

  it('rejects a stateHistory entry whose state disagrees with its association', () => {
    const malformed = registry()
    malformed.identities[0].stateHistory[0].state = 'removed'
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source(records()) })
    expect(result.diagnostic?.code).toBe('identity-conflict')
    expect(result.diagnostic?.path).toBe('registry.identities.stateHistory')
  })

  it('rejects an association fingerprint that is absent from its owner identity history', () => {
    const malformed = registry([{ recordKey: observation, publicId: 'puzzle-1', observedPublicId: null, fingerprint: { contract: 'playable-content-v1', kind: 'current', value: `sha256-${'c'.repeat(64)}` }, aliases: [], state: 'current', observationKey: 'incoming-1' }])
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source(records()) })
    expect(result.diagnostic?.code).toBe('fingerprint-conflict')
    expect(result.diagnostic?.path).toBe('registry.associations.fingerprint')
  })

  it('rejects a reserved ID colliding with another identity', () => {
    const malformed = registry()
    malformed.reservedIds = ['puzzle-1']
    const before = structuredClone(malformed)
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source(records()) })
    expect(result.diagnostic?.code).toBe('id-conflict')
    expect(result.diagnostic?.path).toBe('registry.reservedIds')
    expect(malformed).toEqual(before)
  })

  it('rejects the same association RecordKey across different identities while allowing same-identity recurrence', () => {
    const malformed = registry([
      { recordKey: { source: 'association', key: 'one' }, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'incoming-one' },
      { recordKey: { source: 'association', key: 'one' }, publicId: 'puzzle-2', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'incoming-two' },
    ])
    const before = structuredClone(malformed)
    const result = classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: malformed, historicalContentSource: source(records()) })
    expect(result.diagnostic?.code).toBe('identity-conflict')
    expect(result.diagnostic?.path).toBe('registry.associations.recordKey')
    expect(malformed).toEqual(before)

    const legitimate = registry([
      { recordKey: { source: 'association', key: 'one' }, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'incoming-one' },
      { recordKey: { source: 'association', key: 'one' }, publicId: 'puzzle-1', observedPublicId: null, fingerprint: null, aliases: [], state: 'current', observationKey: 'incoming-two' },
    ])
    expect(classifyDuplicate({ namespace: 'killer-sudoku', observationRecordKey: observation, content, registry: legitimate, historicalContentSource: source(records()) }).diagnostic?.code).not.toBe('identity-conflict')
  })
})
