# M2-4G — Requirements v2 (proposta, NON approvata)

**Provenienza:** Mozart workflow #234, Requirements v1 artifact #839; il testo v1 resta immutato.  
**Stato:** delta proposto per una nuova approvazione umana governata. Non è un'autorizzazione all'adozione né un artifact approvato da Mozart.

## R1. CLI e fonti indipendenti

L'interfaccia di base è: adopt --candidate FILE --output FILE --confirm.

La riverifica richiede inoltre tre ruoli di lettura espliciti e obbligatori: --input LEGACY_RECORDS, --registry REGISTRY_V1, --history HISTORICAL_RECORDS. L'assenza di un ruolo arresta il comando senza scritture. Il report M2-4F non può fungere da propria fonte storica o Registry; i ruoli devono puntare a file regolari fisicamente distinti, entro la root autorizzata, senza traversal, symlink o alias fisici.

L'operatore deve attestare l'origine e l'indipendenza cronologica delle fonti: device/inode diversi non sono prova di autorità storica. --confirm è autorizzazione all'azione, non prova di provenienza.

## R2. Modalità adottabili

Sono adottabili soltanto documenti persistenti M2-4F nelle modalità migrate, generate-catalog, generate-identities e generate-references, con almeno un candidato e nessuna diagnostica bloccante. verify non produce candidati. dry-run non attesta il mode originario: rifiutarlo fino a un eventuale contratto esplicito separato.

Il documento conserva lo schema M2-4F con command, records, candidate, diff, diagnostics. Nessun secondo formato o Registry sintetico.

## R3. Riverifica read-only

Rieseguire la pipeline M2-4F sulle fonti indipendenti, nella modalità effettiva del documento, e confrontare l'intero report canonico, non soltanto i record candidate. Quando la modalità originale non esegue classificazione storica, eseguire anche il gate read-only generate-catalog con le stesse fonti. Nessun utilizzo di candidate come LegacyRecord, di records come storia indipendente o di diff.registry come Registry autorevole.

Rifiutare ogni incongruenza di fingerprint, orientamento storico, ID pubblico, alias, associazioni, riferimenti, riserve o classificazione; nessun ID riciclato o assegnazione nuova implicita. Riutilizzare Registry M2-4C, duplicate classifier M2-4D con D4-v1, e pipeline M2-4F. L'identità pubblica dei risultati adottabili deve essere integra e verificata.

## R4. Filesystem e pubblicazione

L'unica mutazione possibile è la creazione di un singolo file nuovo sotto la root autorizzata, fuori dai percorsi autorevoli. Non modificare input, report, Registry, storia, cataloghi, riferimenti, fixture, identity-lock o dati utente. Output preesistente, target o ancestor symlink, traversal, alias, race di parent e pubblicazione devono fallire senza overwrite e senza output parziale.

Riutilizzare il publisher descriptor-anchored M2-4F writeExclusive con staging, fsync, verifica bytes e hard-link atomico no-replace. Questa precisazione sostituisce il riferimento a rename del design v1; mantiene l'invariante "mai sostituire output".

## R5. Diagnostiche e test

Mantenere codici distinti: confirm-missing, candidate-missing, candidate-invalid, output-missing, output-unauthorized, output-exists, output-traversal, output-symlink, candidate-reverify-failed, collision-or-ambiguity, id-integrity-violation, reference-integrity-violation. Ogni errore termina non-zero e senza scritture.

Obbligatori test E2E positivi con candidati M2-4F realmente prodotti (almeno migrate e generate-catalog), confronto integrale, immutabilità byte-level delle fonti, fail-fast CLI, symlink/traversal/output esistente, fonte duplicata per inode, Registry/history mancanti o incompatibili, report manomesso, collisioni ID e riferimenti, cleanup in ogni failure path. Typecheck, lint, test, verify:catalog e build sul nuovo HEAD.

## R6. Governance

I Requirements v1 #839 e Game Design v1 #840 del workflow Mozart #234 restano immutabili. Questa proposta v2 cambia il contratto, dunque deve essere approvata attraverso un nuovo gate governato prima di usare la patch in una delivery. Non alterare fingerprint né riclassificare la #234. Nessuna PR di solo documento implica il completamento di review, test/build, approvazione umana Mozart o autorizzazione a pubblicare.
