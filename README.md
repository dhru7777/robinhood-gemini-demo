# robinhood-gemini-demo

Robinhood Before/After Chatter & Sentiment prototype.

- Live stock prices via Polygon (`POLY_API_KEY`)
- Chatter / sentiment / news UI for the pitch
- Guided tour via the **Guide** button

## Local

```bash
cp .env.example .env
# add POLY_API_KEY=...
npm start
```

Open http://localhost:3000

## Deploy: Netlify (frontend) + Railway (API)

Netlify is static only. It cannot run `/api/*`. Point the UI at Railway.

### 1) Railway (backend)

1. Deploy this repo as a **Web Service**
2. Prefer **Docker** (`Dockerfile`)
3. Start: `node server.js`
4. Env: `POLY_API_KEY=your_polygon_key`
5. Copy the public URL, e.g. `https://app-production-xxxx.up.railway.app`

### 2) Netlify (frontend)

1. New site from `dhru7777/robinhood-gemini-demo` (branch `main`)
2. Build command: `node scripts/write-config.js`
3. Publish directory: `.`
4. Site env var (required):

| Key | Value |
|---|---|
| `RH_API_BASE` | Your Railway URL, **no trailing slash** |

Example: `RH_API_BASE=https://app-production-xxxx.up.railway.app`

5. Redeploy Netlify after setting the variable

### Quick local override

In the browser console on Netlify:

```js
localStorage.setItem('RH_API_BASE', 'https://YOUR-RAILWAY-URL')
location.reload()
```

## Env

| Variable | Where | Required |
|---|---|---|
| `POLY_API_KEY` | Railway | yes |
| `RH_API_BASE` | Netlify | yes (for split deploy) |
| `PORT` | Railway | auto |
