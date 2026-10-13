import { describe, expect, it } from 'vitest'
import { complete, editCell, newGame, pause, redo, resume, undo } from '../src/domain/game'
import { partialPuzzle, referenceValue, solvedPuzzle } from '../src/domain/fixtures'
import { type PersistenceContract, loadDocument, saveDocument } from '../src/domain/persistence'
import { deserialize, deriveCageData, serialize } from '../src/domain/serialization'
import { type SaveDocument } from '../src/domain/types'
import { validateGameState, validatePuzzle, validateSaveDocument } from '../src/domain/validation'

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

    const withDerivedFields = structuredClone(partialPuzzle)
    ;(withDerivedFields.cages[0] as typeof withDerivedFields.cages[0] & { labelAnchor?: unknown; label?: unknown }).labelAnchor = { row: 0, col: 0 }
    ;(withDerivedFields.cages[0] as typeof withDerivedFields.cages[0] & { labelAnchor?: unknown; label?: unknown }).label = '1'
    expect(() => validatePuzzle(withDerivedFields)).toThrow()
    const validDocument = documentFor(newGame(partialPuzzle))
    const derivedJson = JSON.stringify({
      ...validDocument,
      puzzle: withDerivedFields,
    })
    expect(() => deserialize(derivedJson)).toThrow('invalid cage')
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

  it('accepts cages crossing region boundaries and rejects malformed coordinates', () => {
    const crossing = structuredClone(partialPuzzle)
    crossing.cages = crossing.cages.filter((cage) => !['cage-2-2', 'cage-2-3'].includes(cage.id))
    crossing.cages.push({
      id: 'crossing-boundary',
      cells: [{ row: 2, col: 2 }, { row: 2, col: 3 }],
      sum: 3,
    })
    expect(() => validatePuzzle(crossing)).not.toThrow()

    const overlappingAcrossRegions = structuredClone(partialPuzzle)
    overlappingAcrossRegions.cages[3].cells = [{ row: 0, col: 0 }]
    expect(() => validatePuzzle(overlappingAcrossRegions)).toThrow('cages overlap')

    const candidate = structuredClone(partialPuzzle)
    for (const cells of [
      [{ row: -1, col: 0 }],
      [{ row: 9, col: 0 }],
      [{ row: 0.5, col: 0 }],
      [{ row: 0 }],
      [{ row: 0, col: 0, region: 1 }],
    ]) {
      candidate.cages[0].cells = cells as never
      expect(() => validatePuzzle(candidate)).toThrow()
    }
  })

  it('accepts minimum and maximum distinct sums for a connected two-cell cage', () => {
    for (const sum of [3, 17]) {
      const candidate = structuredClone(partialPuzzle)
      candidate.cages = candidate.cages.filter((cage) => !['cage-0-2', 'cage-0-3'].includes(cage.id))
      candidate.cages.push({
        id: `two-cell-${sum}`,
        cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
        sum,
      })
      expect(() => validatePuzzle(candidate)).not.toThrow()
    }
  })

  it('rejects malformed givens and impossible residual sums', () => {
    for (const givens of [
      Array.from({ length: 8 }, () => Array(9).fill(null)),
      Array.from({ length: 9 }, () => Array(8).fill(null)),
      Array.from({ length: 9 }, () => Array(9).fill(0)),
      Array.from({ length: 9 }, () => Array(9).fill(10)),
      Array.from({ length: 9 }, () => Array(9).fill(1.5)),
    ]) {
      const candidate = structuredClone(partialPuzzle)
      candidate.givens = givens as (number | null)[][]
      expect(() => validatePuzzle(candidate)).toThrow()
    }

    const impossibleResidual = structuredClone(partialPuzzle)
    impossibleResidual.cages = impossibleResidual.cages.filter((cage) => !['cage-0-0', 'cage-1-0'].includes(cage.id))
    impossibleResidual.cages.push({
      id: 'impossible-residual',
      cells: [{ row: 0, col: 0 }, { row: 1, col: 0 }],
      sum: 17,
    })
    expect(() => validatePuzzle(impossibleResidual)).toThrow()
  })

  it('validates minimum and maximum sums for every cage cardinality', () => {
    for (let count = 1; count <= 9; count += 1) {
      const candidate = structuredClone(partialPuzzle)
      const cells = Array.from({ length: count }, (_, col) => ({ row: 2, col }))
      const removed = new Set(cells.map(({ row, col }) => `cage-${row}-${col}`))
      candidate.cages = candidate.cages.filter((cage) => !removed.has(cage.id))
      for (const sum of [count * (count + 1) / 2, count * (19 - count) / 2]) {
        const bounded = structuredClone(candidate)
        bounded.cages.push({ id: `bounds-${count}-${sum}`, cells, sum })
        expect(() => validatePuzzle(bounded)).not.toThrow()
      }
    }
  })

  it('rejects specific invalid cage structures and sums', () => {
    const empty = structuredClone(partialPuzzle)
    empty.cages[0].cells = []
    expect(() => validatePuzzle(empty)).toThrow('cage cage-0-0.cells must not be empty')

    const tooLarge = structuredClone(partialPuzzle)
    tooLarge.cages = tooLarge.cages.slice(9)
    tooLarge.cages.unshift({
      id: 'too-large',
      cells: [
        ...Array.from({ length: 9 }, (_, col) => ({ row: 0, col })),
        { row: 1, col: 0 },
      ],
      sum: 45,
    })
    expect(() => validatePuzzle(tooLarge)).toThrow('cage sum is outside its bounds')

    const diagonal = structuredClone(partialPuzzle)
    diagonal.cages = diagonal.cages.slice(2)
    diagonal.cages.unshift({
      id: 'diagonal',
      cells: [{ row: 0, col: 0 }, { row: 1, col: 1 }],
      sum: 3,
    })
    expect(() => validatePuzzle(diagonal)).toThrow('cage is not connected')

    const emptyId = structuredClone(partialPuzzle)
    emptyId.cages[0].id = ''
    expect(() => validatePuzzle(emptyId)).toThrow('invalid cage')

    for (const sum of [-1, 0, 1.5]) {
      const invalid = structuredClone(partialPuzzle)
      invalid.cages[0].sum = sum
      expect(() => validatePuzzle(invalid)).toThrow(sum === 1.5 ? 'invalid cage' : 'cage sum is outside its bounds')
    }
  })

  it('rejects an impossible residual sum with an empty cage cell', () => {
    const candidate = structuredClone(partialPuzzle)
    candidate.cages = candidate.cages.filter((cage) => !['cage-0-2', 'cage-0-3'].includes(cage.id))
    candidate.cages.push({
      id: 'impossible-empty-residual',
      cells: [{ row: 0, col: 2 }, { row: 0, col: 3 }],
      sum: 18,
    })
    expect(() => validatePuzzle(candidate)).toThrow('cage sum is locally incompatible')
  })

  it('rejects extra puzzle fields and propagates invalid puzzles without mutation', () => {
    const candidate = structuredClone(partialPuzzle) as typeof partialPuzzle & { grid?: unknown }
    candidate.grid = { cells: [] }
    const before = structuredClone(candidate)
    const document = documentFor(newGame(partialPuzzle))
    const invalidDocument = { ...document, puzzle: candidate }
    const serialized = JSON.stringify(invalidDocument)

    expect(() => validatePuzzle(candidate)).toThrow('invalid puzzle metadata')
    expect(() => validatePuzzle(candidate)).toThrow('invalid puzzle metadata')
    expect(candidate).toEqual(before)
    expect(() => serialize(invalidDocument)).toThrow('invalid puzzle metadata')
    expect(() => deserialize(serialized)).toThrow('invalid puzzle metadata')
    expect(() => validateGameState(candidate, document.game)).toThrow('invalid puzzle metadata')
    expect(() => validateSaveDocument(invalidDocument)).toThrow('invalid puzzle metadata')
    expect(candidate).toEqual(before)
    expect(invalidDocument.puzzle).toEqual(before)
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

  it('rejects invalid coordinates, disconnected or overlapping cages, duplicate givens and unsupported versions', () => {
    const disconnected = structuredClone(partialPuzzle)
    disconnected.cages[0].cells = [{ row: 0, col: 0 }, { row: 0, col: 2 }]
    expect(() => validatePuzzle(disconnected)).toThrow()

    const overlapping = structuredClone(partialPuzzle)
    overlapping.cages[0].cells = [{ row: 0, col: 0 }, { row: 0, col: 1 }]
    overlapping.cages[0].sum = 3
    expect(() => validatePuzzle(overlapping)).toThrow('cages overlap')

    const duplicateGiven = structuredClone(partialPuzzle)
    duplicateGiven.givens[0][2] = 1
    expect(() => validatePuzzle(duplicateGiven)).toThrow()

    const unsupportedPuzzle = structuredClone(partialPuzzle)
    unsupportedPuzzle.schemaVersion = '2.0' as typeof unsupportedPuzzle.schemaVersion
    expect(() => validatePuzzle(unsupportedPuzzle)).toThrow()

    const invalidCoordinate = structuredClone(partialPuzzle)
    invalidCoordinate.cages[0].cells = [{ row: -1, col: 0 }]
    expect(() => validatePuzzle(invalidCoordinate)).toThrow()
  })

  it('rejects malformed state history, snapshots, versions and given edits', () => {
    const initial = newGame(partialPuzzle)
    for (const history of ['', null, {}, undefined]) {
      const candidate = structuredClone(initial) as unknown as Record<string, unknown>
      candidate.history = history
      expect(() => validateGameState(partialPuzzle, candidate as never)).toThrow()
    }

    const changedGiven = structuredClone(initial)
    changedGiven.values[0][0] = null
    expect(() => validateGameState(partialPuzzle, changedGiven)).toThrow()
    expect(() => editCell(partialPuzzle, initial, { row: 0, col: 0 }, { value: null, notes: [] })).toThrow()

    const invalidNotes = [
      [3, 3],
      [4, 2],
      [0],
      [10],
    ]
    for (const notes of invalidNotes) {
      expect(() => editCell(partialPuzzle, initial, cell, { value: null, notes })).toThrow()
    }

    const invalidIndex = structuredClone(editCell(partialPuzzle, initial, cell, snapshot))
    invalidIndex.historyIndex = 2
    expect(() => validateGameState(partialPuzzle, invalidIndex)).toThrow()

    const inconsistentRedo = structuredClone(editCell(partialPuzzle, initial, cell, snapshot))
    inconsistentRedo.history.push({
      id: 'redo', type: 'edit_cell', cell: { row: 0, col: 3 },
      before: { value: 9, notes: [] }, after: { value: 4, notes: [] }, elapsedSecondsAfter: 0,
    })
    inconsistentRedo.historyIndex = 0
    expect(() => validateGameState(partialPuzzle, inconsistentRedo)).toThrow()

    const unsupportedState = structuredClone(initial)
    unsupportedState.schemaVersion = '2.0' as typeof unsupportedState.schemaVersion
    expect(() => validateGameState(partialPuzzle, unsupportedState)).toThrow()
  })

  it('handles undo and redo limits, total undo, and preserves immutable nested inputs', () => {
    const originalPuzzle = structuredClone(partialPuzzle)
    const originalState = newGame(partialPuzzle)
    const editInput = { value: null, notes: [2, 6] }
    const edited = editCell(partialPuzzle, originalState, cell, editInput)
    expect(() => undo(partialPuzzle, originalState)).toThrow()
    expect(() => redo(partialPuzzle, originalState)).toThrow()
    const undone = undo(partialPuzzle, edited)
    expect(undone.historyIndex).toBe(-1)
    expect(undone.status).toBe('in_progress')
    expect(undo(partialPuzzle, undone)).toEqual(undone)
    expect(redo(partialPuzzle, undone).notes[0][2]).toEqual([2, 6])
    expect(partialPuzzle).toEqual(originalPuzzle)
    expect(originalState).toEqual(newGame(partialPuzzle))
    expect(editInput).toEqual({ value: null, notes: [2, 6] })
  })

  it('round-trips an active redo branch with non-zero time and preserves values and notes', () => {
    let game = editCell(partialPuzzle, newGame(partialPuzzle), cell, { value: null, notes: [3, 5] })
    game.elapsedSeconds = 7
    game.history[0].elapsedSecondsAfter = 7
    game = editCell(partialPuzzle, game, { row: 0, col: 3 }, { value: 4, notes: [] })
    const undone = undo(partialPuzzle, game)
    expect(undone.elapsedSeconds).toBe(7)
    expect(undone.historyIndex).toBe(0)
    const restored = deserialize(serialize(documentFor(undone))).game
    expect(restored).toEqual(undone)
    expect(restored.notes[0][2]).toEqual([3, 5])
    expect(restored.values[0][3]).toBeNull()
    const redone = redo(partialPuzzle, restored)
    expect(redone.elapsedSeconds).toBe(7)
    expect(redone.values[0][3]).toBe(4)
    expect(redone.notes[0][2]).toEqual([3, 5])
  })
})
