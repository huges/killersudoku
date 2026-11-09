import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calculateSample } from './verify-catalog'
import { execute as executeMigration, writeLegacyCandidate } from './migration-command'

/** Retain the M2-1 identity-lock workflow and expose the M2-4F Registry candidate workflow. */
export function runRegisterCatalogIdentities(args: string[], cwd = process.cwd()): string | void {
  if (args[0] === '--input') {
    const report = executeMigration(['generate-identities', ...args], cwd)
    process.stdout.write(report)
    return report
  }
  if (args.length !== 2 || args[0] !== '--output') throw new Error('identity|arguments|usage: --output NEW-candidate-path OR --input FILE --registry REGISTRY --output NEW-candidate-path')
  const { identity, result } = calculateSample(cwd, false)
  for (const record of result.puzzles) {
    if (!Object.hasOwn(identity, record.puzzleId) || identity[record.puzzleId] !== record.fingerprint) {
      throw new Error(`identity|${record.puzzleId}|missing or mismatched verified fingerprint`)
    }
  }
  // The legacy lock remains a puzzleId/fingerprint map; it is never promoted to Registry v1.
  const ordered = Object.fromEntries(Object.entries(identity).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  writeLegacyCandidate(cwd, args[1], `${JSON.stringify(ordered, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runRegisterCatalogIdentities(process.argv.slice(2)) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
