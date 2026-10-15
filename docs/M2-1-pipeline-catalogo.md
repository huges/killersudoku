# M2-1 — Pipeline offline di verifica del catalogo

Questa fase introduce esclusivamente la pipeline tecnica offline e un campione rappresentativo. Il campione non completa il catalogo M2: quantità, distribuzione dei livelli e classificazione della difficoltà umana sono rinviate a M2-2/M2-3. Nodi DFS e metriche strutturali sono dati tecnici, non misure della difficoltà umana.

## Verifica

`npm run verify:catalog` legge soltanto i file dichiarati da `catalog/fixtures/manifest.json`. Per ogni input conserva la forma originale, rifiuta campi sconosciuti e dati derivati, riusa `validatePuzzle`, controlla gli identificatori, canonicalizza solo dopo la validazione e calcola SHA-256 dell'intera rappresentazione canonica validata. Il solver condiviso viene invocato soltanto dopo i controlli strutturali e sono accettati esclusivamente gli esiti `unique`, conteggio 1 e ricerca completa.

Il risultato atteso e `catalog/identity-lock.json` sono versionati. La verifica è in sola lettura, confronta il risultato byte per byte e non aggiorna identità o riferimenti. Un fingerprint storico diverso per lo stesso ID è un errore; il lock documenta soltanto la storia registrata, non storia non presente nei file.

## Operazioni separate

- `npm run catalog:generate-fixtures <directory> <seed> <generatorVersion> [key=value,...]` genera deterministicamente soltanto gli input dichiarati nell'output e stampa l'elenco dei file prodotti. Non aggiorna manifest, lock o risultato.
- `npm run catalog:update-reference -- --output <candidate>` produce un candidato distinto e non sovrascrive il riferimento storico.
- `npm run catalog:register-identities -- --output <lock>` registra solo contenuti verificati e rifiuta sostituzioni di fingerprint storici.

Le fixture e i test coprono input strutturalmente invalido, dati derivati, ID duplicati o modificati, ricerca incompleta, risultato non riproducibile e fingerprint completo.

## Mozart e CI

Il runner canonico `python3 scripts/mozart-web-game.py validate` esegue installazione, lint, test, `npm run verify:catalog` e solo dopo build. La workflow CI richiama lo stesso runner. Il blocco del merge richiede inoltre la configurazione del check come required check nelle branch protection rules GitHub; non è implicato dal codice della pipeline.
