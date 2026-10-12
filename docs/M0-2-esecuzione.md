# Esecuzione M0-2

## Stato e perimetro

M0-1 è approvato e completato. `docs/M0-1-perimetro.md` resta il riferimento di prodotto e layout. Commit, test e schermate di M0-1 sono evidenze dichiarate dall’operatore, non verifiche indipendenti; questa distinzione non riapre il gate M0-1.

M0-2 realizza una baseline statica non giocabile con TypeScript, React e Vite. Restano escluse griglia, input, tastierino, gabbie, motore Sudoku/Killer, timer operativo, contatore errori, persistenza, autenticazione, deploy, servizi di produzione e annulla/ripristina.

## Profilo e runner Mozart

Il repository contiene il manifest radice `mozart-software.json`:

```text
{"schema_version":2,"profile":"web-game","toolchain":"npm","node_major":22}
```

Il profilo `web-game/2`, `runtime_available: true`, Node `v22.23.3` e la directory di esecuzione uguale alla radice del checkout autorizzato sono stati osservati tramite l’evidenza del sistema `GET /software-validation/profiles`. Il contratto Mozart acquisito espone il runner ufficiale, versionato in `scripts/mozart-web-game.py`:

```text
python3 scripts/mozart-web-game.py validate
```

Il runner opera dalla radice del checkout autorizzato e gestisce la sequenza unica `npm ci --ignore-scripts --no-audit --no-fund`, lint, test e build nello stesso workspace. Il contratto precisa che in CI il checkout è fornito dallo step di checkout e non richiede un mount server. L’hash SHA-256 del runner acquisito è `5255faca08b4308095729ceb5240d8c281e6445577136739e00213c3a80819ba`.

La copia versionata del runner non costituisce da sola evidenza di validazione del progetto. In questo turno non è stata acquisita un’esecuzione governata Mozart del checkout: restano da conservare log completi, esito del validatore e `dist/index.html` prodotti da tale esecuzione.

## Runtime e comandi

Vite 7 richiede Node 22.12 o successivo nella famiglia 22. `.nvmrc` mantiene `22`; `package.json` conserva `engines.node: "22.x"` perché è il vincolo ammesso dal contratto Mozart. Il workflow configura esplicitamente Node `22.12.0`, fornendo il controllo pratico della versione minima richiesta da Vite.

Gli script versionati sono non interattivi e non reinstallano dipendenze. Il runner CI è l’unico comando governato:

```text
python3 scripts/mozart-web-game.py validate
```

Per sviluppo locale è disponibile `npm run dev`. Il runner esegue il typecheck esplicito dei due progetti tramite `npm run build` prima di Vite; l’output richiesto è `dist/index.html`. I test usano Vitest in modalità run e jsdom.

## Lockfile

`package-lock.json` è stato generato tramite lo strumento Mozart autorizzato `workspace_generate_lockfile`, usando npm con Node 22 in ambiente isolato, ed è versionato. La generazione è avvenuta senza installare dipendenze né eseguire hook; non costituisce evidenza di validazione del progetto.

## CI GitHub Actions

GitHub Actions è stata verificata come abilitata per `huges/killersudoku` dall’operatore. È stata inoltre verificata la disponibilità del permesso Mozart Workflows: Read and write. La workflow versionata configura Node 22.12.0 (compatibile con Vite 7 nella famiglia Node 22) e Python 3, invoca esclusivamente `python3 scripts/mozart-web-game.py validate` dalla radice del checkout e conserva `dist/` come artefatto senza segreti. Queste verifiche di abilitazione e permessi non costituiscono ancora l’esito di un’esecuzione CI: log, risultato della workflow e validazione Mozart del checkout restano da acquisire.

Non sono ancora disponibili log, esito del validatore Mozart, esecuzione CI o `dist/index.html` prodotti da un’esecuzione governata di questo checkout.

## Gate di completamento

M0-2 non è dichiarato completato finché non sono disponibili:

1. una singola esecuzione governata Mozart riuscita;
2. log consultabili della sequenza installazione → lint → test → build;
3. esito del validatore e `dist/index.html` prodotti dalla stessa esecuzione;
4. prova dell’esecuzione riuscita della workflow GitHub Actions e dell’abilitazione della piattaforma;
5. risoluzione del gap di evidenza relativo alla CI.
