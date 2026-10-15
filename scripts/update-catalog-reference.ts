import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { calculateSample } from './verify-catalog'

try {
  if (process.argv.length !== 4 || process.argv[2] !== '--output') throw new Error('reference|arguments|usage: --output NEW-candidate-path')
  const { result } = calculateSample(process.cwd())
  // Exclusive creation: cannot replace the reference, lock, inputs or an existing candidate.
  writeFileSync(resolve(process.argv[3]), `${JSON.stringify(result)}\n`, { encoding: 'utf8', flag: 'wx' })
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
