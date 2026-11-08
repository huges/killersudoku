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
| Boundary M2-4E | `publicBoundary`, `persistence`, `serialization` e `docs/M2-4E-compatibilita-lookup-export.md` | Sono utilizzati solo marker/versioni/reader documentati |

Non sono dichiarati altri formati legacy o versioni. Se un record completo non è leggibile da una fonte verificabile, non vengono inventati dati sostitutivi: l'esito è bloccante (`missing-historical-content` quando applicabile).

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

La coincidenza di `RecordKey` da sola non è auto-confronto. È ammessa una ricorrenza quando candidato e fonte sono file distinti, la provenienza è indipendente, identità e riferimenti sono coerenti, il contenuto storico è verificato e D4-v1 conferma l'equivalenza completa. Candidato usato come propria fonte, stessa identità fisica/staging, provenienza circolare, contenuto non verificabile e conflitti producono errore, ambiguità o collisione secondo il caso. Una sola identità equivalente produce duplicate/associated; più identità producono ambiguous; storia mancante blocca la classificazione.

## Percorsi e pubblicazione

La CLI rifiuta NUL, separatori ambigui, assoluti, traversal e componenti vuote, `.` o `..`; risolve i percorsi soltanto sotto la directory di lavoro autorizzata. Gli input sono letti in sola lettura dopo il controllo dei componenti e dell'identità fisica delle fonti. Per un singolo report, il contenuto viene prima scritto con apertura esclusiva in una directory temporanea confinata sullo stesso filesystem, flushato e riletto; la pubblicazione usa un hard link atomico che fallisce se la destinazione esiste. Il parent viene confrontato prima/dopo la scrittura e staging viene rimosso in caso di errore.

Questa implementazione supporta e testa il percorso singolo-file della CLI. Non dichiara supportata l'atomicità indivisibile multi-file: non esiste una pubblicazione di directory con singola operazione no-replace né una suite filesystem che la dimostri. Di conseguenza i comandi correnti producono un solo report/output per invocazione; non devono essere interpretati come garanzia per set multi-file. Le fonti autorevoli restano inalterate nei fallimenti.

## Verifica

`tests/migrationPipeline.test.ts` copre ordinamento/riproducibilità, conservazione della fingerprint legacy, assenza di `orientation`, rifiuto di contenuto malformato e dry-run senza scrittura. Le regressioni delle primitive esistenti restano nei test di catalogo, Registry e duplicate classifier. Il controllo focused/typecheck di questa fase è intermedio; review, lint, suite completa, `verify:catalog`, build e CI governati restano successivi.
