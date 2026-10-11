# M0-1 — Baseline Sudoku e matrice di riuso

## Stato e perimetro

Evidenze raccolte; proposta da verificare nel gate Mozart. Questo documento non dichiara M0-1 completato né sostituisce l'approvazione dell'operatore.
M0-1 documenta riferimento, schermate, matrice e perimetro. Implementazione di gioco, fixture, motore Killer, UI, persistenza e annulla/ripristina appartengono agli incrementi successivi.

## Repository distinti

- Sorgente: https://github.com/huges/project-sudoku
- Destinazione: https://github.com/huges/killersudoku
- Commit sorgente: `936db02e8f9b205db67915254306f5575db77945`.
- Data commit mostrata da Git sul server: `2026-09-21T08:11:07+02:00`.
- Messaggio: `Merge pull request #1 from huges/mozart/workspace-5`.
- Acquisizione: clone SSH in directory temporanea separata `/tmp/mozart-sudoku-reference.BW4saf`, riportato da Ugo l'11 ottobre 2026.
- Evidenza Git: `git -C "$SUDOKU_REFERENCE_DIR" log -1 --format='%H%n%cI%n%s'` e `git -C "$SUDOKU_REFERENCE_DIR" ls-tree --name-only HEAD`.
- Il precedente riferimento `huges/sudoku` negli artifact v2 è errato e deve essere sostituito.
- Il workspace destinazione vuoto non dimostra l'assenza del sorgente.

Albero principale osservato: README.md, css/, index.html, js/, mozart-software.json, tests/.
I sette file in `source-reference/` sono copie testuali recuperate via GitHub al commit indicato, con suffisso .txt per distinguerle dal codice applicativo della destinazione. Non sono un clone completo e non costituiscono implementazione Killer Sudoku.

## Avvio e test del riferimento

Applicazione statica HTML/CSS/JavaScript: il README permette di aprire index.html direttamente in un browser moderno. Non richiede npm install, Vite o una build.
Per l'acquisizione sul server è stato usato un server Python sulla porta 8765, vincolato all'indirizzo Tailscale, con radice nel clone sorgente.

Il test esistente è stato eseguito dall'operatore in un container temporaneo Node, con sorgente montato in sola lettura:

```sh
docker run --rm --network none \
  --mount "type=bind,src=$SUDOKU_REFERENCE_DIR,dst=/reference,readonly" \
  --workdir /reference \
  node:22-bookworm-slim \
  node tests/sudoku-core.test.js
```

Risultato mostrato nella schermata terminale dell'11 ottobre 2026, ore 13:08 circa Europe/Rome: `Sudoku core tests passed.`
È evidenza fornita dall'operatore; non un'esecuzione effettuata dall'agente di delivery. Non dimostra test end-to-end, accessibilità, unicità di tutti i puzzle o compatibilità Killer.

## Schermate

| File | Acquisizione riportata | Pixel immagine | Provenienza | Viewport CSS |
| --- | --- | --- | --- | --- |
| screenshots/mobile-top.png | 11 ottobre 2026, 13:12 Europe/Rome | 684×1536 | Chrome Android, pagina sorgente servita via Tailscale; allegato 38625.png | Non rilevato |
| screenshots/mobile-controls.png | 11 ottobre 2026, 13:12 Europe/Rome | 684×1536 | Stessa sessione mobile, pagina scorsa; allegato 38626.png | Non rilevato |
| screenshots/desktop.png | Ricevuta 11 ottobre 2026, 13:19 Europe/Rome | 2048×1472 | Schermata desktop fornita dall'operatore dopo apertura del riferimento; allegato image(20261011-111909).png | Non rilevato |

Le dimensioni dei PNG non provano il viewport CSS, il device pixel ratio o lo zoom. La schermata desktop non contiene la barra URL. Il collegamento delle schermate al clone e commit deriva dalla sequenza di acquisizione dell'operatore, non da metadati incorporati nel PNG.
Gli hash SHA-256 in `manifest.json` identificano esattamente i file conservati.

Osservazioni visive:
- Mobile: griglia leggibile; per raggiungere tutti i comandi è necessario scorrere; il tastierino non è interamente visibile nella prima schermata.
- Desktop: disposizione verticale, griglia al centro, tastierino sotto e spazio laterale disponibile.
- Le due schermate mobile mostrano lo stesso puzzle. Quella desktop mostra un puzzle differente, coerente con la generazione casuale del sorgente.
- Nessuna interazione completa o verifica sistematica di accessibilità è deducibile dalle sole immagini.

## Matrice verificata sul sorgente

| Componente | Decisione | Evidenza al commit | Adattamento previsto |
| --- | --- | --- | --- |
| Griglia 9×9 | Adattare | index.html: sudoku-grid; js/app.js: rendering e selezione; css/styles.css: regioni 3×3 e celle | Bordi tratteggiati delle gabbie e somme senza sovrapporre le cifre; mantenere selezione e protezione dei dati iniziali |
| Tastierino e tastiera | Riusare e adattare | index.html: tasti 1–9; js/app.js: eventi input, frecce, Backspace/Delete | Conservare logica input e cancellazione; rivedere disposizione e accessibilità nel nuovo layout |
| Annotazioni | Riusare e adattare | js/sudoku-core.js: toggleNote, setValue, clearValue; js/app.js: modalità note e tasto N | Integrare con stato Killer e successiva persistenza; nessuna implementazione in M0-1 |
| Regole Sudoku | Riusare e adattare | js/sudoku-core.js: isValidGrid e isValidPlacement, indipendenti dal DOM | Integrare vincoli delle gabbie, copertura e contiguità; riesaminare controllo completamento |
| Modello puzzle/gabbie | Estendere e creare | Sorgente usa matrici 9×9, fixed e solution; non contiene gabbie | Schema Killer, somme, appartenenza delle celle, validazione della struttura |
| Selezione e feedback | Adattare e creare | js/app.js e CSS: selezione ed errore rispetto alla solution | Aggiungere feedback dei vincoli e contesto riga/colonna/regione; non dichiarare già presenti evidenziazione dei pari o valori uguali |
| Comandi e fine partita | Adattare | Nuova partita, difficoltà, note, cancella, timer, contatore errori e score | Allineare comandi e politica errori alla roadmap Killer; il contatore visuale 0/3 non è criterio di accettazione Killer |
| Layout responsive | Rivedere | css/styles.css: app max 680px, griglia max 540px, breakpoint 500px; schermate allegate | Desktop con griglia e pannello comandi affiancati; mobile con input facilmente raggiungibile e selezione riconoscibile |
| Generazione puzzle | Non riusare per il catalogo iniziale | js/sudoku-core.js: createPuzzle genera soluzione e rimuove cifre secondo difficoltà | Catalogo statico Killer previsto dalla roadmap; non dedurre unicità dal generatore sorgente |
| Persistenza locale | Creare successivamente | Non rilevata nei file applicativi ispezionati | Salvare e recuperare partita secondo incremento dedicato |
| Annulla/ripristina | Creare successivamente | Non rilevati nei file applicativi ispezionati | Storia modifiche utente secondo incremento dedicato |
| Test | Riusare come riferimento e ampliare | tests/sudoku-core.test.js; risultato operatore positivo | Test Killer e interazioni negli incrementi appropriati; nessun nuovo test applicativo in M0-1 |

Le decisioni sono proposte tecniche basate sui file indicati. Non è richiesto introdurre TypeScript, Vite o Vitest per documentare questa baseline.

## Perimetro funzionale proposto

Sudoku 9×9 con regole di riga, colonna e regione 3×3. Gabbie con celle ortogonalmente contigue, somma obiettivo intera positiva, copertura di tutte le 81 celle senza sovrapposizioni, bordi tratteggiati ed etichetta deterministica. Le cifre di una gabbia devono raggiungere la somma e non possono mai ripetersi al suo interno.

Persistenza locale, annotazioni, annulla/ripristina e ulteriori funzioni seguono la roadmap negli incrementi successivi. Account, cloud, multiplayer, classifiche e generazione procedurale sono esclusi dal perimetro iniziale. Pubblicazione rinviata alla fase di rilascio.

## Prima della chiusura del gate

1. Rendere questo pacchetto disponibile nel workspace governato #16.
2. Aggiornare requirements/design v2 usando il sorgente corretto e la matrice osservata; non reiterare "sorgente inaccessibile" se le copie testuali sono disponibili.
3. Registrare i viewport CSS desktop/mobile, oppure ottenere una decisione esplicita del gate sull'accettabilità delle evidenze con viewport non rilevato.
4. Ottenere approvazione del perimetro e della matrice nel gate Mozart.
5. Dichiarare concluso esclusivamente M0-1, senza estenderlo all'implementazione del gioco.
