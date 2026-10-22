# M2-4D — Duplicati e associazioni storiche

## Confine

`classifyDuplicate` opera in sola lettura nel namespace `killer-sudoku`. Riceve la nuova `observationRecordKey`, il `PlayableContent`, il registro autorevole e una `historicalContentSource` separata. Il registro fornisce identità e record pertinenti; la fonte risolve ogni record in modo non ambiguo con `RecordKey`, `publicId` e contenuto completo. Il registro non è usato come archivio dei contenuti storici.

Gli input non vengono normalizzati, ordinati o modificati. La fonte deve restare immutabile e non vengono create associazioni, ID o orientamenti. Soluzioni e stato utente non fanno parte dell’output.

## Validazione e confronto

Il contenuto nuovo, il registro e ogni contenuto storico necessario sono validati prima del confronto. Sono bloccati record key, ID, alias e fingerprint malformati, riferimenti sconosciuti o ambigui, collisioni e associazioni incompatibili. Una fingerprint conforme ma sconosciuta, oppure legacy, resta opaca: non limita il confronto e non viene ricalcolata.

L’insieme dei record storici è l’unione delle prime assegnazioni e delle associazioni del registro, indipendentemente dalla fingerprint. Ogni record viene risolto dalla fonte e confrontato sul contenuto completo (clue e gabbie) con tutte le otto trasformazioni di `d4-v1`. Un contenuto mancante, invalido o incoerente produce `errore bloccante`, mai `nuovo contenuto`.

## Classificazioni

- **nuovo contenuto**: nessuna equivalenza dopo il recupero completo dei contenuti storici;
- **duplicato**: le equivalenze appartengono a una sola identità pubblica; più record della stessa identità restano rappresentati;
- **ambiguità**: le equivalenze appartengono a più identità, riportate senza fusione o scelta implicita;
- **associazione proposta verificata**: selezione esplicita di `requestedPublicId` e `candidateRecordKey`, entrambi validi, appartenenti all’identità richiesta e confermati dal confronto D4 completo. Il report contiene solo il candidato selezionato; non esegue scritture;
- **associazione già registrata**: esiste un’associazione per `observationRecordKey` ed è coerente con contenuto e selezione; prevale anche su una selezione esplicita coerente;
- **errore bloccante**: input o riferimenti non validi, contenuto storico non disponibile/coerente, candidato non equivalente, identità incompatibile o selezione in conflitto con un’associazione già registrata.

Ogni errore contiene codice, percorso, record key pertinenti e messaggio deterministico. Ogni risultato espone `algorithmVersion: d4-v1` e `observationRecordKey`.
