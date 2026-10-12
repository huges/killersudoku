import { type SaveDocument } from './types'
import { validateSaveDocument, validationError } from './validation'

export function serialize(document: SaveDocument): string {
  validateSaveDocument(document)
  return JSON.stringify(document)
}

export function deserialize(input: string): SaveDocument {
  if (typeof input !== 'string') validationError('serialized document must be a string')

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    validationError('serialized document is not valid JSON')
  }

  validateSaveDocument(parsed as SaveDocument)
  return parsed as SaveDocument
}

export function deriveCageData(cage: SaveDocument['puzzle']['cages'][number]): {
  labelAnchor: { row: number; col: number }
  label: string
} {
  const anchor = cage.cells[0]
  return {
    labelAnchor: { row: anchor.row, col: anchor.col },
    label: String(cage.sum),
  }
}
