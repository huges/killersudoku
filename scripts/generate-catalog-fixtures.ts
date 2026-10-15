import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { solvedPuzzle } from '../src/domain/fixtures'
import { verifyCatalog } from '../src/domain/catalogPipeline'

const output = process.argv[2]
const seed = process.argv[3]
const generatorVersion = process.argv[4]
const parameterText = process.argv[5] ?? 'sample=technical'

if (!output || !seed || !generatorVersion) {
  console.error('generator|arguments|usage: output seed generatorVersion [parameters]')
  process.exitCode = 2
} else {
  const parameters = Object.fromEntries(parameterText.split(',').map((item) => {
    const [key, value] = item.split('=', 2)
    return [key, value ?? '']
  }))
  const seedValue = [...seed].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0)
  const suffix = seed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `seed-${seedValue}`
  const generated = structuredClone(solvedPuzzle)
  generated.puzzleId = `generated-${suffix}-${seedValue.toString(16)}`
  if (parameters.difficulty && ['easy', 'medium', 'hard', 'expert'].includes(String(parameters.difficulty))) {
    generated.difficulty = String(parameters.difficulty) as typeof generated.difficulty
  }
  const candidates = [generated]
  const verification = verifyCatalog(candidates, { formatVersion: generatorVersion, sampleVersion: String(parameters.sample ?? 'technical') })
  if (verification.errors.length > 0) {
    console.error(verification.errors[0])
    process.exitCode = 1
  } else {
    const directory = resolve(output)
    mkdirSync(directory, { recursive: true })
    const files = ['inputs.json']
    writeFileSync(resolve(directory, files[0]), `${JSON.stringify(candidates, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ generatorVersion, seed, parameters, files: files.map((file) => resolve(directory, file)) }))
  }
}
