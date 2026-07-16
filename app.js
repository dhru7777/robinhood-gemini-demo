/* Robinhood design prototype — live Polygon prices; mock chatter/sentiment UI */

const WATCHLIST = [
  { t: 'NVDA', name: 'NVIDIA' },
  { t: 'AAPL', name: 'Apple' },
  { t: 'MSFT', name: 'Microsoft' },
  { t: 'TSLA', name: 'Tesla' },
  { t: 'AMD', name: 'AMD' },
  { t: 'META', name: 'Meta' },
  { t: 'AMZN', name: 'Amazon' },
  { t: 'GOOGL', name: 'Alphabet' },
  { t: 'NFLX', name: 'Netflix' },
  { t: 'AVGO', name: 'Broadcom' },
  { t: 'SMCI', name: 'Super Micro' },
  { t: 'INTC', name: 'Intel' },
  { t: 'PLTR', name: 'Palantir' },
  { t: 'COIN', name: 'Coinbase' },
];

const DUMMY_NEWS = {
  NVDA: [
    { title: 'Earnings miss cited as catalyst', src: 'Reuters', when: '2h' },
    { title: 'AI demand narrative still intact into next print', src: 'Bloomberg', when: '4h' },
    { title: 'Options desk flags elevated put volume', src: 'Benzinga', when: '5h' },
  ],
  default: [
    { title: 'Street debate heats up after sharp session move', src: 'CNBC', when: '1h' },
    { title: 'Retail chatter rises into the close', src: 'MarketWatch', when: '3h' },
    { title: 'Analyst desk maintains wait-and-see stance', src: 'Zacks', when: '6h' },
  ],
};

const FOCUS = 'NVDA';
const POLL_MS = 60 * 1000; // refresh live prices every minute
const ALERT_STREAM_MS = 7000;

const state = {
  view: 'before',
  selected: FOCUS,
  quotes: {},
  prevQuotes: {},
  bars: [],
  news: [],
  alerts: [],
  chatter: [],
  alertCursor: 0,
  hasKey: false,
  lastFetchAt: null,
  clockTimer: null,
  pollTimer: null,
  streamTimer: null,
};

const $ = (id) => document.getElementById(id);

function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return '-';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '-';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtClock(d = new Date()) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

function dayRange() {
  const to = new Date();
  const from = new Date();
  // Pull a few sessions back so free/delayed plans still return bars after hours/weekends
  from.setDate(from.getDate() - 5);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

function parseQuote(snap) {
  if (!snap) return null;
  const day = snap.day || {};
  const prev = snap.prevDay || {};
  const last = snap.lastTrade?.p ?? day.c ?? prev.c ?? null;
  const prevClose = prev.c ?? null;
  let changePct = snap.todaysChangePerc;
  if (changePct == null && last != null && prevClose) {
    changePct = ((last - prevClose) / prevClose) * 100;
  }
  const change = snap.todaysChange ?? (last != null && prevClose != null ? last - prevClose : null);
  const high = day.h ?? last;
  const low = day.l ?? last;
  const vol = day.v ?? 0;
  const open = day.o ?? prevClose;
  const rangePct = prevClose && high != null && low != null ? ((high - low) / prevClose) * 100 : Math.abs(changePct || 0);
  return {
    ticker: snap.ticker,
    price: last,
    change,
    changePct: changePct ?? 0,
    high,
    low,
    open,
    prevClose,
    volume: vol,
    rangePct,
    updated: snap.updated,
  };
}

function volatilityLabel(rangePct) {
  if (rangePct >= 4) return 'High';
  if (rangePct >= 2) return 'Elevated';
  return 'Normal';
}

function sentimentSplit(changePct, rangePct) {
  // Derive a simple mixed sentiment from live move + range (prototype heuristic)
  const bearBias = changePct < 0 ? Math.min(70, 50 + Math.abs(changePct) * 4) : Math.max(30, 50 - changePct * 3);
  const neg = Math.round(Math.min(72, Math.max(28, bearBias + (rangePct > 3 ? 4 : 0))));
  return { neg, pos: 100 - neg };
}

function insightCopy(q) {
  const vol = volatilityLabel(q.rangePct);
  const direction = q.changePct >= 0 ? 'bid' : 'risk';
  const spike = (1.4 + Math.min(3.5, Math.abs(q.changePct) * 0.35 + q.rangePct * 0.2)).toFixed(1);
  const until = new Date();
  until.setHours(18, 30, 0, 0);
  const untilStr = until.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return {
    spike,
    vol,
    untilStr,
    headline: `Online chatter around ${q.ticker} is higher than usual. Volatility expected till ${untilStr}.`,
    narrative:
      q.changePct < 0
        ? `Chatter spike: ${spike}× baseline on Reddit/X after a ${fmtPct(q.changePct)} session move. Traders are debating downside follow-through versus dip-buying. Intraday range ~${q.rangePct.toFixed(1)}%.`
        : `Chatter spike: ${spike}× baseline as ${q.ticker} prints ${fmtPct(q.changePct)}. Volume ${formatVol(q.volume)}; traders watching momentum continuation near ${fmtPrice(q.price)}.`,
    avgMove: (2.1 + q.rangePct * 0.45).toFixed(2),
    direction,
    sentiment: sentimentSplit(q.changePct, q.rangePct),
  };
}

function formatVol(v) {
  if (!v) return '-';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}

function initials(ticker) {
  return ticker.slice(0, 2);
}

function apiBase() {
  const raw = (typeof window !== 'undefined' && (window.RH_API_BASE || localStorage.getItem('RH_API_BASE'))) || '';
  return String(raw).trim().replace(/\/$/, '');
}

function apiUrl(path) {
  const base = apiBase();
  if (!path.startsWith('/')) path = `/${path}`;
  return base ? `${base}${path}` : path;
}

async function api(path) {
  const res = await fetch(apiUrl(path));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchSnapshots() {
  const tickers = WATCHLIST.map((w) => w.t).join(',');
  const data = await api(`/api/snapshot?tickers=${encodeURIComponent(tickers)}`);
  const map = {};
  for (const snap of data.tickers || []) {
    const q = parseQuote(snap);
    if (q) map[q.ticker] = q;
  }
  return map;
}

async function fetchAggs(ticker) {
  const { from, to } = dayRange();
  const data = await api(`/api/aggs?ticker=${encodeURIComponent(ticker)}&from=${from}&to=${to}&multiplier=1&timespan=minute`);
  return data.results || [];
}

function dummyNewsFor(ticker) {
  const rows = DUMMY_NEWS[ticker] || DUMMY_NEWS.default;
  return rows.map((r) => ({ ...r, ticker }));
}

function setView(view) {
  state.view = view;
  const isBefore = view === 'before';
  $('view-before').classList.toggle('active', isBefore);
  $('view-after').classList.toggle('active', !isBefore);
  $('tab-before').setAttribute('aria-selected', String(isBefore));
  $('tab-after').setAttribute('aria-selected', String(!isBefore));
  $('tab-before').className = 'tab-btn' + (isBefore ? ' on' : '');
  $('tab-after').className = 'tab-btn' + (!isBefore ? ' on' : '');
  if (!isBefore) {
    if (!state.pollTimer) startPricePolling();
    if (!state.streamTimer) {
      state.streamTimer = setInterval(streamSyntheticAlert, ALERT_STREAM_MS);
    }
    selectTicker(state.selected);
  }
  renderBeforePrice();
}

function renderBeforePrice() {
  const q = state.quotes.NVDA;
  const px = $('before-price');
  const ch = $('before-change');
  if (!px || !ch) return;
  if (!q) {
    px.textContent = '-';
    ch.innerHTML = '<span class="muted">Loading…</span>';
    return;
  }
  px.textContent = fmtPrice(q.price);
  const cls = q.changePct >= 0 ? 'up' : 'down';
  const arrow = q.changePct >= 0 ? '▲' : '▼';
  ch.className = 'chg ' + cls;
  const asOf = state.lastFetchAt ? fmtClock(state.lastFetchAt) : fmtClock();
  ch.innerHTML = `${arrow} ${Math.abs(q.changePct).toFixed(2)}% <span class="muted" style="font-weight:500">${asOf}</span><span class="live-inline"><span class="live-dot" aria-hidden="true"></span>LIVE</span>`;
}

function renderIndices() {
  const spy = state.quotes.SPY || state.quotes.AAPL;
  const qqq = state.quotes.QQQ || state.quotes.MSFT;
  const nvda = state.quotes.NVDA;
  const el = $('indices-strip');
  if (!el) return;
  const cell = (label, q) => {
    if (!q) return `<span class="idx"><b>${label}</b> <span class="muted">…</span></span>`;
    const cls = q.changePct >= 0 ? 'up' : 'down';
    const arrow = q.changePct >= 0 ? '▲' : '▼';
    return `<span class="idx"><b>${label}</b> <span class="${cls}">${arrow} ${Math.abs(q.changePct).toFixed(2)}%</span></span>`;
  };
  el.innerHTML = [
    cell('NVDA', nvda),
    cell('AAPL', spy),
    cell('MSFT', qqq),
  ].join('<span class="dot">·</span>');
}

function renderChartHeader() {
  const q = state.quotes[state.selected];
  if (!q) return;
  $('chart-ticker').textContent = q.ticker;
  const asOf = state.lastFetchAt ? fmtClock(state.lastFetchAt) : fmtClock();
  $('chart-name').textContent = (WATCHLIST.find((w) => w.t === q.ticker)?.name || q.ticker) +
    ` · Vol ${formatVol(q.volume)} · ${asOf}`;
  $('chart-price').textContent = fmtPrice(q.price);
  const cls = q.changePct >= 0 ? 'up' : 'down';
  $('chart-change').className = 'chart-change ' + cls;
  $('chart-change').innerHTML = `${q.change >= 0 ? '+' : ''}${(q.change ?? 0).toFixed(2)} (${fmtPct(q.changePct)}) <span class="live-inline"><span class="live-dot" aria-hidden="true"></span>LIVE</span>`;
}

function renderCandles() {
  const wrap = $('candle-chart');
  if (!wrap) return;
  const bars = state.bars.slice(-48);
  if (!bars.length) {
    wrap.innerHTML = '<div class="chart-empty">Loading live chart…</div>';
    return;
  }
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = max - min || 1;
  const w = 640;
  const h = 220;
  const pad = 12;
  const slot = (w - pad * 2) / bars.length;

  const body = bars.map((b, i) => {
    const x = pad + i * slot + slot * 0.25;
    const cw = Math.max(2, slot * 0.5);
    const yHigh = pad + ((max - b.h) / span) * (h - pad * 2);
    const yLow = pad + ((max - b.l) / span) * (h - pad * 2);
    const yO = pad + ((max - b.o) / span) * (h - pad * 2);
    const yC = pad + ((max - b.c) / span) * (h - pad * 2);
    const up = b.c >= b.o;
    const color = up ? '#00C805' : '#FF5000';
    const top = Math.min(yO, yC);
    const bh = Math.max(2, Math.abs(yC - yO));
    const tip = `${new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}  O ${b.o.toFixed(2)} H ${b.h.toFixed(2)} L ${b.l.toFixed(2)} C ${b.c.toFixed(2)}`;
    return `
      <g class="bar" data-tip="${tip.replace(/"/g, '&quot;')}">
        <line x1="${x + cw / 2}" x2="${x + cw / 2}" y1="${yHigh}" y2="${yLow}" stroke="${color}" stroke-width="1"/>
        <rect x="${x}" y="${top}" width="${cw}" height="${bh}" fill="${color}" rx="1"/>
      </g>`;
  }).join('');

  wrap.innerHTML = `<svg viewBox="0 0 ${w} ${h}" class="candles" role="img" aria-label="Intraday chart">${body}</svg>`;
  wrap.querySelectorAll('.bar').forEach((g) => {
    g.addEventListener('mouseenter', (e) => showTip(e, g.getAttribute('data-tip')));
    g.addEventListener('mousemove', moveTip);
    g.addEventListener('mouseleave', hideTip);
  });
}

function renderMovers() {
  const list = Object.values(state.quotes)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 6);
  const el = $('movers-list');
  el.innerHTML = list.map((q) => {
    const name = WATCHLIST.find((w) => w.t === q.ticker)?.name || q.ticker;
    const cls = q.changePct >= 0 ? 'up' : 'down';
    const since = 'Since ' + fmtTime(new Date(Date.now() - Math.min(6, Math.abs(q.changePct)) * 3600000));
    return `
      <button type="button" class="mover ${state.selected === q.ticker ? 'selected' : ''}" data-ticker="${q.ticker}"
        data-tip="${q.ticker} live price ${fmtPrice(q.price)} (${fmtPct(q.changePct)}) · Vol ${formatVol(q.volume)}">
        <div class="logo">${initials(q.ticker)}</div>
        <div class="meta">
          <div class="row"><span class="sym">${q.ticker}</span><span class="${cls}">${fmtPrice(q.price)}</span></div>
          <div class="row sub"><span>${name}</span><span class="${cls}">${fmtPct(q.changePct)}</span></div>
          <div class="row sub"><span></span><span class="pill">${since}</span></div>
        </div>
      </button>`;
  }).join('');

  el.querySelectorAll('.mover').forEach((btn) => {
    btn.addEventListener('click', () => selectTicker(btn.dataset.ticker));
    btn.addEventListener('mouseenter', (e) => showTip(e, btn.getAttribute('data-tip')));
    btn.addEventListener('mousemove', moveTip);
    btn.addEventListener('mouseleave', hideTip);
  });
}

function renderBuzz() {
  const list = Object.values(state.quotes)
    .sort((a, b) => (b.volume || 0) - (a.volume || 0) || Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 10);
  const el = $('buzz-grid');
  el.innerHTML = list.map((q, i) => {
    const tone = q.changePct >= 1 ? 'bull' : q.changePct <= -1 ? 'bear' : 'neutral';
    const size = i < 2 ? 'lg' : i < 4 ? 'md' : 'sm';
    const tip = `${q.ticker} · ${fmtPrice(q.price)} (${fmtPct(q.changePct)}) · Vol ${formatVol(q.volume)}`;
    return `<button type="button" class="buzz ${tone} ${size}" data-ticker="${q.ticker}" data-tip="${tip}">${q.ticker}</button>`;
  }).join('');
  el.querySelectorAll('.buzz').forEach((btn) => {
    btn.addEventListener('click', () => selectTicker(btn.dataset.ticker));
    btn.addEventListener('mouseenter', (e) => showTip(e, btn.getAttribute('data-tip')));
    btn.addEventListener('mousemove', moveTip);
    btn.addEventListener('mouseleave', hideTip);
  });
}

function renderInsight() {
  const q = state.quotes[state.selected];
  if (!q) return;
  const info = insightCopy(q);
  const pill = q.changePct >= 0.5 ? 'Bullish' : q.changePct <= -0.5 ? 'Bearish' : 'Mixed';
  const pillCls = pill === 'Bullish' ? 'up' : pill === 'Bearish' ? 'down' : 'mixed';

  $('insight-card').innerHTML = `
    <div class="card-head">
      <h3>Cortex Insight</h3>
      <span class="badge">AI</span>
    </div>
    <p class="lead">${info.headline}</p>
    <div class="vol-box" data-tip="${q.ticker} ${fmtPrice(q.price)} (${fmtPct(q.changePct)}) · range ${q.rangePct.toFixed(1)}%">
      <div class="vol-row">Expected Volatility: <span class="vol-pill">${info.vol}</span></div>
      <p class="note">Alerts with this volatility moved an average of ${info.avgMove}% within 45 minutes in the last month.</p>
    </div>
    <div class="ai-row">
      <span>AI Volatility Analysis</span>
      <span class="badge ghost">BETA</span>
      <span class="sent-pill ${pillCls}">${pill}</span>
    </div>
    <div class="narrative">
      <h4>What is the chatter about?</h4>
      <p>${info.narrative}</p>
    </div>`;

  $('chatter-insights').innerHTML = `
    <div class="card-head"><h3>Chatter Insights</h3></div>
    <div class="label">Chatter Sentiment (24h)</div>
    <div class="sentiment-bar" data-tip="${info.sentiment.neg}% negative · ${info.sentiment.pos}% positive">
      <div class="neg" style="width:${info.sentiment.neg}%"></div>
      <div class="pos" style="width:${info.sentiment.pos}%"></div>
    </div>
    <div class="sent-legend"><span>${info.sentiment.neg}% negative</span><span>${info.sentiment.pos}% positive</span></div>
    <div class="highlights">
      <div class="hl"><span class="t">${fmtTime()}</span><span class="sent-pill ${pillCls}">${pill}</span><span>${q.ticker} at ${fmtPrice(q.price)} (${fmtPct(q.changePct)}).</span></div>
      <div class="hl"><span class="t">${fmtTime(new Date(Date.now() - 7200000))}</span><span class="sent-pill ${q.changePct < 0 ? 'up' : 'down'}">${q.changePct < 0 ? 'Bullish' : 'Bearish'}</span><span>Counter-narrative building around ${q.changePct < 0 ? 'dip-buys' : 'fade-the-rip'} near ${fmtPrice(q.price)}.</span></div>
    </div>
    <p class="social">${q.ticker} mentioned <b>${40 + Math.round(Math.abs(q.changePct) * 18 + q.rangePct * 8)}</b> times by high-impact influencers this week.</p>`;

  $('gold-card').innerHTML = `
    <div class="card-head gold">
      <span class="lock">🔒</span>
      <h3>GOLD - Full Breakdown</h3>
    </div>
    <ul>
      <li>Top 3 bull / bear arguments</li>
      <li>7-day sentiment history</li>
    </ul>
    <button type="button" class="gold-btn">Create agentic rule from this signal</button>`;

  $('insight-card').querySelectorAll('[data-tip]').forEach(bindTip);
  $('chatter-insights').querySelectorAll('[data-tip]').forEach(bindTip);
}

function renderChatterFeed() {
  const el = $('chatter-feed');
  const items = state.chatter.slice(0, 5);
  const asof = $('chatter-asof');
  if (asof) asof.textContent = state.lastFetchAt ? fmtClock(state.lastFetchAt) : fmtClock();
  el.innerHTML = items.map((c, i) => `
    <article class="chatter-item ${i === 0 ? 'hot' : ''}" data-ticker="${c.ticker}"
      data-tip="${c.ticker} ${fmtPrice(c.price)} (${fmtPct(c.changePct)})">
      <div class="ch-top">
        <span class="logo sm">${initials(c.ticker)}</span>
        <span class="sym">${c.ticker}</span>
        <span class="time">${c.time}</span>
      </div>
      <p>${c.text}</p>
    </article>`).join('');

  el.querySelectorAll('.chatter-item').forEach((node) => {
    node.addEventListener('click', () => selectTicker(node.dataset.ticker));
    bindTip(node);
  });
}

function renderNews() {
  const el = $('news-feed');
  const rows = state.news.length ? state.news : dummyNewsFor(state.selected);
  el.innerHTML = rows.slice(0, 5).map((n) => `
      <article class="news-item" data-tip="${n.title}">
        <div class="n-title">${n.title}</div>
        <div class="n-meta">${n.when || ''} · ${n.src || 'News'}</div>
      </article>`).join('');
  el.querySelectorAll('[data-tip]').forEach(bindTip);
}

function renderAlertToast(alert) {
  const rail = $('alert-rail');
  const node = document.createElement('div');
  node.className = 'alert-toast in';
  node.innerHTML = `<b>${alert.ticker}</b> <span class="${alert.changePct >= 0 ? 'up' : 'down'}">${fmtPct(alert.changePct)}</span> <span class="muted">${alert.text}</span>`;
  rail.prepend(node);
  while (rail.children.length > 4) rail.lastChild.remove();
  setTimeout(() => node.classList.add('show'), 10);
}

function buildChatterFromQuotes(quotes, announce) {
  const ranked = Object.values(quotes).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const fresh = [];
  for (const q of ranked.slice(0, 5)) {
    const bear = q.changePct < 0;
    const text = bear
      ? `<span class="down">Chatter notes</span> ${q.ticker} ${fmtPct(q.changePct)} with elevated range (${q.rangePct.toFixed(1)}%), implying <span class="down">downside risk</span> into the close.`
      : `<span class="up">Chatter highlights</span> ${q.ticker} ${fmtPct(q.changePct)} on volume ${formatVol(q.volume)}; traders watching <span class="up">continuation</span>.`;
    const item = {
      ticker: q.ticker,
      price: q.price,
      changePct: q.changePct,
      time: fmtTime(),
      text,
      why: 'demo',
    };
    fresh.push(item);
  }

  // Surface a toast when a live price moves meaningfully between polls
  if (announce && Object.keys(state.prevQuotes).length) {
    for (const q of ranked) {
      const prev = state.prevQuotes[q.ticker];
      if (!prev) continue;
      const delta = Math.abs(q.changePct - prev.changePct);
      if (delta >= 0.08) {
        const alert = {
          ticker: q.ticker,
          changePct: q.changePct,
          text: `Price update · ${fmtPrice(q.price)}`,
        };
        state.alerts.unshift(alert);
        renderAlertToast(alert);
      }
    }
  }

  state.chatter = [...fresh, ...state.chatter].slice(0, 5);
}

function streamSyntheticAlert() {
  const list = Object.values(state.quotes);
  if (!list.length) return;
  const q = list[state.alertCursor % list.length];
  state.alertCursor += 1;
  const alert = {
    ticker: q.ticker,
    changePct: q.changePct,
    text: `${fmtPrice(q.price)} · volatility watch`,
  };
  state.alerts.unshift(alert);
  renderAlertToast(alert);

  const bear = q.changePct < 0;
  state.chatter.unshift({
    ticker: q.ticker,
    price: q.price,
    changePct: q.changePct,
    time: fmtTime(),
    text: bear
      ? `${q.ticker} <span class="down">put chatter rising</span> after ${fmtPct(q.changePct)}; monitoring ${fmtPrice(q.low)} session low.`
      : `${q.ticker} <span class="up">momentum chatter</span> after ${fmtPct(q.changePct)}; eyes on ${fmtPrice(q.high)} high.`,
    why: 'demo',
  });
  state.chatter = state.chatter.slice(0, 5);
  renderChatterFeed();
}

async function selectTicker(ticker) {
  if (!ticker || ticker === state.selected) {
    state.selected = ticker || state.selected;
  } else {
    state.selected = ticker;
  }
  renderMovers();
  renderBuzz();
  renderChartHeader();
  renderInsight();
  state.news = dummyNewsFor(state.selected);
  renderNews();
  try {
    state.bars = await fetchAggs(state.selected);
    renderCandles();
  } catch (e) {
    console.warn(e);
  }
}

async function refreshAll(announce) {
  try {
    setLivePill('Updating…', false);
    const quotes = await fetchSnapshots();
    if (!Object.keys(quotes).length) throw new Error('No snapshot data returned');
    state.prevQuotes = state.quotes;
    state.quotes = quotes;
    state.lastFetchAt = new Date();
    buildChatterFromQuotes(quotes, announce);
    renderBeforePrice();
    renderIndices();
    renderMovers();
    renderBuzz();
    renderChartHeader();
    renderInsight();
    renderChatterFeed();
    const moversAsof = $('movers-asof');
    if (moversAsof) moversAsof.textContent = fmtClock(state.lastFetchAt);
    if ($('status-banner')) $('status-banner').hidden = true;
    setLivePill(fmtClock(state.lastFetchAt), true);
  } catch (e) {
    console.error(e);
    $('status-banner').hidden = false;
    $('status-banner').textContent =
      e.code === 'NO_KEY' || e.status === 503
        ? 'Add your Polygon API key to a .env file (POLY_API_KEY=…) and restart the server.'
        : `Market data error: ${e.message}`;
    setLivePill('Offline', false);
  }
}

function setLivePill(text, on) {
  const pill = $('live-pill');
  const label = $('live-pill-text');
  if (label) label.textContent = on ? `LIVE · ${text}` : text;
  else if (pill) pill.textContent = text;
  if (pill) pill.classList.toggle('on', Boolean(on));
}

async function startLive() {
  await refreshAll(false);
  state.news = dummyNewsFor(state.selected);
  renderNews();
  try {
    state.bars = await fetchAggs(state.selected);
    renderCandles();
  } catch (e) {
    console.warn(e);
  }

  clearInterval(state.pollTimer);
  clearInterval(state.streamTimer);
  state.pollTimer = setInterval(() => refreshAll(true), POLL_MS);
  state.streamTimer = setInterval(streamSyntheticAlert, ALERT_STREAM_MS);
}

/** Always keep NVDA (and watchlist) prices fresh, even on Before tab */
async function startPricePolling() {
  await refreshAll(false);
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => refreshAll(true), POLL_MS);
}

/* Tooltip */
const tipEl = () => $('hover-tip');
function showTip(e, text) {
  const el = tipEl();
  if (!text) return;
  el.textContent = text;
  el.hidden = false;
  moveTip(e);
}
function moveTip(e) {
  const el = tipEl();
  if (el.hidden) return;
  const x = Math.min(window.innerWidth - 280, e.clientX + 14);
  const y = Math.min(window.innerHeight - 80, e.clientY + 14);
  el.style.transform = `translate(${x}px, ${y}px)`;
}
function hideTip() {
  tipEl().hidden = true;
}
function bindTip(node) {
  node.addEventListener('mouseenter', (e) => showTip(e, node.getAttribute('data-tip')));
  node.addEventListener('mousemove', moveTip);
  node.addEventListener('mouseleave', hideTip);
}

function tickClock() {
  const el = $('live-clock');
  if (el) el.textContent = fmtClock();
}

function showKeyBar(show) {
  const bar = $('key-bar');
  if (!bar) return;
  bar.hidden = !show;
  bar.style.display = show ? 'block' : 'none';
}

async function init() {
  $('tab-before').addEventListener('click', () => setView('before'));
  $('tab-after').addEventListener('click', () => {
    setView('after');
    advanceTourFromAfterClick();
  });

  $('key-save')?.addEventListener('click', async () => {
    const key = $('key-input').value.trim();
    if (!key) return;
    try {
      const res = await fetch(apiUrl('/api/key'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save key');
      state.hasKey = true;
      showKeyBar(false);
      $('status-banner').hidden = false;
      $('status-banner').hidden = true;
      await startPricePolling();
      if (state.view === 'after') {
        clearInterval(state.streamTimer);
        state.streamTimer = setInterval(streamSyntheticAlert, ALERT_STREAM_MS);
        await selectTicker(state.selected);
      }
    } catch (e) {
      $('status-banner').hidden = false;
      $('status-banner').textContent = e.message;
    }
  });

  try {
    const health = await api('/api/health');
    state.hasKey = health.hasKey;
    if (!health.hasKey) {
      showKeyBar(true);
      $('status-banner').hidden = true;
    } else {
      await startPricePolling();
    }
  } catch {
    showKeyBar(false);
    $('status-banner').hidden = false;
    const base = apiBase();
    $('status-banner').textContent = base
      ? `Cannot reach API at ${base}. Check Railway is live and RH_API_BASE on Netlify.`
      : 'No API server on this host. On Netlify, set RH_API_BASE to your Railway URL, then redeploy.';
  }

  tickClock();
  state.clockTimer = setInterval(tickClock, 1000);
  setView('before');

  $('guide-btn')?.addEventListener('click', () => startTour());
}

/* ---------- Guided tour ---------- */
const tour = {
  active: false,
  step: 0,
  waitingForAfter: false,
};

const TOUR_STEPS = [
  {
    title: 'Walk the before / after story',
    body: 'This short guide shows today\'s stock page first, then the proposed Chatter & Sentiment experience.',
    target: null,
    view: 'before',
    nextLabel: 'Start',
  },
  {
    title: 'Today\'s experience',
    body: 'Here\'s the stock page as it feels today: live price on top, then a generic news feed. Same headlines for every user.',
    target: '#tour-before',
    view: 'before',
    nextLabel: 'Next',
  },
  {
    title: 'Generic news only',
    body: 'No chatter spike, no sentiment, no next action. Useful context, but not tied to what\'s moving the name right now.',
    target: '#tour-before-news',
    view: 'before',
    nextLabel: 'Next',
  },
  {
    title: 'Open the After view',
    body: 'Click After to see the proposed Cortex layer: live price plus chatter, sentiment, and an actionable GOLD path.',
    target: '#tab-after',
    view: 'before',
    nextLabel: 'Open After',
    requireAfter: true,
  },
  {
    title: 'Live price & chart',
    body: 'Prices refresh continuously for the ticker you select. Pick a mover anytime and the chart and insight update with it.',
    target: '.col-chart',
    view: 'after',
    nextLabel: 'Next',
  },
  {
    title: 'Cortex Insight',
    body: 'This card answers what moved the name: chatter spike, mixed sentiment, and a plain-language summary of the debate.',
    target: '#insight-card',
    view: 'after',
    nextLabel: 'Next',
  },
  {
    title: 'Online Chatter',
    body: 'A living feed of narratives around names in motion, so you can scan what\'s heating up without leaving the page.',
    target: '.col-chatter',
    view: 'after',
    nextLabel: 'Finish',
  },
];

function startTour() {
  tour.active = true;
  tour.step = 0;
  tour.waitingForAfter = false;
  $('tour').classList.add('open');
  $('tour').setAttribute('aria-hidden', 'false');
  document.body.classList.add('tour-lock');
  setView('before');
  renderTourStep();
}

function endTour() {
  tour.active = false;
  tour.waitingForAfter = false;
  const root = $('tour');
  root.classList.remove('open', 'has-spot', 'tour-mobile');
  root.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('tour-lock');
  $('tour-spot').hidden = true;
  document.querySelectorAll('.tour-target-pop').forEach((el) => el.classList.remove('tour-target-pop'));
}

function isMobileTour() {
  return window.innerWidth <= 900;
}

function positionTourCard(rect) {
  const card = $('tour-card');
  const root = $('tour');
  const pad = 12;
  const mobile = isMobileTour();
  root.classList.toggle('tour-mobile', mobile);

  const cardW = Math.min(mobile ? window.innerWidth - 24 : 340, window.innerWidth - 24);
  card.style.width = `${cardW}px`;
  const cardH = card.offsetHeight || 180;
  let top;
  let left;

  if (mobile) {
    // Dock guide card to bottom on mobile so spotlights stay readable above
    left = (window.innerWidth - cardW) / 2;
    top = window.innerHeight - cardH - pad;
    if (top < pad) top = pad;
  } else if (!rect) {
    top = Math.max(pad, (window.innerHeight - cardH) / 2);
    left = Math.max(pad, (window.innerWidth - cardW) / 2);
  } else {
    left = Math.min(Math.max(pad, rect.left), window.innerWidth - cardW - pad);
    top = rect.bottom + 14;
    if (top + cardH > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - cardH - 14);
    }
    // Keep card clear of the highlighted target when possible
    if (rect && top < rect.bottom && top + cardH > rect.top) {
      top = Math.min(window.innerHeight - cardH - pad, rect.bottom + 12);
    }
  }
  card.style.top = `${Math.max(pad, top)}px`;
  card.style.left = `${Math.max(pad, left)}px`;
}

function renderTourStep() {
  const step = TOUR_STEPS[tour.step];
  if (!step) return endTour();

  if (step.view && state.view !== step.view) setView(step.view);

  $('tour-kicker').textContent = `${tour.step + 1} / ${TOUR_STEPS.length}`;
  $('tour-title').textContent = step.title;
  $('tour-body').textContent = step.body;

  const next = $('tour-next');
  next.textContent = step.nextLabel || 'Next';
  next.classList.toggle('pulse', Boolean(step.requireAfter));

  document.querySelectorAll('.tour-target-pop').forEach((el) => el.classList.remove('tour-target-pop'));

  const spot = $('tour-spot');
  const root = $('tour');
  const target = step.target ? document.querySelector(step.target) : null;

  if (target) {
    const block = isMobileTour() ? 'start' : 'center';
    target.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' });
    setTimeout(() => {
      let rect = target.getBoundingClientRect();
      const pad = 8;
      // On mobile, keep highlight in the upper area above the docked card
      if (isMobileTour() && rect.bottom > window.innerHeight * 0.55) {
        window.scrollBy({ top: rect.top - 72, behavior: 'smooth' });
        rect = target.getBoundingClientRect();
      }
      spot.hidden = false;
      root.classList.add('has-spot');
      spot.style.position = 'fixed';
      spot.style.top = `${Math.max(8, rect.top - pad)}px`;
      spot.style.left = `${Math.max(8, rect.left - pad)}px`;
      spot.style.width = `${Math.min(window.innerWidth - 16, rect.width + pad * 2)}px`;
      let h = rect.height + pad * 2;
      if (isMobileTour()) h = Math.min(h, window.innerHeight * 0.5);
      spot.style.height = `${h}px`;
      target.classList.add('tour-target-pop');
      positionTourCard(rect);
    }, 280);
  } else {
    spot.hidden = true;
    root.classList.remove('has-spot');
    positionTourCard(null);
  }

  tour.waitingForAfter = Boolean(step.requireAfter);
}

function advanceTourFromAfterClick() {
  if (!(tour.active && tour.waitingForAfter)) return;
  tour.waitingForAfter = false;
  tour.step = Math.min(tour.step + 1, TOUR_STEPS.length - 1);
  setTimeout(renderTourStep, 280);
}

function tourNext() {
  const step = TOUR_STEPS[tour.step];
  if (!step) return;

  if (step.requireAfter) {
    tour.waitingForAfter = false;
    setView('after');
    tour.step += 1;
    setTimeout(renderTourStep, 280);
    return;
  }

  if (tour.step >= TOUR_STEPS.length - 1) {
    endTour();
    return;
  }
  tour.step += 1;
  renderTourStep();
}

$('tour-next')?.addEventListener('click', tourNext);
$('tour-skip')?.addEventListener('click', endTour);

window.addEventListener('resize', () => {
  if (tour.active) renderTourStep();
});

init();
