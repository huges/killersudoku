import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { partialPuzzle } from '../src/domain/fixtures'
import {
  arePlayableContentsD4Equivalent,
  canonicalizePlayableContent,
  D4_EQUIVALENCE_ALGORITHM_VERSION,
  extractPlayableContent,
  fingerprintPlayableContent,
  transformPlayableContent,
  type D4Transformation,
  type PlayableContent,
} from '../src/domain/identity'
import { ValidationError } from '../src/domain/validation'

function content(): PlayableContent {
  return extractPlayableContent(partialPuzzle)
}

function expectInvalid(value: unknown): void {
  expect(() => canonicalizePlayableContent(value as PlayableContent)).toThrow(ValidationError)
  expect(() => fingerprintPlayableContent(value as PlayableContent)).toThrow(ValidationError)
}

type Coordinate = { row: number; col: number }
type ExpectedClue = Coordinate & { value: number }

const asymmetricClues: ExpectedClue[] = [
  { row: 0, col: 2, value: 4 }, { row: 1, col: 4, value: 7 },
  { row: 3, col: 1, value: 8 }, { row: 5, col: 6, value: 2 },
  { row: 7, col: 3, value: 6 }, { row: 8, col: 8, value: 9 },
]
const asymmetricCage = [{ row: 0, col: 0 }, { row: 1, col: 0 }]

function independentFixture(clues: ExpectedClue[], multiCell = asymmetricCage, multiSum = 3): PlayableContent {
  const clueByCoordinate = new Map(clues.map((clue) => [`${clue.row}:${clue.col}`, clue.value]))
  const multiKeys = new Set(multiCell.map((cell) => `${cell.row}:${cell.col}`))
  const cages = [{ cells: multiCell.map((cell) => ({ ...cell })), sum: multiSum }]
  for (let row = 0; row < 9; row += 1) for (let col = 0; col < 9; col += 1) {
    const key = `${row}:${col}`
    if (!multiKeys.has(key)) cages.push({
      cells: [{ row, col }],
      sum: clueByCoordinate.get(key) ?? 1,
    })
  }
  return { size: 9, clues: clues.map((clue) => ({ ...clue })), cages }
}

function expectValid(value: PlayableContent): void {
  expect(() => canonicalizePlayableContent(value)).not.toThrow()
}

function sortedCoordinates(cells: Coordinate[]): Coordinate[] {
  return cells
    .map((cell) => ({ ...cell }))
    .sort((left, right) => left.row - right.row || left.col - right.col)
}

const expectedD4: Record<D4Transformation, { clues: ExpectedClue[]; cage: Coordinate[] }> = {
  identity: { clues: asymmetricClues, cage: [{ row: 0, col: 0 }, { row: 1, col: 0 }] },
  rotate90: { clues: [{ row: 2, col: 8, value: 4 }, { row: 4, col: 7, value: 7 }, { row: 1, col: 5, value: 8 }, { row: 6, col: 3, value: 2 }, { row: 3, col: 1, value: 6 }, { row: 8, col: 0, value: 9 }], cage: [{ row: 0, col: 7 }, { row: 0, col: 8 }] },
  rotate180: { clues: [{ row: 8, col: 6, value: 4 }, { row: 7, col: 4, value: 7 }, { row: 5, col: 7, value: 8 }, { row: 3, col: 2, value: 2 }, { row: 1, col: 5, value: 6 }, { row: 0, col: 0, value: 9 }], cage: [{ row: 7, col: 8 }, { row: 8, col: 8 }] },
  rotate270: { clues: [{ row: 6, col: 0, value: 4 }, { row: 4, col: 1, value: 7 }, { row: 7, col: 3, value: 8 }, { row: 2, col: 5, value: 2 }, { row: 5, col: 7, value: 6 }, { row: 0, col: 8, value: 9 }], cage: [{ row: 8, col: 0 }, { row: 8, col: 1 }] },
  reflectVertical: { clues: [{ row: 0, col: 6, value: 4 }, { row: 1, col: 4, value: 7 }, { row: 3, col: 7, value: 8 }, { row: 5, col: 2, value: 2 }, { row: 7, col: 5, value: 6 }, { row: 8, col: 0, value: 9 }], cage: [{ row: 0, col: 8 }, { row: 1, col: 8 }] },
  reflectHorizontal: { clues: [{ row: 8, col: 2, value: 4 }, { row: 7, col: 4, value: 7 }, { row: 5, col: 1, value: 8 }, { row: 3, col: 6, value: 2 }, { row: 1, col: 3, value: 6 }, { row: 0, col: 8, value: 9 }], cage: [{ row: 7, col: 0 }, { row: 8, col: 0 }] },
  reflectMainDiagonal: { clues: [{ row: 2, col: 0, value: 4 }, { row: 4, col: 1, value: 7 }, { row: 1, col: 3, value: 8 }, { row: 6, col: 5, value: 2 }, { row: 3, col: 7, value: 6 }, { row: 8, col: 8, value: 9 }], cage: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
  reflectAntiDiagonal: { clues: [{ row: 6, col: 8, value: 4 }, { row: 4, col: 7, value: 7 }, { row: 7, col: 5, value: 8 }, { row: 2, col: 3, value: 2 }, { row: 5, col: 1, value: 6 }, { row: 0, col: 0, value: 9 }], cage: [{ row: 8, col: 7 }, { row: 8, col: 8 }] },
}

describe('playable content identity', () => {
  it('extracts givens from the real puzzle model and excludes metadata and ids', () => {
    const original = structuredClone(partialPuzzle)
    const extracted = extractPlayableContent(partialPuzzle)

    expect(extracted).toEqual(expect.objectContaining({
      size: 9,
      clues: [
        { row: 0, col: 0, value: 1 },
        { row: 0, col: 1, value: 2 },
        { row: 1, col: 0, value: 4 },
      ],
    }))
    expect(Object.keys(extracted)).toEqual(['size', 'clues', 'cages'])
    expect(extracted.cages[0]).toEqual({ cells: [{ row: 0, col: 0 }], sum: 1 })
    expect(Object.keys(extracted.cages[0])).toEqual(['cells', 'sum'])
    expect(JSON.stringify(partialPuzzle)).toBe(JSON.stringify(original))
  })

  it('is stable for permutations without mutating the input', () => {
    const first = content()
    const reordered: PlayableContent = {
      size: 9,
      clues: [...first.clues].reverse(),
      cages: first.cages.map((cage) => ({ ...cage, cells: [...cage.cells] })).reverse(),
    }
    const before = structuredClone(reordered)
    expect(canonicalizePlayableContent(first)).toBe(canonicalizePlayableContent(reordered))
    expect(fingerprintPlayableContent(first)).toBe(fingerprintPlayableContent(reordered))
    expect(reordered).toEqual(before)

    const multiCell: PlayableContent = {
      ...content(),
      cages: [
        { cells: [{ row: 0, col: 1 }, { row: 0, col: 0 }], sum: 3 },
        ...content().cages.slice(2),
      ],
    }
    const multiCellReordered: PlayableContent = {
      size: 9,
      clues: [...multiCell.clues].reverse(),
      cages: [...multiCell.cages].reverse().map((cage) => ({
        cells: [...cage.cells].reverse(),
        sum: cage.sum,
      })),
    }
    const multiCellBefore = structuredClone(multiCellReordered)
    expect(canonicalizePlayableContent(multiCell)).toBe(canonicalizePlayableContent(multiCellReordered))
    expect(fingerprintPlayableContent(multiCell)).toBe(fingerprintPlayableContent(multiCellReordered))
    expect(multiCellReordered).toEqual(multiCellBefore)

    expect(fingerprintPlayableContent(first)).toMatch(/^sha256-[0-9a-f]{64}$/)
    expect(fingerprintPlayableContent(first)).toBe(fingerprintPlayableContent(content()))

    const canonical = canonicalizePlayableContent(first)
    const independentDigest = createHash('sha256').update(canonical, 'utf8').digest('hex')
    expect(fingerprintPlayableContent(first)).toBe(`sha256-${independentDigest}`)
  })

  it('does not include puzzle metadata in the extracted fingerprint', () => {
    const changed = structuredClone(partialPuzzle)
    changed.puzzleId = 'another-id'
    changed.difficulty = 'expert'
    changed.schemaVersion = '1.0'
    changed.cages = changed.cages.map((cage, index) => ({ ...cage, id: `changed-cage-${index}` }))
    const withChangedMetadata = extractPlayableContent(changed)
    expect(fingerprintPlayableContent(withChangedMetadata)).toBe(fingerprintPlayableContent(content()))
  })

  it('extracts independently of the authoritative cage array order', () => {
    const reorderedPuzzle = structuredClone(partialPuzzle)
    reorderedPuzzle.cages.reverse()
    expect(extractPlayableContent(reorderedPuzzle)).toEqual(extractPlayableContent(partialPuzzle))
  })

  it('rejects original puzzles and extra fields at the content boundary', () => {
    expectInvalid(partialPuzzle)
    expectInvalid({ ...content(), metadata: null })
    expectInvalid({ ...content(), givens: [] })
  })

  it.each([1, 4, 16, 9.5, '9', undefined])('rejects unsupported size %s', (size) => {
    expectInvalid({ ...content(), size } as unknown)
  })

  it('rejects malformed clues and sudoku conflicts', () => {
    const base = content()
    expectInvalid({ ...base, clues: [{ row: 0, col: 0, value: 1 }, { row: 0, col: 0, value: 2 }] })
    expectInvalid({ ...base, clues: [{ row: 0, col: 0, value: 1.5 }] })
    expectInvalid({ ...base, clues: [{ row: 9, col: 0, value: 1 }] })
    expectInvalid({ ...base, clues: [{ row: 0, col: 0, value: 1 }, { row: 0, col: 2, value: 1 }] })
    expectInvalid({ ...base, clues: [{ row: 0, col: 0, value: 1, extra: true }] })
  })

  it('preserves original validation invariants during extraction', () => {
    const badShape = structuredClone(partialPuzzle)
    badShape.givens = badShape.givens.slice(0, 8)
    expect(() => extractPlayableContent(badShape)).toThrow(ValidationError)

    const badValue = structuredClone(partialPuzzle)
    badValue.givens[0][2] = 10
    expect(() => extractPlayableContent(badValue)).toThrow(ValidationError)

    const rowConflict = structuredClone(partialPuzzle)
    rowConflict.givens[0][2] = 1
    expect(() => extractPlayableContent(rowConflict)).toThrow(ValidationError)

    const columnConflict = structuredClone(partialPuzzle)
    columnConflict.givens[2][0] = 1
    expect(() => extractPlayableContent(columnConflict)).toThrow(ValidationError)

    const regionConflict = structuredClone(partialPuzzle)
    regionConflict.givens[1][1] = 1
    expect(() => extractPlayableContent(regionConflict)).toThrow(ValidationError)
  })

  it('rejects invalid cages and incompatible sums', () => {
    const base = content()
    expectInvalid({ ...base, cages: [{ cells: [], sum: 1 }] })
    expectInvalid({ ...base, cages: [{ cells: [{ row: 0, col: 0 }, { row: 0, col: 0 }], sum: 1 }] })
    expectInvalid({ ...base, cages: [{ cells: [{ row: 9, col: 0 }], sum: 1 }] })
    expectInvalid({ ...base, cages: [{ cells: [{ row: 0, col: 0 }], sum: 1.5 }] })
    expectInvalid({ ...base, cages: [{ cells: [{ row: 0, col: 0 }], sum: 0 }] })
    expectInvalid({ ...base, cages: [{ cells: [{ row: 0, col: 0 }], sum: 9 }] })

    const fixedSumMismatch: PlayableContent = {
      ...base,
      cages: [
        { cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }], sum: 4 },
        ...base.cages.slice(2),
      ],
    }
    expectInvalid(fixedSumMismatch)
    expectInvalid({ ...base, clues: [{ row: 0, col: 0, value: 1 }], cages: base.cages.map((cage, index) => index === 0 ? { ...cage, sum: 2 } : cage) })
    expectInvalid({ ...base, clues: [{ row: 0, col: 0, value: 1 }, { row: 0, col: 2, value: 1 }] })
    expectInvalid({ ...base, cages: [{ cells: [{ row: 0, col: 0 }], sum: 2 }] })
    expectInvalid({ ...base, cages: [{ cells: [{ row: 0, col: 0 }], sum: 1, id: 'not-allowed' }] })

    const disconnected = structuredClone(base)
    disconnected.cages = [
      { cells: [{ row: 0, col: 0 }, { row: 0, col: 2 }], sum: 3 },
      { cells: [{ row: 0, col: 1 }], sum: 2 },
      ...base.cages.slice(3),
    ]
    expectInvalid(disconnected)

    const overlap = structuredClone(base)
    overlap.cages[1] = { cells: [{ row: 0, col: 0 }], sum: 1 }
    expectInvalid(overlap)

    const incomplete = structuredClone(base)
    incomplete.cages = incomplete.cages.slice(0, -1)
    expectInvalid(incomplete)
  })

  it('rejects invalid original givens through the authoritative validator', () => {
    const malformed = structuredClone(partialPuzzle) as unknown as Record<string, unknown>
    malformed.givens = Array.from({ length: 8 }, () => Array(9).fill(null))
    expect(() => extractPlayableContent(malformed as never)).toThrow(ValidationError)

    const invalidValue = structuredClone(partialPuzzle) as unknown as Record<string, unknown>
    ;(invalidValue.givens as unknown[][])[0][0] = 10
    expect(() => extractPlayableContent(invalidValue as never)).toThrow(ValidationError)

    const rowConflict = structuredClone(partialPuzzle)
    rowConflict.givens[0][2] = 1
    expect(() => extractPlayableContent(rowConflict)).toThrow(ValidationError)

    const columnConflict = structuredClone(partialPuzzle)
    columnConflict.givens[2][0] = 1
    expect(() => extractPlayableContent(columnConflict)).toThrow(ValidationError)

    const regionConflict = structuredClone(partialPuzzle)
    regionConflict.givens[1][1] = 1
    expect(() => extractPlayableContent(regionConflict)).toThrow(ValidationError)
  })

  it('rejects sparse and nullish array elements before canonicalization or hashing', () => {
    const base = content()
    const sparseCases: unknown[] = []

    for (const index of [0, 1, base.clues.length]) {
      const clues = [...base.clues]
      clues.length = base.clues.length + 1
      delete clues[index]
      sparseCases.push({ ...base, clues })
    }
    for (const index of [0, 1, base.cages.length]) {
      const cages = [...base.cages]
      cages.length = base.cages.length + 1
      delete cages[index]
      sparseCases.push({ ...base, cages })
    }
    for (const index of [0, 1, base.cages[0].cells.length]) {
      const cages = base.cages.map((cage) => ({ ...cage, cells: [...cage.cells] }))
      cages[0].cells.length = base.cages[0].cells.length + 1
      delete cages[0].cells[index]
      sparseCases.push({ ...base, cages })
    }
    sparseCases.push({ ...base, clues: [null, ...base.clues] })
    sparseCases.push({ ...base, cages: [undefined, ...base.cages] })
    sparseCases.push({ ...base, cages: [{ ...base.cages[0], cells: [null, ...base.cages[0].cells] }, ...base.cages.slice(1)] })

    for (const invalid of sparseCases) expectInvalid(invalid)
  })

  it('reports the same diagnostics for the same invalid input', () => {
    const invalid = { ...content(), clues: [{ row: 0, col: 0, value: 1.5 }] }
    const first = (() => { try { canonicalizePlayableContent(invalid) } catch (error) { return String(error) } return '' })()
    const second = (() => { try { canonicalizePlayableContent(invalid) } catch (error) { return String(error) } return '' })()
    expect(first).toBe(second)
    expect(first).toContain('content.clues[0].value')
  })

  it('transforms the independent asymmetric fixture with all eight D4 formulas', () => {
    const original = independentFixture(asymmetricClues)
    expectValid(original)
    const originalSnapshot = structuredClone(original)

    for (const transformation of Object.keys(expectedD4) as D4Transformation[]) {
      const expected = expectedD4[transformation]
      const transformed = transformPlayableContent(original, transformation)
      const expectedContent = independentFixture(expected.clues, expected.cage)
      expectValid(expectedContent)
      expectValid(transformed)
      expect(transformed.clues).toEqual(expected.clues)
      const transformedMultiCell = transformed.cages.find((cage) => cage.cells.length === 2)
      expect(transformedMultiCell?.sum).toBe(3)
      expect(sortedCoordinates(transformedMultiCell?.cells ?? [])).toEqual(sortedCoordinates(expected.cage))
      expect(arePlayableContentsD4Equivalent(original, transformed)).toBe(true)
      expect(transformed).not.toBe(original)
    }
    expect(original).toEqual(originalSnapshot)
  })

  it('accepts a separately constructed symmetric content and preserves immutability', () => {
    const symmetric: PlayableContent = {
      size: 9,
      clues: [],
      cages: Array.from({ length: 9 }, (_, row) =>
        Array.from({ length: 9 }, (_, col) => ({ cells: [{ row, col }], sum: 1 })),
      ).flat(),
    }
    expectValid(symmetric)
    const snapshot = structuredClone(symmetric)
    for (const transformation of Object.keys(expectedD4) as D4Transformation[]) {
      const transformed = transformPlayableContent(symmetric, transformation)
      const independentlyConstructedExpected = {
        size: 9 as const,
        clues: [],
        cages: Array.from({ length: 9 }, (_, row) =>
          Array.from({ length: 9 }, (_, col) => ({ cells: [{ row, col }], sum: 1 })),
        ).flat(),
      }
      expectValid(transformed)
      expectValid(independentlyConstructedExpected)
      expect(canonicalizePlayableContent(transformed)).toBe(canonicalizePlayableContent(independentlyConstructedExpected))
      expect(arePlayableContentsD4Equivalent(symmetric, transformed)).toBe(true)
    }
    expect(symmetric).toEqual(snapshot)
  })

  it.each([
    ['coordinate', independentFixture([{ row: 0, col: 3, value: 4 }, ...asymmetricClues.slice(1)])],
    ['clue value', independentFixture([{ row: 0, col: 2, value: 5 }, ...asymmetricClues.slice(1)])],
    ['cage sum', independentFixture(asymmetricClues, asymmetricCage, 4)],
    ['cage membership', independentFixture(asymmetricClues, [{ row: 0, col: 0 }, { row: 0, col: 1 }])],
  ])('rejects valid contents that differ in %s outside the D4 orbit', (_, changed) => {
    const original = independentFixture(asymmetricClues)
    expectValid(original)
    expectValid(changed)
    expect(arePlayableContentsD4Equivalent(original, changed)).toBe(false)
  })

  it('separates invalid inputs and invalid transformations from valid non-equivalence', () => {
    const original = independentFixture(asymmetricClues)
    expect(() => transformPlayableContent(original, 'unknown' as D4Transformation)).toThrow(ValidationError)
    expect(() => transformPlayableContent(original, 'rotate45' as D4Transformation)).toThrow(ValidationError)
    expect(() => arePlayableContentsD4Equivalent(original, { ...original, size: 8 } as unknown as PlayableContent)).toThrow(ValidationError)
    expect(() => transformPlayableContent({ ...original, cages: [] }, 'identity')).toThrow(ValidationError)
    expect(() => transformPlayableContent({ ...original, clues: [{ row: 9, col: 0, value: 4 }] }, 'identity')).toThrow(ValidationError)
  })

  it('rejects every non-D4 runtime identifier with a stable diagnostic without mutation', () => {
    const invalidTransformations: unknown[] = [
      Symbol('rotate45'),
      Object.create(null),
      { name: 'rotate45' },
      () => 'rotate45',
      null,
      undefined,
    ]

    for (const transformation of invalidTransformations) {
      const original = independentFixture(asymmetricClues)
      const snapshot = structuredClone(original)
      expect(() => transformPlayableContent(original, transformation as D4Transformation)).toThrow(ValidationError)
      expect(() => transformPlayableContent(original, transformation as D4Transformation)).toThrow(
        'transformation: unsupported D4 transformation',
      )
      expect(original).toEqual(snapshot)
    }
  })

  it('exposes the versioned D4 contract and compares complete canonical strings', () => {
    expect(D4_EQUIVALENCE_ALGORITHM_VERSION).toBe('d4-v1')
    const original = independentFixture(asymmetricClues)
    const sameOrbit = independentFixture(expectedD4.rotate90.clues, expectedD4.rotate90.cage)
    const distinctOrbit: PlayableContent = {
      size: 9,
      clues: [],
      cages: Array.from({ length: 9 }, (_, row) =>
        Array.from({ length: 9 }, (_, col) => ({ cells: [{ row, col }], sum: 1 })),
      ).flat(),
    }
    expectValid(original)
    expectValid(sameOrbit)
    expectValid(distinctOrbit)
    expect(arePlayableContentsD4Equivalent(original, sameOrbit)).toBe(true)
    expect(arePlayableContentsD4Equivalent(original, distinctOrbit)).toBe(false)
  })
})
