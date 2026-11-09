import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateSample } from './verify-catalog'
import { execute as executeMigration, writeLegacyCandidate } from './migration-command'

/** Preserve the M2-1 reference workflow and expose verified M2-4F reference candidates. */
export function runUpdateCatalogReference(args: string[], cwd = process.cwd()): string | void {
  if (args[0] === '--input') return executeMigration(['generate-references', ...args], cwd)
  if (args.length !== 2 || args[0] !== '--output') throw new Error('reference|arguments|usage: --output NEW-candidate-path OR --input FILE --history FILE --registry FILE --output NEW-candidate-path')
  const { result } = calculateSample(cwd)
  // Exclusive creation: cannot replace the reference, lock, inputs or an existing candidate.
  writeLegacyCandidate(cwd, args[1], `${JSON.stringify(result)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runUpdateCatalogReference(process.argv.slice(2))
    if (result !== undefined) process.stdout.write(result)
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
