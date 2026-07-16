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

## Deploy (manual)

### Railway (API + full app)

1. New project from this repo (or CLI upload)
2. Set env var: `POLY_API_KEY`
3. Start command: `node server.js`
4. Builder: Docker (`Dockerfile`) preferred

### Netlify (frontend)

If you host only the static UI on Netlify, point API calls at your Railway URL and set CORS on the backend. The default `app.js` uses same-origin `/api/...` when the Node server serves both.

### Render

See `render.yaml` Blueprint if you prefer Render for the Node service.

## Env

| Variable | Required | Notes |
|---|---|---|
| `POLY_API_KEY` | yes | Polygon API key |
| `PORT` | no | Set by Railway/Render |
| `NODE_ENV` | no | `production` in deploy |
