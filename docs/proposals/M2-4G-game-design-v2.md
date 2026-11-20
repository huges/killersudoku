# M2-4G — Game Design v2 (proposta, NON approvata)

**Provenienza:** Mozart workflow #234, Game Design v1 artifact #840, Requirements v2 proposti.  
**Stato:** proposta da sottoporre a nuova approvazione governata. Il design v1 rimane immutabile.

## Responsabilità e riuso

I principi di scopo, interfaccia, fail-fast, verifiche, atomicità, diagnosi e test del v1 rimangono applicabili, con i chiarimenti seguenti.

- Unico nuovo entrypoint: scripts/adopt-command.ts; il mapping delle diagnostiche e la policy additiva dei percorsi non autorevoli possono rimanere funzioni private al comando.
- Reader read-only esistente: readJson in scripts/migration-command.ts; nessun reader indipendente incompleto.
- Riesecuzione senza output: execute con dry-run --mode <mode> e ruoli --input, --registry, --history, sul vero LegacyRecord input. Normalizzare solo il campo command nel confronto con il report persistente.
- Pipeline di dominio: parseMigrationInput, runMigration, stableMigrationJson e generateIdentityCandidate da src/domain/migrationPipeline.ts; identità, riserve e confronto storico a carico di Registry e duplicateClassifier esistenti.
- Gate storico aggiuntivo: generate-catalog read-only sulle stesse fonti, quando la modalità originaria non impone già classificazione indipendente.
- Publisher unico: writeExclusive da scripts/migration-command.ts, con hard-link atomico no-replace e verifica del parent via descriptor.
- Non introdurre cinque servizi duplicati (adoptPolicy, adoptPreflight, adoptReverify, adoptWriter) finché le primitive M2-4F esistenti soddisfano il contratto. L'implementazione del v1 che rileggeva records/diff come autorità non è accettabile.

## Fasi vincolanti

1. Parsing di flags noti, senza duplicazioni; verificare --confirm prima di qualsiasi scrittura.
2. Verificare candidate, output e tutte e tre le fonti read-only esplicite. Percorsi sotto root, no traversal/symlink, identità fisiche separate, output non autorevole e non esistente.
3. Leggere il candidato tramite reader sicuro; validare il documento completo con cinque campi canonici, mode ammesso, non-dry-run e candidati non vuoti.
4. Rieseguire la modalità di pipeline del report dalle tre fonti, senza trasformare CandidateRecord in LegacyRecord.
5. Confrontare la serializzazione canonica completa (normalizzando solo la label command tra dry-run e invocazione persistente). Non omettere diff, records o diagnostics.
6. Applicare il gate indipendente generate-catalog per i mode non già classificati contro storia/Registry. Ogni collisione, ambiguità, ID non integro, reference incoerente, fingerprint manomessa o fonte non verificabile fallisce chiusa.
7. Pubblicare il documento completo sul nuovo output con writeExclusive e controlli di staging/parent/race. Successo solo dopo la verifica finale; nessuna mutazione autorevole.

## Test e limitazioni

Test positivi con veri report M2-4F (migrate e generate-catalog) e fixture PuzzleDefinition valide, non JSON costruiti artificialmente. Test negativi per flag obbligatori, output esistente, traversal/symlink/race, candidate/documento alterati, stessa inode per ruoli distinti, Registry/history mancanti o incompatibili, id/reference/association conflict, e verifica dell'immutabilità byte-level delle sorgenti.

Il test eseguito nella copia isolata del checkpoint #234 ha superato 247/247 test Vitest, lint, typecheck, verify:catalog e build sul runner Mozart web-game/2. Questo è solo evidenza tecnica offline del bundle v3: non è CI GitHub, non è validazione di un HEAD pubblicato, e non equivale all'approvazione v2.

## Governance dell'handoff

I file con il codice v3 restano nel bundle isolato e nel Git checkpoint locale #234; non sono introdotti dalla PR documentale. La vecchia istanza #234 è failed con fingerprint del design v1; l'import-correction esistente non può essere usato per sostituire tacitamente quel fingerprint con la v2. Serve una nuova revisione documentale approvata e un passaggio esplicito che associ la patch verificata al nuovo design, senza saltare le fasi review/test/build.
