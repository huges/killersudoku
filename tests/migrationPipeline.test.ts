import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync, linkSync, symlinkSync, mkdirSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { partialPuzzle } from '../src/domain/fixtures'
import { execute, readJson, writeExclusive } from '../scripts/migration-command'
import { parseMigrationInput, runMigration, stableMigrationJson, type LegacyRecord } from '../src/domain/migrationPipeline'
import { extractPlayableContent } from '../src/domain/identity'
import { type HistoricalRecord } from '../src/domain/duplicateClassifier'
import { loadSample, verifySample } from '../scripts/verify-catalog'
import { deserializePublicExport, serializePublicExport, type PublicExport } from '../src/domain/publicBoundary'
import { assignIncremental, createEmptyRegistry, type Registry } from '../src/domain/registry'
import { newGame } from '../src/domain/game'

const record = (key: string, overrides: Partial<LegacyRecord> = {}): LegacyRecord => ({
  recordKey: { source: 'legacy', key },
  puzzle: structuredClone(partialPuzzle),
  legacyFingerprint: 'legacy-opaque-value',
  aliases: ['z-alias', 'a-alias'],
  versions: { difficulty: null, schema: '1.0' },
  references: ['legacy/catalog'],
  ...overrides,
})

describe('M2-4F migration pipeline', () => {
  it('orders records and preserves opaque legacy data while deriving current content identity', () => {
    const result = runMigration('migrate', [record('b'), record('a')])
    expect(result.diagnostics).toEqual([])
    expect(result.records.map((item) => item.recordKey.key)).toEqual(['a', 'b'])
    expect(result.records[0]).toMatchObject({
      legacyFingerprint: 'legacy-opaque-value',
      aliases: ['a-alias', 'z-alias'],
      currentFingerprint: expect.stringMatching(/^sha256-[0-9a-f]{64}$/),
      content: { size: 9 },
      outcome: 'candidate',
    })
    expect(result.records[0].content).not.toHaveProperty('orientation')
    expect(result.candidate).toHaveLength(2)
  })

  it('verifies solvability and uniqueness and excludes solution or user state from reports', () => {
    const valid = runMigration('verify', [record('verified')])
    expect(valid.diagnostics).toEqual([])
    expect(valid.records[0].outcome).toBe('pass')
    expect(valid.candidate).toEqual([])
    for (const field of ['solution', 'notes', 'statistics', 'history', 'session', 'userState', 'orientation']) {
      expect(valid.records[0]).not.toHaveProperty(field)
    }

    const unsatisfiable = structuredClone(partialPuzzle)
    unsatisfiable.cages.find((cage) => cage.id === 'cage-0-2')!.sum = 3
    unsatisfiable.cages.find((cage) => cage.id === 'cage-0-3')!.sum = 3
    const rejected = runMigration('verify', [record('unsatisfiable', { puzzle: unsatisfiable })])
    expect(rejected.records[0].outcome).toBe('error')
    expect(rejected.records[0].content).toBeNull()
    expect(rejected.records[0].currentFingerprint).toBeNull()
    expect(rejected.diagnostics).toHaveLength(1)
  })

  it('round-trips only the documented public export projection and rejects user data', () => {
    const exported: PublicExport = {
      format: 'killer-sudoku-export', version: 1,
      record: { identity: { id: 'puzzle-000001', aliases: ['legacy'] },
        recordKey: { source: 'legacy', key: 'export' }, content: extractPlayableContent(partialPuzzle) },
    }
    const serialized = serializePublicExport(exported)
    expect(deserializePublicExport(serialized)).toEqual(exported)
    expect(serialized).not.toMatch(/solution|notes|statistics|history|session|orientation/i)
    expect(() => deserializePublicExport(JSON.stringify({
      ...exported, record: { ...exported.record, solution: [[1]] },
    }))).toThrow()
  })

  it('rejects malformed content without emitting a partial candidate', () => {
    const malformed = record('bad', { puzzle: { ...structuredClone(partialPuzzle), cages: [] } as never })
    const result = runMigration('migrate', [malformed, record('good')])
    const bad = result.records.find((item) => item.recordKey.key === 'bad')
    expect(bad?.outcome).toBe('error')
    expect(bad?.content).toBeNull()
    // Candidate publication is transactional: a single invalid record blocks the whole set.
    expect(result.candidate).toEqual([])
    expect(result.diagnostics.map((item) => item.code)).toContain('invalid-record')
  })

  it('is reproducible and dry-run produces the same logical report without a write concern', () => {
    const input = [record('b'), record('a')]
    const first = runMigration('dry-run', input)
    const second = runMigration('dry-run', [...input].reverse())
    expect(stableMigrationJson(first)).toBe(stableMigrationJson(second))
    expect(first.candidate).toEqual(first.records.filter((item) => item.outcome === 'candidate').map((item) => ({
      recordKey: item.recordKey, publicId: item.publicId, aliases: item.aliases, legacyFingerprint: item.legacyFingerprint, content: item.content, currentFingerprint: item.currentFingerprint, versions: item.versions, references: item.references,
    })))
  })

  it('accepts a same-RecordKey historical recurrence from an independent source', () => {
    const recurring = record('recurring', { recordKey: { source: 'legacy', key: 'recurring' }, references: [] })
    const assigned = assignIncremental(createEmptyRegistry(), [{
      recordKey: recurring.recordKey, content: extractPlayableContent(partialPuzzle), aliases: [], state: 'current',
    }], { initialization: true })
    expect(assigned.registry).not.toBeNull()
    const historical: HistoricalRecord = {
      recordKey: recurring.recordKey, publicId: assigned.registry!.identities[0].publicId,
      content: extractPlayableContent(partialPuzzle),
    }
    const result = runMigration('generate-catalog', [recurring], {
      registry: assigned.registry as Registry,
      historicalContentSource: { resolve: (key) => JSON.stringify(key) === JSON.stringify(recurring.recordKey) ? structuredClone(historical) : 'missing' },
    })
    expect(result.records[0].outcome).toBe('associated')
    expect(result.candidate).toEqual([])
    expect(result.records[0].duplicate?.algorithmVersion).toBe('d4-v1')
  })

  it('produces byte-identical generated reports across repeated runs and permuted inputs', () => {
    const left = mkdtempSync(join(tmpdir(), 'mozart-migration-repro-left-'))
    const right = mkdtempSync(join(tmpdir(), 'mozart-migration-repro-right-'))
    try {
      const records = [record('z-record', { references: [] }), record('a-record', { references: [] })]
      for (const [root, input] of [[left, records], [right, [...records].reverse()]] as const) {
        writeFileSync(join(root, 'input.json'), JSON.stringify(input))
        writeFileSync(join(root, 'history.json'), JSON.stringify([]))
        writeFileSync(join(root, 'registry.json'), JSON.stringify(createEmptyRegistry()))
      }
      const makeArgs = (output: string) => ['generate-catalog', '--input', 'input.json', '--history', 'history.json', '--registry', 'registry.json', '--output', output]
      const first = execute(makeArgs('report.json'), left)
      const repeated = execute(makeArgs('report-repeat.json'), left)
      const permuted = execute(makeArgs('report.json'), right)
      expect(repeated).toBe(first)
      expect(permuted).toBe(first)
      expect(JSON.parse(first).records.map((item: { recordKey: { key: string } }) => item.recordKey.key)).toEqual(['a-record', 'z-record'])
    } finally { rmSync(left, { recursive: true, force: true }); rmSync(right, { recursive: true, force: true }) }
  })

  it('rejects unknown input fields before processing records', () => {
    expect(() => parseMigrationInput({ ...record('bad'), unexpected: true })).toThrow('unknown field')
  })

  it('keeps dry-run in memory and rejects unauthorized or existing output paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-'))
    try {
      const inputPath = join(root, 'input.json')
      const outputPath = join(root, 'output.json')
      writeFileSync(inputPath, JSON.stringify([record('cli')]))
      const dryRun = execute(['dry-run', '--input', 'input.json'], root)
      expect(JSON.parse(dryRun).command).toBe('dry-run')
      expect(existsSync(outputPath)).toBe(false)
      expect(readdirSync(root)).toEqual(['input.json'])
      expect(readdirSync(root).some((name) => name.startsWith('.mozart-migration-'))).toBe(false)
      expect(() => execute(['migrate', '--input', 'input.json', '--output', '../outside.json'], root)).toThrow('unauthorized raw path')
      writeFileSync(outputPath, 'existing')
      expect(() => execute(['migrate', '--input', 'input.json', '--output', 'output.json'], root)).toThrow('already exists')
      expect(readFileSync(outputPath, 'utf8')).toBe('existing')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects symlinked and physically aliased authoritative inputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-fs-'))
    try {
      const inputPath = join(root, 'input.json')
      const symlinkPath = join(root, 'input-link.json')
      const hardlinkPath = join(root, 'input-hardlink.json')
      writeFileSync(inputPath, JSON.stringify([record('fs')]))
      symlinkSync(inputPath, symlinkPath)
      expect(() => execute(['dry-run', '--input', 'input-link.json'], root)).toThrow('symlink component')
      linkSync(inputPath, hardlinkPath)
      expect(() => execute(['dry-run', '--input', 'input.json', '--history', 'input-hardlink.json'], root)).toThrow('physically distinct')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('classifies an independently resolved same-key history record and preserves recurrence', () => {
    const historicalKey = { source: 'history', key: 'same-key' }
    const assigned = assignIncremental(createEmptyRegistry(), [{
      recordKey: historicalKey,
      content: extractPlayableContent(partialPuzzle),
      aliases: ['historical-alias'],
      state: 'current',
    }], { initialization: true })
    expect(assigned.registry).not.toBeNull()
    const registry = assigned.registry as Registry
    const historical: HistoricalRecord = {
      recordKey: historicalKey,
      publicId: registry.identities[0].publicId,
      content: extractPlayableContent(partialPuzzle),
    }
    const result = runMigration('generate-catalog', [record('observation')], {
      registry,
      historicalContentSource: { resolve: (key) => JSON.stringify(key) === JSON.stringify(historicalKey) ? structuredClone(historical) : 'missing' },
    })
    expect(result.records[0].outcome).toBe('duplicate')
    expect(result.records[0].duplicate?.matches?.[0].publicId).toBe(registry.identities[0].publicId)
  })

  it('reads the documented public export while keeping M2-1 and identity-lock distinct source roles', () => {
    const technicalSample = JSON.parse(readFileSync(resolve(process.cwd(), 'catalog/fixtures/inputs.json'), 'utf8')) as unknown
    const identityLock = JSON.parse(readFileSync(resolve(process.cwd(), 'catalog/identity-lock.json'), 'utf8')) as unknown
    const exportContent = extractPlayableContent(partialPuzzle)
    const documentedExport: PublicExport = {
      format: 'killer-sudoku-export', version: 1,
      record: {
        identity: { id: 'puzzle-000001', aliases: ['legacy-a', 'legacy-b'] },
        recordKey: { source: 'legacy', key: 'export-record' },
        fingerprint: { contract: 'legacy-sha256', kind: 'legacy', value: `sha256-${'a'.repeat(64)}` },
        content: exportContent,
      },
    }
    const technical = loadSample(process.cwd())
    expect(technical.puzzles).toEqual(technicalSample)
    expect(verifySample(process.cwd())).toContain('"puzzles"')
    expect(() => parseMigrationInput(technicalSample)).toThrow('recordKey')
    // The M2-1 sample and legacy identity-lock remain distinct from complete historical records.
    expect(() => parseMigrationInput(identityLock)).toThrow()
    const imported = parseMigrationInput(documentedExport)
    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({
      recordKey: documentedExport.record.recordKey, publicId: 'puzzle-000001',
      aliases: ['legacy-a', 'legacy-b'], legacyFingerprint: documentedExport.record.fingerprint?.value ?? null,
      versions: { export: '1' },
    })
    expect(extractPlayableContent(imported[0].puzzle)).toEqual(exportContent)

    // The M2-4E save and PuzzleDefinition readers validate these documented
    // forms, but neither embeds a RecordKey. Migration must not invent one.
    const saveDocument = { format: 'killer-sudoku-save', schemaVersion: '1.0', puzzle: partialPuzzle, game: newGame(partialPuzzle) }
    expect(() => parseMigrationInput(saveDocument)).toThrow('documented save/puzzle format has no RecordKey')
    expect(() => parseMigrationInput(partialPuzzle)).toThrow('documented save/puzzle format has no RecordKey')
    expect(() => parseMigrationInput({ ...record('opaque'), legacyFingerprint: 'not-a-digest-or-current-fingerprint' })).not.toThrow()
  })

  it('rejects an input path replaced between lstat and descriptor open', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-open-race-'))
    const path = join(root, 'input.json')
    const replacement = join(root, 'replacement.json')
    try {
      writeFileSync(path, JSON.stringify([record('original')]))
      writeFileSync(replacement, JSON.stringify([record('replacement')]))
      expect(() => readJson(path, {
        beforeOpen: () => {
          renameSync(path, join(root, 'original.json'))
          renameSync(replacement, path)
        },
      })).toThrow('identity changed between validation and open')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('accepts a documented export from a file through the migration command without altering public identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-cli-export-'))
    try {
      const content = extractPlayableContent(partialPuzzle)
      const exported: PublicExport = {
        format: 'killer-sudoku-export', version: 1,
        record: {
          identity: { id: 'puzzle-000042', aliases: ['old-name'] },
          recordKey: { source: 'legacy', key: 'cli-export' },
          fingerprint: { contract: 'legacy-sha256', kind: 'legacy', value: `sha256-${'b'.repeat(64)}` },
          content,
        },
      }
      writeFileSync(join(root, 'input.json'), JSON.stringify(exported))
      const output = JSON.parse(execute(['migrate', '--input', 'input.json', '--output', 'candidate.json'], root))
      expect(output.records[0]).toMatchObject({
        recordKey: exported.record.recordKey, publicId: 'puzzle-000042', aliases: ['old-name'],
        legacyFingerprint: exported.record.fingerprint?.value, content, outcome: 'candidate',
      })
      expect(readFileSync(join(root, 'candidate.json'), 'utf8')).toContain('puzzle-000042')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('blocks absent migration prerequisites and rejects unverified historical content', () => {
    const absent = runMigration('generate-catalog', [record('no-reader')])
    expect(absent.records[0].outcome).toBe('error')
    expect(absent.records[0].content).toBeNull()
    expect(absent.diagnostics.map((item) => item.code)).toContain('missing-historical-content')

    const assigned = assignIncremental(createEmptyRegistry(), [{
      recordKey: { source: 'history', key: 'unverified' }, content: extractPlayableContent(partialPuzzle), aliases: [], state: 'current',
    }], { initialization: true })
    expect(assigned.registry).not.toBeNull()
    const invalidHistorical = {
      recordKey: { source: 'history', key: 'unverified' },
      publicId: assigned.registry!.identities[0].publicId,
      content: { size: 9, clues: [], cages: [] },
    } as unknown as HistoricalRecord
    const rejected = runMigration('generate-catalog', [record('candidate')], {
      registry: assigned.registry as Registry,
      historicalContentSource: { resolve: () => structuredClone(invalidHistorical) },
    })
    expect(rejected.records[0].outcome).toBe('error')
    expect(rejected.candidate).toEqual([])
    expect(rejected.diagnostics.map((item) => item.code)).toContain('invalid-historical-content')
  })

  it('reports missing history, ambiguous identity, and identity collision without candidates', () => {
    const first = assignIncremental(createEmptyRegistry(), [{ recordKey: { source: 'history', key: 'one' }, content: extractPlayableContent(partialPuzzle), aliases: [], state: 'current' }], { initialization: true })
    const second = assignIncremental(createEmptyRegistry(), [{ recordKey: { source: 'history', key: 'two' }, content: extractPlayableContent(partialPuzzle), publicId: 'puzzle-000002', aliases: [], state: 'current' }], { initialization: true })
    expect(first.registry).not.toBeNull()
    expect(second.registry).not.toBeNull()
    const missing = runMigration('generate-catalog', [record('missing')], { registry: first.registry as Registry, historicalContentSource: { resolve: () => 'missing' } })
    expect(missing.records[0].outcome).toBe('error')
    expect(missing.diagnostics[0].code).toBe('missing-historical-content')
    const ambiguous = runMigration('generate-catalog', [record('ambiguous')], { registry: first.registry as Registry, historicalContentSource: { resolve: () => 'ambiguous' } })
    expect(ambiguous.records[0].outcome).toBe('error')
    expect(ambiguous.diagnostics[0].code).toBe('ambiguous-historical-reference')
    const collisionSource: HistoricalRecord = { recordKey: { source: 'history', key: 'one' }, publicId: 'puzzle-999', content: extractPlayableContent(partialPuzzle) }
    const collision = runMigration('generate-catalog', [record('collision')], { registry: first.registry as Registry, historicalContentSource: { resolve: () => structuredClone(collisionSource) } })
    expect(collision.records[0].outcome).toBe('collision')
    expect(collision.candidate).toEqual([])
  })

  it('rejects candidate/history physical aliasing and keeps existing output untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-provenance-'))
    try {
      const inputPath = join(root, 'input.json')
      const historyPath = join(root, 'history.json')
      writeFileSync(inputPath, JSON.stringify([record('provenance')]))
      linkSync(inputPath, historyPath)
      expect(() => execute(['dry-run', '--input', 'input.json', '--history', 'history.json'], root)).toThrow('physically distinct')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('covers all six command modes and keeps dry-run logic equal to generation', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-commands-'))
    try {
      writeFileSync(join(root, 'input.json'), JSON.stringify([record('commands')]))
      const commands = ['verify', 'migrate', 'generate-catalog', 'generate-identities', 'generate-references'] as const
      const generated = commands.map((command) => JSON.parse(execute([command, '--input', 'input.json', '--output', `${command}.json`], root)))
      const dry = JSON.parse(execute(['dry-run', '--input', 'input.json'], root))
      expect(generated.find((result) => result.command === 'migrate')?.records).toEqual(dry.records)
      expect(generated.find((result) => result.command === 'migrate')?.candidate).toEqual(dry.candidate)
      expect(generated.find((result) => result.command === 'generate-catalog')?.records[0].outcome).toBe('error')
      expect(generated.find((result) => result.command === 'generate-identities')?.records[0].outcome).toBe('error')
      expect(generated.find((result) => result.command === 'generate-references')?.records[0].outcome).toBe('error')
      expect(generated.find((result) => result.command === 'verify')?.candidate).toEqual([])
      for (const command of commands) expect(existsSync(join(root, `${command}.json`))).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('generates verified catalog, identity and reference candidates with separate authoritative inputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-generation-'))
    try {
      const candidate = record('generation', { references: [] })
      writeFileSync(join(root, 'input.json'), JSON.stringify([candidate]))
      writeFileSync(join(root, 'history.json'), JSON.stringify([]))
      writeFileSync(join(root, 'registry.json'), JSON.stringify(createEmptyRegistry()))
      for (const command of ['generate-catalog', 'generate-identities'] as const) {
        const text = execute([command, '--input', 'input.json', '--history', 'history.json', '--registry', 'registry.json', '--output', `${command}.json`], root)
        const result = JSON.parse(text)
        expect(result.diagnostics).toEqual([])
        expect(result.records[0].outcome).toBe('candidate')
        expect(result.candidate).toHaveLength(1)
        expect(readFileSync(join(root, `${command}.json`), 'utf8')).toBe(text)
        const dry = JSON.parse(execute(['dry-run', '--mode', command, '--input', 'input.json', '--history', 'history.json', '--registry', 'registry.json'], root))
        expect(dry.records).toEqual(result.records)
        expect(dry.candidate).toEqual(result.candidate)
        if (command === 'generate-identities') {
          expect(result.diff[0].registry.identities).toHaveLength(1)
          expect(result.diff[0].registry.identities[0].publicId).toBe('puzzle-000001')
        }
      }

      const historicalKey = { source: 'history', key: 'generation' }
      const assigned = assignIncremental(createEmptyRegistry(), [{
        recordKey: historicalKey, content: extractPlayableContent(partialPuzzle), aliases: [], state: 'current',
      }], { initialization: true })
      expect(assigned.registry).not.toBeNull()
      const registry = assigned.registry as Registry
      const historyRecord = {
        recordKey: historicalKey, publicId: registry.identities[0].publicId,
        content: extractPlayableContent(partialPuzzle), references: ['legacy/catalog'],
      }
      writeFileSync(join(root, 'reference-input.json'), JSON.stringify([record('reference-candidate')]))
      writeFileSync(join(root, 'reference-history.json'), JSON.stringify([historyRecord]))
      writeFileSync(join(root, 'reference-registry.json'), JSON.stringify(registry))
      const generatedReferences = JSON.parse(execute([
        'generate-references', '--input', 'reference-input.json', '--history', 'reference-history.json',
        '--registry', 'reference-registry.json', '--output', 'generate-references.json',
      ], root))
      expect(generatedReferences.diagnostics).toEqual([])
      expect(generatedReferences.records[0].outcome).toBe('duplicate')
      expect(generatedReferences.candidate).toEqual([{
        recordKey: { source: 'legacy', key: 'reference-candidate' }, reference: 'legacy/catalog',
        resolvedRecordKey: historicalKey, publicId: registry.identities[0].publicId,
        currentFingerprint: generatedReferences.records[0].currentFingerprint, outcome: 'candidate',
      }])
      const dryReferences = JSON.parse(execute([
        'dry-run', '--mode', 'generate-references', '--input', 'reference-input.json',
        '--history', 'reference-history.json', '--registry', 'reference-registry.json',
      ], root))
      expect(dryReferences.records).toEqual(generatedReferences.records)
      expect(dryReferences.candidate).toEqual(generatedReferences.candidate)
      expect(readFileSync(join(root, 'generate-references.json'), 'utf8')).toBe(stableMigrationJson({ ...generatedReferences, command: 'generate-references' }))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects indirect symlink paths before reading authoritative input', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-indirect-link-'))
    try {
      const linked = join(root, 'linked')
      mkdirSync(linked, { recursive: true })
      const real = join(root, 'real')
      mkdirSync(real, { recursive: true })
      writeFileSync(join(real, 'input.json'), JSON.stringify([record('indirect')]))
      rmSync(linked, { recursive: true, force: true })
      symlinkSync(real, linked, 'dir')
      expect(() => execute(['dry-run', '--input', 'linked/input.json'], root)).toThrow('symlink component')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('does not publish output or leave staging when input parsing fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-atomic-failure-'))
    try {
      writeFileSync(join(root, 'input.json'), '{ invalid json')
      expect(() => execute(['migrate', '--input', 'input.json', '--output', 'candidate.json'], root)).toThrow()
      expect(existsSync(join(root, 'candidate.json'))).toBe(false)
      expect(readdirSync(root).filter((name) => name.startsWith('.mozart-migration-'))).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects a parent replaced by a symlink before it can publish output', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-parent-race-'))
    try {
      const parent = join(root, 'parent')
      const moved = join(root, 'moved')
      mkdirSync(parent)
      expect(() => writeExclusive(join(parent, 'candidate.json'), '{}', {
        afterStagingCreated: () => {
          // Rename the directory while its staging child exists, then replace the parent path.
          // The production check must observe that the authorized parent identity changed.
          // renameSync is used here rather than spying on Node's ESM filesystem exports.
          renameSync(parent, moved)
          symlinkSync(moved, parent, 'dir')
        },
      })).toThrow()
      expect(existsSync(join(moved, 'candidate.json'))).toBe(false)
      expect(readdirSync(moved)).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects raw NUL, absolute, and duplicate source paths before processing', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-raw-paths-'))
    try {
      writeFileSync(join(root, 'input.json'), JSON.stringify([record('raw-path')]))
      expect(() => execute(['dry-run', '--input', 'bad\0path.json'], root)).toThrow('unauthorized raw path')
      expect(() => execute(['dry-run', '--input', join(root, 'input.json')], root)).toThrow('unauthorized raw path')
      expect(() => execute(['dry-run', '--input', 'input.json', '--history', 'input.json'], root)).toThrow('must be distinct')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('cleans staging and preserves authoritative input when staged serialization write fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-write-failure-'))
    const input = JSON.stringify([record('write-failure')])
    try {
      writeFileSync(join(root, 'input.json'), input)
      expect(() => writeExclusive(join(root, 'candidate.json'), '{}', {
        write: () => { throw Object.assign(new Error('injected write failure'), { code: 'EIO' }) },
      })).toThrow('injected write failure')
      expect(existsSync(join(root, 'candidate.json'))).toBe(false)
      expect(readFileSync(join(root, 'input.json'), 'utf8')).toBe(input)
      expect(readdirSync(root).filter((name) => name.startsWith('.mozart-migration-'))).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('cleans staging and preserves authoritative input when final publication fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-publish-failure-'))
    const input = JSON.stringify([record('publication-failure')])
    try {
      writeFileSync(join(root, 'input.json'), input)
      expect(() => writeExclusive(join(root, 'candidate.json'), '{}', {
        publish: () => { throw Object.assign(new Error('injected publication failure'), { code: 'EIO' }) },
      })).toThrow('injected publication failure')
      expect(existsSync(join(root, 'candidate.json'))).toBe(false)
      expect(readFileSync(join(root, 'input.json'), 'utf8')).toBe(input)
      expect(readdirSync(root).filter((name) => name.startsWith('.mozart-migration-'))).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('publishes one complete report and refuses both multi-file output and overwrite', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-single-artifact-'))
    try {
      writeFileSync(join(root, 'input.json'), JSON.stringify([record('one-artifact')]))
      const args = ['migrate', '--input', 'input.json', '--output', 'result.json']
      const text = execute(args, root)
      const report = JSON.parse(text)
      expect(Object.keys(report)).toEqual(['candidate', 'command', 'diagnostics', 'diff', 'records'])
      expect(readFileSync(join(root, 'result.json'), 'utf8')).toBe(text)
      expect(readdirSync(root).sort()).toEqual(['input.json', 'result.json'])
      expect(() => execute(args, root)).toThrow()
      expect(readFileSync(join(root, 'result.json'), 'utf8')).toBe(text)
      expect(() => execute(['migrate', '--input', 'input.json', '--output-dir', 'result-dir'], root)).toThrow()
      expect(existsSync(join(root, 'result-dir'))).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('canonicalizes nested registry and diagnostic property order, not just record order', () => {
    const left = runMigration('migrate', [record('canonical')])
    const right = structuredClone(left)
    left.diff = [{ registry: { z: 7, a: { z: 2, a: 1 } } }]
    right.diff = [{ registry: { a: { a: 1, z: 2 }, z: 7 } }]
    left.diagnostics = [{ code: 'test', path: 'record', message: 'same' }]
    right.diagnostics = [{ message: 'same', path: 'record', code: 'test' }]
    expect(stableMigrationJson(left)).toBe(stableMigrationJson(right))
  })

  it('reads from the originally opened parent when an ancestor pathname is replaced during input open', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-ancestor-read-race-'))
    try {
      const parent = join(root, 'parent')
      const moved = join(root, 'moved')
      const replacement = join(root, 'replacement')
      mkdirSync(parent)
      mkdirSync(replacement)
      writeFileSync(join(parent, 'input.json'), JSON.stringify({ source: 'authorized' }))
      writeFileSync(join(replacement, 'input.json'), JSON.stringify({ source: 'redirected' }))
      expect(readJson(join(parent, 'input.json'), {
        beforeOpen: () => {
          renameSync(parent, moved)
          symlinkSync(replacement, parent, 'dir')
        },
      })).toEqual({ source: 'authorized' })
      expect(readFileSync(join(replacement, 'input.json'), 'utf8')).toContain('redirected')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses publication when an ancestor of the anchored parent is replaced', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozart-migration-ancestor-publish-race-'))
    try {
      const ancestor = join(root, 'ancestor')
      const movedAncestor = join(root, 'moved-ancestor')
      const replacement = join(root, 'replacement-ancestor')
      const parent = join(ancestor, 'parent')
      mkdirSync(parent, { recursive: true })
      mkdirSync(join(replacement, 'parent'), { recursive: true })
      expect(() => writeExclusive(join(parent, 'candidate.json'), '{}', {
        afterStagingCreated: () => {
          renameSync(ancestor, movedAncestor)
          symlinkSync(replacement, ancestor, 'dir')
        },
      })).toThrow()
      expect(existsSync(join(movedAncestor, 'parent', 'candidate.json'))).toBe(false)
      expect(existsSync(join(replacement, 'parent', 'candidate.json'))).toBe(false)
      expect(readdirSync(join(movedAncestor, 'parent'))).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
