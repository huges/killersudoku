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

- Griglia, tastierino e comandi devono essere disposti in tre aree affiancate e chiaramente distinguibili, senza sovrapposizioni.
- La griglia resta prioritaria e leggibile; il tastierino è adiacente alla griglia e l’area comandi è adiacente al tastierino o alla griglia secondo lo spazio disponibile.
- Il tastierino deve essere utilizzabile con mouse o tastiera e non deve ridurre la leggibilità della griglia.
- I comandi di partita devono restare in un’area dedicata, con timer, errori, difficoltà e nuova partita facilmente individuabili.
- La disposizione a tre aree affiancate è una decisione proposta per rendere espliciti ordine, posizione e raggiungibilità dei controlli desktop.

### Mobile

- Ordine preferito: griglia, tastierino, comandi secondari.
- Tastierino facilmente raggiungibile con una mano.
- Griglia e comandi essenziali non coperti dalla tastiera o dai controlli.
- Cella selezionata chiaramente riconoscibile.
- Controlli dimensionati per il tocco.
- Comandi secondari separati dal tastierino per ridurre gli errori di azionamento.

L’incremento UI dovrà verificare esplicitamente ordine, posizione, dimensionamento, raggiungibilità e feedback di tastierino e comandi.

## Matrice proposta dei componenti

| Componente | Decisione proposta | Motivazione | Mantenere | Adattare o creare | Riferimenti ispezionati | Incremento previsto |
|---|---|---|---|---|---|---|
| Griglia 9×9 | Adattare | Conserva la struttura della baseline e aggiunge la rappresentazione visiva delle gabbie senza cambiare la griglia Sudoku. | Struttura 9×9 e selezione cella | Confini delle gabbie, bordi tratteggiati, etichette e stato Killer | Nessuno: non sono stati ispezionati file sorgente o immagini | UI |
| Tastierino e input | Adattare | Riutilizza i modi di inserimento dichiarati e li estende ai feedback specifici dei vincoli Killer. | Tasti 1–9, cancellazione, annotazioni e input da tastiera | Feedback per conflitti Sudoku, somma non valida e duplicati nella gabbia; mouse, tocco e tastiera fisica | Nessuno: non sono stati ispezionati file sorgente o immagini | UI/motore |
| Selezione e feedback cella | Adattare | Mantiene la selezione necessaria per l’inserimento e rende distinguibili gli errori introdotti dalle nuove regole. | Selezione riconoscibile | Distinzione tra conflitto Sudoku, duplicato nella gabbia e somma non valida | Nessuno: non sono stati ispezionati file sorgente o immagini | Motore/UI |
| Evidenziazione riga/colonna/regione | Creare o adattare | È una funzionalità proposta e non appartiene alla baseline dichiarata; va quindi valutata separatamente. | Nulla della baseline dichiarata | Evidenziazione proposta, da valutare separatamente | Nessuno: non sono stati ispezionati file sorgente o immagini | UI successiva |
| Comandi di gioco | Adattare | Mantiene il flusso di partita dichiarato e prepara l’accesso alle regole e allo stato Killer. | Difficoltà, nuova partita, timer e contatore errori | Accesso alle regole e stato partita; annulla/ripristina in seguito | Nessuno: non sono stati ispezionati file sorgente o immagini | UI |
| Layout responsive | Adattare o creare | La disposizione deve rendere griglia, tastierino e comandi utilizzabili nei diversi formati, senza sovrapposizioni. | Nessun comportamento verificato direttamente | Desktop con tre aree affiancate; mobile con griglia sopra tastierino e comandi separati | Nessuno: schermate desktop e mobile dichiarate dall’operatore, ma non ispezionate | UI |
| Modello puzzle e gabbie | Creare o estendere | Servono invarianti espliciti che la baseline Sudoku non copre: copertura completa, contiguità e non sovrapposizione. | Decisione tecnica da determinare dopo analisi | Griglia, coordinate, valori iniziali/utente, annotazioni, gabbie e somme; configurazione iniziale immutabile | Nessuno: non sono stati ispezionati file sorgente o immagini | Modello |
| Motore di validazione | Creare o estendere | Le regole Killer richiedono controlli coordinati oltre alla validazione Sudoku classica. | Decisione tecnica da determinare dopo analisi | Regole Sudoku, contiguità, copertura, non sovrapposizione, somme e divieto assoluto di duplicati | Nessuno: non sono stati ispezionati file sorgente o immagini | Motore |
| Annotazioni | Mantenere e adattare | Preserva la funzionalità dichiarata evitando che le note interferiscano con la validazione delle cifre inserite. | Annotazioni della baseline | Non trattarle come cifre definitive nella validazione | Nessuno: non sono stati ispezionati file sorgente o immagini | UI/motore |
| Persistenza locale | Creare | È necessaria per conservare lo stato utente, ma appartiene alla roadmap successiva e non a M0-1. | Nessun comportamento verificato direttamente | Salvare/ripristinare stato utente senza modificare dati iniziali o gabbie | Nessuno: non sono stati ispezionati file sorgente o immagini | Incremento successivo |
| Annulla/ripristina | Creare o adattare | Richiede uno storico delle modifiche non presente nel perimetro documentale M0-1. | Nessun comportamento verificato direttamente | Operare sulle modifiche utente, incluse annotazioni, senza modificare dati iniziali | Nessuno: non sono stati ispezionati file sorgente o immagini | Incremento successivo |

Il riuso effettivo del codice non è verificato e non viene dichiarato. I riferimenti indicati nella matrice sono quindi esplicitamente “nessuno” per ogni riga.

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
