// Genera config.js per la pubblicazione: URL del backend e versione di build.
const fs = require('fs');

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
const buildVersion = `v.${stamp}${sha ? ` (${sha})` : ''}`;

const config = { apiBase: process.env.API_BASE_URL || '', buildVersion };
fs.writeFileSync(process.argv[2] || 'config.js', `window.APP_CONFIG = ${JSON.stringify(config)};\n`);
console.log(`config.js generato: ${buildVersion}`);
