// Server minimale senza dipendenze: serve la pagina e fa da proxy verso CardTrader
// così il token resta lato server (e si evitano problemi CORS).
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'https://api.cardtrader.com/api/v2';
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
const TOKEN = loadToken();
if (!TOKEN) {
  console.error('Token mancante: crea il file token.txt con il token CardTrader, oppure imposta CARDTRADER_TOKEN (anche in .env).');
  process.exit(1);
}
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    try {
      const r = await fetch(BASE + req.url.slice(4), {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(await r.text());
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  const file = path.join(__dirname, 'index.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
