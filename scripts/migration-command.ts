import { constants, lstatSync, readFileSync, writeFileSync, mkdtempSync, rmSync, linkSync, unlinkSync, openSync, closeSync, fstatSync, fsyncSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMigrationInput, runMigration, stableMigrationJson, generateIdentityCandidate, type MigrationCommand, type LegacyRecord } from '../src/domain/migrationPipeline'
import type { HistoricalContentSource, HistoricalRecord } from '../src/domain/duplicateClassifier'
import type { Registry, RecordKey } from '../src/domain/registry'

const commands = new Set<MigrationCommand>(['verify', 'migrate', 'generate-catalog', 'generate-identities', 'generate-references', 'dry-run'])
const usage = 'migration|arguments|usage: <command> --input FILE [--history FILE] [--registry FILE] [--output FILE]; dry-run optionally accepts --mode <migrate|generate-catalog|generate-identities|generate-references>'
const rawPath = (value: string): void => {
  if (!value || value.includes('\0') || value.includes('\\') || isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error('filesystem|path|unauthorized raw path')
}
export type ReadHooks = { beforeOpen?: (path: string) => void }
type OpenedJson = { value: unknown; dev: number; ino: number }
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY
const noFollowDirectoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
const descriptorPath = (descriptor: number, child = ''): string => `/proc/self/fd/${descriptor}${child ? `/${child}` : ''}`
function duplicateDirectoryDescriptor(descriptor: number): number {
  // The procfs fd entry is itself a symlink: O_NOFOLLOW on that bare path
  // causes ENOTDIR. Follow only this trusted descriptor handle, then verify its
  // identity; child opens still use O_NOFOLLOW on the actual final component.
  const duplicate = openSync(descriptorPath(descriptor), constants.O_RDONLY | constants.O_DIRECTORY)
  const originalMetadata = fstatSync(descriptor)
  const duplicateMetadata = fstatSync(duplicate)
  if (!duplicateMetadata.isDirectory() || duplicateMetadata.dev !== originalMetadata.dev || duplicateMetadata.ino !== originalMetadata.ino) {
    closeSync(duplicate)
    throw new Error('filesystem|path|directory descriptor identity changed')
  }
  return duplicate
}

// Walk from the filesystem root using retained directory descriptors. Each
// component is opened relative to the preceding descriptor, so replacing an
// ancestor pathname cannot redirect subsequent opens. Fail closed without procfs.
function openAnchoredDirectory(absolutePath: string): number {
  if (!isAbsolute(absolutePath)) throw new Error('filesystem|path|directory path must be absolute')
  const components = absolutePath.split(sep).filter(Boolean)
  let descriptor = openSync(sep, directoryFlags)
  try {
    for (const component of components) {
      const componentPath = descriptorPath(descriptor, component)
      const componentMetadata = lstatSync(componentPath)
      if (componentMetadata.isSymbolicLink()) throw new Error('filesystem|path|symlink component')
      const next = openSync(componentPath, noFollowDirectoryFlags)
      const metadata = fstatSync(next)
      if (!metadata.isDirectory()) { closeSync(next); throw new Error('filesystem|path|component is not a directory') }
      closeSync(descriptor)
      descriptor = next
    }
    return descriptor
  } catch (error) { closeSync(descriptor); throw error }
}

type OpenedFile = { descriptor: number; parent: number; leaf: string; metadata: ReturnType<typeof fstatSync> }
function openFileFromParent(parent: number, leaf: string, path: string, hooks: ReadHooks = {}): OpenedFile {
  // The caller already holds this directory open from a descriptor-relative walk.
  // Do not reopen /proc/self/fd/N with O_NOFOLLOW: procfs exposes that handle as
  // a symlink, and the flag would reject the descriptor path rather than a file.
  const checked = lstatSync(descriptorPath(parent, leaf))
  if (!checked.isFile() || checked.isSymbolicLink()) throw new Error('filesystem|input|source is not a regular non-symlink file')
  hooks.beforeOpen?.(path)
  const descriptor = openSync(descriptorPath(parent, leaf), constants.O_RDONLY | constants.O_NOFOLLOW)
  const metadata = fstatSync(descriptor)
  if (!metadata.isFile() || metadata.dev !== checked.dev || metadata.ino !== checked.ino) { closeSync(descriptor); throw new Error('filesystem|input|identity changed between validation and open') }
  return { descriptor, parent, leaf, metadata }
}
function openFileBelowRoot(rootDescriptor: number, path: string, hooks: ReadHooks = {}): OpenedFile {
  rawPath(path)
  const components = path.split('/')
  const leaf = components.pop()!
  // A bare /proc/self/fd/N path is a symlink, so duplicate the already-open
  // root descriptor with identity verification instead of O_NOFOLLOW.
  let parent = duplicateDirectoryDescriptor(rootDescriptor)
  try {
    for (const component of components) {
      const componentPath = descriptorPath(parent, component)
      const componentMetadata = lstatSync(componentPath)
      if (componentMetadata.isSymbolicLink()) throw new Error('filesystem|path|symlink component')
      const next = openSync(componentPath, noFollowDirectoryFlags)
      if (!fstatSync(next).isDirectory()) { closeSync(next); throw new Error('filesystem|path|component is not a directory') }
      closeSync(parent)
      parent = next
    }
    const inputPath = descriptorPath(parent, leaf)
    const checked = lstatSync(inputPath)
    if (checked.isSymbolicLink()) throw new Error('filesystem|path|symlink component')
    if (!checked.isFile()) throw new Error('filesystem|input|source is not a regular non-symlink file')
    hooks.beforeOpen?.(path)
    const descriptor = openSync(descriptorPath(parent, leaf), constants.O_RDONLY | constants.O_NOFOLLOW)
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.dev !== checked.dev || metadata.ino !== checked.ino) { closeSync(descriptor); throw new Error('filesystem|input|identity changed between validation and open') }
    return { descriptor, parent, leaf, metadata }
  } catch (error) { closeSync(parent); throw error }
}
function openAnchoredFile(path: string, hooks: ReadHooks = {}): OpenedFile {
  const absolute = resolve(path)
  const parent = openAnchoredDirectory(dirname(absolute))
  return openFileFromParent(parent, basename(absolute), path, hooks)
}

function readOpenedJson(opened: ReturnType<typeof openAnchoredFile>): OpenedJson {
  try {
    const text = readFileSync(opened.descriptor, 'utf8')
    const afterRead = fstatSync(opened.descriptor)
    if (afterRead.dev !== opened.metadata.dev || afterRead.ino !== opened.metadata.ino || afterRead.size !== opened.metadata.size) throw new Error('filesystem|input|source changed while being read')
    return { value: JSON.parse(text), dev: opened.metadata.dev, ino: opened.metadata.ino }
  } finally { closeSync(opened.descriptor); closeSync(opened.parent) }
}

function readJsonWithIdentity(path: string, hooks: ReadHooks = {}): OpenedJson {
  return readOpenedJson(openAnchoredFile(path, hooks))
}
export function readJson(path: string, hooks: ReadHooks = {}): unknown {
  return readJsonWithIdentity(path, hooks).value
}
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
  beforePublish?: (parent: string) => void
  write?: (descriptor: number, text: string) => void
  publish?: (temporary: string, destination: string) => void
}

export function writeExclusive(path: string, text: string, hooks: PublicationHooks = {}): void {
  const parent = dirname(path)
  const before = lstatSync(parent)
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('filesystem|parent|authorized parent is not a real directory')
  // Keep the authorized directory object open for the whole transaction. The
  // final hard link is addressed through this descriptor, not a re-resolved path.
  const parentDescriptor = openAnchoredDirectory(resolve(parent))
  const anchoredParent = fstatSync(parentDescriptor)
  if (!anchoredParent.isDirectory() || anchoredParent.dev !== before.dev || anchoredParent.ino !== before.ino) {
    closeSync(parentDescriptor)
    throw new Error('filesystem|parent|parent identity changed while opening publication directory')
  }
  // Linux exposes an opened directory through procfs. Use that stable handle for
  // staging and final publication; fail closed on platforms without descriptor paths.
  const anchoredPath = `/proc/self/fd/${parentDescriptor}`
  const staging = mkdtempSync(join(anchoredPath, '.mozart-migration-'))
  const temporary = join(staging, 'output.json')
  const destination = join(anchoredPath, basename(path))
  try {
    hooks.afterStagingCreated?.(parent)
    hooks.beforePublish?.(parent)
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
    if (hooks.publish) hooks.publish(temporary, destination)
    else linkSync(temporary, destination)
    unlinkSync(temporary)
  } finally {
    rmSync(staging, { recursive: true, force: true })
    closeSync(parentDescriptor)
  }
}

/** Legacy single-file outputs may use an absolute path, but only below the authorized cwd.
 * Modern migration arguments remain strictly root-relative. Both paths reuse the
 * descriptor-anchored, exclusive single-file writer; no alternative publisher. */
export function writeLegacyCandidate(cwd: string, output: string, text: string): void {
  const absolute = isAbsolute(output)
  if (!output || output.includes('\\0') || output.includes('\\\\') || /^[A-Za-z]:/.test(output)
    || output.split('/').some((part, index) => part === '.' || part === '..' || (part === '' && !(absolute && index === 0)))) {
    throw new Error('filesystem|path|unauthorized raw path')
  }
  const relativeOutput = absolute ? relative(resolve(cwd), output) : output
  writeExclusive(confined(cwd, relativeOutput), text)
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
  // Resolve and open each role beneath one retained authorized root. Component
  // traversal is descriptor-relative, and physical provenance is derived from
  // the descriptors actually opened rather than pathname stat checks.
  const rootDescriptor = openAnchoredDirectory(resolve(cwd))
  let input: LegacyRecord[]
  let history: HistoricalContentSource | undefined
  let registry: Registry | undefined
  try {
    const inputOpened = openFileBelowRoot(rootDescriptor, inputPath)
    const inputDocument = readOpenedJson(inputOpened)
    const historyDocument = historyPath ? readOpenedJson(openFileBelowRoot(rootDescriptor, historyPath)) : undefined
    const registryDocument = registryPath ? readOpenedJson(openFileBelowRoot(rootDescriptor, registryPath)) : undefined
    const identities = [inputDocument, historyDocument, registryDocument].filter((item): item is OpenedJson => item !== undefined).map((item) => `${item.dev}:${item.ino}`)
    if (new Set(identities).size !== identities.length) throw new Error('filesystem|provenance|input, history, and registry must be physically distinct')
    input = parseMigrationInput(inputDocument.value as LegacyRecord[])
    history = historyDocument ? sourceFrom(historyDocument.value) : undefined
    registry = registryDocument ? registryDocument.value as Registry : undefined
  } finally { closeSync(rootDescriptor) }
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
