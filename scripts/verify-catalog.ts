import { readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { compareReference, verifyCatalog, type CatalogVerificationResult } from '../src/domain/catalogPipeline'

type Manifest = { formatVersion: string; sampleVersion: string; generatorVersion: string; seed: string; parameters: Record<string, unknown>; inputs: string[]; expectedResult: string; identityLock: string }

const root = resolve(process.cwd())
const fail = (message: string): never => { throw new Error(message) }
const readText = (path: string): string => readFileSync(path, 'utf8')
const readJson = (path: string): unknown => { try { return JSON.parse(readText(path)) } catch { fail(`manifest|${relative(root, path)}|invalid JSON`) } }
const normalizedPath = (path: string): string => path.split(sep).join('/')

function assertManifest(manifest: unknown): asserts manifest is Manifest {
  if (typeof manifest !== 'object' || manifest === null) fail('manifest|manifest.json|must be an object')
  const value = manifest as Record<string, unknown>
  const paths = ['inputs', 'expectedResult', 'identityLock']
  if (!['formatVersion', 'sampleVersion', 'generatorVersion', 'seed', 'parameters', ...paths].every((key) => key in value)) fail('manifest|manifest.json|missing required field')
  if (typeof value.formatVersion !== 'string' || typeof value.sampleVersion !== 'string' || typeof value.generatorVersion !== 'string' || typeof value.seed !== 'string' || typeof value.parameters !== 'object' || value.parameters === null || !Array.isArray(value.inputs) || value.inputs.some((item) => typeof item !== 'string') || typeof value.expectedResult !== 'string' || typeof value.identityLock !== 'string') fail('manifest|manifest.json|invalid field')
  if (value.inputs.length === 0 || [...value.inputs].sort().some((item, index) => item !== value.inputs[index]) || new Set(value.inputs).size !== value.inputs.length) fail('manifest|inputs|must be non-empty, unique and deterministically ordered')
}

function withinCatalog(path: string): boolean {
  const catalogRoot = resolve(root, 'catalog')
  const candidate = resolve(root, path)
  return candidate === catalogRoot || candidate.startsWith(`${catalogRoot}/`)
}

function main(): void {
  const manifestPath = resolve(root, 'catalog/fixtures/manifest.json')
  const manifest = readJson(manifestPath)
  assertManifest(manifest)
  const declared = [...manifest.inputs, manifest.expectedResult, manifest.identityLock]
  for (const item of declared) {
    if (item.startsWith('/') || !withinCatalog(item) || item.includes('..')) fail(`manifest|${item}|path outside catalog root`)
  }
  const inputs = manifest.inputs.map((item) => readJson(resolve(root, item)))
  const puzzles = inputs.flatMap((item) => Array.isArray(item) ? item : [item])
  const identity = readJson(resolve(root, manifest.identityLock))
  if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) fail(`identity|${manifest.identityLock}|must be an object`)
  const actual = verifyCatalog(puzzles, { formatVersion: manifest.formatVersion, sampleVersion: manifest.sampleVersion, identity: identity as Record<string, string> })
  const expectedText = readText(resolve(root, manifest.expectedResult))
  const expected = readJson(resolve(root, manifest.expectedResult)) as CatalogVerificationResult
  const comparison = compareReference(actual, expected)
  const actualText = `${JSON.stringify(actual)}\n`
  if (!comparison.equal || actualText !== expectedText) fail(`reference|${manifest.expectedResult}|byte-for-byte mismatch`)
  const identityEntries = Object.entries(identity as Record<string, string>)
  for (const [id, fingerprint] of identityEntries) {
    if (!/^sha256-[0-9a-f]{64}$/.test(fingerprint)) fail(`identity|${id}|fingerprint must be a SHA-256 digest`)
  }
  for (const record of actual.puzzles) {
    if (record.structural === 'valid' && record.fingerprint && !identityEntries.some(([id, fingerprint]) => id === record.puzzleId && fingerprint === record.fingerprint)) fail(`identity|${record.puzzleId}|missing verified fingerprint`)
  }
  if (actual.errors.length > 0) fail(actual.errors[0])
}

try { main() } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
