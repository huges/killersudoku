# M2-4D — Duplicati e associazioni storiche

## Contratto e confini

`classifyDuplicate` è un servizio read-only del namespace `killer-sudoku`. Riceve `observationRecordKey` (il record della nuova osservazione, distinto da ogni public ID), il `PlayableContent` osservato, il `Registry` autorevole e una `historicalContentSource` separata e immutabile. Per una selezione esplicita riceve anche, insieme, `requestedPublicId` e `candidateRecordKey`. `Association.recordKey` identifica il record osservato associato; `observationKey` resta il valore storico e non identifica il candidato. Il registro non è una fonte di contenuti storici.

La fonte risolve ogni RecordKey come `HistoricalRecord | missing | ambiguous` e deve restituire senza ambiguità RecordKey, public ID, contenuto completo e riferimenti dichiarati. Il servizio non scrive né adotta registro, fonte, identity-lock, riferimenti, fixture o cataloghi; non crea, assegna, ricicla o sostituisce ID e non aggiunge orientamenti. Input e strutture annidate restano immutati sia in caso di successo sia di errore. Soluzioni e stato utente non entrano nell’output.

## Validazione e diagnostica

Prima di qualsiasi fingerprint, indicizzazione o confronto vengono validati input, namespace, observationRecordKey, selezione, PlayableContent osservato, struttura completa del registro e fonte storica. La validazione del registro copre identità e storia, first assignment, RecordKey, public ID, alias, fingerprint, reserved ID/alias, associazioni, ownership, riferimenti e collisioni. Sono bloccanti anche associazioni nulle o malformate e campi annidati mancanti: non devono produrre eccezioni non gestite.

RecordKey, ID, alias, fingerprint o riferimenti malformati, sconosciuti o incoerenti producono `errore bloccante`. Le fingerprint `playable-content-v1` e le fingerprint legacy conformi sono valori opachi: una fingerprint sconosciuta o non indicizzata non esclude il record, non viene ricalcolata e non viene modificata. Le chiavi di fingerprint usate nei controlli sono canoniche e indipendenti dall’ordine delle proprietà.

Ogni errore ha una sola classificazione e una diagnostica con `code`, `path`, `recordKeys` e `message`. L’ordinamento canonico di codici, percorsi, RecordKey e messaggi rende il risultato indipendente dall’ordine di identità, associazioni, alias, fingerprint, reserved ID e reserved alias. I codici includono, tra gli altri, `invalid-input`, `invalid-record-key`, `invalid-public-id`, `invalid-alias`, `invalid-fingerprint`, `unknown-reference`, `missing-historical-content`, `invalid-historical-content`, `ambiguous-historical-reference`, `identity-conflict`, `record-conflict`, `fingerprint-conflict`, `alias-conflict`, `association-conflict`, `unknown-requested-public-id`, `unknown-candidate-record`, `candidate-identity-mismatch`, `candidate-not-equivalent` e `registered-association-conflict`.

## Recupero e confronto D4

L’insieme dei record necessari è l’unione deduplicata e ordinata delle first assignment e delle associazioni rappresentate dal registro. Ogni record viene risolto dalla fonte separata; risposta mancante, ambigua, strutturalmente invalida, con contenuto invalido, public ID sconosciuto o riferimenti malformati/inesistenti/incoerenti blocca la classificazione.

Ogni contenuto storico viene confrontato con il contenuto osservato completo, inclusi clue e gabbie, mediante tutte le otto trasformazioni di `d4-v1`. La fingerprint è solo un indice preliminare: il risultato non dipende dalla sua presenza, dal suo valore legacy o dalla sua indicizzazione.

## Precedenza e output

1. **Associazione già registrata** — se esiste un’associazione per `observationRecordKey`, il contenuto del record associato viene verificato tramite fonte e D4 completo. Una selezione esplicita è coerente quando il public ID richiesto coincide con quello registrato e il candidato appartiene alla stessa identità ed è D4-equivalente; non è richiesta la coincidenza con un candidato originario non conservato. In questo caso prevale sempre `associazione già registrata` e l’output può esporre il candidato selezionato. Public ID diverso, candidato inesistente, di altra identità o non equivalente producono `errore bloccante`.
2. **Associazione proposta verificata** — senza associazione preesistente, la selezione è valida solo se public ID e candidato esistono, il candidato appartiene all’identità richiesta e il confronto D4 completo conferma l’equivalenza. Non comporta scritture e il report contiene solo `observationRecordKey`, versione algoritmo, `requestedPublicId`, `candidateRecordKey` e i riferimenti necessari al candidato; non include altri candidati, contenuti, soluzioni o stato utente.
3. **Nessuna selezione** — nessuna equivalenza dopo il recupero completo produce `nuovo contenuto`; equivalenze di una sola identità producono `duplicato` senza nuovo ID, anche con più record della stessa identità; equivalenze di più identità producono `ambiguità` conservando tutte le identità e i record pertinenti senza fusione o scelta implicita.

Ogni risultato positivo espone `algorithmVersion: "d4-v1"` e `observationRecordKey`. Non esistono scritture parziali: gli errori restituiscono un risultato bloccante senza mutazioni.

## Copertura verificata

I test indipendenti coprono RecordKey obbligatoria e distinta dal public ID, nuova osservazione assente dal registro, fonte separata, contenuti storici mancanti/invalidi e riferimenti incoerenti, fingerprint sconosciute e legacy, tutte le otto trasformazioni D4 con contenuto completo, duplicati con più record, ambiguità tra identità, selezioni valide e rifiutate, associazioni già registrate, ID/alias/RecordKey/riferimenti sconosciuti, collisioni, input malformati senza eccezioni, immutabilità di successi e fallimenti, report limitato e permutazioni delle collezioni che dimostrano diagnostica deterministica.
