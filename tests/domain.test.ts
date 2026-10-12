import { describe, expect, it } from 'vitest'
import { complete, editCell, newGame, pause, redo, resume, undo } from '../src/domain/game'
import { partialPuzzle, referenceValue, solvedPuzzle } from '../src/domain/fixtures'
import { type PersistenceContract, loadDocument, saveDocument } from '../src/domain/persistence'
import { deserialize, deriveCageData, serialize } from '../src/domain/serialization'
import { type SaveDocument } from '../src/domain/types'
import { validateGameState, validatePuzzle } from '../src/domain/validation'

const cell = { row: 0, col: 2 }
const snapshot = { value: 3, notes: [] }

function documentFor(game = newGame(partialPuzzle)): SaveDocument {
  return { format: 'killer-sudoku-save', schemaVersion: '1.0', puzzle: partialPuzzle, game }
}

class Double implements PersistenceContract {
  constructor(public stored: string, private failLoad = false, private failReplace = false) {}
  load(): string { if (this.failLoad) throw new Error('load failed'); return this.stored }
  replace(value: string): void { if (this.failReplace) throw new Error('replace failed'); this.stored = value }
}

describe('M0-3 domain', () => {
  it('validates fixtures and derives, rather than persists, cage labels', () => {
    validatePuzzle(partialPuzzle)
    expect(deriveCageData(partialPuzzle.cages[0])).toEqual({ labelAnchor: { row: 0, col: 0 }, label: '1' })
    expect(JSON.stringify(partialPuzzle)).not.toContain('labelAnchor')
  })

  it('rejects non-canonical cage cells without mutating input', () => {
    const candidate = structuredClone(partialPuzzle)
    candidate.cages[0].cells = [{ row: 0, col: 1 }, { row: 0, col: 0 }]
    const before = structuredClone(candidate)
    expect(() => validatePuzzle(candidate)).toThrow()
    expect(candidate).toEqual(before)
  })

  it('creates immutable not_started state and records combined edits', () => {
    const game = newGame(partialPuzzle)
    const edited = editCell(partialPuzzle, game, cell, { value: null, notes: [3, 5] })
    const combined = editCell(partialPuzzle, edited, cell, snapshot)
    expect(game.status).toBe('not_started')
    expect(combined.history[1].before).toEqual({ value: null, notes: [3, 5] })
    expect(undo(partialPuzzle, combined).notes[0][2]).toEqual([3, 5])
    expect(redo(partialPuzzle, undo(partialPuzzle, combined)).values[0][2]).toBe(3)
  })

  it('preserves redo until a new edit and preserves elapsed time', () => {
    let game = editCell(partialPuzzle, newGame(partialPuzzle), cell, snapshot)
    game = editCell(partialPuzzle, game, { row: 0, col: 3 }, { value: 4, notes: [] })
    const undone = undo(partialPuzzle, game)
    const redone = redo(partialPuzzle, undone)
    expect(redone.history).toHaveLength(2)
    const branched = editCell(partialPuzzle, undone, { row: 0, col: 4 }, { value: 5, notes: [] })
    expect(branched.history).toHaveLength(2)
    const invalid = structuredClone(game)
    invalid.elapsedSeconds = -1
    expect(() => validateGameState(partialPuzzle, invalid)).toThrow()
  })

  it('enforces pause and resume transitions and rejects edits while paused', () => {
    const game = editCell(partialPuzzle, newGame(partialPuzzle), cell, snapshot)
    const paused = pause(game)
    expect(() => editCell(partialPuzzle, paused, cell, { value: null, notes: [] })).toThrow()
    expect(resume(paused).status).toBe('in_progress')
  })

  it('round-trips JSON and rejects malformed input', () => {
    const document = documentFor(editCell(partialPuzzle, newGame(partialPuzzle), cell, snapshot))
    expect(deserialize(serialize(document))).toEqual(document)
    expect(() => deserialize('{')).toThrow()
    expect(() => deserialize(JSON.stringify({ ...document, game: { ...document.game, puzzleId: 'other' } }))).toThrow()
  })

  it('checks redo timestamps during full-history validation', () => {
    let game = editCell(partialPuzzle, newGame(partialPuzzle), cell, snapshot)
    game = editCell(partialPuzzle, game, { row: 0, col: 3 }, { value: 4, notes: [] })
    const undone = undo(partialPuzzle, game)
    const invalid = structuredClone(undone)
    invalid.elapsedSeconds = 0
    invalid.history[1].elapsedSecondsAfter = 1
    expect(() => validateGameState(partialPuzzle, invalid)).toThrow()
  })

  it('uses the abstract persistence contract without losing the prior document', () => {
    const original = serialize(documentFor())
    const invalid = new Double('{not json')
    expect(() => loadDocument(invalid)).toThrow()
    expect(invalid.stored).toBe('{not json')
    const failing = new Double(original, false, true)
    expect(() => saveDocument(failing, documentFor())).toThrow()
    expect(failing.stored).toBe(original)
    const valid = new Double(original)
    saveDocument(valid, documentFor(editCell(partialPuzzle, newGame(partialPuzzle), cell, snapshot)))
    expect(deserialize(valid.stored).game.history).toHaveLength(1)
  })

  it('keeps the solved fixture consistent with its givens and solution values', () => {
    const game = newGame(solvedPuzzle)
    for (let row = 0; row < 9; row += 1) for (let col = 0; col < 9; col += 1) {
      expect(game.values[row][col]).toBe(referenceValue(row, col))
    }
    expect(() => validateGameState(solvedPuzzle, game)).not.toThrow()
  })

  it('completes a valid solved state and rejects undo and redo afterwards', () => {
    const inProgress = { ...newGame(solvedPuzzle), status: 'in_progress' as const }
    const completed = complete(solvedPuzzle, inProgress)
    expect(completed.status).toBe('completed')
    expect(() => undo(solvedPuzzle, completed)).toThrow()
    expect(() => redo(solvedPuzzle, completed)).toThrow()
  })

  it('validates a connected multicell cage and rejects incompatible local sums', () => {
    const candidate = structuredClone(partialPuzzle)
    candidate.cages = candidate.cages.filter((cage) => cage.id !== 'cage-0-1')
    candidate.cages[0] = {
      id: 'multicell-0',
      cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
      sum: 3,
    }
    expect(() => validatePuzzle(candidate)).not.toThrow()

    const invalid = structuredClone(candidate)
    invalid.cages[0].sum = 4
    expect(() => validatePuzzle(invalid)).toThrow()
    expect(invalid.cages[0].cells).toEqual([{ row: 0, col: 0 }, { row: 0, col: 1 }])
  })

  it('replays the complete history of a solved partial fixture before completing it', () => {
    let game = newGame(partialPuzzle)
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        if (partialPuzzle.givens[row][col] === null) {
          game = editCell(partialPuzzle, game, { row, col }, { value: referenceValue(row, col), notes: [] })
        }
      }
    }
    expect(game.history.length).toBe(78)
    expect(() => validateGameState(partialPuzzle, game)).not.toThrow()
    expect(complete(partialPuzzle, game).status).toBe('completed')
  })

  it('rejects malformed puzzle cages without changing the candidate', () => {
    for (const mutate of [
      (candidate: typeof partialPuzzle) => { candidate.cages = [] },
      (candidate: typeof partialPuzzle) => { candidate.cages[0].id = candidate.cages[1].id },
      (candidate: typeof partialPuzzle) => { candidate.cages[0].cells = [{ row: 0, col: 0 }, { row: 0, col: 0 }] },
      (candidate: typeof partialPuzzle) => { candidate.cages[0].sum = 0 },
    ]) {
      const candidate = structuredClone(partialPuzzle)
      mutate(candidate)
      const before = structuredClone(candidate)
      expect(() => validatePuzzle(candidate)).toThrow()
      expect(candidate).toEqual(before)
    }
  })
})
