# M2-4E — Compatibilità legacy, lookup pubblico ed export

## Confini

Il boundary pubblico del namespace `killer-sudoku` è read-only: legge i formati verificati, risolve un ID pubblico, produce/legge l’export pubblico versionato e lascia invariata la persistenza atomica del salvataggio. Non modifica Registry, identity-lock, cataloghi o fixture autorevoli, non assegna ID durante il runtime e non migra fingerprint legacy.

## Matrice dei formati verificati

| Formato | Marker/versione | API e riscontri | Compatibilità |
|---|---|---|---|
| `PuzzleDefinition` | `schemaVersion: "1.0"` | `PuzzleDefinition`, `validatePuzzle`, `extractPlayableContent`; fixture in `src/domain/fixtures.ts` e `catalog/fixtures/` | Lettura; nessun writer nuovo |
| `killer-sudoku-save` | `format: "killer-sudoku-save"`, `schemaVersion: "1.0"` | `SaveDocument`, `validateSaveDocument`, `serialize`/`deserialize`, `loadDocument`/`saveDocument`; `docs/M0-3-modello.md`, `tests/domain.test.ts` | Lettura, scrittura e persistenza atomica; resta distinto dall’export |
| `Registry` | schema `1`, namespace `killer-sudoku` | `Registry`, `IdentityHistory`, `firstAssignment`, `Association`, `observationKey`, `RecordKey`, `FingerprintRef` in `src/domain/registry.ts` | Sola lettura tramite strutture/API esistenti; la validazione interna non è un reader autonomo |
| Contenuto storico | nessun marker aggiuntivo dichiarato | `HistoricalContentSource`/`HistoricalRecord` in `duplicateClassifier.ts`, con `resolve(recordKey)` | Solo fonti che espongono reader e contenuto verificabile |
| `killer-sudoku-export` | `format: "killer-sudoku-export"`, `version: 1` | `PublicExport`, `serializePublicExport`, `deserializePublicExport` in `publicBoundary.ts` | Supportato in questo incremento, strict |
| QR pubblico | nessun contratto implementato in precedenza | `parsePublicQr` implementa il contratto minimo versionato di questo incremento | JSON UTF-8 con `format`, `version`, `id`; nessun campo extra |

Non sono dichiarati supportati altri marker, versioni, formati legacy o fixture privi di evidenza.

## Contenuto, identità e D4

`extractPlayableContent`, `canonicalizePlayableContent` e `fingerprintPlayableContent` sono riutilizzati. L’estrazione conserva coordinate, gabbie e orientamento originale; ID delle gabbie e metadati esclusi non entrano nel contenuto giocabile o nel fingerprint. `FingerprintRef` resta strutturato e opaco: il boundary non lo converte in stringa e non ricalcola fingerprint storici.

Identità pubblica, `observationKey`, `RecordKey`, `FingerprintRef` e contenuto sono distinti. D4 resta una verifica di equivalenza: anche se una trasformazione riconosce il contenuto, il lookup restituisce il contenuto letto dalla fonte storica senza rotazioni o riflessioni.

## Lookup ID e QR

`lookupPublicId` valida l’identificatore, trova una sola identità, quindi usa `IdentityHistory.firstAssignment.observationKey` per individuare una sola `Association`. Verifica contemporaneamente appartenenza alla stessa identità e coincidenza di `Association.recordKey` con `firstAssignment.recordKey`; non usa soltanto il `RecordKey`, l’ordine degli array o associazioni successive. Risolve poi quel `RecordKey` nella `HistoricalContentSource`, restituendo contenuto originale, riferimenti e fingerprint dell’associazione canonica. Riferimenti mancanti, incoerenti, ambigui o multipli producono diagnostiche deterministiche.

Lo stato `removed` non cancella il contenuto: se la prima associazione è `removed` ma la fonte risolve ancora il record, il contenuto originale viene restituito senza fallback. La stessa politica è usata da `lookupPublicQr`, dopo il parsing del payload. Il QR è JSON UTF-8 con esattamente `format: "killer-sudoku-qr"`, `version: 1` e `id`; non contiene contenuto, soluzione, fingerprint o stato utente.

## Export pubblico v1

L’export è costruito con allowlist positiva e non riusa implicitamente `killer-sudoku-save`. Contiene marker/versione e una proiezione esplicita di identità (`id`, alias consentiti), `RecordKey`, `FingerprintRef` opzionale, `PlayableContent` (`size`, `clues`, `cages`) e soltanto i metadati pubblici dichiarati (`difficulty`). Non propaga `IdentityHistory` completa: `firstAssignment`, associazioni, observation key e stati `removed` restano interni. Soluzione, note, cronologia, statistiche, sessione, progressi, stato utente, dati runtime e campi non allowlisted sono esclusi.

`serializePublicExport` costruisce un nuovo oggetto, canonicalizza il contenuto giocabile tramite `canonicalizePlayableContent` (senza trasformazioni D4) e ordina gli alias; `deserializePublicExport` accetta soltanto marker/versione supportati, valida il contenuto e rifiuta campi extra. Il dispatcher `readVerifiedDocument` distingue strictamente `PuzzleDefinition`, `killer-sudoku-save` ed export pubblico, riusando `validatePuzzle` e `deserialize`; marker o combinazioni non riconosciuti producono diagnostiche stabili.

## Salvataggio e test

`killer-sudoku-save` mantiene il contratto completo, inclusa la sessione prevista dal modello. `saveDocument` valida e serializza prima di una sola sostituzione tramite `PersistenceContract.replace`; gli errori precedenti non sostituiscono il documento precedente.

`tests/publicBoundary.test.ts` copre contenuto `removed`, sequenza storica A(current) → B(removed) → A(current), lookup indipendente dall’ordine, verifiche observation key/RecordKey, QR condiviso con ID, campi extra, export deterministico e assenza di stato utente, oltre alla conservazione dell’orientamento originale dopo D4. I test esistenti in `tests/domain.test.ts` coprono il contratto `killer-sudoku-save` e la persistenza.
