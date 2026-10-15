import { describe, expect, it, vi } from 'vitest'
import { partialPuzzle, solvedPuzzle } from '../src/domain/fixtures'
import { canonicalizePuzzle, compareReference, fingerprintPuzzle, verifyCatalog } from '../src/domain/catalogPipeline'
import * as solver from '../src/domain/solver'

const clone = <T>(value: T): T => structuredClone(value)

describe('offline catalog pipeline', () => {
  it('accepts a valid puzzle, reuses the shared solver and is deterministic', () => {
    const first = verifyCatalog([solvedPuzzle])
    const second = verifyCatalog([solvedPuzzle])
    expect(first).toEqual(second)
    expect(first.errors).toEqual([])
    expect(first.puzzles[0]).toMatchObject({ puzzleId: 'fixture-solved', structural: 'valid', solver: { status: 'unique', count: 1, complete: true } })
    expect(fingerprintPuzzle(canonicalizePuzzle(solvedPuzzle))).toBe(first.puzzles[0].fingerprint)
  })

  it('rejects structural input before invoking the solver or reordering it', () => {
    const invalid = clone(solvedPuzzle)
    invalid.cages[0].cells = [{ row: -1, col: 0 }]
    const solveSpy = vi.spyOn(solver, 'solve')
    const result = verifyCatalog([invalid])
    expect(result.puzzles[0].structural).toBe('invalid')
    expect(result.puzzles[0].errors[0]).toMatch(/coordinate|invalid/i)
    expect(solveSpy).not.toHaveBeenCalled()
    solveSpy.mockRestore()
  })

  it('rejects duplicate identifiers and historical content changes', () => {
    const duplicate = clone(solvedPuzzle)
    const changed = clone(solvedPuzzle)
    changed.givens[0][0] = null
    expect(verifyCatalog([solvedPuzzle, duplicate]).errors[0]).toMatch(/duplicate identifier/)
    const fingerprint = fingerprintPuzzle(canonicalizePuzzle(solvedPuzzle))
    expect(verifyCatalog([changed], { identity: { [changed.puzzleId]: fingerprint } }).errors[0]).toMatch(/historical fingerprint mismatch/)
  })

  it('fingerprints the complete canonical representation with SHA-256', () => {
    const original = canonicalizePuzzle(solvedPuzzle)
    const changed = clone(solvedPuzzle)
    changed.givens[0][0] = null
    expect(fingerprintPuzzle(original)).toMatch(/^sha256-[0-9a-f]{64}$/)
    expect(fingerprintPuzzle(original)).not.toBe(fingerprintPuzzle(canonicalizePuzzle(changed)))
  })

  it('canonicalizes cage and cell order without mutating validated input', () => {
    const shuffled = clone(solvedPuzzle)
    shuffled.cages = [...shuffled.cages].reverse()
    shuffled.cages[0].cells = [...shuffled.cages[0].cells].reverse()
    const before = clone(shuffled)
    expect(canonicalizePuzzle(shuffled)).toBe(canonicalizePuzzle(solvedPuzzle))
    expect(shuffled).toEqual(before)
  })

  it('rejects derived fields and incomplete searches deterministically', () => {
    const derived = { ...clone(solvedPuzzle), solution: solvedPuzzle.givens }
    expect(verifyCatalog([derived]).puzzles[0].errors[0]).toMatch(/unknown field/)
    const result = verifyCatalog([partialPuzzle], { maxNodes: 1 })
    expect(result.puzzles[0].solver.status).toBe('incomplete')
    expect(result.errors[0]).toMatch(/incomplete/)
  })

  it('rejects representative negative fixtures without invoking the solver for structural failures', () => {
    const invalidCage = clone(solvedPuzzle)
    invalidCage.cages[0].cells = [{ row: 0, col: 0 }, { row: 0, col: 0 }]
    const unsatisfiable = clone(solvedPuzzle)
    unsatisfiable.givens[0][0] = 9
    const incomplete = verifyCatalog([partialPuzzle], { maxNodes: 1 })
    expect(verifyCatalog([invalidCage]).errors[0]).toMatch(/invalid|duplicate|cage/i)
    expect(verifyCatalog([unsatisfiable]).errors.length).toBeGreaterThan(0)
    expect(incomplete.errors[0]).toMatch(/incomplete|solver/i)
  })

  it('compares canonical references byte-for-byte', () => {
    const result = verifyCatalog([partialPuzzle])
    expect(compareReference(result, clone(result))).toEqual({ equal: true, errors: [] })
    expect(compareReference(result, { ...result, sampleVersion: 'other' }).equal).toBe(false)
  })
})
