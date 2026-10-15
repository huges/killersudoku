import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyCatalog } from '../src/domain/catalogPipeline'

if (process.argv[2] !== '--output' || !process.argv[3]) {
  console.error('reference|arguments|usage: --output path')
  process.exit(2)
}
const root = resolve(process.cwd())
const manifest = JSON.parse(readFileSync(resolve(root, 'catalog/fixtures/manifest.json'), 'utf8')) as { inputs: string[]; formatVersion: string; sampleVersion: string; identityLock: string }
const puzzles = manifest.inputs.flatMap((path) => { const value = JSON.parse(readFileSync(resolve(root, path), 'utf8')); return Array.isArray(value) ? value : [value] })
const identity = JSON.parse(readFileSync(resolve(root, manifest.identityLock), 'utf8'))
const result = verifyCatalog(puzzles, { formatVersion: manifest.formatVersion, sampleVersion: manifest.sampleVersion, identity })
if (result.errors.length > 0) { console.error(result.errors[0]); process.exit(1) }
const output = resolve(process.argv[3])
if (output === resolve(root, manifest.expectedResult)) { console.error('reference|output|must be distinct from historical reference'); process.exit(1) }
writeFileSync(output, `${JSON.stringify(result)}\n`, 'utf8')
console.log(`reference|candidate|${output}`)
