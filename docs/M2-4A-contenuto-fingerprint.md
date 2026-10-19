# M2-4A — Contenuto giocabile canonico e fingerprint

## Modelli e separazione

Il modello autorevole resta `PuzzleDefinition` in `src/domain/types.ts`: contiene `schemaVersion`, `puzzleId`, `difficulty`, `size`, la matrice `givens` 9×9 e gabbie originali `{ id, cells, sum }`. `givens` è l’unica sorgente degli indizi. I valori `null` non producono clue; ogni altro valore produce `{ row, col, value }` con coordinate zero-based nell’orientamento storico.

`src/domain/identity.ts` espone un modello distinto e fingerprintabile: `{ size, clues, cages }`. Le gabbie di questo modello contengono esclusivamente `{ cells, sum }`; ID, schema, difficoltà, `puzzleId`, metadati, date, soluzione e stato utente sono esclusi. La data, nei modelli metadata applicabili, resta `null` quando assente e comunque non entra nel contenuto.

## Contratti

- `extractPlayableContent(originalPuzzle)` valida il `PuzzleDefinition` con `validatePuzzle`, copia senza alias gabbie e celle e materializza i clue da `givens`. Non modifica l’input, non cerca soluzioni e non verifica unicità.
- `canonicalizePlayableContent(content)` accetta solo il contenuto già estratto: rifiuta `PuzzleDefinition`, `givens` e campi estranei, applica la validazione del contenuto e restituisce JSON compatto con soli `size`, `clues` e `cages`.
- `fingerprintPlayableContent(content)` usa lo stesso confine di validazione e calcola SHA-256 sulla stringa canonica UTF-8. Il digest è calcolato sui byte UTF-8 della stringa canonica e il risultato è `sha256-` seguito da 64 cifre esadecimali minuscole. Un input invalido non produce né stringa canonica né digest.

Il flusso da un puzzle originale è esplicito: `extractPlayableContent(puzzle)` seguito da canonicalizzazione o fingerprint.

## Validazione e diagnostica

Sono mantenuti gli invarianti Sudoku e delle gabbie del validatore originale: matrice e valori 9×9, conflitti su righe, colonne e regioni, coordinate valide, gabbie non vuote, senza duplicati o sovrapposizioni, con copertura esatta, connessione ortogonale, somme intere compatibili con cifre distinte e con i clue fissati. Il validatore del contenuto applica gli stessi vincoli senza richiedere ID.

Le diagnostiche includono percorso e, quando applicabile, indice e coordinata (per esempio `content.clues[2].value` o `content.cages[1].cells[0]`). L’ordine di attraversamento per una singola rappresentazione è deterministico: struttura, clue ricevuti, gabbie ricevute, celle ricevute, quindi invarianti globali. La validazione non muta gli array e rifiuta anche array sparsi o elementi `null`/`undefined`, indicando il percorso e l'indice mancanti; una permutazione può cambiare il primo errore, ma la stessa rappresentazione immutata produce la stessa sequenza.

## Canonicalizzazione

Le copie usate per la serializzazione ordinano clue e celle numericamente per `row`, poi `col`. Le gabbie sono ordinate con una chiave composta esclusivamente dalle celle già ordinate e dalla somma. Non sono usati ID, `localeCompare` o ordinamenti dipendenti dalla locale. Riordinare clue, celle o gabbie senza cambiare il contenuto logico mantiene serializzazione e fingerprint.

La funzionalità non introduce ricerca della soluzione, controllo di unicità, D4, registro, assegnazione di ID, CLI, migrazione o adozione.
