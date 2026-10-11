# Sudoku

Applicazione Sudoku 9×9 offline, realizzata con HTML, CSS e JavaScript senza dipendenze runtime esterne.

## Avvio

Aprire `index.html` in un browser moderno. È possibile scegliere la difficoltà, iniziare una nuova partita, compilare la griglia tramite tastiera o tastierino, usare le annotazioni e cancellare i valori inseriti.

Gli indizi iniziali sono protetti e le celle modificabili sono identificate tramite riga e colonna. Dopo quattro inserimenti errati la partita termina; il completamento corretto mostra il punteggio.

## Test

I test della logica Sudoku usano esclusivamente le API standard di Node.js:

```text
node tests/sudoku-core.test.js
```

La logica in `js/sudoku-core.js` è indipendente dal DOM e include validazione della griglia, generazione deterministica tramite RNG opzionale, gestione dei valori e annotazioni.

## Struttura

- `index.html`: pagina principale e struttura semantica della griglia.
- `css/styles.css`: presentazione e accessibilità visiva.
- `js/sudoku-core.js`: regole Sudoku e transizioni dello stato.
- `js/app.js`: interazione browser, timer, errori e punteggio.
- `tests/sudoku-core.test.js`: test automatici Node.js.
- `mozart-software.json`: manifest del progetto web-game.
