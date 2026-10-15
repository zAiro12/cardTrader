# CardTrader Order Status

Piccolo sito web per consultare l'elenco e lo stato dei tuoi ordini tramite le API di CardTrader (`https://api.cardtrader.com/api/v2`). Permette anche di trovare l'ID di un ordine e vederne il dettaglio.

## Requisiti

- Node.js 18 o superiore (serve `fetch` nativo). Nessuna dipendenza da installare.
- Un token API CardTrader (Profilo CardTrader → Impostazioni).
- Un browser moderno (Vue 3 viene caricato da CDN; serve una connessione al primo accesso).

## Configurazione del token

Il token non va mai committato. Puoi fornirlo in uno di questi modi (in ordine di priorità):

1. Variabile d'ambiente `CARDTRADER_TOKEN`
2. File `token.txt` nella cartella del progetto, contenente solo il token
3. File `.env` con una riga `CARDTRADER_TOKEN=...`

`token.txt` e `.env` sono in `.gitignore`.

## Avvio

```powershell
node server.js
```

Poi apri http://localhost:3000. Per cambiare porta: `$env:PORT=8080; node server.js`.

Se il token manca il server si ferma con un messaggio di errore.

## Installazione come PWA

Aprendo l'app in locale su `http://localhost:3000` (o pubblicandola su HTTPS), il browser può installarla come app. Nei browser compatibili appare il pulsante **Installa app**; su iPhone/iPad usa **Condividi → Aggiungi alla schermata Home**.

L'interfaccia e Vue vengono memorizzati per consentire l'apertura offline dopo il primo caricamento. Le richieste `/api/` non vengono mai memorizzate: per aggiornare ordini e articoli è necessaria una connessione e il server Node deve essere in esecuzione.

## Panoramica

- `server.js`: server Node senza dipendenze. Serve `index.html` e fa da proxy: le richieste a `/api/*` vengono inoltrate a CardTrader aggiungendo l'header `Authorization: Bearer <token>`. Così il token resta lato server e si evitano problemi CORS.
- `index.html`, `style.css`, `app.js`: markup, stili e logica dell'interfaccia Vue 3 (CDN). Nella vista CT0 si può raggruppare (stato / chi spedisce), ordinare per vari campi in modo crescente o decrescente e comprimere i gruppi. Elenca gli ordini (`GET /orders?sort=date.desc`) e mostra il dettaglio di un ordine (`GET /orders/{id}`).
- `card_trader_postman_collection.json`: collection Postman con gli endpoint di riferimento.

Nota: se l'elenco ordini risulta vuoto, il token usato potrebbe non avere ordini associati al tuo account.

## Dashboard CardTrader Zero

Usa l'endpoint `/api/ct0_box_items`. Lo stato viene derivato dalle date: annullato, reso al venditore, arrivato, prevendita, in arrivo (con flag *In ritardo* se la data stimata è passata). Puoi filtrare per stato, cercare e ordinare. I pulsanti "Raggruppa per" (Nessuno / Stato / Chi spedisce) dividono gli articoli in gruppi con conteggio e valore totale.
