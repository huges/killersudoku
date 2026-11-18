/**
 * M2-4G acceptance-evidence regression tests for the approved v2 contract.
 * All mutations are confined to disposable directories under the OS temp dir.
 * These are not operator authorization or evidence of real-data provenance.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { partialPuzzle } from '../src/domain/fixtures'
import { createEmptyRegistry } from '../src/domain/registry'
import { execute } from '../scripts/migration-command'
import { executeAdopt } from '../scripts/adopt-command'

const cli = [
  '--candidate', 'candidate.json', '--input', 'input.json',
  '--registry', 'registry.json', '--history', 'history.json',
  '--output', 'out.json', '--confirm',
]

// Mandatory known M2-1 assets; the fixture also copies every other file under
// the authoritative catalog tree, including any future fixtures and results.
const catalogAssets = [
  'catalog/identity-lock.json',
  'catalog/fixtures/inputs.json',
  'catalog/fixtures/manifest.json',
  'catalog/results/catalog-result.json',
]

function createFixture(visit: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'mozart-m2-4g-evidence-'))
  try {
    const record = {
      recordKey: { source: 'legacy', key: 'k-1' },
      puzzle: structuredClone(partialPuzzle),
      publicId: 'puzzle-000001',
      aliases: [], versions: { schema: '1.0' }, references: [],
    }
    writeFileSync(join(root, 'input.json'), JSON.stringify([record]))
    writeFileSync(join(root, 'registry.json'), JSON.stringify(createEmptyRegistry()))
    writeFileSync(join(root, 'history.json'), '[]')
    // Separate reference-data sentinel; references embedded in input/history
    // are also protected through hashes of those original source files.
    writeFileSync(join(root, 'references.json'), JSON.stringify({ references: [] }))
    for (const asset of catalogAssets) {
      const source = resolve(process.cwd(), asset)
      expect(existsSync(source), `Authoritative repository asset missing: ${asset}`).toBe(true)
    }
    const catalogRoot = resolve(process.cwd(), 'catalog')
    function copyCatalog(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const source = join(directory, entry.name)
        const target = join(root, relative(process.cwd(), source))
        if (entry.isDirectory()) { copyCatalog(source); continue }
        expect(entry.isFile(), `Unexpected catalog entry (symlink/other): ${source}`).toBe(true)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(source, target)
      }
    }
    copyCatalog(catalogRoot)
    execute(['migrate', '--input', 'input.json', '--output', 'candidate.json'], root)
    visit(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function digest(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

// Snapshot every regular file, including the complete copied catalog tree;
// this prevents a test from accidentally omitting a protected path from a list.
function snapshot(root: string): Record<string, { bytes: number; sha256: string }> {
  const found: Record<string, { bytes: number; sha256: string }> = {}
  function visit(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      const stat = lstatSync(path)
      if (stat.isDirectory()) { visit(path); continue }
      expect(stat.isFile(), `Unexpected non-regular fixture entry: ${path}`).toBe(true)
      const bytes = readFileSync(path)
      found[relative(root, path).replaceAll('\\', '/')] = {
        bytes: bytes.length, sha256: digest(bytes),
      }
    }
  }
  visit(root)
  return found
}

function assertFailureWithoutMutation(root: string, args: string[], code: string): void {
  const before = snapshot(root)
  expect(() => executeAdopt(args, root)).toThrow(code)
  expect(snapshot(root)).toEqual(before)
  expect(existsSync(join(root, 'out.json'))).toBe(false)
  expect(readdirSync(root).some((item) => item.startsWith('.mozart-migration-'))).toBe(false)
}

function without(flag: string): string[] {
  const index = cli.indexOf(flag)
  expect(index).toBeGreaterThanOrEqual(0)
  return [...cli.slice(0, index), ...cli.slice(index + (flag === '--confirm' ? 1 : 2))]
}

describe('M2-4G v2 independent acceptance evidence', () => {
  it('rejects each missing mandatory CLI argument, without writing any protected file', () => createFixture((root) => {
    const missing = [
      ['--candidate', 'candidate-missing'],
      ['--input', 'candidate-reverify-failed'],
      ['--registry', 'candidate-reverify-failed'],
      ['--history', 'candidate-reverify-failed'],
      ['--output', 'output-missing'],
      ['--confirm', 'confirm-missing'],
    ] as const
    for (const [flag, code] of missing) assertFailureWithoutMutation(root, without(flag), code)
  }))

  it('rejects duplicate, unknown and misplaced flags before publishing', () => createFixture((root) => {
    const invalid = [
      [...cli, '--candidate', 'candidate.json'],
      [...cli, '--input', 'input.json'],
      [...cli, '--registry', 'registry.json'],
      [...cli, '--history', 'history.json'],
      [...cli, '--output', 'out.json'],
      [...cli, '--confirm'],
      [...cli, '--unknown', 'value'],
      [...cli, 'positional'],
      ['--candidate', '--input', ...cli.slice(2)],
    ]
    for (const attempt of invalid) assertFailureWithoutMutation(root, attempt, 'candidate-invalid')
  }))

  it('rejects an actual persisted verify report as well as a forged verify command', () => createFixture((root) => {
    const verified = execute(['verify', '--input', 'input.json', '--output', 'verify.json'], root)
    const document = JSON.parse(verified) as { command: string; candidate: unknown[] }
    expect(document.command).toBe('verify')
    expect(document.candidate).toEqual([])
    assertFailureWithoutMutation(root, cli.map((value) => value === 'candidate.json' ? 'verify.json' : value), 'candidate-invalid')
    const path = join(root, 'candidate.json')
    const forged = JSON.parse(readFileSync(path, 'utf8')) as { command: string }
    forged.command = 'verify'
    writeFileSync(path, JSON.stringify(forged))
    assertFailureWithoutMutation(root, cli, 'candidate-invalid')
  }))

  it('adds exactly one authorized output and preserves source/catalog/reference bytes', () => createFixture((root) => {
    const before = snapshot(root)
    expect(Object.keys(before)).toContain('catalog/identity-lock.json')
    expect(Object.keys(before)).toContain('catalog/fixtures/inputs.json')
    expect(Object.keys(before)).toContain('catalog/fixtures/manifest.json')
    expect(Object.keys(before)).toContain('catalog/results/catalog-result.json')
    expect(Object.keys(before)).toContain('references.json')
    const text = executeAdopt(cli, root)
    const after = snapshot(root)
    expect(Object.keys(after).filter((path) => !Object.hasOwn(before, path))).toEqual(['out.json'])
    for (const [path, evidence] of Object.entries(before)) expect(after[path]).toEqual(evidence)
    expect(after['out.json']).toEqual({
      bytes: Buffer.byteLength(text), sha256: digest(Buffer.from(text)),
    })
    expect(readFileSync(join(root, 'out.json'), 'utf8')).toBe(text)
    expect(readdirSync(root).some((item) => item.startsWith('.mozart-migration-'))).toBe(false)
  }))

  it('preserves every protected byte on invalid source, tampered report, and unauthorized output', () => createFixture((root) => {
    const registryPath = join(root, 'registry.json')
    const originalRegistry = readFileSync(registryPath)
    const registry = createEmptyRegistry()
    registry.reservedIds.push('puzzle-000001')
    writeFileSync(registryPath, JSON.stringify(registry))
    assertFailureWithoutMutation(root, cli, 'id-integrity-violation')
    writeFileSync(registryPath, originalRegistry)

    const candidatePath = join(root, 'candidate.json')
    const originalCandidate = readFileSync(candidatePath)
    const altered = JSON.parse(originalCandidate.toString()) as { diff: unknown[] }
    altered.diff = [{ unverified: true }]
    writeFileSync(candidatePath, JSON.stringify(altered))
    assertFailureWithoutMutation(root, cli, 'candidate-reverify-failed')
    writeFileSync(candidatePath, originalCandidate)

    assertFailureWithoutMutation(root,
      cli.map((value) => value === 'out.json' ? '../outside.json' : value),
      'output-traversal')
    assertFailureWithoutMutation(root,
      cli.map((value) => value === 'out.json' ? 'catalog/fixtures/new.json' : value),
      'output-unauthorized')
  }))
})
