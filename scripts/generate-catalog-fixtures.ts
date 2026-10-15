import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'

const output = process.argv[2]
const seed = process.argv[3]
const generatorVersion = process.argv[4]
if (!output || !seed || !generatorVersion) {
  console.error('generator|arguments|usage: output seed generatorVersion')
  process.exitCode = 2
} else {
  const directory = resolve(output)
  mkdirSync(directory, { recursive: true })
  const files = ['inputs.json']
  writeFileSync(resolve(directory, files[0]), `${JSON.stringify([solvedPuzzle, partialPuzzle], null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ generatorVersion, seed, files: files.map((file) => resolve(directory, file)) }))
}
