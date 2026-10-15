# M2-1 — Pipeline offline di verifica del catalogo

M2-1 consegna la pipeline e un campione tecnico, non il catalogo finale M2.
I puzzle del rilascio e la difficoltà umana restano M2-2/M2-3. Le metriche DFS
sono dati tecnici, non una valutazione della difficoltà per il giocatore.

## Confini e riuso

`src/domain/catalogPipeline.ts` coordina `validatePuzzle`, `solve` e `verifyGame`.
Non modifica i contratti del dominio e non ricopia gli invarianti di validazione.
La validazione avviene sull'input originale prima di ordinare una copia; coordinate
non canoniche restano un errore. Gli ID seguono il dominio: puzzle univoci nel
campione, gabbie univoche nel singolo puzzle, nessun prefisso aggiuntivo richiesto.
Gli stessi ID di gabbia possono comparire in puzzle diversi.
Il modulo usa Node crypto per la verifica offline e non è un entrypoint del gioco.

## Verifica in sola lettura

Dalla root, con Node 22.12+ nella famiglia 22 e dipendenze installate:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run verify:catalog
python3 scripts/mozart-web-game.py validate
```

Il manifest `catalog/fixtures/manifest.json` dichiara input, fixture negative,
registro, riferimento, versioni e limite DFS. I percorsi devono essere distinti,
ordinati, risolti realmente entro `catalog/`; traversal e symlink esterni sono
rifiutati. Nessuna scansione implicita aggiunge puzzle al campione. File non
elencati non diventano input. Il comando verifica tutti gli input elencati,
non la storia di Git né l'intero contenuto arbitrario del repository.

Sono accettati soltanto puzzle `unique`, count 1, complete true e soluzione
ricontrollata con `verifyGame`. Errori strutturali non raggiungono il solver.
`multiple`, `unsatisfiable` e `incomplete` falliscono. Un campione vuoto fallisce.

Il fingerprint SHA-256 copre tutti i campi persistibili del puzzle canonico,
compresi metadati, givens e gabbie. Il JSON canonico usa ordine lessicografico
esplicito, senza locale, orologio o rete. L'output non contiene soluzioni.
Il risultato registra versione verificatore e maxNodes; il riferimento è
confrontato byte per byte, newline finale inclusa. Assenze, placeholder,
JSON malformato, risultati diversi o identità mancanti causano exit non zero.
In caso di successo stdout contiene esattamente il risultato; il verifier non scrive.

## Runner e controlli

Il runner ufficiale Mozart rimane identico al contratto `web-game/2`.
L'integrazione avviene attraverso i comandi npm che quel runner già esegue:
`test` esegue Vitest e poi verifica catalogo; `build` verifica catalogo prima
anche del typecheck e di Vite. Così il controllo copre sia le fasi governate
separate test/build sia `validate` locale/CI, senza una seconda logica.
Questo sostituisce la proposta iniziale di modificare soltanto `validate`,
che avrebbe lasciato scoperto il percorso governato separato.
Lint e TypeScript includono gli script CLI. Un fallimento interrompe il comando
prima di Vite; il blocco merge dipende dai required checks impostati su GitHub.

## Generazione e aggiornamenti espliciti

Le operazioni scrivono candidati da revisionare, senza sostituire file esistenti:

```text
npm run catalog:generate-fixtures -- /tmp/catalog-new m2-1-technical 1 technical-v1
npm run catalog:register-identities -- --output /tmp/catalog-identities-candidate.json
npm run catalog:update-reference -- --output /tmp/catalog-reference-candidate.json
```

La directory di generazione e i file candidati devono essere nuovi. Il generatore
versione 1 accetta seed esplicito e profilo `technical-v1`; il seed determina una
rotazione delle cifre del campione positivo e multiplo. Esporta esclusivamente
`inputs.json` e quattro JSON `negative/` elencati da `OUTPUTS`, non manifest,
lock o riferimento. Valida i casi destinati alla ricerca; i negativi strutturali
sono mutazioni deliberatamente invalide. Non genera puzzle del catalogo finale.

Il registro è sempre letto dal percorso autorevole del manifest, anche quando
l'output è un candidato altrove. La registrazione verifica prima i puzzle,
conserva anche identità ritirate e rifiuta conflitti. Si revisiona e adotta il
candidato in Git prima di generare il nuovo riferimento, che richiede identità
già registrate. Poi si revisiona/adotta il riferimento e si esegue `verify:catalog`.
Ogni contenuto cambiato richiede un nuovo puzzleId: lo schema dominio attuale
non definisce una versione indipendente del singolo puzzle.

Il registro garantisce coerenza con le associazioni presenti, non immutabilità
contro un operatore che modifichi contemporaneamente registro e riferimento.
La storia precedente non registrata non è dimostrata. Le modifiche ai due file
restano soggette a revisione Git. I placeholder iniziali non erano identità
verificate: vengono sostituiti dai risultati calcolati, non conservati come storia.

## Fixture e test

Le fixture JSON negative versionate e dichiarate nel manifest coprono struttura invalida,
campo derivato, non risolvibilità strutturalmente valida e molteplicità reale.
I tre descrittori di scenario riusano le fixture esistenti senza duplicare griglie:
`scenario-duplicate-id.json` verifica la causa `identifier` per un ID duplicato,
`scenario-reused-id.json` verifica `identity-lock` quando cambia il contenuto sotto
un ID registrato, e `scenario-incomplete-search.json` applica `maxNodes=1` alla
fixture multiple-solutions e richiede l'esito `solver|incomplete`. `verify:catalog`
esegue direttamente ogni fixture e scenario, confronta controllo e causa attesi,
e fallisce se un caso viene accettato o rifiutato per una causa diversa.
Non sono inclusi nel campione positivo. I test invocano inoltre le CLI reali in
directory isolate e coprono ordine validazione/solver, output stabile, hash,
namespace, storico, generazione, nessuna sovrascrittura, percorsi e immutabilità
dei file.

Il rollback consiste nel ripristino con Git dell'intero insieme coerente di
codice, fixture, manifest, registro e risultato; nessuno schema database cambia.
