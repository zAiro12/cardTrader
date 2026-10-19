// Genera config.js per la pubblicazione: URL del backend e versione di build (ora italiana).
const fs = require('fs');

const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date()).map(part => [part.type, part.value]));
const buildVersion = `v.${parts.year}.${parts.month}.${parts.day}-${parts.hour}${parts.minute}`;

const config = { apiBase: process.env.API_BASE_URL || '', buildVersion };
fs.writeFileSync(process.argv[2] || 'config.js', `window.APP_CONFIG = ${JSON.stringify(config)};\n`);
console.log(`config.js generato: ${buildVersion}`);