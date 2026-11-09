# M2-4F — Migrazione, candidati e dry-run

## Obiettivo e confini

Il comando `npm run migration -- <command> ...` espone sei modalità offline nel namespace `killer-sudoku`: `verify`, `migrate`, `generate-catalog`, `generate-identities`, `generate-references` e `dry-run`. La pipeline costruisce report, diff e candidati; non adotta risultati e non modifica identity-lock, Registry, cataloghi, riferimenti, fixture o dati utente autorevoli.

Il modello condiviso conserva `RecordKey`, ID pubblico quando presente, alias ordinati, fingerprint legacy opaca, contenuto giocabile originale, fingerprint corrente e versioni/riferimenti disponibili. Il contenuto originale rappresenta anche l'orientamento storico: non viene introdotto alcun campo `orientation`. Soluzione, note, statistiche, cronologia, sessione e stato utente non fanno parte dei candidati.

## Fonti effettivamente supportate

| Fonte | Evidenza e uso | Limiti |
|---|---|---|
| Campione tecnico M2-1 | `catalog/fixtures/inputs.json`, `manifest.json`, `catalog/results/catalog-result.json`; primitive `verify-catalog`/`catalogPipeline` | Fixture di verifica e regressione, non fonte storica completa |
| Identity-lock legacy | `catalog/identity-lock.json`; mappa `puzzleId`/fingerprint opaca | Lettura/validazione dei valori presenti בלבד; non ricostruisce first assignment, associazioni, alias o ID pubblici |
| Registry v1 | `src/domain/registry.ts` e `docs/M2-4C-registro-storico.md`; storia, assegnazioni, associazioni, alias e riserve | Fonte di identità/storia, non di contenuto |
| `HistoricalContentSource` | Contratto in `src/domain/duplicateClassifier.ts` e `docs/M2-4D-duplicati-associazioni-storiche.md` | Deve essere separata e indipendente dal candidato; risoluzione `missing`/`ambiguous` blocca la classificazione |
| Boundary M2-4E | `publicBoundary`, `persistence`, `serialization` e `docs/M2-4E-compatibilita-lookup-export.md` | La CLI legge l'export `killer-sudoku-export` v1 tramite `readVerifiedDocument`; save v1 e `PuzzleDefinition` schema 1.0 sono riconosciuti e validati, ma non migrabili senza un `RecordKey` indipendente |

Il reader di record della CLI riusa `readVerifiedDocument` del boundary M2-4E per l'export pubblico `killer-sudoku-export` v1: conserva `RecordKey`, ID e alias, fingerprint legacy opaca, contenuto e versione export. `killer-sudoku-save` v1 e `PuzzleDefinition` schema 1.0 sono riconosciuti e validati dal dispatcher M2-4E, ma non sono convertiti in record migrabili perché non contengono un `RecordKey` indipendentemente verificabile; la CLI li rifiuta esplicitamente invece di derivare una chiave da `puzzleId`. Il campione M2-1 e identity-lock restano input per i rispettivi reader/ruoli e non sono promossi a record storici completi o Registry. Non sono dichiarati altri formati o versioni. Se un record completo indispensabile non è leggibile da una fonte verificabile, non vengono inventati dati sostitutivi: la classificazione si blocca (`missing-historical-content` quando applicabile).

## Pipeline e comandi

Tutte le modalità condividono parsing, ordinamento canonico, validazione del puzzle, estrazione/canonicalizzazione del `PlayableContent`, fingerprint corrente e report deterministico. Quando sono forniti Registry e `HistoricalContentSource`, il confronto riusa `classifyDuplicate` e D4-v1; la fingerprint resta soltanto un indice. `generate-identities` riusa `assignIncremental` per proporre un Registry candidato e non ricicla ID.

- **verify**: produce il report senza candidati.
- **migrate**: conserva i dati legacy verificabili e calcola la fingerprint corrente mancante.
- **generate-catalog**: emette candidati solo per record validati e classificati.
- **generate-identities**: propone l'estensione del Registry separato dall'identity-lock legacy.
- **generate-references**: produce report/diff per riferimenti, senza modificare la fonte.
- **dry-run**: restituisce lo stesso risultato logico in memoria/stdout e rifiuta `--output`; non crea file, directory, staging o temporanei persistenti.

Un record invalido non entra in `candidate`. Gli esiti del report sono `pass`, `duplicate`, `associated`, `candidate`, `ambiguous`, `collision` ed `error`, con diagnostiche ordinate per codice, path e `RecordKey`.

## Confronto storico e auto-confronto

La coincidenza di `RecordKey` da sola non è auto-confronto. È ammessa una ricorrenza quando candidato e fonte sono file distinti, la provenienza è indipendente, identità e riferimenti sono coerenti, il contenuto storico è verificato e D4-v1 conferma l'equivalenza completa. Candidato usato come propria fonte, stessa identità fisica/staging, contenuto non verificabile e conflitti producono errore, ambiguità o collisione secondo il caso. La CLI richiede file `--history` e `--input` fisicamente distinti e non ricava la storia dai candidati. **Questa verifica non attesta da sola l'indipendenza cronologica dei dati:** l'operatore deve fornire una fonte storica già verificata e indipendente. Due file distinti creati copiando il medesimo candidato non diventano una storia autorevole; il codice non può provare la loro provenienza senza un contratto di attestazione separato. Una sola identità equivalente produce duplicate/associated; più identità producono ambiguous; storia mancante blocca la classificazione.

## Percorsi e pubblicazione

La CLI M2-4F rifiuta NUL, separatori ambigui, assoluti, traversal e componenti vuote, `.` o `..`. Le due CLI legacy accettano anche un percorso assoluto **solo se interno alla root autorizzata**, tramite lo stesso writer; risolve i percorsi soltanto sotto la directory di lavoro autorizzata e rifiuta componenti symlinkate. I reader dei file controllano con `lstat` che l'input sia un file regolare non symlink, poi lo aprono con `O_NOFOLLOW`; verificano sul descriptor `fstat` che device/inode coincidano con quelli controllati prima dell'apertura e verificano nuovamente identità e dimensione dopo la lettura. Le fonti di input, storia e Registry sono inoltre distinte per identità fisica prima dell'elaborazione.

Per un singolo report (anche dalle CLI legacy), il parent autorizzato viene aperto con `O_DIRECTORY | O_NOFOLLOW`; l'identità device/inode sul descriptor deve coincidere con quella verificata sul percorso. Il descriptor resta aperto per tutta la transazione e staging, temporaneo e destinazione sono indirizzati tramite `/proc/self/fd/<descriptor>`, così la pubblicazione continua a riferirsi all'oggetto directory verificato anche se il nome del parent viene sostituito. Prima del link no-replace si ricontrolla anche l'identità del parent al percorso; un hard link atomico pubblica il file completo e fallisce se la destinazione esiste. Il temporaneo è aperto in esclusiva, flushato, riletto e confrontato con il contenuto previsto; staging viene rimosso in caso di errore. Il percorso descriptor-backed dipende da `/proc/self/fd`; se non è disponibile la pubblicazione fallisce chiusa, senza ripiegare su un percorso non ancorato.

**Decisione di scope — opzione A (8 novembre 2026):** ogni invocazione persistente pubblica **un solo artifact JSON** con le sezioni `command`, `records`, `candidate`, `diff`, `diagnostics`. La serializzazione ordina ricorsivamente le chiavi degli oggetti, senza alterare il significato degli array. Il writer pubblica il documento completo una sola volta, con creazione esclusiva no-replace; gli errori di validazione bloccano la generazione di qualsiasi candidato parziale. Le fonti autorevoli restano inalterate. La pubblicazione indivisibile di una directory di più file è **fuori scope**, non una funzionalità parziale o disponibile come API dimostrativa. Un eventuale bisogno futuro richiede un item separato. Vedi `docs/M2-4F-scope-single-artifact.md`.

## Verifica

`tests/migrationPipeline.test.ts` verifica ordinamento, JSON canonico anche per proprietà annidate, assenza di `orientation` e di stato utente, compatibilità export verificato, dry-run senza scrittura, controllo delle fonti, publication race e output single-artifact senza sovrascritture. `tests/catalogPipeline.test.ts` copre anche le CLI legacy con percorsi assoluti confinati, destinazione già presente, escape e parent symlink. Ogni modifica alla PR deve superare typecheck, lint, suite completa, `verify:catalog`, build e CI GitHub sul nuovo HEAD; i risultati di validazioni precedenti non equivalgono a quelli del nuovo commit.
