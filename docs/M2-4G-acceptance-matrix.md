# M2-4G — Matrice di verifica del contratto v2

**Base immutabile della proposta:** workflow Mozart #235; requirements #841 v2;
Game Design #842 v2; review #844 v1 (`revise`); commit locale
`a8af9533f51a083b6de9daa9b9dd2f4455c08cd5` nel workspace #16.
Questa è una proposta di completamento delle evidenze, **non** una nuova
approvazione del design o un'attestazione di successo dei gate.

## Comando e autorizzazione

Il contratto approvato richiede:

```text
npm run adopt -- --candidate FILE --input LEGACY_RECORDS --registry REGISTRY_V1 --history HISTORICAL_RECORDS --output FILE --confirm
```

- Ogni percorso è esplicito, sotto root autorizzata, senza traversal, symlink o alias fisico dei quattro ruoli di lettura.
- L'operatore deve identificare fonti storiche **indipendenti e autorevoli**. Inode differenti, hash o file copiati **non** provano l'indipendenza storica.
- Il flag `--confirm` non sostituisce l'autorizzazione umana di una reale adozione. In questa PR non si adotta alcun dato reale.
- Il documento persistente di `verify` e quello etichettato `dry-run` non sono adottabili; soltanto `migrate`, `generate-catalog`, `generate-identities` e `generate-references` possono essere presi in considerazione dopo la riverifica.
- L'unico output consentito è un **nuovo** file non autorevole, tramite `writeExclusive` M2-4F; nessuna fonte può essere sovrascritta.

## Tracciabilità e test

| Contratto | Evidenza nel commit #235 | Integrazione proposta | Stato prima dei gate |
| --- | --- | --- | --- |
| Requirements §2 / Design §2, §4.1: sei ruoli obbligatori | `executeAdopt` controlla i flag; test precedenti coprono solo un sottoinsieme | `adoptAcceptance.test.ts`: tutte le omissioni, ciascun duplicato, flag ignoti e posizionali, senza output | Da eseguire |
| Requirements §3 / Design §4.3: persistente `verify` rifiutato | `adoptable` esclude `verify`, test precedenti coprono solo `dry-run` | Report `verify` reale M2-4F e documento forgiato, rifiuto senza mutazioni | Da eseguire |
| Requirements §4 / Design §4.4–5: replay dell'intero report, migrate due forme | `adopt-command.ts` usa `stableMigrationJson`, test `adoptCommand.test.ts` coprono le due forme e `generate-catalog` | Nessun secondo parser/replayer, preservare la copertura esistente | Da rieseguire |
| Requirements §4 / Design §4.5: gate storico, ID e riferimenti | `execute` M2-4F e `assertHistoricalClassification`, `assertPublicIds`; test legacy | Non sostituire classificatore, Registry o D4 | Da rieseguire e controllare |
| Requirements §5 / Design §4.2, §4.6–7: filesystem e output esclusivo | Reader e writer M2-4F riusati, test `adoptCommand.test.ts` e `migrationPipeline.test.ts` | Test aggiuntivi di assenza scritture su output non autorizzato | Da rieseguire |
| Requirements §7 / Design §5: SHA-256 byte-level invariati in successi/errori | Solo confronto testuale dei quattro file temporanei | `adoptAcceptance.test.ts` conserva byte e SHA-256 di input, Registry, history, candidate, riferimenti sentinella e **copia byte-identica dell’intero albero `catalog/` corrente** (identity-lock, cataloghi, fixture e risultati) | Da eseguire |
| Confini A–F + G | `adopt-command.ts` usa `readJson`, `execute`, `stableMigrationJson`, `writeExclusive` di M2-4F | Nessuna nuova API, storage, classificatore, assegnatore o writer; nessuna mutazione dei dati autorevoli | Da confermare |
| Gate finali | Requirements §7 / Design §5 | `npm run typecheck`, `npm run lint`, `npm test`, `npm run verify:catalog`, `npm run build`, runner Mozart `web-game/2`, review e CI sul medesimo HEAD | Non eseguiti qui |

**Portata dell'evidenza:** i test operano in directory temporanee e verificano
snapshot di SHA-256 per i file protetti **presenti nel sandbox**. Copiano
tutto l’albero `catalog/` del checkout corrente, verificando esplicitamente
quattro asset minimi (identity-lock, manifest, input fixture e risultato);
non dichiarano l'inventario completo di tutte le eventuali fonti autorevoli di
produzione né certificano la provenienza di un dataset reale. Il controllo
completo della matrice resta un gate di review: non dichiarare una delivery
ready sulla sola base dei test proposti.

## Applicazione governata

Non modificare direttamente il branch gestito da Mozart, non chiamare `adopt`
su fonti autorevoli, non alterare il workflow #235 o la policy #30 durante
la preparazione offline. La PR Mozart #538 ha esteso il percorso esistente
`SoftwareCorrectionImportService` per importare esclusivamente file nuovi
in una delivery `waiting_budget` successiva a review `revise`. Per #235
l'importazione deve verificare instance #235, Run #6685, review event #4796,
artifact #844, step #32, ciclo 2 e HEAD
`a8af9533f51a083b6de9daa9b9dd2f4455c08cd5`.

L'operazione conserva istanza, Run e ciclo, crea un commit governato con
provenienza registrata e ritorna alla review. Non autorizza nuovi budget e
non richiama l'LLM durante l'importazione. Restano necessari i successivi
gate di review, test, build e le approvazioni applicabili. La preparazione
offline non autorizza l'invio della richiesta.
