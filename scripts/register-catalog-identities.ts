import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { calculateSample, loadSample } from './verify-catalog'
import { runMigration, type LegacyRecord } from '../src/domain/migrationPipeline'

try {
  if (process.argv.length !== 4 || process.argv[2] !== '--output') throw new Error('identity|arguments|usage: --output NEW-candidate-path')
  const { identity, result } = calculateSample(process.cwd(), false)
  for (const record of result.puzzles) {
    if (!Object.hasOwn(identity, record.puzzleId) || identity[record.puzzleId] !== record.fingerprint) {
      throw new Error(`identity|${record.puzzleId}|missing or mismatched verified fingerprint`)
    }
  }
  // Identity-lock is a legacy puzzleId/fingerprint map, not a Registry v1. Preserve its values verbatim; validation above checks only the fixture entries present.
  const next = { ...identity }
  const ordered = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  writeFileSync(resolve(process.argv[3]), `${JSON.stringify(ordered, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
