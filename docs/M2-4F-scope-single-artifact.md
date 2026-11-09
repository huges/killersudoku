# M2-4F — Decisione di scope: un artifact JSON per esecuzione

**Decisione del responsabile di prodotto: 8 novembre 2026 — Opzione A.** Implementata sulla PR #15. Questa decisione non assegna nuove versioni agli artifact approvati in Mozart: l'allineamento della roadmap e delle revisioni Requirements/Game Design rimane manuale.

## Requisito aggiornato (delta rispetto a Requirements e Game Design precedenti)

Ogni comando offline `verify`, `migrate`, `generate-catalog`, `generate-identities` e `generate-references` costruisce in memoria un **unico documento JSON completo** con `command`, `records`, `candidate`, `diff`, `diagnostics`. `dry-run` esegue la stessa elaborazione logica della modalità selezionata e restituisce il risultato in memoria/stdout, senza creare file. Le due CLI legacy conservano il formato legacy nella modalità preesistente.

Il documento persistente è pubblicato in un solo file nuovo tramite staging nello stesso filesystem, scrittura e sincronizzazione, verifica, poi link atomico **no-replace** ancorato al descriptor della directory autorizzata. Nessun file esistente è sostituito; errori bloccanti producono `candidate: []` e diagnostiche, non candidati parziali. Nessun comando adotta risultati o modifica fonti autorevoli, cataloghi, identity-lock, Registry, fixture o dati utente.

La **pubblicazione atomica multi-file di directory è esclusa** dal requisito M2-4F. La sua introduzione futura richiede una decisione e un item autonomi. Non mantenere stub pubblici che sembrino offrire un'API multi-file.

## Design aggiornato: riuso delle capability

- `runMigration` riusa `verifyCatalog`, `extractPlayableContent`, fingerprint canonico, Registry/`assignIncremental` e `classifyDuplicate` con D4-v1; non introdurre altri resolver/registri o modelli di identità.
- `stableMigrationJson` e le diagnostiche riusano **la stessa logica di ordinamento ricorsivo delle chiavi**, senza riordinare array semanticamente ordinati.
- `writeExclusive` è l'unico publisher single-file per i comandi nuovi e le due CLI legacy. Queste ultime mantengono la compatibilità con output assoluti **all'interno della cwd autorizzata**, rifiutando traversals, symlink, parent sostituiti e destinazioni esistenti.
- `--history` è una fonte storica di lettura distinta fisicamente da `--input` e `--registry`; nessun auto-confronto o trasformazione di identity-lock legacy in Registry v1. La capacità di stabilire la **provenienza storica originale** appartiene al processo che prepara/autorizza il dataset e non è garantita dal solo `dev/inode`. Questa PR non introduce attestatori o manifest inventati: se manca la prova esterna, non presentare la fonte come attestata.

## Verifica e tracciabilità

I test dell'incremento coprono output unico, ordine canonico ricorsivo, dry-run, import/export documentati, esclusività, symlink/escape, sostituzione della directory parent e regressioni CLI legacy. Restano obbligatori typecheck, lint, suite completa, `verify:catalog`, build e CI sul nuovo HEAD.

**Governance:** la PR non effettua merge e non chiude l'item. La sincronizzazione della decisione con Requirements/Game Design versionati e roadmap Mozart sarà verificata durante la chiusura manuale. Le versioni degli artifact #827/#828 del workflow #232 non vengono dichiarate aggiornate da questo file.
