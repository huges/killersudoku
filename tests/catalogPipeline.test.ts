import { afterEach, describe, expect, it, vi } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'
import { canonicalizePuzzle, compareReference, fingerprintPuzzle, verifyCatalog } from '../src/domain/catalogPipeline'
import { validatePuzzle } from '../src/domain/validation'
import { type PuzzleDefinition } from '../src/domain/types'
import * as solver from '../src/domain/solver'
import { loadSample, verifySample } from '../scripts/verify-catalog'
import { fixtureSet, OUTPUTS } from '../scripts/generate-catalog-fixtures'

const root = process.cwd()
const clone = <T>(v: T): T => structuredClone(v)
const fixture = (name: string): PuzzleDefinition => JSON.parse(readFileSync(resolve(root, `catalog/fixtures/negative/${name}.json`), 'utf8'))
const temps: string[] = []
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-test-')); temps.push(dir)
  cpSync(resolve(root, 'catalog'), join(dir, 'catalog'), { recursive: true })
  return dir
}
function cli(name: string, cwd: string, args: string[] = []) {
  return spawnSync(process.execPath, ['--import', resolve(root, 'node_modules/tsx/dist/loader.mjs'), resolve(root, `scripts/${name}.ts`), ...args], { cwd, encoding: 'utf8' })
}
function snapshots(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => {
    const path = join(e.parentPath, e.name)
    return [relative(dir, path), readFileSync(path).toString('hex')]
  }))
}
afterEach(() => { vi.restoreAllMocks(); for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('offline catalog pipeline', () => {
  it('reuses domain validation, solves a partial sample, and excludes solutions from output', () => {
    const p = clone(partialPuzzle); const before = clone(p)
    const result = verifyCatalog([p])
    expect(result.errors).toEqual([])
    expect(result.puzzles[0].solver).toMatchObject({ status: 'unique', count: 1, complete: true })
    expect(result.puzzles[0]).not.toHaveProperty('solution')
    expect(p).toEqual(before)
    expect(result).toEqual(verifyCatalog([p]))
  })
  it('rejects original noncanonical cells before sorting or invoking the solver', () => {
    const p = fixture('multiple-solutions'); p.cages[0].cells.reverse()
    const before = clone(p); const spy = vi.spyOn(solver, 'solve')
    expect(verifyCatalog([p]).errors.join()).toMatch(/canonical/)
    expect(() => canonicalizePuzzle(p)).toThrow(/canonical/)
    expect(spy).not.toHaveBeenCalled(); expect(p).toEqual(before)
  })
  it.each(['structurally-invalid', 'derived-field'])('rejects %s without invoking the solver', name => {
    const spy = vi.spyOn(solver, 'solve')
    expect(verifyCatalog([fixture(name)]).errors.length).toBeGreaterThan(0)
    expect(spy).not.toHaveBeenCalled()
  })
  it.each([['unsatisfiable', 'unsatisfiable'], ['multiple-solutions', 'multiple']])('executes the real solver for %s', (name, status) => {
    const p = fixture(name); validatePuzzle(p)
    const r = verifyCatalog([p])
    expect(r.puzzles[0].structural).toBe('valid')
    expect(r.puzzles[0].solver.status).toBe(status)
    expect(r.errors.join()).toContain(status)
  })
  it('rejects incomplete search with zero or one discovered solution', () => {
    for (const maxNodes of [1, 4]) {
      const r = verifyCatalog([fixture('multiple-solutions')], { maxNodes })
      expect(r.puzzles[0].solver).toMatchObject({ status: 'incomplete', complete: false })
      expect(r.errors.join()).toContain('incomplete')
    }
  })
  it('preserves domain namespaces, allowing equal puzzle/cage IDs and cage IDs across puzzles', () => {
    const a = clone(solvedPuzzle); a.puzzleId = a.cages[0].id
    const b = clone(solvedPuzzle); b.puzzleId = 'second'
    expect(verifyCatalog([a, b]).errors).toEqual([])
    b.cages[1].id = b.cages[0].id
    expect(verifyCatalog([b]).errors.join()).toMatch(/cage/)
  })
  it('rejects duplicate puzzle IDs, empty samples and invalid search options', () => {
    expect(verifyCatalog([solvedPuzzle, solvedPuzzle]).errors.join()).toMatch(/duplicate/)
    expect(verifyCatalog([]).errors.join()).toMatch(/empty/)
    expect(() => verifyCatalog([solvedPuzzle], { maxNodes: 0 })).toThrow()
  })
  it('hashes complete canonical content, sorts independently of locale and rejects identity changes', () => {
    const p = clone(partialPuzzle); const changed = clone(p); changed.givens[0][0] = null
    const hash = fingerprintPuzzle(canonicalizePuzzle(p))
    expect(hash).toMatch(/^sha256-[0-9a-f]{64}$/)
    expect(fingerprintPuzzle(canonicalizePuzzle(changed))).not.toBe(hash)
    expect(verifyCatalog([changed], { identity: { [p.puzzleId]: hash } }).errors.join()).toMatch(/historical/)
    const reversed = clone(p); reversed.cages.reverse()
    expect(canonicalizePuzzle(reversed)).toBe(canonicalizePuzzle(p))
    const other = clone(p); other.puzzleId = 'A'
    expect(verifyCatalog([p, other])).toEqual(verifyCatalog([other, p]))
  })
  it('checks returned solutions against shared game verification', () => {
    vi.spyOn(solver, 'solve').mockReturnValue({ status: 'unique', count: 1, complete: true, nodes: 1, solution: Array.from({ length: 9 }, () => Array<number>(9).fill(1)) })
    expect(verifyCatalog([partialPuzzle]).errors.length).toBeGreaterThan(0)
  })
  it('compares references exactly', () => {
    const r = verifyCatalog([partialPuzzle])
    expect(compareReference(r, clone(r)).equal).toBe(true)
    expect(compareReference(r, { ...r, sampleVersion: 'stale' }).equal).toBe(false)
  })
  it('runs the real CLI twice with identical output and no writes', () => {
    const dir = sandbox(); const before = snapshots(dir)
    const a = cli('verify-catalog', dir); const b = cli('verify-catalog', dir)
    expect(a.status, a.stderr).toBe(0); expect(b.status, b.stderr).toBe(0)
    expect(a.stdout).toBe(b.stdout)
    expect(a.stdout).toBe(readFileSync(join(dir, 'catalog/results/catalog-result.json'), 'utf8'))
    expect(snapshots(dir)).toEqual(before)
  })
  it.each(['missing', 'malformed', 'stale', 'noncanonical'])('CLI rejects %s reference', mode => {
    const dir = sandbox(); const path = join(dir, 'catalog/results/catalog-result.json')
    if (mode === 'missing') rmSync(path)
    else writeFileSync(path, mode === 'malformed' ? '{' : mode === 'stale' ? '{}\n' : readFileSync(path, 'utf8') + '\n')
    expect(cli('verify-catalog', dir).status).not.toBe(0)
  })
  it.each(['unsatisfiable', 'multiple-solutions', 'structurally-invalid', 'derived-field'])('CLI refuses %s before reference acceptance', name => {
    const dir = sandbox()
    writeFileSync(join(dir, 'catalog/fixtures/inputs.json'), JSON.stringify([fixture(name)]))
    const r = cli('verify-catalog', dir)
    expect(r.status).not.toBe(0); expect(r.stderr.length).toBeGreaterThan(0)
  })
  it('CLI rejects duplicate and reused IDs and missing or malformed identity entries', () => {
    for (const mode of ['duplicate', 'reused', 'missing', 'malformed']) {
      const dir = sandbox(); const path = join(dir, 'catalog/fixtures/inputs.json')
      const puzzles = JSON.parse(readFileSync(path, 'utf8')) as PuzzleDefinition[]
      if (mode === 'duplicate') puzzles.push(clone(puzzles[0]))
      if (mode === 'reused') puzzles[0].givens[0][0] = null
      if (mode === 'missing' || mode === 'malformed') writeFileSync(join(dir, 'catalog/identity-lock.json'), mode === 'missing' ? '{}' : '{"id":1}')
      writeFileSync(path, JSON.stringify(puzzles))
      expect(cli('verify-catalog', dir).status, mode).not.toBe(0)
    }
  })
  it('rejects traversal, symlink escape, duplicate paths and unknown manifest keys', () => {
    for (const mode of ['traversal', 'symlink', 'duplicate', 'extra']) {
      const dir = sandbox(); const path = join(dir, 'catalog/fixtures/manifest.json')
      const m = JSON.parse(readFileSync(path, 'utf8'))
      if (mode === 'traversal') m.inputs = ['../outside.json']
      if (mode === 'symlink') { writeFileSync(join(dir, 'outside.json'), '{}'); symlinkSync(join(dir, 'outside.json'), join(dir, 'catalog/escape.json')); m.inputs = ['catalog/escape.json'] }
      if (mode === 'duplicate') m.inputs.push(m.inputs[0])
      if (mode === 'extra') m.extra = true
      writeFileSync(path, JSON.stringify(m))
      expect(() => loadSample(dir)).toThrow()
    }
  })
  it('creates reference candidates exclusively without replacing authoritative files', () => {
    const dir = sandbox(); const before = snapshots(dir); const out = join(dir, 'reference-candidate.json')
    expect(cli('update-catalog-reference', dir, ['--output', out]).status).toBe(0)
    expect(cli('update-catalog-reference', dir, ['--output', out]).status).not.toBe(0)
    expect(cli('update-catalog-reference', dir, ['--output', 'catalog/identity-lock.json']).status).not.toBe(0)
    rmSync(out); expect(snapshots(dir)).toEqual(before)
  })
  it('identity registration retains history and rejects mismatches even in a separate candidate', () => {
    const dir = sandbox(); const path = join(dir, 'catalog/identity-lock.json')
    const history = JSON.parse(readFileSync(path, 'utf8')); history.retired = `sha256-${'0'.repeat(64)}`
    writeFileSync(path, JSON.stringify(history)); const out = join(dir, 'identity-candidate.json')
    expect(cli('register-catalog-identities', dir, ['--output', out]).status).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(history)
    rmSync(out)
    history['fixture-partial'] = `sha256-${'1'.repeat(64)}`; writeFileSync(path, JSON.stringify(history))
    expect(cli('register-catalog-identities', dir, ['--output', out]).status).not.toBe(0)
  })
  it('generates exactly declared fixtures reproducibly, with explicit seed/parameters and no overwrites', () => {
    const m = loadSample(root).manifest
    const data = fixtureSet(m.seed, m.generatorVersion, 'technical-v1')
    expect(Object.keys(data)).toEqual([...OUTPUTS])
    expect(data).toEqual(fixtureSet(m.seed, m.generatorVersion, 'technical-v1'))
    expect(data['inputs.json']).not.toEqual(fixtureSet(m.seed + 'a', m.generatorVersion, 'technical-v1')['inputs.json'])
    for (const path of OUTPUTS) expect(JSON.parse(readFileSync(resolve(root, 'catalog/fixtures', path), 'utf8'))).toEqual(data[path])
    expect(() => fixtureSet(m.seed, 'unknown', 'technical-v1')).toThrow()
    const dir = sandbox(); const before = snapshots(dir); const out = join(dir, 'generated')
    expect(cli('generate-catalog-fixtures', dir, [out, m.seed, '1', 'technical-v1']).status).toBe(0)
    expect(cli('generate-catalog-fixtures', dir, [out, m.seed, '1', 'technical-v1']).status).not.toBe(0)
    rmSync(out, { recursive: true }); expect(snapshots(dir)).toEqual(before)
  })
  it('a failed catalog check stops the actual npm build before typecheck or Vite', () => {
    const dir = sandbox()
    cpSync(resolve(root, 'package.json'), join(dir, 'package.json'))
    cpSync(resolve(root, 'scripts'), join(dir, 'scripts'), { recursive: true })
    cpSync(resolve(root, 'src'), join(dir, 'src'), { recursive: true })
    symlinkSync(resolve(root, 'node_modules'), join(dir, 'node_modules'))
    writeFileSync(join(dir, 'catalog/results/catalog-result.json'), '{}')
    const r = spawnSync('npm', ['run', 'build'], { cwd: dir, encoding: 'utf8' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('byte-for-byte mismatch')
    expect(r.stdout).not.toContain('> tsc --project')
    expect(r.stdout).not.toContain('building for production')
  })
  it('executes the versioned negative scenarios through verify:catalog', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'catalog/fixtures/manifest.json'), 'utf8'))
    expect(manifest.negativeFixtures).toEqual(expect.arrayContaining([
      'catalog/fixtures/negative/scenario-duplicate-id.json',
      'catalog/fixtures/negative/scenario-reused-id.json',
      'catalog/fixtures/negative/scenario-incomplete-search.json',
    ]))
    expect(() => verifySample(root)).not.toThrow()
  })

  it('rejects malformed versioned scenario descriptors before using their fields', () => {
    const dir = sandbox()
    const descriptor = join(dir, 'catalog/fixtures/negative/scenario-incomplete-search.json')
    writeFileSync(descriptor, JSON.stringify({
      formatVersion: '1', scenario: 'malformed', source: 'catalog/fixtures/negative/multiple-solutions.json',
      transform: 'none', expected: { control: 'solver', cause: 'incomplete' }, options: { maxNodes: 0 },
    }))
    const result = cli('verify-catalog', dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('invalid scenario descriptor')
  })

  it('enforces verification from the npm test/build commands used by governed validation', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(pkg.scripts.test).toContain('&& npm run verify:catalog')
    expect(pkg.scripts.build.startsWith('npm run verify:catalog &&')).toBe(true)
    expect(() => verifySample(root)).not.toThrow()
  })
})
