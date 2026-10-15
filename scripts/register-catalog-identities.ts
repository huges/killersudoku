import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { calculateSample } from './verify-catalog'

try {
  if (process.argv.length !== 4 || process.argv[2] !== '--output') throw new Error('identity|arguments|usage: --output NEW-candidate-path')
  const { identity, result } = calculateSample(process.cwd(), false)
  // Always read the authoritative register, even when writing a separate candidate.
  const next = { ...identity }
  for (const record of result.puzzles) next[record.puzzleId] = record.fingerprint!
  const ordered = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  writeFileSync(resolve(process.argv[3]), `${JSON.stringify(ordered, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
