# M0-1 — Baseline e perimetro proposto di Killer Sudoku

## Stato del gate

- Gate umano: aperto.
- Perimetro: **proposto**, non approvato.
- Questo incremento registra esclusivamente baseline, evidenze dichiarate, decisioni progettuali e matrice dei componenti.
- Non contiene implementazione del gioco, UI, modello operativo, fixture, motore di validazione, test applicativi, persistenza o annulla/ripristina.
- La PR #1 esterna non è considerata evidenza di lavoro svolto da Mozart.

## Repository ed evidenze dichiarate

| Ruolo | Riferimento |
|---|---|
| Sorgente Sudoku | `huges/project-sudoku` — https://github.com/huges/project-sudoku |
| Commit sorgente dichiarato dall’operatore | `936db02e8f9b205db67915254306f5575db77945` |
| Destinazione | `huges/killersudoku` |
| Test dichiarato dall’operatore | `tests/sudoku-core.test.js`, eseguito tramite Node in Docker |
| Risultato dichiarato | `Sudoku core tests passed` |
| Riferimenti visivi dichiarati | schermate desktop e mobile acquisite dall’operatore |

Le informazioni sul commit, sul test e sulle schermate sono dichiarazioni dell’operatore. In questo contesto non risultano file sorgente, commit o immagini ispezionati direttamente da Mozart; non vengono quindi presentate come verifiche indipendenti.

## Baseline progettuale assunta

La baseline fornita dall’operatore comprende:

- griglia Sudoku 9×9;
- selezione della cella;
- tastierino numerico 1–9;
- input da tastiera;
- cancellazione;
- annotazioni;
- selezione della difficoltà;
- nuova partita;
- timer;
- contatore degli errori.

L’evidenziazione di riga, colonna e regione non è baseline esistente: è una funzionalità proposta da valutare in un successivo incremento UI.

## Perimetro funzionale proposto

Killer Sudoku mantiene le regole Sudoku classiche:

- ogni riga contiene le cifre da 1 a 9 senza duplicati;
- ogni colonna contiene le cifre da 1 a 9 senza duplicati;
- ogni regione 3×3 contiene le cifre da 1 a 9 senza duplicati.

Introduce inoltre gabbie che devono:

- essere formate da celle ortogonalmente contigue;
- coprire complessivamente tutte le 81 celle;
- non sovrapporsi;
- avere una somma obiettivo;
- mostrare un bordo tratteggiato;
- mostrare un’etichetta leggibile della somma;
- risultare coerenti con la somma delle cifre inserite;
- vietare sempre le cifre duplicate nella stessa gabbia, senza eccezioni.

Fuori perimetro: account, sincronizzazione cloud, multiplayer, classifiche, generazione procedurale e pubblicazione online.

## Decisioni di layout proposte

### Desktop

- Griglia e area comandi affiancate, senza sovrapposizioni.
- Griglia prioritaria e leggibile.
- Tastierino vicino alla griglia, utilizzabile con mouse o tastiera.
- Comandi di partita in un’area dedicata.
- Timer, errori, difficoltà e nuova partita facilmente individuabili.

### Mobile

- Ordine preferito: griglia, tastierino, comandi secondari.
- Tastierino facilmente raggiungibile con una mano.
- Griglia e comandi essenziali non coperti dalla tastiera o dai controlli.
- Cella selezionata chiaramente riconoscibile.
- Controlli dimensionati per il tocco.
- Comandi secondari separati dal tastierino per ridurre gli errori di azionamento.

L’incremento UI dovrà verificare esplicitamente ordine, posizione, dimensionamento, raggiungibilità e feedback di tastierino e comandi.

## Matrice proposta dei componenti

| Componente | Decisione proposta | Mantenere | Adattare o creare | Incremento previsto |
|---|---|---|---|---|
| Griglia 9×9 | Adattare | Struttura 9×9 e selezione cella | Confini delle gabbie, bordi tratteggiati, etichette e stato Killer | UI |
| Tastierino e input | Adattare | Tasti 1–9, cancellazione, annotazioni e input da tastiera | Feedback per conflitti Sudoku, somma non valida e duplicati nella gabbia; mouse, tocco e tastiera fisica | UI/motore |
| Selezione e feedback cella | Adattare | Selezione riconoscibile | Distinzione tra conflitto Sudoku, duplicato nella gabbia e somma non valida | Motore/UI |
| Evidenziazione riga/colonna/regione | Creare o adattare | Nulla della baseline dichiarata | Evidenziazione proposta, da valutare separatamente | UI successiva |
| Comandi di gioco | Adattare | Difficoltà, nuova partita, timer e contatore errori | Accesso alle regole e stato partita; annulla/ripristina in seguito | UI |
| Layout responsive | Adattare o creare | Nessun comportamento verificato direttamente | Desktop affiancato; mobile con griglia sopra tastierino e comandi separati | UI |
| Modello puzzle e gabbie | Creare o estendere | Decisione tecnica da determinare dopo analisi | Griglia, coordinate, valori iniziali/utente, annotazioni, gabbie e somme; configurazione iniziale immutabile | Modello |
| Motore di validazione | Creare o estendere | Decisione tecnica da determinare dopo analisi | Regole Sudoku, contiguità, copertura, non sovrapposizione, somme e divieto assoluto di duplicati | Motore |
| Annotazioni | Mantenere e adattare | Annotazioni della baseline | Non trattarle come cifre definitive nella validazione | UI/motore |
| Persistenza locale | Creare | Nessun comportamento verificato direttamente | Salvare/ripristinare stato utente senza modificare dati iniziali o gabbie | Incremento successivo |
| Annulla/ripristina | Creare o adattare | Nessun comportamento verificato direttamente | Operare sulle modifiche utente, incluse annotazioni, senza modificare dati iniziali | Incremento successivo |

Il riuso effettivo del codice non è verificato e non viene dichiarato. Non risultano riferimenti sorgente o visivi ispezionati direttamente da Mozart.

## Assegnazione alla roadmap

- **M0-1:** baseline, evidenze dichiarate, perimetro proposto, matrice e decisioni responsive.
- **Incremento modello:** rappresentazione di puzzle e gabbie, inclusi invarianti di copertura, contiguità e non sovrapposizione.
- **Incremento motore:** validazione Sudoku, somme e divieto assoluto di duplicati nelle gabbie.
- **Incremento UI:** griglia, bordi ed etichette delle gabbie, tastierino, feedback e layout desktop/mobile.
- **Incremento successivo:** persistenza locale.
- **Incremento successivo:** annulla/ripristina per modifiche e annotazioni.

## Criteri documentali di M0-1

Il deliverable registra:

- distinzione tra repository sorgente e destinazione;
- commit, test e schermate come riferimenti forniti dall’operatore;
- baseline e funzionalità proposte distinte;
- matrice con decisione e lavoro futuro;
- layout desktop/mobile per griglia, tastierino e comandi;
- gabbie ortogonalmente contigue, non sovrapposte e complessivamente estese alle 81 celle;
- divieto assoluto di cifre duplicate nelle gabbie;
- persistenza locale e annulla/ripristina assegnati a incrementi successivi;
- assenza di implementazione del gioco;
- perimetro indicato come proposto fino all’approvazione umana.

Non sono stati aggiunti test applicativi perché M0-1 li esclude esplicitamente; non esiste implementazione da testare nel repository inizialmente vuoto.
