import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'
import { type PuzzleDefinition } from '../src/domain/types'
import { validatePuzzle } from '../src/domain/validation'

export const GENERATOR_VERSION = '1'
export const OUTPUTS = ['inputs.json', 'negative/derived-field.json', 'negative/multiple-solutions.json', 'negative/structurally-invalid.json', 'negative/unsatisfiable.json'] as const
export function fixtureSet(seed: string, version: string, parameters: string) {
  if (!seed || version !== GENERATOR_VERSION || parameters !== 'technical-v1') throw new Error('generator|arguments|expected seed, version 1, parameters technical-v1')
  const offset = [...seed].reduce((n, c) => (n + c.charCodeAt(0)) % 9, 0)
  const rotate = (p: PuzzleDefinition) => {
    const q = structuredClone(p)
    const digit = (v: number) => (v - 1 + offset) % 9 + 1
    q.givens = q.givens.map(row => row.map(v => v === null ? null : digit(v)))
    q.cages = q.cages.map(c => ({ ...c, sum: digit(c.sum) })) // base fixtures have single-cell cages
    return q
  }
  const unique = rotate(partialPuzzle)
  const multiple = rotate(solvedPuzzle)
  multiple.puzzleId = 'fixture-multiple'
  multiple.givens = multiple.givens.map((row, r) => r < 2 ? Array<number | null>(9).fill(null) : row)
  multiple.cages = [
    ...[0, 1].map(row => ({ id: `row-${row}`, cells: Array.from({ length: 9 }, (_, col) => ({ row, col })), sum: 45 })),
    ...multiple.cages.filter(c => c.cells[0].row >= 2),
  ]
  const unsatisfiable = structuredClone(partialPuzzle)
  unsatisfiable.puzzleId = 'fixture-unsatisfiable'
  unsatisfiable.cages.find(c => c.id === 'cage-0-2')!.sum = 3
  unsatisfiable.cages.find(c => c.id === 'cage-0-3')!.sum = 3
  const invalid = structuredClone(unique)
  invalid.cages[0].cells = []
  for (const p of [unique, multiple, unsatisfiable]) validatePuzzle(p)
  return {
    'inputs.json': [unique],
    'negative/derived-field.json': { ...unique, solution: [] },
    'negative/multiple-solutions.json': multiple,
    'negative/structurally-invalid.json': invalid,
    'negative/unsatisfiable.json': unsatisfiable,
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [output, seed, version, parameters] = process.argv.slice(2)
    if (process.argv.length !== 6 || !output) throw new Error('generator|arguments|usage: NEW-output-directory seed 1 technical-v1')
    const data = fixtureSet(seed, version, parameters)
    // New directory only: the generator cannot overwrite any existing input/reference/register.
    const root = resolve(output)
    mkdirSync(root)
    for (const path of OUTPUTS) {
      const target = resolve(root, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, `${JSON.stringify(data[path], null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    }
    console.log(JSON.stringify({ seed, generatorVersion: version, parameters, outputs: OUTPUTS }))
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
