# Killer Sudoku

## Stato M0-2

M0-1 è approvato e completato. `docs/M0-1-perimetro.md` resta il riferimento di prodotto e layout. Le evidenze di M0-1 (commit, test e schermate) sono dichiarate dall’operatore e non costituiscono verifiche indipendenti; questa distinzione non riapre il gate.

M0-2 prepara una baseline statica non giocabile con TypeScript, React e Vite. Sono escluse griglia, celle selezionabili, input, tastierino, gabbie, motore Sudoku/Killer, timer operativo, contatore errori, persistenza, autenticazione, deploy, servizi di produzione e annulla/ripristina.

## Stack e compatibilità

Lo stack TypeScript/React/Vite è usato per tipizzazione, rendering e testabilità della UI, feedback locale rapido e produzione di asset statici.

- Runtime supportato: Node 22.12 o successivo nella famiglia 22, richiesto da Vite 7.
- Versione osservata nell’ambiente Mozart: Node v22.23.3.
- `.nvmrc`: `22`.
- `package.json` conserva `engines.node: "22.x"`, come richiesto dal contratto Mozart; il workflow configura esplicitamente Node `22.12.0`.
- `mozart-software.json` configura il profilo governato `web-game` con schema 2, toolchain npm e Node major 22.
- Il profilo `web-game/2` e il runtime sono stati osservati tramite l’evidenza di `GET /software-validation/profiles`; ciò non dimostra la validazione di questo progetto.

Il runner esegue dalla radice del checkout autorizzato, dove sono presenti manifest, package manifest e lockfile. Il contratto acquisito precisa che in CI il checkout è fornito dallo step di checkout e non richiede un mount server.

## Comandi locali

Da un checkout pulito, con Node 22.12 o successivo nella famiglia 22:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm run test
npm run build
```

L’installazione è unica; gli script non reinstallano dipendenze e non usano hook impliciti. `npm run build` esegue prima il typecheck esplicito di `tsconfig.app.json` e `tsconfig.node.json`, poi Vite. L’output atteso è `dist/index.html`.

Per lo sviluppo locale:

```text
npm run dev
```

Sono disponibili anche `npm run typecheck`, `npm run lint` e `npm run test`; il test usa Vitest in modalità run e jsdom.

## Mozart e CI

Il contratto Mozart acquisito espone il runner ufficiale, versionato in `scripts/mozart-web-game.py`:

```text
python3 scripts/mozart-web-game.py validate
```

Il runner opera dalla radice del checkout autorizzato e gestisce nello stesso workspace una sola installazione `npm ci --ignore-scripts --no-audit --no-fund`, quindi lint, test e build. Il checkout CI è fornito dallo step di checkout e non richiede un mount server. La copia del runner e il contratto acquisito non costituiscono da soli evidenza di validazione del progetto.

L’operatore ha verificato nelle impostazioni di `huges/killersudoku` che GitHub Actions è abilitata e ha aggiornato il token Mozart con il permesso `Workflows: Read and write`. Questa è un’evidenza dichiarata dall’operatore, non una verifica indipendente di Mozart. La workflow versionata configura Python 3 e Node `22.12.0` (compatibile con Vite 7 nella famiglia Node 22), invoca esclusivamente il runner Mozart dalla radice del checkout e conserva `dist/` come artefatto senza segreti.

L’esito CI sarà acquisito dopo la pubblicazione della workflow sul branch: l’assenza dell’esecuzione in questa fase non giustifica la rimozione della workflow e non impedisce test/build Mozart. Non sono ancora disponibili log, esito del validatore Mozart, esecuzione CI o `dist/index.html` prodotti da un’esecuzione governata di questo checkout; il completamento M0-2 resta subordinato a una CI riuscita prima del merge.

## Riproducibilità e stato del lockfile

`package-lock.json` è stato generato tramite `workspace_generate_lockfile`, usando npm Node 22 in ambiente isolato, ed è versionato nel repository. La generazione è avvenuta senza installare dipendenze né eseguire hook; non costituisce evidenza di validazione del progetto.

M0-2 è completato; i controlli automatici e la CI restano parte del contratto di validazione del repository.

## M0-3 — Modello di dominio

M0-3 aggiunge il modello puro versionato del puzzle e dello stato di partita in `src/domain/`, incluse validazione di puzzle, gabbie, cronologia e documento JSON, serializzazione, operazioni immutabili di partita e fixture deterministiche. La UI resta intenzionalmente non giocabile.

Il confine `PersistenceContract` in `src/domain/persistence.ts` espone esclusivamente caricamento e sostituzione atomica del documento serializzato; non introduce filesystem, database, `localStorage` o altro storage concreto. I test usano un test double per verificare che caricamenti invalidi e scritture fallite non sostituiscano il documento precedente. Il modello completo e le invarianti sono documentati in `docs/M0-3-modello.md`.
