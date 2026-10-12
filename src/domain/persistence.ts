import { type SaveDocument } from './types'
import { deserialize, serialize } from './serialization'

/** Abstract persistence boundary. Implementations provide atomic replace semantics. */
export interface PersistenceContract {
  load(): string
  replace(serializedDocument: string): void
}

/** Loads and validates before returning; callers retain their current state on error. */
export function loadDocument(adapter: PersistenceContract): SaveDocument {
  return deserialize(adapter.load())
}

/** Serializes and validates before asking the adapter to atomically replace its document. */
export function saveDocument(adapter: PersistenceContract, document: SaveDocument): void {
  adapter.replace(serialize(document))
}
