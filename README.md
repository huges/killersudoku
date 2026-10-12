# Killer Sudoku

## Stato M0-2

M0-1 è approvato e completato. `docs/M0-1-perimetro.md` resta il riferimento di prodotto e layout. Le evidenze di M0-1 (commit, test e schermate) sono dichiarate dall’operatore e non costituiscono verifiche indipendenti; questa distinzione non riapre il gate.

M0-2 prepara una baseline statica non giocabile con TypeScript, React e Vite. Sono escluse griglia, celle selezionabili, input, tastierino, gabbie, motore Sudoku/Killer, timer operativo, contatore errori, persistenza, autenticazione, deploy, servizi di produzione e annulla/ripristina.

## Stack e compatibilità

Lo stack TypeScript/React/Vite è usato per tipizzazione, rendering e testabilità della UI, feedback locale rapido e produzione di asset statici.

- Runtime supportato: Node 22.x.
- Versione osservata nell’ambiente Mozart: Node v22.23.3.
- `.nvmrc`: `22`.
- `package.json` richiede `engines.node: "22.x"`.
- `mozart-software.json` configura il profilo governato `web-game` con schema 2, toolchain npm e Node major 22.
- Il profilo `web-game/2` e il runtime sono stati osservati tramite l’evidenza di `GET /software-validation/profiles`; ciò non dimostra la validazione di questo progetto.

Il runner deve eseguire dalla radice del checkout autorizzato, dove sono presenti manifest, package manifest e lockfile. La modalità effettiva con cui Mozart riceve o monta il checkout non è ancora esposta nell’evidenza disponibile.

## Comandi locali

Da un checkout pulito, con Node 22.x:

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

Il contratto Mozart acquisito espone il runner ufficiale `python3 scripts/mozart-web-game.py validate`. Il runner opera dalla radice del checkout autorizzato; in CI il checkout è fornito dal normale step di checkout e non richiede un mount server. Il contratto non costituisce evidenza di validazione riuscita del progetto.

Restano gap di evidenza bloccanti: non sono ancora disponibili log della sequenza governata, esito del validatore, `dist/index.html` prodotto dalla build o conferma che GitHub Actions sia abilitata per questo progetto. Non è stata aggiunta una workflow GitHub Actions finché la piattaforma non sarà verificata. M0-2 non può essere dichiarato completato finché questi gap non sono risolti.

Quando la CI sarà verificata e predisposta, dovrà mantenere un solo job e una sola installazione, nell’ordine installazione → lint → test → build, conservando log e artefatti senza segreti.

## Riproducibilità e stato del lockfile

`package-lock.json` è stato generato tramite lo strumento Mozart autorizzato `workspace_generate_lockfile`, usando npm Node 22 in ambiente isolato, ed è versionato nel repository. Il lockfile è stato preparato senza installare dipendenze né eseguire hook; non costituisce da solo evidenza di validazione del progetto.

Il contratto Mozart acquisito espone il runner ufficiale `python3 scripts/mozart-web-game.py validate`. Il runner esegue dalla radice del checkout autorizzato una sola installazione `npm ci --ignore-scripts --no-audit --no-fund`, quindi lint, test e build nello stesso workspace. Il contratto precisa che in CI il checkout è fornito dal normale step di checkout e non richiede un mount server. Questa acquisizione non dimostra ancora l’esito della validazione del progetto né l’abilitazione di GitHub Actions.

Restano da acquisire tramite un’esecuzione governata: log completi della sequenza, esito del validatore Mozart, `dist/index.html` e conferma della piattaforma GitHub Actions. M0-2 non è dichiarato completato finché questi gap bloccanti non sono risolti.
