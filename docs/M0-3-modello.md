# M0-3 — Modello di puzzle e stato di partita

## Perimetro

M0-3 implementa il dominio puro e il contratto JSON del Killer Sudoku. Sono inclusi:

- tipi versionati per puzzle, gabbie, celle, partita e cronologia;
- validazione di puzzle, stato, cronologia e documento persistito;
- serializzazione e deserializzazione JSON;
- `newGame`, `editCell`, `undo`, `redo`, `pause`, `resume` e `complete`;
- fixture deterministiche e test del dominio;
- contratto astratto di persistenza e test double.

Sono esclusi timer attivo, UI giocabile, solver/backtracking, motore completo di partita e storage concreto. La UI resta la baseline non giocabile di M0-2.

## Modello e invarianti

Le coordinate persistite sono oggetti `{ row, col }` zero-based nella griglia 9×9. Puzzle e partita usano schema version `1.0`; `puzzleId` collega lo stato al puzzle e la difficoltà è una delle modalità supportate (`easy`, `medium`, `hard`, `expert`).

Le gabbie coprono esattamente la griglia, senza sovrapposizioni o duplicati, sono ortogonalmente connesse e hanno celle in ordine canonico row/col. La somma rispetta i limiti delle cifre distinte e la compatibilità con i givens è verificata localmente; ciò non dimostra la risolvibilità globale. `validatePuzzle` è il punto d’ingresso unico: accetta esclusivamente la forma `PuzzleDefinition` versione `1.0`, con coordinate zero-based `{ row, col }`, e rifiuta campi extra o forme derivate.

`labelAnchor` e il testo dell’etichetta sono dati derivati: l’ancora è la prima cella canonica e il testo deriva dalla somma. Nessuno dei due è persistito.

I givens non possono essere modificati né annotati. Un valore esclude le note della stessa cella; una cella vuota può contenere note ordinate, distinte e comprese tra 1 e 9. Un’azione che cambia valore e note li registra insieme nello stesso snapshot, così undo e redo non perdono informazioni.

`not_started` richiede valori iniziali, note vuote, tempo zero, cronologia vuota e `historyIndex = -1`. La prima modifica porta lo stato a `in_progress`; undo totale non lo riporta a `not_started`. `pause` e `resume` non cambiano dati, cronologia o tempo. `completed` è prodotto solo da `complete` dopo la verifica completa della soluzione; undo e redo sono sempre rifiutati in quello stato.

La cronologia conserva anche il ramo redo. Il validatore ricostruisce tutte le voci, comprese quelle oltre `historyIndex`, controllando `before`, `after`, givens, identificatori e timestamp. `elapsedSeconds` non diminuisce e deve essere almeno il massimo `elapsedSecondsAfter` dell’intera cronologia.

Tutte le trasformazioni ricevono esplicitamente il puzzle quando devono proteggere i givens o verificare la soluzione. Gli input non vengono mutati.

## JSON e persistenza

Il documento ha forma:

```json
{
  "format": "killer-sudoku-save",
  "schemaVersion": "1.0",
  "puzzle": {},
  "game": {}
}
```

`serialize` valida prima di produrre JSON; `deserialize` esegue parsing e validazione completa prima di restituire un nuovo documento. L’ordine delle gabbie, delle celle canoniche, delle note e della cronologia è conservato.

`PersistenceContract` definisce soltanto il confine astratto:

- `load()` restituisce il documento serializzato oppure solleva un errore;
- `replace(serializedDocument)` sostituisce il documento con semantica atomica oppure solleva un errore.

`loadDocument` non accetta JSON invalido. `saveDocument` serializza e valida prima di chiamare `replace`. Di conseguenza un caricamento invalido o una scrittura fallita non sostituiscono lo stato/documento precedente, secondo il contratto dell’adapter. Non viene introdotto alcun filesystem, database, `localStorage`, temporaneo o rename; i test usano un test double configurabile.

## API di dominio

Le funzioni sono disponibili in `src/domain/game.ts`, i validatori in `src/domain/validation.ts`, il contratto in `src/domain/persistence.ts`, e serializzazione/derivazioni in `src/domain/serialization.ts`. Le fixture deterministiche sono in `src/domain/fixtures.ts` e i test di dominio in `tests/domain.test.ts`.

## Verifica M1-2

`verifyGame` in `src/domain/verification.ts` valida una matrice 9×9 associata al puzzle e restituisce l'esito derivato `INCOMPLETA`, `CONFLITTO` o `VALIDA`, senza aggiungere dati a `GameState` o al documento di salvataggio. Controlla duplicati in righe, colonne, riquadri e gabbie, oltre alle somme complete e alla raggiungibilità locale delle somme parziali tramite cifre distinte.

L'omissione della griglia iniziale produce una copia dei givens con le altre celle vuote. Le griglie fornite devono contenere soltanto `null` o interi da 1 a 9 e non possono modificare i givens; gli input malformati sono rifiutati come errori di validazione. Una griglia completa ma conflittuale resta `CONFLITTO`.

`complete` invoca esplicitamente `verifyGame` e porta lo stato a `completed` soltanto per un esito `VALIDA`. Gli stati intermedi conflittuali rimangono validi e persistibili secondo le invarianti esistenti. Solver, ricerca e conteggio delle soluzioni non fanno parte di questo incremento.
