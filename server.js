// Server Node per l'interfaccia, il proxy CardTrader e le notifiche push.
const http = require('http');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const BASE = 'https://api.cardtrader.com/api/v2';
const PUSH_DATA_FILE = path.join(__dirname, 'push-data.json');
const PUSH_POLL_INTERVAL = 60_000;
function loadToken() {
  if (process.env.CARDTRADER_TOKEN) return process.env.CARDTRADER_TOKEN.trim();
  const tokenFile = path.join(__dirname, 'token.txt');
  if (fs.existsSync(tokenFile)) return fs.readFileSync(tokenFile, 'utf8').trim();
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^\s*(?:CARDTRADER_TOKEN|TOKEN)\s*=\s*["']?([^"'\r\n]+)/m);
    if (m) return m[1].trim();
  }
  return null;
}
function loadSetting(name) {
  if (process.env[name]) return process.env[name].trim();
  const envFile = path.join(__dirname, '.env');
  if (!fs.existsSync(envFile)) return null;
  const pattern = new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\r\\n]+)`, 'm');
  const match = fs.readFileSync(envFile, 'utf8').match(pattern);
  return match ? match[1].trim() : null;
}
const TOKEN = loadToken();
const isMain = require.main === module;
if (!TOKEN) {
  console.error('Token mancante: crea il file token.txt con il token CardTrader, oppure imposta CARDTRADER_TOKEN (anche in .env o nelle variabili d\'ambiente).');
  if (isMain) process.exit(1);
}
const PORT = process.env.PORT || 3000;
const VAPID_PUBLIC_KEY = loadSetting('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = loadSetting('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = loadSetting('VAPID_SUBJECT') || 'mailto:admin@example.com';
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
// Origine del sito su GitHub Pages (es. https://utente.github.io), abilitata via CORS.
const ALLOWED_ORIGIN = (loadSetting('ALLOWED_ORIGIN') || '').replace(/\/+$/, '') || null;

if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('Notifiche push disabilitate: configura VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY in .env.');
}

function loadPushData() {
  if (!fs.existsSync(PUSH_DATA_FILE)) return { subscriptions: [], statuses: null };
  const data = JSON.parse(fs.readFileSync(PUSH_DATA_FILE, 'utf8'));
  if (!Array.isArray(data.subscriptions) ||
      !(data.statuses === null || (typeof data.statuses === 'object' && !Array.isArray(data.statuses)))) {
    throw new Error('push-data.json non ha un formato valido.');
  }
  return data;
}

let pushData = loadPushData();
let polling = false;

function savePushData() {
  const tempFile = PUSH_DATA_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(pushData, null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, PUSH_DATA_FILE);
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function isSameOrigin(req) {
  if (!req.headers.origin || !req.headers.host) return false;
  try {
    const origin = new URL(req.headers.origin);
    return (origin.protocol === 'https:' || origin.protocol === 'http:') &&
      (origin.host.toLowerCase() === req.headers.host.toLowerCase() || origin.origin === ALLOWED_ORIGIN);
  } catch {
    return false;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let oversized = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (oversized) return;
      body += chunk;
      if (body.length > 32_768) {
        oversized = true;
        body = '';
        reject(Object.assign(new Error('Richiesta troppo grande.'), { status: 413 }));
      }
    });
    req.on('end', () => {
      if (oversized) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('JSON non valido.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function itemStatus(item) {
  return item.cancelled_at ? 'cancelled' : item.return_to_seller ? 'returned'
    : item.arrived_at ? 'arrived' : item.presale ? 'presale' : 'incoming';
}

const STATUS_LABELS = {
  presale: 'Prevendita',
  incoming: 'In arrivo',
  arrived: 'Arrivato in box',
  returned: 'Reso al venditore',
  cancelled: 'Annullato',
};

async function pollStatusChanges() {
  if (!PUSH_ENABLED || polling || pushData.subscriptions.length === 0) return;
  polling = true;
  try {
    const response = await fetch(`${BASE}/ct0_box_items`, {
      headers: { Authorization: 'Bearer ' + TOKEN },
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`CardTrader ha risposto ${response.status}: ${JSON.stringify(result)}`);
    const items = Array.isArray(result) ? result : (result.array || result.ct0_box_items || result.items);
    if (!Array.isArray(items)) throw new Error('Formato della risposta ct0_box_items non riconosciuto.');

    const current = {};
    for (const item of items) {
      if (item.id == null) continue;
      current[String(item.id)] = {
        status: itemStatus(item),
        name: item.name || item.blueprint_name || `Articolo ${item.id}`,
      };
    }

    if (pushData.statuses === null) {
      pushData.statuses = current;
      savePushData();
      return;
    }

    const changes = Object.entries(current).filter(([id, item]) =>
      pushData.statuses[id] && pushData.statuses[id].status !== item.status);
    const newItems = Object.keys(current).some(id => !pushData.statuses[id]);
    const expiredEndpoints = new Set();
    const subscriptions = [...pushData.subscriptions];

    for (const [id, item] of changes) {
      const previous = pushData.statuses[id];
      const notification = JSON.stringify({
        title: 'Stato ordine aggiornato',
        body: `${item.name}: ${STATUS_LABELS[previous.status] || previous.status} → ${STATUS_LABELS[item.status] || item.status}`,
        url: '/',
        tag: `cardtrader-item-${id}`,
      });
      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification(subscription, notification, { TTL: 3600 });
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            expiredEndpoints.add(subscription.endpoint);
          } else {
            console.error(`Invio notifica push non riuscito (HTTP ${error.statusCode || 'sconosciuto'}):`, error.message);
          }
        }
      }
    }

    if (expiredEndpoints.size) {
      pushData.subscriptions = pushData.subscriptions.filter(s => !expiredEndpoints.has(s.endpoint));
    }
    if (changes.length || newItems || expiredEndpoints.size) {
      pushData.statuses = current;
      savePushData();
    }
  } catch (error) {
    console.error('Controllo notifiche CardTrader non riuscito:', error.message);
  } finally {
    polling = false;
  }
}

async function handler(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (!TOKEN) return sendJson(res, 500, { error: 'Token CardTrader non configurato sul server.' });
  if (requestUrl.pathname.startsWith('/api/') && ALLOWED_ORIGIN && req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
  }
  if (requestUrl.pathname.startsWith('/api/push/')) {
    if (requestUrl.pathname === '/api/push/config' && req.method === 'GET') {
      return sendJson(res, 200, { enabled: PUSH_ENABLED, publicKey: PUSH_ENABLED ? VAPID_PUBLIC_KEY : null });
    }
    if (requestUrl.pathname === '/api/push/subscribe' && req.method === 'POST') {
      if (!PUSH_ENABLED) return sendJson(res, 503, { error: 'Le notifiche push non sono configurate sul server.' });
      if (!isSameOrigin(req)) {
        req.resume();
        return sendJson(res, 403, { error: 'Richiesta non autorizzata.' });
      }
      try {
        const subscription = await readJson(req);
        if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription) ||
            typeof subscription.endpoint !== 'string' || !subscription.keys?.p256dh || !subscription.keys?.auth) {
          return sendJson(res, 400, { error: 'Sottoscrizione push non valida.' });
        }
        let endpoint;
        try {
          endpoint = new URL(subscription.endpoint);
        } catch {
          return sendJson(res, 400, { error: 'Endpoint push non valido.' });
        }
        const allowedHost = endpoint.hostname === 'fcm.googleapis.com' ||
          endpoint.hostname.endsWith('.push.services.mozilla.com') ||
          endpoint.hostname.endsWith('.notify.windows.com') ||
          endpoint.hostname.endsWith('.push.apple.com');
        if (endpoint.protocol !== 'https:' || endpoint.port || !allowedHost) {
          return sendJson(res, 400, { error: 'Provider notifiche non supportato.' });
        }
        pushData.subscriptions = pushData.subscriptions.filter(s => s.endpoint !== subscription.endpoint);
        pushData.subscriptions.push(subscription);
        savePushData();
        if (pushData.statuses === null) setImmediate(pollStatusChanges);
        return sendJson(res, 201, { ok: true });
      } catch (error) {
        console.error('Salvataggio sottoscrizione push non riuscito:', error.message);
        return sendJson(res, error.status || 500, { error: error.status ? error.message : 'Impossibile salvare la sottoscrizione.' });
      }
    }
    if (requestUrl.pathname === '/api/push/unsubscribe' && req.method === 'POST') {
      if (!isSameOrigin(req)) {
        req.resume();
        return sendJson(res, 403, { error: 'Richiesta non autorizzata.' });
      }
      try {
        const { endpoint } = await readJson(req);
        if (typeof endpoint !== 'string') return sendJson(res, 400, { error: 'Endpoint non valido.' });
        pushData.subscriptions = pushData.subscriptions.filter(s => s.endpoint !== endpoint);
        savePushData();
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        console.error('Rimozione sottoscrizione push non riuscita:', error.message);
        return sendJson(res, error.status || 500, { error: error.status ? error.message : 'Impossibile rimuovere la sottoscrizione.' });
      }
    }
    return sendJson(res, 404, { error: 'Endpoint push non trovato.' });
  }
  if (requestUrl.pathname.startsWith('/api/')) {
    try {
      const r = await fetch(BASE + req.url.slice(4), {
        headers: { Authorization: "Bearer " + TOKEN },
      });
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(await r.text());
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  };
  const name = requestUrl.pathname === '/' ? 'index.html' : path.basename(requestUrl.pathname);
  const ext = path.extname(name);
  const file = path.join(__dirname, name);
  if (!types[ext] || !fs.existsSync(file) || name === 'server.js') {
    res.writeHead(404); return res.end('Not found');
  }
  const headers = { 'Content-Type': types[ext] };
  if (name === 'service-worker.js' || name === 'manifest.webmanifest') headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

module.exports = handler;

// In locale parte come server standalone; su Vercel viene usato solo l'handler esportato.
if (isMain) {
  http.createServer(handler).listen(PORT, () => console.log(`http://localhost:${PORT}`));
  const pushPoll = setInterval(pollStatusChanges, PUSH_POLL_INTERVAL);
  pushPoll.unref();
}
