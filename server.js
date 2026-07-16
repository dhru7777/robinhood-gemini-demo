const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function corsHeaders(req) {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function send(res, status, body, headers = {}, req) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(req ? corsHeaders(req) : {}),
    ...headers,
  });
  res.end(payload);
}

async function proxyPolygon(reqPath, searchParams) {
  const key = process.env.POLY_API_KEY;
  if (!key || key === 'your_polygon_api_key_here') {
    const err = new Error('Missing POLY_API_KEY. Add it to a .env file in the project root.');
    err.code = 'NO_KEY';
    throw err;
  }

  const url = new URL(`https://api.polygon.io${reqPath}`);
  for (const [k, v] of searchParams.entries()) {
    if (k !== 'apiKey') url.searchParams.set(k, v);
  }
  url.searchParams.set('apiKey', key);

  const upstream = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  const text = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { status: 'error', message: text.slice(0, 200) };
  }
  return { status: upstream.status, data };
}

function serveStatic(req, res) {
  let reqPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, reqPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Allow Netlify (and other hosts) to call this API
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  if (url.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      hasKey: Boolean(process.env.POLY_API_KEY && process.env.POLY_API_KEY !== 'your_polygon_api_key_here'),
    }, {}, req);
  }

  if (url.pathname === '/api/key' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const key = String(parsed.key || '').trim();
        if (!key || key.length < 10) {
          return send(res, 400, { status: 'error', error: 'Invalid API key' }, {}, req);
        }
        process.env.POLY_API_KEY = key;
        // Persist for next restart (local demo only)
        try {
          fs.writeFileSync(path.join(ROOT, '.env'), `POLY_API_KEY=${key}\nPORT=${PORT}\n`, 'utf8');
        } catch {
          // read-only filesystem on some hosts
        }
        return send(res, 200, { status: 'ok', hasKey: true }, {}, req);
      } catch (e) {
        return send(res, 400, { status: 'error', error: e.message }, {}, req);
      }
    });
    return;
  }

  if (url.pathname === '/api/snapshot') {
    try {
      const tickers = url.searchParams.get('tickers') || '';
      const { status, data } = await proxyPolygon(
        '/v2/snapshot/locale/us/markets/stocks/tickers',
        new URLSearchParams({ tickers })
      );
      return send(res, status, data, {}, req);
    } catch (e) {
      return send(res, e.code === 'NO_KEY' ? 503 : 500, { status: 'error', error: e.message, code: e.code || 'ERROR' }, {}, req);
    }
  }

  if (url.pathname === '/api/aggs') {
    try {
      const ticker = (url.searchParams.get('ticker') || 'NVDA').toUpperCase();
      const multiplier = url.searchParams.get('multiplier') || '5';
      const timespan = url.searchParams.get('timespan') || 'minute';
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!from || !to) {
        return send(res, 400, { status: 'error', error: 'from and to are required (YYYY-MM-DD)' }, {}, req);
      }
      const { status, data } = await proxyPolygon(
        `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}`,
        new URLSearchParams({ adjusted: 'true', sort: 'asc', limit: '500' })
      );
      return send(res, status, data, {}, req);
    } catch (e) {
      return send(res, e.code === 'NO_KEY' ? 503 : 500, { status: 'error', error: e.message, code: e.code || 'ERROR' }, {}, req);
    }
  }

  if (url.pathname === '/api/news') {
    try {
      const ticker = (url.searchParams.get('ticker') || 'NVDA').toUpperCase();
      const { status, data } = await proxyPolygon(
        '/v2/reference/news',
        new URLSearchParams({ ticker, limit: '6', order: 'desc', sort: 'published_utc' })
      );
      return send(res, status, data, {}, req);
    } catch (e) {
      return send(res, e.code === 'NO_KEY' ? 503 : 500, { status: 'error', error: e.message, code: e.code || 'ERROR' }, {}, req);
    }
  }

  if (url.pathname.startsWith('/api/')) {
    return send(res, 404, { status: 'error', error: 'Unknown API route' }, {}, req);
  }

  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  const hasKey = Boolean(process.env.POLY_API_KEY && process.env.POLY_API_KEY !== 'your_polygon_api_key_here');
  console.log(`Robinhood prototype → http://0.0.0.0:${PORT}`);
  console.log(hasKey ? 'Polygon API key loaded' : 'No POLY_API_KEY set (add it in Railway Variables)');
});
