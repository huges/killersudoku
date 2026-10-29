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

La matrice seguente distingue il requisito obbligatorio dalla regressione effettivamente presente in `tests/duplicateClassifier.test.ts`; l'esito indicato è quello verificato dal typecheck intermedio, mentre l'esecuzione Vitest resta al gate governato successivo.

| Requisito 708/709 | Test effettivo | Esito osservato in questa fase |
|---|---|---|
| observationRecordKey obbligatoria/assente e distinta dal public ID | `rejects missing and malformed observationRecordKey independently from content validation` | Test scritto; typecheck passato; Vitest al gate |
| observationRecordKey malformata | `rejects missing and malformed observationRecordKey independently from content validation` | Test scritto; typecheck passato; Vitest al gate |
| PlayableContent osservato invalido | `rejects an invalid observed content with a valid observationRecordKey` | Test scritto; typecheck passato; Vitest al gate |
| Fonte separata, contenuto storico mancante/invalido e riferimenti strutturalmente invalidi | `blocks missing, invalid...`, `rejects malformed source references...`, `blocks malformed source responses...` | Test scritto; typecheck passato; Vitest al gate |
| Riferimenti storici strutturalmente validi senza semantica source/key approvata | `does not impose the removed source/key reference rule` | Decisione contrattuale sulla rappresentazione non ambigua ancora aperta; il test dimostra soltanto che non viene introdotto autonomamente il vincolo rimosso |
| Fingerprint sconosciuta/legacy opaca e chiavi canoniche | `accepts unknown and legacy fingerprints...` | Test scritto; typecheck passato; Vitest al gate; Vitest al gate |
| Tutte le otto trasformazioni D4 e contenuto completo | `recognizes every D4 transformation...` | Test scritto; typecheck passato; Vitest al gate |
| Duplicato con più record e ambiguità tra identità | `covers D4 and keeps multiple records...`, `recognizes a new observation...` | Test scritto; typecheck passato; Vitest al gate |
| Selezione proposta, candidato sconosciuto/foreign/non-equivalente e report limitato | `verifies an explicit proposal...`, `distinguishes unknown...`, `blocks non-equivalent...` | Test scritto; typecheck passato; Vitest al gate |
| Associazione già registrata, precedenza e conflitto | `gives registered association precedence...` | Test scritto; typecheck passato; Vitest al gate |
| Collisioni ID, alias, RecordKey, fingerprint e associazioni incompatibili, incluso association.recordKey contro firstAssignment.recordKey | `reports each required registry collision...`, `rejects an association RecordKey owned by a different identity while allowing same-identity recurrence`, `rejects a reserved ID colliding with another identity`, `rejects the same association RecordKey across different identities while allowing same-identity recurrence` | Test scritti; typecheck passato; Vitest al gate |
| Input malformati, atomicità e immutabilità di successo/fallimento | `returns blocking diagnostics...`, `rejects malformed source references...`, `blocks non-equivalent...` | Test scritto; typecheck passato; Vitest al gate |
| Diagnostica indipendente dall'ordine di identità, associazioni, reserved ID/alias, alias e fingerprint | `keeps the complete diagnostic stable...`, `makes association diagnostics invariant...`, `orders diagnostics...` | Coperto per i casi elencati; typecheck passato |
| Più associazioni malformate di forme diverse permutate, con diagnostiche distinguibili | `makes association diagnostics invariant under permutation of distinct invalid associations` (oggetto incompleto con RecordKey valido e `null`, entrambe le permutazioni) | Test scritto; typecheck e controllo corrente da rieseguire |
| Registri validi costruiti tramite `assignIncremental`: prima assegnazione e associazioni cumulative | `classifies a first assignment registry built by assignIncremental...`, `accepts cumulative associations for one identity...` | Test scritto; non eseguito in questa fase |
| Ricorrenze storiche legittime, riserve coerenti e sequenza A-current/B-removed/A-current | `accepts legitimate alias and fingerprint recurrences...`, `accepts a registry with owner-consistent reservations...` | Test scritto; non eseguito in questa fase |
| Immutabilità della fonte e dei dati serializzabili sottostanti nei successi incrementali | `classifies a first assignment registry...`, `accepts legitimate alias and fingerprint recurrences...` | Test scritto; non eseguito in questa fase |

La matrice distingue test scritti da controlli eseguiti: il solo `npm run typecheck` verifica i tipi e non esegue le asserzioni Vitest. Questi test non autorizzano scritture: verificano che registro, fonte e input restino invariati. I gate successivi devono eseguire Vitest, lint e build; questa fase dichiara soltanto il controllo `npm run typecheck` riuscito e non anticipa tali esiti.
