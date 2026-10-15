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

  it('compares canonical references byte-for-byte', () => {
    const result = verifyCatalog([partialPuzzle])
    expect(compareReference(result, clone(result))).toEqual({ equal: true, errors: [] })
    expect(compareReference(result, { ...result, sampleVersion: 'other' }).equal).toBe(false)
  })
})
