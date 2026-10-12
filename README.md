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

GitHub Actions non è stata verificata come abilitata per questo progetto; per questo motivo nessun workflow viene versionato in questa revisione. Il gap è preciso: gli strumenti Mozart disponibili non espongono una verifica dell’abilitazione né dell’esecuzione CI. Quando la piattaforma sarà verificata, il workflow dovrà configurare Python 3 e Node `22.12.0` (minimo richiesto da Vite 7 nella famiglia Node 22), invocare esclusivamente il runner Mozart dalla radice del checkout e conservare `dist/` come artefatto senza segreti.

Non sono ancora disponibili log, esito del validatore Mozart, esecuzione CI o `dist/index.html` prodotti da un’esecuzione governata di questo checkout.

## Riproducibilità e stato del lockfile

`package-lock.json` è stato generato tramite `workspace_generate_lockfile`, usando npm Node 22 in ambiente isolato, ed è versionato nel repository. La generazione è avvenuta senza installare dipendenze né eseguire hook; non costituisce evidenza di validazione del progetto.

M0-2 resta bloccato finché non sono acquisiti l’esito del runner Mozart, i log della sequenza unica, l’artefatto `dist/index.html` e l’evidenza dell’abilitazione e dell’esecuzione riuscita di GitHub Actions.
