import { existsSync, lstatSync, statSync, readFileSync, writeFileSync, mkdtempSync, rmSync, linkSync, unlinkSync, openSync, closeSync, fstatSync, fsyncSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMigrationInput, runMigration, stableMigrationJson, generateIdentityCandidate, type CandidateRecord, type MigrationCommand, type LegacyRecord } from '../src/domain/migrationPipeline'
import type { HistoricalContentSource, HistoricalRecord } from '../src/domain/duplicateClassifier'
import type { Registry, RecordKey } from '../src/domain/registry'

const commands = new Set<MigrationCommand>(['verify', 'migrate', 'generate-catalog', 'generate-identities', 'generate-references', 'dry-run'])
const usage = 'migration|arguments|usage: <command> --input FILE [--history FILE] [--registry FILE] [--output FILE]; dry-run optionally accepts --mode <migrate|generate-catalog|generate-identities|generate-references>'
const rawPath = (value: string): void => {
  if (!value || value.includes('\0') || value.includes('\\') || isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error('filesystem|path|unauthorized raw path')
}
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const keyText = (key: RecordKey): string => JSON.stringify([key.source, key.key])
function sourceFrom(value: unknown): HistoricalContentSource {
  if (!Array.isArray(value)) throw new Error('history|records|historical source must be an array')
  const records = value as HistoricalRecord[]
  return {
    resolve: (key) => {
      const matches = records.filter((record) => record && typeof record === 'object' && record.recordKey && keyText(record.recordKey) === keyText(key))
      return matches.length === 1 ? structuredClone(matches[0]) : matches.length === 0 ? 'missing' : 'ambiguous'
    },
    resolveReference: (reference) => {
      const matches = records.filter((record) => record && typeof record === 'object' && Array.isArray(record.references) && record.references.includes(reference))
      if (matches.length !== 1 || !matches[0].recordKey || typeof matches[0].recordKey !== 'object') {
        return matches.length === 0 ? 'missing' : 'ambiguous'
      }
      return { reference, recordKey: structuredClone(matches[0].recordKey) }
    },
  }
}
function confined(root: string, path: string): string {
  rawPath(path)
  const rootPath = resolve(root)
  const target = resolve(rootPath, path)
  const rel = relative(rootPath, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('filesystem|path|outside authorized root')
  const components = rel.split(sep)
  let current = rootPath
  for (let index = 0; index < components.length; index += 1) {
    current = resolve(current, components[index])
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('filesystem|path|symlink component is not authorized')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || index !== components.length - 1) throw error
      // A new output leaf is valid; its parent components were checked above.
    }
  }
  return target
}
export type PublicationHooks = {
  afterStagingCreated?: (parent: string) => void
  write?: (descriptor: number, text: string) => void
  publish?: (temporary: string, destination: string) => void
}

export function writeExclusive(path: string, text: string, hooks: PublicationHooks = {}): void {
  const parent = dirname(path)
  const before = lstatSync(parent)
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('filesystem|parent|authorized parent is not a real directory')
  const staging = mkdtempSync(resolve(parent, '.mozart-migration-'))
  const temporary = resolve(staging, 'output.json')
  try {
    hooks.afterStagingCreated?.(parent)
    const descriptor = openSync(temporary, 'wx')
    try {
      const opened = fstatSync(descriptor)
      if (!opened.isFile()) throw new Error('filesystem|staging|temporary is not a regular file')
      if (hooks.write) hooks.write(descriptor, text)
      else writeFileSync(descriptor, text, { encoding: 'utf8' })
      fsyncSync(descriptor)
    } finally { closeSync(descriptor) }
    if (readFileSync(temporary, 'utf8') !== text) throw new Error('filesystem|staging|content changed before publication')
    const after = lstatSync(parent)
    if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) throw new Error('filesystem|parent|parent directory changed during publication')
    // A hard link publishes the fully flushed same-filesystem inode atomically and fails if the destination exists.
    if (hooks.publish) hooks.publish(temporary, path)
    else linkSync(temporary, path)
    unlinkSync(temporary)
  } finally { rmSync(staging, { recursive: true, force: true }) }
}

/**
 * Refuse multi-file publication unless the runtime supplies a true directory
 * no-replace primitive. Node's rename replaces an empty destination directory
 * on some platforms, so a pre-check followed by rename cannot prove the
 * required all-or-nothing/no-replace contract. Failing before staging keeps
 * authoritative inputs and destinations unchanged instead of exposing a
 * partial set.
 */
export function publishMultiFile(_destination: string, _files: Readonly<Record<string, string>>): never {
  throw new Error('filesystem|multi-file-atomicity|directory no-replace publication is unavailable; no files were written')
}
export function execute(argv: string[], cwd = process.cwd()): string {
  const command = argv[0] as MigrationCommand
  if (!commands.has(command)) throw new Error(usage)
  const values = new Map<string, string>()
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1]
    if (!['--input', '--history', '--registry', '--output', '--mode'].includes(flag) || value === undefined || values.has(flag)) throw new Error(usage)
    values.set(flag, value)
  }
  const inputPath = values.get('--input'); if (!inputPath) throw new Error(usage)
  const historyPath = values.get('--history'); const registryPath = values.get('--registry'); const outputPath = values.get('--output'); const requestedMode = values.get('--mode')
  const generationModes = new Set<MigrationCommand>(['migrate', 'generate-catalog', 'generate-identities', 'generate-references'])
  if (requestedMode !== undefined && (command !== 'dry-run' || !generationModes.has(requestedMode as MigrationCommand))) throw new Error('dry-run|mode|--mode is only valid with dry-run and a generation command')
  const executionCommand: MigrationCommand = command === 'dry-run' ? (requestedMode as MigrationCommand | undefined) ?? 'migrate' : command
  const suppliedPaths = [inputPath, historyPath, registryPath, outputPath].filter((item): item is string => item !== undefined)
  for (const path of suppliedPaths) rawPath(path)
  if (new Set(suppliedPaths).size !== suppliedPaths.length) throw new Error('filesystem|provenance|input, history, registry, and output paths must be distinct')
  if (command === 'dry-run' && outputPath) throw new Error('dry-run|output|dry-run cannot create files')
  if (command !== 'dry-run' && !outputPath) throw new Error(usage)
  const inputFile = confined(cwd, inputPath)
  const historyFile = historyPath ? confined(cwd, historyPath) : undefined
  const registryFile = registryPath ? confined(cwd, registryPath) : undefined
  const physicalFiles = [inputFile, historyFile, registryFile].filter((path): path is string => path !== undefined)
  const physicalKeys = physicalFiles.map((path) => {
    const metadata = statSync(path)
    return `${metadata.dev}:${metadata.ino}`
  })
  if (new Set(physicalKeys).size !== physicalKeys.length) throw new Error('filesystem|provenance|input, history, and registry must be physically distinct')
  const input = parseMigrationInput(readJson(inputFile) as LegacyRecord[])
  const history = historyFile ? sourceFrom(readJson(historyFile)) : undefined
  const registry = registryFile ? readJson(registryFile) as Registry : undefined
  const result = runMigration(executionCommand, input, { registry, historicalContentSource: history, dryRun: command === 'dry-run' })
  if (command === 'dry-run') result.command = 'dry-run'
  if (executionCommand === 'generate-identities' && registry) {
    const eligible = result.diagnostics.length === 0
      && result.records.length === result.candidate.length
      && result.records.every((record) => record.outcome === 'candidate')
    if (eligible) {
      const candidate = generateIdentityCandidate(registry, result.records)
      if (candidate.diagnostics.length) {
        result.diagnostics.push(...candidate.diagnostics)
        result.candidate = []
        result.diff = []
        for (const record of result.records) {
          record.outcome = 'error'
          record.diagnostics.push(...candidate.diagnostics.map((item) => ({ ...item, ...(record.recordKey ? { recordKey: record.recordKey } : {}) })))
        }
      } else if (candidate.registry) {
        result.diff = [{ registry: candidate.registry }]
      }
    } else {
      // Identity assignment is transactional: never expose record candidates when a
      // prerequisite or another record prevented the complete Registry proposal.
      result.candidate = []
      result.diff = []
    }
  }
  const text = stableMigrationJson(result)
  if (command === 'dry-run') return text
  writeExclusive(confined(cwd, outputPath!), text)
  return text
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(execute(process.argv.slice(2))) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
