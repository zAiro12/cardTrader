# CardTrader Order Status

PWA per seguire lo stato dei tuoi ordini e degli articoli **CardTrader Zero** tramite le API di CardTrader, con notifiche push quando un articolo cambia stato (anche ad app chiusa, anche su iPhone).

[![Deploy to GitHub Pages](https://github.com/zAiro12/cardTrader/actions/workflows/pages.yml/badge.svg)](https://github.com/zAiro12/cardTrader/actions/workflows/pages.yml)
[![Controllo stati e notifiche](https://github.com/zAiro12/cardTrader/actions/workflows/push-check.yml/badge.svg)](https://github.com/zAiro12/cardTrader/actions/workflows/push-check.yml)

**Demo:** https://zairo12.github.io/cardTrader/

## Funzionalità

- Elenco ordini e dettaglio per ID (`/orders`, `/orders/{id}`).
- Dashboard CardTrader Zero: stati *Prevendita, In arrivo (con flag In ritardo), Arrivato in box, Reso, Annullato*, conteggi e valore totale.
- Nome delle carte affiancato dal costo di mana in simboli SVG e dalla rarità abbreviata (C, U, R, M, L).
- Filtri per stato, rarità, espansione e colore mana, oltre a ricerca, ordinamento (crescente/decrescente) e raggruppamento per stato o chi spedisce, con gruppi comprimibili.
- Filtri, ricerca, ordinamento e raggruppamento vengono **ricordati** alla riapertura dell'app (salvati nel browser).
- PWA installabile (Android, desktop, iOS), apertura offline dell'interfaccia.
- Notifiche push Web Push (VAPID), attivabili da più dispositivi.
- Versione di pubblicazione nel footer (`v.AAAA.MM.GG-HHMM`, ora italiana).
- Il token CardTrader resta solo sul server: il browser non lo vede mai.

## Architettura

```
GitHub Pages (frontend statico, Vue 3 da CDN)
        │  fetch /api/*
        ▼
Vercel (server.js, proxy CardTrader + push) ──► Neon Postgres (sottoscrizioni, ultimo stato)
        ▲
GitHub Actions (cron ogni 10 min → /api/push/check)
```

| File | Ruolo |
| --- | --- |
| `index.html`, `style.css`, `main.js` | Interfaccia Vue 3 |
| `service-worker.js`, `manifest.webmanifest`, `app-icon-*.png` | PWA, cache, push, icone |
| `server.js` | Server Node: static, proxy CardTrader, endpoint push, polling |
| `api/[...path].js` | Entry point Vercel che riusa `server.js` |
| `scripts/generate-config.js` | Genera `config.js` (URL backend + versione build) |
| `.github/workflows/pages.yml` | Deploy del frontend su Pages |
| `.github/workflows/push-check.yml` | Controllo periodico stati |

## Requisiti

- Node.js 18+ e npm.
- Token API CardTrader (Profilo → Impostazioni).
- Per la produzione: account GitHub, Vercel e Neon (piani gratuiti sufficienti).

## Avvio in locale

Il token non va mai committato. In ordine di priorità: variabile `CARDTRADER_TOKEN`, file `token.txt`, riga `CARDTRADER_TOKEN=...` in `.env` (entrambi in `.gitignore`).

```powershell
npm install
node server.js
```

Apri http://localhost:3000 (porta: `$env:PORT=8080; node server.js`). In locale le sottoscrizioni push sono salvate in `push-data.json` (ignorato da Git).

### Chiavi VAPID

```powershell
npx web-push generate-vapid-keys
```

```dotenv
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:tuo-indirizzo@example.com
```

Non rigenerarle dopo aver registrato dei dispositivi: le sottoscrizioni dipendono da quella coppia.

## Deploy

### Backend su Vercel

Importa il repository. Variabili d'ambiente:

| Variabile | Descrizione |
| --- | --- |
| `CARDTRADER_TOKEN` | Token API CardTrader |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Chiavi Web Push |
| `ALLOWED_ORIGIN` | Origine di Pages, es. `https://utente.github.io` (senza percorso né `/` finale) |
| `DATABASE_URL` | Connection string Neon Postgres (tabella `app_state` creata in automatico) |
| `CRON_SECRET` | Segreto per `/api/push/check` |
| `PUSH_TEST_HOURLY` | Opzionale: `true` invia una notifica di test circa ogni ora |

### Frontend su GitHub Pages

1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions:
   - Variable `API_BASE_URL`: URL del backend (senza `/` finale né `/api`).
   - Secret `CRON_SECRET`: stesso valore impostato su Vercel.
3. Ogni push su `main` pubblica il sito e rigenera `config.js` con la versione di build.

Il piano Hobby di Vercel ha solo cron giornalieri, per questo il controllo ogni 10 minuti è fatto da GitHub Actions (può avere qualche minuto di ritardo).

## Installazione e notifiche

- **Android/desktop**: pulsante **Installa app**.
- **iPhone/iPad**: Safari → Condividi → **Aggiungi alla schermata Home** (le notifiche richiedono iOS/iPadOS 16.4+ e l'app aperta dalla Home).
- Poi premi **Attiva notifiche** e concedi il permesso. Ogni dispositivo si registra separatamente.

## Sicurezza

- Non committare `.env`, `token.txt`, `push-data.json`.
- Se un token è stato esposto, revocalo e generane uno nuovo dal profilo CardTrader.
- Le rotte `/api/*` del proxy sono accessibili a chi conosce l'URL del backend: valuta di aggiungere una chiave di accesso se lo rendi pubblico.

## Note

Se l'elenco ordini è vuoto, il token potrebbe non avere ordini associati all'account. `card_trader_postman_collection.json` contiene gli endpoint di riferimento.
