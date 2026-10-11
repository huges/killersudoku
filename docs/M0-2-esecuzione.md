# Esecuzione M0-2

## Stato

M0-1 è approvato e completato. `docs/M0-1-perimetro.md` resta il riferimento di prodotto e layout. Commit, test e schermate di M0-1 sono evidenze dichiarate dall’operatore, non verifiche indipendenti; questa distinzione non riapre il gate M0-1.

M0-2 realizza una baseline statica non giocabile con TypeScript, React e Vite. Restano escluse griglia, input, tastierino, gabbie, motore Sudoku/Killer, timer operativo, contatore errori, persistenza, autenticazione, deploy, servizi di produzione e annulla/ripristina.

## Profilo Mozart

Il repository contiene il manifest radice `mozart-software.json`:

```text
{"schema_version":2,"profile":"web-game","toolchain":"npm","node_major":22}
```

Il profilo `web-game/2`, `runtime_available: true`, Node `v22.23.3` e la directory di esecuzione uguale alla radice del checkout autorizzato sono stati osservati tramite l’evidenza del sistema `GET /software-validation/profiles`. Node 22.x è il runtime supportato; `.nvmrc` contiene `22` e `package.json` richiede `22.x`.

La modalità effettiva con cui Mozart riceve o monta il checkout nella radice autorizzata non è esposta nell’evidenza disponibile. Non è disponibile neppure un comando ufficiale eseguibile per invocare il validatore `web-game/2`. Non vengono inventati URL, token, wrapper o comandi sostitutivi. La disponibilità del profilo non equivale alla validazione riuscita del progetto.

## Comandi del checkout

Gli script versionati sono non interattivi e non reinstallano dipendenze:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm run test
npm run build
```

La sequenza governata richiede una sola `npm ci`, seguita da lint, test e build. `npm run build` esegue prima il controllo esplicito di `tsconfig.app.json` e `tsconfig.node.json`, poi `vite build`; l’output atteso è `dist/index.html`.

Per sviluppo locale è disponibile `npm run dev`. I test usano Vitest in modalità run e jsdom. Il test dell’entry point verifica il montaggio dell’applicazione nel nodo `#root`.

## Lockfile e verifica locale

`package-lock.json` deve essere generato dagli strumenti npm e versionato; non è ammesso costruirlo manualmente. In questa esecuzione non è esposto uno strumento npm per generarlo né per eseguire `npm ci`, lint, test o build. Il tentativo non è stato quindi effettuabile: non è stato restituito un comando npm disponibile né un log di esecuzione.

Di conseguenza restano da acquisire tramite un ambiente autorizzato:

- `package-lock.json` generato da npm;
- esito e log della sequenza unica installazione → lint → test → build;
- `dist/index.html` prodotto dalla build;
- esito del validatore Mozart.

## CI

Non è disponibile nell’evidenza corrente la conferma che GitHub Actions sia abilitata per questo progetto. Per questo motivo non viene aggiunta una workflow inventata o non verificata. La CI è un requisito obbligatorio del gate M0-2, non un requisito reso facoltativo dal gap.

Dopo la verifica della piattaforma e dell’invocazione governata, la CI dovrà usare Node 22.x, una sola installazione e un solo job con l’ordine installazione → lint → test → build, conservando log consultabili e `dist/` senza segreti. Se il validatore Mozart espone un wrapper, la CI dovrà usare esclusivamente quello; se espone una validazione separata, dovrà riutilizzare l’installazione esistente senza ripetere i controlli.

## Gate di completamento

M0-2 non è dichiarato completato. Il completamento richiede, oltre alla baseline e ai test presenti nel repository:

1. lockfile generato da npm in un checkout pulito;
2. una singola esecuzione governata riuscita;
3. comando ufficiale del validatore `web-game/2`;
4. prova del trasferimento o mount del checkout nella radice autorizzata;
5. log consultabili, esito del validatore e `dist/index.html`;
6. CI GitHub Actions riuscita dopo verifica della piattaforma;
7. risoluzione dei gap di runner, CI e compatibilità.
