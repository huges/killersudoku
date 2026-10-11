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

Il comando ufficiale per invocare il validatore Mozart `web-game/2` non è presente nell’evidenza disponibile e non viene inventato in questo repository. Mancano inoltre la prova del trasferimento/mount del checkout nella radice autorizzata e la conferma che GitHub Actions sia abilitata per questo progetto.

Questi sono gap di evidenza bloccanti, non una dichiarazione di assenza della capacità. Non è stata aggiunta una workflow GitHub Actions finché la piattaforma non sarà verificata. M0-2 non può essere dichiarato completato finché non sono disponibili comando ufficiale, prova del checkout, log consultabili, esito del validatore, CI riuscita e `dist/index.html`.

Quando la capacità sarà esposta, la validazione dovrà mantenere un solo job e una sola installazione, nell’ordine installazione → lint → test → build, conservando log e artefatti senza segreti.

## Riproducibilità e stato del lockfile

`package-lock.json` deve essere generato dagli strumenti npm e versionato; non deve essere costruito manualmente. Nell’ambiente di questa consegna non è esposto uno strumento di esecuzione npm per generarlo o per eseguire `npm ci`, lint, test e build. Di conseguenza il lockfile, i log, l’artefatto `dist/` e la validazione governata restano da acquisire tramite il runner autorizzato.
