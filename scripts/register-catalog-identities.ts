import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fingerprintPuzzle, canonicalizePuzzle, verifyCatalog } from '../src/domain/catalogPipeline'

if (process.argv[2] !== '--output' || !process.argv[3]) {
  console.error('identity|arguments|usage: --output path')
  process.exit(2)
}
const root = resolve(process.cwd())
const manifest = JSON.parse(readFileSync(resolve(root, 'catalog/fixtures/manifest.json'), 'utf8')) as { inputs: string[]; formatVersion: string; sampleVersion: string }
const puzzles = manifest.inputs.flatMap((path) => {
  const value = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as unknown
  return Array.isArray(value) ? value : [value]
})
const result = verifyCatalog(puzzles, { formatVersion: manifest.formatVersion, sampleVersion: manifest.sampleVersion })
if (result.errors.length > 0) { console.error(result.errors[0]); process.exit(1) }
const output = resolve(process.argv[3])
const existing = output === resolve(root, 'catalog/identity-lock.json') ? JSON.parse(readFileSync(output, 'utf8')) as Record<string, string> : {}
const next = { ...existing }
for (const puzzle of puzzles) {
  const id = (puzzle as { puzzleId: string }).puzzleId
  const fingerprint = fingerprintPuzzle(canonicalizePuzzle(puzzle as never))
  if (next[id] !== undefined && next[id] !== fingerprint) { console.error(`identity|${id}|historical fingerprint mismatch`); process.exit(1) }
  next[id] = fingerprint
}
writeFileSync(output, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
console.log(`identity|registered|${output}`)
