/**
 * M2-4G operator adoption of a verified M2-4F result into ONE new file.
 * All independent source evidence must be supplied by the operator.
 * Read/write primitives remain owned by the M2-4F migration command.
 */
import { lstatSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execute, readJson, writeExclusive } from './migration-command'
import { stableMigrationJson, type MigrationCommand, type MigrationResult } from '../src/domain/migrationPipeline'

type AdoptErrorCode =
  | 'confirm-missing' | 'candidate-missing' | 'candidate-invalid'
  | 'output-missing' | 'output-unauthorized' | 'output-exists'
  | 'output-traversal' | 'output-symlink' | 'candidate-reverify-failed'
  | 'collision-or-ambiguity' | 'id-integrity-violation'
  | 'reference-integrity-violation'

const usage = 'adopt|arguments|usage: adopt --candidate FILE --input FILE --registry FILE --history FILE --output FILE --confirm'
const flags = new Set(['--candidate', '--input', '--registry', '--history', '--output'])
const adoptable = new Set<MigrationCommand>(['migrate', 'generate-catalog', 'generate-identities', 'generate-references'])
// This is an additive publication policy. The source files are independently
// checked below, while the descriptor-based M2-4F writer owns the atomic link.
const authoritative = new Set([
  '.git', '.github', 'catalog', 'docs', 'scripts', 'src', 'tests',
  'public', 'dist', 'node_modules', '.env', '.gitignore', '.nvmrc',
  'README.md', 'package.json', 'package-lock.json',
  'mozart-preparation.json', 'mozart-software.json',
  'tsconfig.app.json', 'tsconfig.node.json',
  'vite.config.ts', 'vitest.config.ts', 'eslint.config.js', 'index.html',
])

export class AdoptError extends Error {
  constructor(public readonly code: AdoptErrorCode, message: string) { super(`${code}|${message}`) }
}

function rawPath(path: string, kind: 'output' | 'input'): void {
  if (!path || path.includes('\0') || path.includes('\\') || isAbsolute(path)
    || /^[A-Za-z]:/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new AdoptError(kind === 'output' ? 'output-traversal' : 'candidate-invalid',
      `adopt|${kind}|unauthorized path`)
  }
}

function outputTarget(root: string, path: string): string {
  rawPath(path, 'output')
  const target = resolve(root, path)
  const relativePath = relative(root, target)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)) throw new AdoptError('output-unauthorized', 'adopt|output|outside root')
  if (authoritative.has(relativePath.split(sep)[0])) {
    throw new AdoptError('output-unauthorized', 'adopt|output|authoritative location')
  }
  let part = root
  const segments = relativePath.split(sep)
  for (const segment of segments) {
    part = resolve(part, segment)
    try {
      const metadata = lstatSync(part)
      if (metadata.isSymbolicLink()) throw new AdoptError('output-symlink', 'adopt|output|symlink component')
      if (part === target) throw new AdoptError('output-exists', 'adopt|output|destination exists')
      if (!metadata.isDirectory()) throw new AdoptError('output-unauthorized', 'adopt|output|non-directory parent')
    } catch (error) {
      if (error instanceof AdoptError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && part === target) break
      throw new AdoptError('output-unauthorized', 'adopt|output|invalid parent or destination')
    }
  }
  return target
}

function migrationResult(value: unknown): value is MigrationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  return Object.keys(raw).length === 5
    && ['command', 'records', 'candidate', 'diff', 'diagnostics'].every((key) => Object.hasOwn(raw, key))
    && typeof raw.command === 'string' && Array.isArray(raw.records)
    && Array.isArray(raw.candidate) && Array.isArray(raw.diff) && Array.isArray(raw.diagnostics)
}

function diagnosticCode(value: unknown): string {
  return value && typeof value === 'object' && 'code' in value
    && typeof value.code === 'string' ? value.code : 'invalid-diagnostic'
}

function assertAdoptable(result: MigrationResult): void {
  const codes = result.diagnostics.map(diagnosticCode)
  const outcomes = result.records.map((record) => record && typeof record === 'object' ? record.outcome : 'error')
  if (outcomes.includes('ambiguous') || outcomes.includes('collision') || codes.some((code) => /ambigu|collision|conflict/.test(code))) {
    throw new AdoptError('collision-or-ambiguity', 'adopt|reverify|unresolved collision or ambiguity')
  }
  if (codes.some((code) => /reference/.test(code))) {
    throw new AdoptError('reference-integrity-violation', 'adopt|reverify|reference integrity')
  }
  if (codes.some((code) => /id|registry|fingerprint|alias/.test(code))) {
    throw new AdoptError('id-integrity-violation', 'adopt|reverify|identity integrity')
  }
  if (codes.length || outcomes.includes('error') || result.candidate.length === 0) {
    throw new AdoptError('candidate-reverify-failed', 'adopt|reverify|missing verified candidate or failed report')
  }
  if (result.command === 'generate-identities') {
    if (!result.diff.some((entry) => entry !== null && typeof entry === 'object'
        && 'registry' in entry && entry.registry !== null)) {
      throw new AdoptError('id-integrity-violation', 'adopt|reverify|missing proposed Registry')
    }
  } else {
    // M2-4G may not publish candidates lacking a public identity. Identity
    // generation instead carries assigned IDs in the verified Registry diff.
    for (const record of result.candidate) {
      if (!record || typeof record !== 'object' || !('publicId' in record)
        || typeof record.publicId !== 'string' || !record.publicId) {
        throw new AdoptError('id-integrity-violation', 'adopt|reverify|missing public ID')
      }
    }
  }
}

function fingerprintRoles(root: string, paths: string[]): void {
  const identities = new Set<string>()
  for (const path of paths) {
    rawPath(path, 'input')
    // readJson in migration-command does descriptor-anchored, no-follow opens.
    // This precheck is ONLY for role aliasing; it does not replace that reader.
    let metadata: ReturnType<typeof lstatSync>
    try { metadata = lstatSync(resolve(root, path)) }
    catch { throw new AdoptError('candidate-invalid', 'adopt|sources|file not found') }
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new AdoptError('candidate-invalid', 'adopt|sources|not a regular file')
    const identity = `${metadata.dev}:${metadata.ino}`
    if (identities.has(identity)) throw new AdoptError('candidate-reverify-failed', 'adopt|sources|same physical source for different roles')
    identities.add(identity)
  }
}

function assertHistoricalClassification(result: MigrationResult): void {
  const codes = result.diagnostics.map(diagnosticCode)
  if (codes.some((code) => /reference/.test(code))) {
    throw new AdoptError('reference-integrity-violation', 'adopt|reverify|historical references not verified')
  }
  if (codes.some((code) => /id|registry|fingerprint|alias/.test(code))) {
    throw new AdoptError('id-integrity-violation', 'adopt|reverify|historical identity not verified')
  }
  if (result.records.some((record) => record.outcome === 'ambiguous' || record.outcome === 'collision')
    || codes.some((code) => /ambigu|collision|conflict/.test(code))) {
    throw new AdoptError('collision-or-ambiguity', 'adopt|reverify|historical collision or ambiguity')
  }
  if (codes.length || result.records.some((record) => record.outcome === 'error')) {
    throw new AdoptError('candidate-reverify-failed', 'adopt|reverify|historical classification failed')
  }
}

function assertPublicIds(result: MigrationResult, registryValue: unknown, classified: MigrationResult): void {
  if (result.command === 'generate-identities') return // Existing assignIncremental handles the proposed Registry.
  if (!registryValue || typeof registryValue !== 'object' || Array.isArray(registryValue)) {
    throw new AdoptError('id-integrity-violation', 'adopt|registry|invalid Registry')
  }
  const registry = registryValue as Record<string, unknown>
  // The classification replay validates the full Registry structure. This
  // additional check enforces that an explicitly adopted ID is not reserved or
  // already owned by a DIFFERENT, non-equivalent historical identity.
  if (!Array.isArray(registry.identities) || !Array.isArray(registry.associations)
    || !Array.isArray(registry.reservedIds)) {
    throw new AdoptError('id-integrity-violation', 'adopt|registry|Registry collections missing')
  }
  const reserved = new Set(registry.reservedIds)
  const seen = new Map<string, string>()
  const key = (recordKey: unknown): string => JSON.stringify(recordKey)
  for (const candidate of result.candidate) {
    if (!candidate || typeof candidate !== 'object' || !('publicId' in candidate)
      || typeof candidate.publicId !== 'string' || !candidate.publicId) {
      throw new AdoptError('id-integrity-violation', 'adopt|candidate|missing public ID')
    }
    const publicId = candidate.publicId
    const recordKey = key(candidate.recordKey)
    if (reserved.has(publicId)) throw new AdoptError('id-integrity-violation', 'adopt|candidate|reserved ID')
    if (result.command !== 'generate-references' && seen.has(publicId)
      && seen.get(publicId) !== recordKey) {
      throw new AdoptError('id-integrity-violation', 'adopt|candidate|duplicated public ID')
    }
    seen.set(publicId, recordKey)
    const owners = (registry.identities as { publicId: string }[]).filter((item) =>
      item && item.publicId === publicId)
    if (!owners.length) continue
    // A recorded ID can be reused only if the authoritative D4 classifier
    // attests the candidate is equivalent to that historical public identity.
    const observation = classified.records.find((item) => key(item.recordKey) === recordKey)
    const matches = observation?.duplicate?.matches ?? []
    const association = observation?.duplicate?.registeredAssociation
    if (!matches.some((item) => item.publicId === publicId)
      && association?.publicId !== publicId) {
      throw new AdoptError('id-integrity-violation', 'adopt|candidate|ID belongs to another identity')
    }
  }
}

function replayArgs(command: MigrationCommand, input: string, registry: string, history: string): string[] {
  return ['dry-run', '--mode', command, '--input', input, '--registry', registry, '--history', history]
}

export function executeAdopt(argv: string[], cwd = process.cwd()): string {
  const values = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--confirm') {
      if (values.has(flag)) throw new AdoptError('candidate-invalid', usage)
      values.set(flag, true)
      continue
    }
    if (!flags.has(flag) || values.has(flag) || argv[index + 1] === undefined
      || argv[index + 1].startsWith('--')) throw new AdoptError('candidate-invalid', usage)
    values.set(flag, argv[++index])
  }
  if (!values.has('--confirm')) throw new AdoptError('confirm-missing', 'adopt|confirm|required')
  const candidate = values.get('--candidate')
  if (typeof candidate !== 'string') throw new AdoptError('candidate-missing', 'adopt|candidate|required')
  const output = values.get('--output')
  if (typeof output !== 'string') throw new AdoptError('output-missing', 'adopt|output|required')
  const input = values.get('--input')
  const registry = values.get('--registry')
  const history = values.get('--history')
  if (typeof input !== 'string' || typeof registry !== 'string' || typeof history !== 'string') {
    throw new AdoptError('candidate-reverify-failed', 'adopt|sources|--input, --registry and --history required')
  }
  const root = resolve(cwd)
  const target = outputTarget(root, output)
  const roles = [candidate, input, registry, history]
  fingerprintRoles(root, roles)
  const sourceSnapshots = [input, registry, history].map((path) => {
    try { return JSON.stringify(readJson(resolve(root, path))) }
    catch (error) { throw new AdoptError('candidate-reverify-failed', `adopt|sources|${String(error)}`) }
  })

  let document: unknown
  try { document = readJson(resolve(root, candidate)) }
  catch (error) { throw new AdoptError('candidate-invalid', `adopt|candidate|${String(error)}`) }
  if (!migrationResult(document) || !adoptable.has(document.command)) {
    throw new AdoptError('candidate-invalid', 'adopt|candidate|unsupported or malformed M2-4F result')
  }
  // A dry-run report loses the original --mode in its single-artifact format;
  // it cannot be adopted without an independently attested mode.
  const mode = document.command
  assertAdoptable(document)

  let replayed: MigrationResult | undefined
  let classification: unknown
  try {
    // M2-4F's optional Registry affects the contents of a `migrate` report:
    // providing it adds classification metadata, even with no historical match.
    // Both forms are legitimate. Accept only an EXACT canonical replay of one
    // supported source configuration; the independent classification gate below
    // still uses authoritative Registry and history in every case.
    const replayOptions: string[][] = [
      replayArgs(mode, input, registry, history),
      ...(mode === 'migrate' ? [['dry-run', '--mode', mode, '--input', input]] : []),
    ]
    const expected = stableMigrationJson(document)
    for (const option of replayOptions) {
      const result: unknown = JSON.parse(execute(option, root))
      if (!migrationResult(result)) throw new Error('invalid M2-4F replay shape')
      // M2-4F in-memory dry-run changes only the top-level command label.
      result.command = mode
      if (stableMigrationJson(result) === expected) { replayed = result; break }
    }
    classification = JSON.parse(execute(replayArgs('generate-catalog', input, registry, history), root))
  } catch (error) {
    throw new AdoptError('candidate-reverify-failed', `adopt|reverify|source replay failed: ${String(error)}`)
  }
  if (!replayed || !migrationResult(classification)) {
    throw new AdoptError('candidate-reverify-failed', 'adopt|reverify|candidate differs from supported source replay or classification is invalid')
  }
  assertAdoptable(replayed)
  // The second replay is a read-only *classification* gate: even a 'migrate'
  // report may not bypass authoritative Registry / historical checks.
  assertHistoricalClassification(classification)
  let authoritativeRegistry: unknown
  try { authoritativeRegistry = readJson(resolve(root, registry)) }
  catch (error) { throw new AdoptError('candidate-reverify-failed', `adopt|registry|${String(error)}`) }
  assertPublicIds(document, authoritativeRegistry, classification)
  fingerprintRoles(root, roles)
  const finalSources = [input, registry, history].map((path) => {
    try { return JSON.stringify(readJson(resolve(root, path))) }
    catch (error) { throw new AdoptError('candidate-reverify-failed', `adopt|sources|${String(error)}`) }
  })
  if (finalSources.some((value, index) => value !== sourceSnapshots[index])) {
    throw new AdoptError('candidate-reverify-failed', 'adopt|sources|source content changed during re-verification')
  }
  let finalCandidate: unknown
  try { finalCandidate = readJson(resolve(root, candidate)) }
  catch (error) { throw new AdoptError('candidate-invalid', `adopt|candidate|${String(error)}`) }
  if (!migrationResult(finalCandidate) || stableMigrationJson(finalCandidate) !== stableMigrationJson(document)) {
    throw new AdoptError('candidate-reverify-failed', 'adopt|candidate|candidate changed during re-verification')
  }
  const text = stableMigrationJson(document)
  if (text !== stableMigrationJson(replayed)) {
    throw new AdoptError('candidate-reverify-failed', 'adopt|reverify|candidate differs from independently replayed result')
  }
  try { writeExclusive(target, text) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AdoptError('output-exists', 'adopt|output|concurrent destination exists')
    throw new AdoptError('output-unauthorized', 'adopt|output|exclusive publication failed')
  }
  return text
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(executeAdopt(process.argv.slice(2))) }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
