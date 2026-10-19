# CardTrader Order Status

Piccolo sito web per consultare l'elenco e lo stato dei tuoi ordini tramite le API di CardTrader (`https://api.cardtrader.com/api/v2`). Permette anche di trovare l'ID di un ordine e vederne il dettaglio.

[![Deploy to GitHub Pages](https://github.com/zAiro12/cardTrader/actions/workflows/pages.yml/badge.svg)](https://github.com/zAiro12/cardTrader/actions/workflows/pages.yml)
[![Controllo stati e notifiche](https://github.com/zAiro12/cardTrader/actions/workflows/push-check.yml/badge.svg)](https://github.com/zAiro12/cardTrader/actions/workflows/push-check.yml)

## Requisiti

- Node.js 18 o superiore (serve `fetch` nativo) e npm per installare le dipendenze.
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
npm install
node server.js
```

Poi apri http://localhost:3000. Per cambiare porta: `$env:PORT=8080; node server.js`.

Se il token manca il server si ferma con un messaggio di errore.

## Installazione come PWA

Aprendo l'app in locale su `http://localhost:3000` (o pubblicandola su HTTPS), il browser può installarla come app. Nei browser compatibili appare il pulsante **Installa app**; su iPhone/iPad usa **Condividi → Aggiungi alla schermata Home**.

L'interfaccia e Vue vengono memorizzati per consentire l'apertura offline dopo il primo caricamento. Le richieste `/api/` non vengono mai memorizzate: per aggiornare ordini e articoli è necessaria una connessione e il server Node deve essere in esecuzione.

### Notifiche push

Le notifiche richiedono che il server sia raggiungibile via HTTPS, chiavi VAPID e il permesso esplicito dell'utente. Installare l'app non attiva automaticamente le notifiche: apri l'app, premi **Attiva notifiche** e concedi il permesso. Su iPhone/iPad l'app deve essere aggiunta alla schermata Home con iOS/iPadOS 16.4 o successivi.

Per l'ambiente locale, le chiavi VAPID sono salvate nel `.env` escluso da Git. Per configurare un altro server, genera una coppia:

```powershell
npx web-push generate-vapid-keys
```

Aggiungi le chiavi generate al file `.env` (non committarlo) e imposta un indirizzo di contatto valido:

```dotenv
VAPID_PUBLIC_KEY=chiave-pubblica-generata
VAPID_PRIVATE_KEY=chiave-privata-generata
VAPID_SUBJECT=mailto:tuo-indirizzo@example.com
```

Riavvia `node server.js`. Il server controlla CardTrader ogni minuto e avvisa quando cambia lo stato di un articolo già rilevato al controllo precedente. Le sottoscrizioni dei dispositivi e l'ultimo stato rilevato sono salvati in `push-data.json`, escluso da Git: conserva questo file e le chiavi VAPID per mantenere attive le registrazioni. Il server deve restare acceso e connesso a Internet perché i push arrivino anche con l'app chiusa.

Non rigenerare le chiavi VAPID dopo aver registrato i dispositivi: le sottoscrizioni esistenti dipendono da quella coppia.

## Pubblicazione su GitHub Pages

Il workflow [pages.yml](.github/workflows/pages.yml) pubblica l'interfaccia statica a ogni push su `main`. Il backend (proxy CardTrader col token, push, controllo stati) non può girare su Pages e va ospitato altrove (es. Vercel).

1. Repository → Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → Variables: crea `API_BASE_URL` con l'URL del backend (es. `https://mio-backend.vercel.app`).
3. Sul backend imposta `ALLOWED_ORIGIN` con l'origine di Pages (es. `https://utente.github.io`, senza percorso) e le variabili `CARDTRADER_TOKEN` e `VAPID_*`.

Il workflow genera `config.js` con `API_BASE_URL`; in locale `config.js` resta vuoto e le API sono quelle dello stesso server.

## Panoramica

- `server.js`: server Node con la dipendenza web-push. Serve `index.html` e fa da proxy: le richieste a `/api/*` vengono inoltrate a CardTrader aggiungendo l'header `Authorization: Bearer <token>`. Così il token resta lato server e si evitano problemi CORS.
- `index.html`, `style.css`, `main.js`: markup, stili e logica dell'interfaccia Vue 3 (CDN). Nella vista CT0 si può raggruppare (stato / chi spedisce), ordinare per vari campi in modo crescente o decrescente e comprimere i gruppi. Elenca gli ordini (`GET /orders?sort=date.desc`) e mostra il dettaglio di un ordine (`GET /orders/{id}`).
- `card_trader_postman_collection.json`: collection Postman con gli endpoint di riferimento.

Nota: se l'elenco ordini risulta vuoto, il token usato potrebbe non avere ordini associati al tuo account.

## Dashboard CardTrader Zero

Usa l'endpoint `/api/ct0_box_items`. Lo stato viene derivato dalle date: annullato, reso al venditore, arrivato, prevendita, in arrivo (con flag *In ritardo* se la data stimata è passata). Puoi filtrare per stato, cercare e ordinare. I pulsanti "Raggruppa per" (Nessuno / Stato / Chi spedisce) dividono gli articoli in gruppi con conteggio e valore totale.
