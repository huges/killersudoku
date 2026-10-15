import { readFileSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCatalog } from '../src/domain/catalogPipeline'

export type Manifest = {
  formatVersion: string; sampleVersion: string; generatorVersion: string
  seed: string; parameters: Record<string, unknown>; inputs: string[]
  expectedResult: string; identityLock: string; negativeFixtures: string[]; maxNodes: number
}
const fail = (message: string): never => { throw new Error(message) }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fail(`file|${path}|missing or invalid JSON`) }
}
export function catalogPath(root: string, path: string): string {
  if (typeof path !== 'string' || isAbsolute(path) || path.includes('\\') || path.split('/').some(p => p === '..' || p === '.' || p === '')) fail('manifest|path|invalid relative path')
  const catalog = realpathSync(resolve(root, 'catalog'))
  const target = realpathSync(resolve(root, path))
  const rel = relative(catalog, target)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) fail(`manifest|${path}|path outside catalog root`)
  return target
}
export function loadSample(root: string) {
  const raw = readJson(catalogPath(root, 'catalog/fixtures/manifest.json'))
  const keys = ['formatVersion', 'sampleVersion', 'generatorVersion', 'seed', 'parameters', 'inputs', 'expectedResult', 'identityLock', 'negativeFixtures', 'maxNodes']
  if (!object(raw) || Object.keys(raw).length !== keys.length || keys.some(k => !Object.hasOwn(raw, k))) fail('manifest|schema|invalid fields')
  const m = raw as unknown as Manifest
  if ([m.formatVersion, m.sampleVersion, m.generatorVersion, m.seed, m.expectedResult, m.identityLock].some(v => typeof v !== 'string' || !v) || m.formatVersion !== '1' || !object(m.parameters) || !Number.isSafeInteger(m.maxNodes) || m.maxNodes <= 0) fail('manifest|schema|invalid values')
  for (const paths of [m.inputs, m.negativeFixtures]) {
    if (!Array.isArray(paths) || paths.some(v => typeof v !== 'string') || new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify([...paths].sort())) fail('manifest|paths|must be unique and ordered')
  }
  if (!m.inputs.length) fail('manifest|inputs|empty sample')
  const declared = [...m.inputs, ...m.negativeFixtures, m.expectedResult, m.identityLock]
  if (new Set(declared).size !== declared.length) fail('manifest|paths|roles must be distinct')
  for (const path of declared) catalogPath(root, path)
  const puzzles = m.inputs.flatMap(path => { const value = readJson(catalogPath(root, path)); return Array.isArray(value) ? value : [value] })
  const identity = readJson(catalogPath(root, m.identityLock))
  if (!object(identity) || Object.values(identity).some(v => typeof v !== 'string' || !/^sha256-[0-9a-f]{64}$/.test(v))) fail('identity|schema|invalid SHA-256 register')
  return { manifest: m, puzzles, identity: identity as Record<string, string> }
}
export function calculateSample(root: string, requireRegistered = true) {
  const { manifest, puzzles, identity } = loadSample(root)
  const result = verifyCatalog(puzzles, { formatVersion: manifest.formatVersion, sampleVersion: manifest.sampleVersion, maxNodes: manifest.maxNodes, identity })
  if (result.errors.length) fail(result.errors.join('\n'))
  if (requireRegistered) for (const record of result.puzzles) {
    if (!Object.hasOwn(identity, record.puzzleId) || identity[record.puzzleId] !== record.fingerprint) fail(`identity|${record.puzzleId}|missing verified fingerprint`)
  }
  return { manifest, identity, result }
}
export function verifySample(root: string): string {
  const { manifest, result } = calculateSample(root)
  const actual = `${JSON.stringify(result)}\n`
  const expected = readFileSync(catalogPath(root, manifest.expectedResult), 'utf8')
  // Exact current format, ordering and content: parsed-but-malformed references also fail.
  if (actual !== expected) fail(`reference|${manifest.expectedResult}|byte-for-byte mismatch`)
  return actual
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(verifySample(process.cwd())) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
