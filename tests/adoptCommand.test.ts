import { existsSync, lstatSync, linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { partialPuzzle } from '../src/domain/fixtures'
import { createEmptyRegistry } from '../src/domain/registry'
import { execute } from '../scripts/migration-command'
import { executeAdopt } from '../scripts/adopt-command'

const args = ['--candidate', 'candidate.json', '--input', 'input.json', '--registry', 'registry.json', '--history', 'history.json', '--output', 'out.json', '--confirm']

function withFixture(test: (root: string) => void, command: 'migrate' | 'generate-catalog' | 'generate-identities' = 'migrate'): void {
  const root = mkdtempSync(join(tmpdir(), 'mozart-m2-4g-'))
  try {
    writeFileSync(join(root, 'input.json'), JSON.stringify([{
      recordKey: { source: 'legacy', key: 'k-1' },
      puzzle: structuredClone(partialPuzzle),
      publicId: 'puzzle-000001',
      aliases: [], versions: { schema: '1.0' }, references: [],
    }]))
    writeFileSync(join(root, 'registry.json'), JSON.stringify(createEmptyRegistry()))
    // This test fixture represents a genuinely empty historical inventory.
    // Production independence and historical completeness are operator attestations.
    writeFileSync(join(root, 'history.json'), '[]')
    const commandArgs = command === 'migrate'
      ? [command, '--input', 'input.json', '--output', 'candidate.json']
      : [command, '--input', 'input.json', '--registry', 'registry.json', '--history', 'history.json', '--output', 'candidate.json']
    execute(commandArgs, root)
    test(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function checkNothingWritten(root: string, operation: () => unknown, code: string): void {
  const source = ['input.json', 'registry.json', 'history.json', 'candidate.json']
    .map((path) => readFileSync(join(root, path), 'utf8'))
  expect(operation).toThrow(code)
  expect(existsSync(join(root, 'out.json'))).toBe(false)
  expect(['input.json', 'registry.json', 'history.json', 'candidate.json']
    .map((path) => readFileSync(join(root, path), 'utf8'))).toEqual(source)
  expect(readdirSync(root).some((path) => path.startsWith('.mozart-migration-'))).toBe(false)
}

describe('M2-4G operator adoption from a verified M2-4F candidate', () => {
  it('requires explicit confirm and each mandatory role', () => withFixture((root) => {
    checkNothingWritten(root, () => executeAdopt(args.filter((arg) => arg !== '--confirm'), root), 'confirm-missing')
    checkNothingWritten(root, () => executeAdopt(args.slice(0, -3).concat('--confirm'), root), 'output-missing')
    checkNothingWritten(root, () => executeAdopt(['--input', 'input.json', '--registry', 'registry.json', '--history', 'history.json', '--output', 'out.json', '--confirm'], root), 'candidate-missing')
    checkNothingWritten(root, () => executeAdopt(args.filter((item) => !['--history', 'history.json'].includes(item)), root), 'candidate-reverify-failed')
  }))

  it('adopts a real M2-4F migration report, without mutating independent sources', () => withFixture((root) => {
    const before = ['candidate.json', 'input.json', 'history.json', 'registry.json']
      .map((path) => readFileSync(join(root, path), 'utf8'))
    const text = executeAdopt(args, root)
    expect(readFileSync(join(root, 'out.json'), 'utf8')).toBe(text)
    expect(lstatSync(join(root, 'out.json')).isFile()).toBe(true)
    expect(['candidate.json', 'input.json', 'history.json', 'registry.json']
      .map((path) => readFileSync(join(root, path), 'utf8'))).toEqual(before)
    expect(() => executeAdopt(args, root)).toThrow('output-exists')
  }))

  it('accepts a migrate report generated with optional authoritative inputs, keeping strict replay', () => withFixture((root) => {
    const withoutRegistry = readFileSync(join(root, 'candidate.json'), 'utf8')
    rmSync(join(root, 'candidate.json'))
    const withRegistry = execute([
      'migrate', '--input', 'input.json', '--registry', 'registry.json',
      '--history', 'history.json', '--output', 'candidate.json',
    ], root)
    // An optional M2-4F Registry can change report metadata without changing
    // the playable candidate; both canonical forms must be verifiable.
    expect(withRegistry).not.toBe(withoutRegistry)
    expect(executeAdopt(args, root)).toBe(withRegistry)
    expect(readFileSync(join(root, 'out.json'), 'utf8')).toBe(withRegistry)
  }))

  it('adopts a real generate-catalog candidate with independent Registry and history', () => withFixture((root) => {
    const document = JSON.parse(readFileSync(join(root, 'candidate.json'), 'utf8'))
    expect(document.command).toBe('generate-catalog')
    expect(document.candidate.length).toBeGreaterThan(0)
    expect(executeAdopt(args, root)).toBe(readFileSync(join(root, 'out.json'), 'utf8'))
  }, 'generate-catalog'))

  it('rejects tampered candidate identity, records and diagnostic fields with zero writes', () => withFixture((root) => {
    const source = readFileSync(join(root, 'candidate.json'), 'utf8')
    const tamper = (change: (value: Record<string, unknown>) => void, expected: string) => {
      const document = JSON.parse(source) as Record<string, unknown>
      change(document)
      writeFileSync(join(root, 'candidate.json'), JSON.stringify(document))
      checkNothingWritten(root, () => executeAdopt(args, root), expected)
    }
    tamper((doc) => { (doc.candidate as { publicId: string }[])[0].publicId = 'puzzle-999999' }, 'candidate-reverify-failed')
    tamper((doc) => { (doc.candidate as { publicId: string }[])[0].publicId = '' }, 'id-integrity-violation')
    tamper((doc) => { (doc.records as { outcome: string }[])[0].outcome = 'ambiguous' }, 'collision-or-ambiguity')
    tamper((doc) => { doc.diagnostics = [{ code: 'unknown-reference', path: 'references', message: 'invalid' }] }, 'reference-integrity-violation')
    tamper((doc) => { doc.diff = [{ forged: true }] }, 'candidate-reverify-failed')
    writeFileSync(join(root, 'candidate.json'), source)
  }))

  it('rejects different source content and unverified history/Registry', () => withFixture((root) => {
    const original = readFileSync(join(root, 'input.json'), 'utf8')
    const changed = JSON.parse(original)
    changed[0].recordKey.key = 'moved-record'
    writeFileSync(join(root, 'input.json'), JSON.stringify(changed))
    checkNothingWritten(root, () => executeAdopt(args, root), 'candidate-reverify-failed')
    writeFileSync(join(root, 'input.json'), original)
    writeFileSync(join(root, 'registry.json'), '{}')
    checkNothingWritten(root, () => executeAdopt(args, root), 'id-integrity-violation')
  }))

  it('rejects a public ID reserved in the authoritative Registry', () => withFixture((root) => {
    const registry = createEmptyRegistry()
    registry.reservedIds.push('puzzle-000001')
    writeFileSync(join(root, 'registry.json'), JSON.stringify(registry))
    checkNothingWritten(root, () => executeAdopt(args, root), 'id-integrity-violation')
  }))

  it('rejects distinct pathnames that actually refer to the same inode', () => withFixture((root) => {
    rmSync(join(root, 'history.json'))
    linkSync(join(root, 'registry.json'), join(root, 'history.json'))
    checkNothingWritten(root, () => executeAdopt(args, root), 'candidate-reverify-failed')
  }))

  it('rejects dry-run provenance without an attested generation mode', () => withFixture((root) => {
    const path = join(root, 'candidate.json')
    const doc = JSON.parse(readFileSync(path, 'utf8'))
    doc.command = 'dry-run'
    writeFileSync(path, JSON.stringify(doc))
    checkNothingWritten(root, () => executeAdopt(args, root), 'candidate-invalid')
  }))

  it('rejects traversal, authoritative destinations and existing files', () => withFixture((root) => {
    checkNothingWritten(root, () => executeAdopt(args.map((v) => v === 'out.json' ? '../escape.json' : v), root), 'output-traversal')
    expect(() => executeAdopt(args.map((v) => v === 'out.json' ? 'catalog/identity-lock.json' : v), root)).toThrow('output-unauthorized')
    writeFileSync(join(root, 'out.json'), 'existing')
    expect(() => executeAdopt(args, root)).toThrow('output-exists')
    expect(readFileSync(join(root, 'out.json'), 'utf8')).toBe('existing')
  }))

  it('rejects symlink output and symlink candidate without writing', () => withFixture((root) => {
    symlinkSync(join(root, 'candidate.json'), join(root, 'out.json'))
    expect(() => executeAdopt(args, root)).toThrow('output-symlink')
    rmSync(join(root, 'out.json'))
    const source = readFileSync(join(root, 'candidate.json'), 'utf8')
    writeFileSync(join(root, 'original.json'), source)
    rmSync(join(root, 'candidate.json'))
    symlinkSync(join(root, 'original.json'), join(root, 'candidate.json'))
    expect(() => executeAdopt(args, root)).toThrow('candidate-invalid')
    expect(existsSync(join(root, 'out.json'))).toBe(false)
  }))
})
