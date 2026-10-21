# M2-4C — Registro storico incrementale

Questo modulo assegna identità persistenti nel namespace `killer-sudoku` tramite `assignIncremental(previousRegistry, input, options)`. L’operazione è incrementale: le identità assenti dal batch, comprese quelle rimosse, conservano associazioni, fingerprint, alias, storia degli stati e stato corrente. Un registro vuoto richiede `options.initialization === true`. Gli input non vengono mutati e ogni errore restituisce `registry: null`, osservazioni vuote e diagnostiche senza risultati parziali.

## Risoluzione e determinismo

Prima di assegnare ID il modulo valida l’intero batch, calcola le `observationKey` canoniche e raggruppa le osservazioni compatibili tramite fingerprint, alias e public ID storico. Il raggruppamento usa la coppia esatta `[recordKey.source, recordKey.key]` per evitare collisioni fra chiavi contenenti `/`. Record distinti che condividono evidenza compatibile aggiornano la stessa identità; osservazioni diverse della stessa RecordKey nello stesso batch falliscono con `duplicate-record-key`. L’ordine degli input non determina ID, associazioni o serializzazione.

I fingerprint current e legacy sono contratti distinti; il legacy è conservato byte per byte. Un alias sconosciuto o un public ID nuovo, da soli, non sono evidenza di contenuto. Nella risoluzione intra-batch questi riferimenti non storici non sono token di unione: osservazioni con fingerprint incompatibili restano candidate separate e la validazione globale segnala poi la collisione del proprietario (`alias-conflict` o `id-conflict`). Un public ID storico può disambiguare soltanto riferimenti già compatibili. I conflitti non vengono risolti implicitamente. Se un fingerprint noto e un alias noto indicano due identità storiche diverse, la diagnostica deterministica è `ambiguous-identity`; non viene usato `identity-conflict` per questo caso di riferimenti contraddittori.

Le nuove identità adottano un public ID esplicito valido quando supportato da fingerprint/contenuto; altrimenti ricevono il minimo ID libero da `puzzle-000001` a `puzzle-999999`. Le riserve sono raccolte dall’intero registro e dall’intero batch prima dell’assegnazione: la prenotazione del proprio ID da parte del gruppo corrente è ammessa, mentre una prenotazione appartenente a un altro gruppo o proprietario produce `id-conflict`; l’ID non viene mai riutilizzato per fondere gruppi incompatibili.

## Storia e stato

`IdentityHistory` conserva `firstAssignment` immutabile, fingerprint e alias cumulativi e tutte le osservazioni di stato. Un’associazione già presente non viene duplicata. Una riattivazione con la stessa osservazione A dopo A(current) → B(removed) riusa A, mantiene la prima assegnazione e applica nuovamente `current`. Per osservazioni compatibili nella stessa chiamata, `currentStateObservation` è la minima `observationKey` del gruppo con lo stato applicato; non pretende di ricostruire l’ordine delle chiamate.

Il registro e il risultato hanno ordine di campi e array canonico, con `null` espliciti per `observedPublicId` e fingerprint assenti nelle associazioni. La validazione annidata avviene prima di clonazione e accessi rischiosi; una validazione globale finale ricontrolla ID, alias, fingerprint, associazioni, RecordKey e riserve.

## Diagnostiche e verifica

Sono mantenuti i codici `insufficient-identity-evidence`, `malformed-alias-list`, `ambiguous-identity`, `identity-conflict`, `fingerprint-conflict`, `fingerprint-alias-conflict`, `public-id-conflict`, `duplicate-record-key`, `incompatible-state` e `id-exhausted`, oltre ai codici strutturali. Ogni diagnostica contiene solo `code`, `path`, `recordKeys` ordinati e `message`. I test `tests/registry.test.ts` coprono raggruppamento batch, public ID storico, scelta minima dello stato, A/B/A, atomicità e collisioni della coppia RecordKey.

## Correzioni di regressione

- Il caso di fingerprint sconosciuto con alias noto usa ora un fingerprint realmente distinto e produce `fingerprint-alias-conflict`, come previsto dalla tabella di risoluzione; il caso fingerprint noto con alias nuovo è verificato separatamente e resta valido.
- Le riserve del fixture ID includono anche il primo ID generabile: l'identità nuova conserva quindi il minimo ID libero effettivamente atteso, senza modificare l'algoritmo di assegnazione.
- La validazione della struttura dell'identità precede ogni iterazione di `stateHistory`; un registro malformato restituisce diagnostici e risultato atomico (`registry: null`, osservazioni vuote), senza eccezioni native.
- Lo storico cumulativo non associa fingerprint incompatibili tramite alias: le osservazioni successive riusano il fingerprint compatibile e dimostrano la conservazione dello storico di stati e alias secondo il contratto.
- La regressione di validazione copre elementi `null`, `undefined`, array sparsi e oggetti con campi mancanti o valori non validi in `stateHistory`; ogni caso produce `invalid-structure`, `registry: null` e osservazioni vuote, senza eccezioni o mutazioni. La causa era l'accesso a `state.observationKey` prima della validazione dell'elemento; la guardia strutturale ora precede ogni accesso, in coerenza con la pipeline atomica del design.
- Tutti gli array runtime del registro, incluse `reservedIds` e `reservedAliases`, sono scansionati per indice con `index in array`: un buco e un elemento esplicitamente `undefined` sono distinti ma entrambi producono `invalid-structure` prima della raccolta delle riserve. Le regressioni verificano array completamente sparsi e misti, assenza di eccezioni, risultato atomico, immutabilità e conservazione degli indici assenti; anche `association.aliases` viene controllato solo dopo aver verificato la forma dell'associazione.
