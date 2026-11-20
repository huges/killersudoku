# M2-4G — Handoff di governance e recupero codice (proposta)

## Inventario immutabile

- Mozart project / roadmap item: #7 / #615, workflow fallito #234, Run #5979, workspace Git #16.
- Requirements v1 approvati: artifact #839; Game Design v1 approvato: artifact #840. Non sostituirli.
- Checkpoint Git locale nel workspace persistente: 5f8492e545be79d8ae43fffaa8a1276de35ded8b; base pulita: 07d35da885afeecd2de8468025ddf42ee3cfb993.
- Esiste un bundle di correzione M2-4G v3 preparato e verificato fuori dal workspace gestito. Il bundle non è versionato in questa PR e il checkpoint non è stato importato.
- La Run storica #5577 del workflow #229 è stata riconciliata ad abandoned con il metodo già esistente di Mozart; #229 e #234 sono rimasti failed.

## Verifiche già osservate (16 novembre 2026)

In una copia isolata del checkpoint, il runner ufficiale Mozart web-game/2 (Node v22.23.3) ha completato install, lint, test, build; 247/247 test Vitest, 11/11 specifici M2-4G, verify:catalog, TypeScript e build Vite. La prima esecuzione del runner è stata bloccata da Git dubious ownership sul mount; ripetuta con safe.directory limitata a /work, è stata completata. Non è prova di CI remota né di commit approvato.

## Decisione necessaria prima di importare

La v2 proposta esplicita --input, --registry, --history come fonti autorevoli, e cambia il modo di pubblicare verso il writer M2-4F. È una variazione del contratto approvato v1, non una semplice correzione di compilazione. L'importazione del checkpoint fallito #234 tramite il servizio attuale copia soltanto Requirements/Game Design esistenti e ne preserva il fingerprint; non può importare la v3 come se la v1 l'avesse autorizzata.

Passi governati richiesti:
1. Review e approvazione delle modifiche Requirements/Game Design da parte dell'operatore, senza cambiare gli artifact #839/#840.
2. Registrazione della decisione nel nuovo workflow documentale Mozart con artifact versionati e un gate umano effettivo. Approvazione di una PR GitHub, da sola, non equivale a questo gate.
3. Avere una procedura esplicita per riutilizzare la patch del checkpoint #234 dopo l'approvazione del design v2, senza falsificare la provenance. Non forzare l'endpoint import-correction per la v1.
4. Eseguire tutte le review, test, build, approvazioni budget e pubblicazione sul nuovo HEAD, senza dichiarare automaticamente una delivery pronta.

## Confini di questa PR

**Documentazione soltanto.** Non crea workflow, non chiama modelli, non aggiorna il database, non modifica file autorevoli, non introduce API o permessi e non trasferisce il codice v3. Nessun nuovo test è richiesto per questa PR poiché non modifica runtime né comportamento: la matrice test descrive i futuri gate funzionali.

Non fare merge di questa proposta come se fosse una delivery completata. La PR può essere usata come base di revisione del contratto e delle opzioni di governance di Mozart.
