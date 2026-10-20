# M2-4C — Registro storico incrementale

Questo modulo assegna identità persistenti nel namespace `killer-sudoku` tramite `assignIncremental(previousRegistry, input, options)`. L’operazione è incrementale: le identità assenti dal batch, comprese quelle rimosse, conservano associazioni, fingerprint, alias, storia degli stati e stato corrente. Un registro vuoto richiede `options.initialization === true`. Gli input non vengono mutati e ogni errore restituisce `registry: null`, osservazioni vuote e diagnostiche senza risultati parziali.

## Risoluzione e determinismo

Prima di assegnare ID il modulo valida l’intero batch, calcola le `observationKey` canoniche e raggruppa le osservazioni compatibili tramite fingerprint, alias e public ID storico. Il raggruppamento usa la coppia esatta `[recordKey.source, recordKey.key]` per evitare collisioni fra chiavi contenenti `/`. Record distinti che condividono evidenza compatibile aggiornano la stessa identità; osservazioni diverse della stessa RecordKey nello stesso batch falliscono con `duplicate-record-key`. L’ordine degli input non determina ID, associazioni o serializzazione.

I fingerprint current e legacy sono contratti distinti; il legacy è conservato byte per byte. Un alias sconosciuto o un public ID nuovo, da soli, non sono evidenza di contenuto. Un public ID storico può disambiguare soltanto riferimenti già compatibili. I conflitti non vengono risolti implicitamente.

Le nuove identità adottano un public ID esplicito valido quando supportato da fingerprint/contenuto; altrimenti ricevono il minimo ID libero da `puzzle-000001` a `puzzle-999999`. Le riserve sono raccolte dall’intero registro e dall’intero batch prima dell’assegnazione.

## Storia e stato

`IdentityHistory` conserva `firstAssignment` immutabile, fingerprint e alias cumulativi e tutte le osservazioni di stato. Un’associazione già presente non viene duplicata. Una riattivazione con la stessa osservazione A dopo A(current) → B(removed) riusa A, mantiene la prima assegnazione e applica nuovamente `current`. Per osservazioni compatibili nella stessa chiamata, `currentStateObservation` è la minima `observationKey` del gruppo con lo stato applicato; non pretende di ricostruire l’ordine delle chiamate.

Il registro e il risultato hanno ordine di campi e array canonico, con `null` espliciti per `observedPublicId` e fingerprint assenti nelle associazioni. La validazione annidata avviene prima di clonazione e accessi rischiosi; una validazione globale finale ricontrolla ID, alias, fingerprint, associazioni, RecordKey e riserve.

## Diagnostiche e verifica

Sono mantenuti i codici `insufficient-identity-evidence`, `malformed-alias-list`, `ambiguous-identity`, `identity-conflict`, `fingerprint-conflict`, `fingerprint-alias-conflict`, `public-id-conflict`, `duplicate-record-key`, `incompatible-state` e `id-exhausted`, oltre ai codici strutturali. Ogni diagnostica contiene solo `code`, `path`, `recordKeys` ordinati e `message`. I test `tests/registry.test.ts` coprono raggruppamento batch, public ID storico, scelta minima dello stato, A/B/A, atomicità e collisioni della coppia RecordKey.
