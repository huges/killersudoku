# M2-4B — Equivalenza D4 verificata

## Perimetro

Il modulo `src/domain/identity.ts` riconosce l’equivalenza esclusivamente rispetto alle otto trasformazioni D4 della griglia 9×9. L’orientamento storico resta quello con origine nell’angolo superiore sinistro e coordinate zero-based; non vengono permutate righe, bande, colonne o pile e non vengono rinumerate cifre.

Le API sono `transformPlayableContent`, `arePlayableContentsD4Equivalent` e il tipo `D4Transformation`. La versione dell’algoritmo è esposta come `D4_EQUIVALENCE_ALGORITHM_VERSION` (`d4-v1`).

## Trasformazioni

Con `n = 8`, ogni clue e ogni cella di ogni gabbia è trasformato con la stessa formula:

- `identity`: `(r,c) → (r,c)`
- `rotate90`: `(r,c) → (c,n-r)`
- `rotate180`: `(r,c) → (n-r,n-c)`
- `rotate270`: `(r,c) → (n-c,r)`
- `reflectVertical`: `(r,c) → (r,n-c)`
- `reflectHorizontal`: `(r,c) → (n-r,c)`
- `reflectMainDiagonal`: `(r,c) → (c,r)`
- `reflectAntiDiagonal`: `(r,c) → (n-c,n-r)`

Valori dei clue, somme, cardinalità e copertura delle gabbie sono conservati. Le funzioni creano nuovi oggetti e array e non mutano il contenuto ricevuto. Ogni input viene validato prima dell’elaborazione; contenuti malformati e trasformazioni sconosciute producono `ValidationError` deterministici.

## Equivalenza e canonicalizzazione

Dopo la validazione di entrambi gli input, l’equivalenza canonicalizza `right` una volta, genera le otto trasformazioni di `left`, canonicalizza ciascun risultato e confronta direttamente le stringhe complete. La canonicalizzazione condivisa ordina numericamente clue, celle e gabbie e serializza `size`, tutti i clue con coordinate e valori e tutte le gabbie con somme e celle. Non viene usato un digest nel percorso decisionale: una coincidenza parziale o un’ipotetica collisione non può produrre equivalenza.

I test distinguono gli input invalidi dai contenuti validi ma non equivalenti: questi ultimi modificano coordinate, valori dei clue, somme o appartenenza alle gabbie mantenendo invarianti e validità. Fixture asimmetriche con coordinate attese indipendenti coprono tutte le otto trasformazioni; una fixture simmetrica costruita separatamente verifica il caso di orbita stabile.
