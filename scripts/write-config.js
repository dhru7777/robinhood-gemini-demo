const fs = require('fs');
const path = require('path');

const base = String(process.env.RH_API_BASE || process.env.API_BASE || '')
  .trim()
  .replace(/\/$/, '');

const out = path.join(__dirname, '..', 'config.js');
fs.writeFileSync(
  out,
  `// Generated for Netlify/Railway split deploy\nwindow.RH_API_BASE = ${JSON.stringify(base)};\n`,
  'utf8'
);

console.log(base ? `RH_API_BASE -> ${base}` : 'RH_API_BASE empty (same-origin /api)');
