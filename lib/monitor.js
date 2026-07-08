/* ═══════════════════════════════════════
   MONITOR — real-time visitor dashboard + CDN alert log
   Semua state (log, SSE clients, alert) hidup di sini; server.js dan
   ketiga platform scraper cukup import fungsi yang dibutuhkan.

   Buffer limits (supaya /monitor tidak lag di puluhan ribu event):
   - MON_BUF      : jumlah event yang disimpan di memory (ring buffer)
   - CDN_ALERT_MAX: jumlah CDN alert yang disimpan
   - SSE_HISTORY  : jumlah event yang dikirim ke client baru saat connect
   totalEvents adalah counter akurat terpisah — tidak berkurang saat
   ring buffer trim, sehingga stat "Total Events" di dashboard tetap benar.
═══════════════════════════════════════ */

const MONITOR_KEY   = process.env.SESSION_SECRET || '';
const MON_BUF       = 2000;   // max event tersimpan di memory (ring buffer)
const CDN_ALERT_MAX = 200;    // max CDN alert tersimpan
const SSE_HISTORY   = 300;    // max event dikirim ke client baru saat connect

const monitorLog = [];        // ring buffer — max MON_BUF entries
let   totalEvents = 0;        // counter akurat, tidak berkurang saat trim
let   monitorSSE  = [];       // connected SSE clients

const cdnAlerts = [];         // ring buffer — max CDN_ALERT_MAX entries

function pushMonitorEvent(type, payload) {
  const ev = { ts: Date.now(), type, ...payload };
  totalEvents++;
  monitorLog.push(ev);
  // Trim ring buffer — buang yang paling lama
  if (monitorLog.length > MON_BUF) monitorLog.shift();

  const msg = `event: event\ndata: ${JSON.stringify(ev)}\n\n`;
  monitorSSE = monitorSSE.filter(r => {
    try { r.write(msg); return true; } catch { return false; }
  });
}

function logCdnAlert(msg) {
  console.warn(msg);
  cdnAlerts.push({ ts: new Date().toISOString(), msg });
  if (cdnAlerts.length > CDN_ALERT_MAX) cdnAlerts.shift();
}

/* ── Middleware: catat setiap request API yang relevan ── */
function trackRequest(req, _res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
           || req.socket?.remoteAddress || '?';
  const ua = (req.headers['user-agent'] || '').slice(0, 100);
  const p  = req.path;
  if      (p.startsWith('/proxy/stream/'))  pushMonitorEvent('stream',   { id: p.split('/')[3] || '?', ip, ua });
  else if (p.startsWith('/api/video/'))     pushMonitorEvent('video',    { id: p.split('/')[3] || '?', ip, ua });
  else if (p.startsWith('/api/folder/'))    pushMonitorEvent('folder',   { id: p.split('/')[3] || '?', ip, ua });
  else if (p.startsWith('/api/rb/video/'))  pushMonitorEvent('rb_video', { id: p.split('/')[4] || '?', ip, ua });
  else if (p.startsWith('/api/rb/posts'))   pushMonitorEvent('rb_posts', { ip, ua });
  else if (p.startsWith('/api/yb/video/'))  pushMonitorEvent('yb_video', { id: p.split('/')[4] || '?', ip, ua });
  else if (p.startsWith('/api/yb/posts'))   pushMonitorEvent('yb_posts', { ip, ua });
  else if (p.startsWith('/api/bk/video/'))  pushMonitorEvent('bk_video', { id: p.split('/')[4] || '?', ip, ua });
  else if (p.startsWith('/api/bk/posts'))   pushMonitorEvent('bk_posts', { ip, ua });
  next();
}

/* ── Auth: form login, bukan 401 mentah — bisa di-bookmark dengan ?key= ── */
function checkMonitorKey(req, res, action = '/monitor') {
  if (!MONITOR_KEY) { res.status(503).send('SESSION_SECRET belum di-set.'); return false; }
  if (req.query.key !== MONITOR_KEY) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(req.query.key ? 401 : 200).send(`<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vidorey Monitor — Login</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0d12;color:#e0e0e8;font-family:'Segoe UI',system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#14141e;border:1px solid #2a2a3a;border-radius:12px;padding:32px 28px;
        width:100%;max-width:360px;text-align:center}
  h1{font-size:1.1rem;color:#a78bfa;margin-bottom:6px}
  p{font-size:.78rem;color:#52525b;margin-bottom:24px}
  input{width:100%;padding:10px 14px;background:#0d0d12;border:1px solid #2a2a3a;
        border-radius:8px;color:#e0e0e8;font-size:.9rem;margin-bottom:12px;outline:none}
  input:focus{border-color:#7c3aed}
  button{width:100%;padding:10px;background:#7c3aed;border:none;border-radius:8px;
         color:#fff;font-size:.9rem;font-weight:600;cursor:pointer}
  button:hover{background:#6d28d9}
  .err{color:#f87171;font-size:.75rem;margin-bottom:12px}
</style></head>
<body><div class="card">
  <h1>⬡ Vidorey Monitor</h1>
  <p>Masukkan SESSION_SECRET untuk masuk</p>
  ${req.query.key ? '<div class="err">⚠ Key salah, coba lagi.</div>' : ''}
  <form method="GET" action="${action}">
    <input type="password" name="key" placeholder="SESSION_SECRET" autofocus autocomplete="current-password">
    <button type="submit">Masuk</button>
  </form>
</div></body></html>`);
    return false;
  }
  return true;
}

function monitorDashboardHtml(key) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vidorey Monitor</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d0d12;color:#e0e0e8;min-height:100vh;padding:16px}
  h1{font-size:1.1rem;color:#a78bfa;letter-spacing:.05em;margin-bottom:8px}
  .topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .toplinks{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn-firebase{display:inline-flex;align-items:center;gap:6px;background:#1a1a24;border:1px solid #f59e0b44;
    color:#fbbf24;border-radius:8px;padding:6px 14px;font-size:.78rem;font-weight:600;text-decoration:none;
    letter-spacing:.03em;transition:background .15s}
  .btn-firebase:hover{background:#2a2010}
  .btn-console{display:inline-flex;align-items:center;gap:6px;background:#1a1a24;border:1px solid #4285f444;
    color:#74a9ff;border-radius:8px;padding:6px 14px;font-size:.78rem;font-weight:600;text-decoration:none;
    letter-spacing:.03em;transition:background .15s}
  .btn-console:hover{background:#101828}
  .stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .stat{background:#1a1a24;border:1px solid #2a2a3a;border-radius:8px;padding:10px 16px;min-width:110px}
  .stat-val{font-size:1.6rem;font-weight:700;color:#c4b5fd}
  .stat-lbl{font-size:.7rem;color:#6b6b80;margin-top:2px;text-transform:uppercase;letter-spacing:.05em}
  #feed{display:flex;flex-direction:column;gap:4px}
  .ev{display:grid;grid-template-columns:70px 80px 1fr 120px;gap:8px;align-items:center;
      background:#14141e;border:1px solid #1f1f2e;border-radius:6px;padding:7px 10px;font-size:.75rem}
  /* animasi hanya untuk event live baru, bukan history bulk */
  .ev.live{animation:fadeIn .25s ease}
  @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .ev-time{color:#6b6b80;font-variant-numeric:tabular-nums}
  .badge{display:inline-block;padding:2px 7px;border-radius:99px;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  .b-stream  {background:#14532d;color:#4ade80}
  .b-video   {background:#1e3a5f;color:#60a5fa}
  .b-folder  {background:#2a2a2a;color:#a1a1aa}
  .b-rb_video{background:#3b1d5a;color:#c084fc}
  .b-rb_posts{background:#3b1d5a;color:#c084fc}
  .b-yb_video{background:#14532d;color:#4ade80}
  .b-yb_posts{background:#14532d;color:#4ade80}
  .b-bk_video{background:#1c2a3a;color:#38bdf8}
  .b-bk_posts{background:#1c2a3a;color:#38bdf8}
  .ev-id{color:#d4d4d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ev-ip{color:#71717a;font-size:.7rem;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:6px;animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  #status{font-size:.72rem;color:#52525b;margin-bottom:12px}
  .hint{font-size:.68rem;color:#3f3f52;margin-top:8px;text-align:center}
</style>
</head>
<body>
<div class="topbar">
  <h1>⬡ Vidorey Monitor</h1>
  <div class="toplinks">
    <a class="btn-firebase" href="https://vidorey.web.app" target="_blank" rel="noopener">🔥 vidorey.web.app</a>
    <a class="btn-console" href="https://analytics.google.com/analytics/web/?authuser=1&hl=en-US#/a338511152p518732508/reports/dashboard?r=firebase-overview" target="_blank" rel="noopener">📊 Firebase Analytics</a>
  </div>
</div>
<div id="status"><span class="dot"></span>Connecting…</div>
<div class="stats">
  <div class="stat"><div class="stat-val" id="s-total">0</div><div class="stat-lbl">Total Events</div></div>
  <div class="stat"><div class="stat-val" id="s-stream">0</div><div class="stat-lbl">Streams</div></div>
  <div class="stat"><div class="stat-val" id="s-video">0</div><div class="stat-lbl">Video Opens</div></div>
  <div class="stat"><div class="stat-val" id="s-ip">0</div><div class="stat-lbl">Unique IPs</div></div>
</div>
<div id="feed"></div>
<p class="hint" id="hint"></p>
<script>
const KEY      = '${key}';
const MAX_ROWS = 300;   // max baris DOM — hapus yang paling lama saat overflow
const feed     = document.getElementById('feed');

// counts.total diinit dari totalEvents server (akurat walau ring buffer trim)
let counts = { total: 0, stream: 0, video: 0 };
const ips  = new Set();

function fmt(ts) {
  return new Date(ts).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

// animate=true hanya untuk event live baru (bukan bulk history)
function addRow(ev, prepend, animate) {
  counts.total++;
  if (ev.type === 'stream') counts.stream++;
  if (ev.type === 'video')  counts.video++;
  if (ev.ip) ips.add(ev.ip);
  document.getElementById('s-total').textContent  = counts.total;
  document.getElementById('s-stream').textContent = counts.stream;
  document.getElementById('s-video').textContent  = counts.video;
  document.getElementById('s-ip').textContent     = ips.size;

  const row = document.createElement('div');
  row.className = animate ? 'ev live' : 'ev';
  const badge   = '<span class="badge b-' + ev.type + '">' + ev.type.replace('_', ' ') + '</span>';
  const ipShort = (ev.ip || '?').split(',')[0].trim().slice(0, 20);
  row.innerHTML  = '<span class="ev-time">' + fmt(ev.ts) + '</span>'
    + badge
    + '<span class="ev-id">' + (ev.id || '-') + '</span>'
    + '<span class="ev-ip">' + ipShort + '</span>';

  if (prepend) {
    feed.prepend(row);
    // Trim DOM — hapus baris paling bawah jika sudah melebihi MAX_ROWS
    while (feed.children.length > MAX_ROWS) feed.removeChild(feed.lastChild);
  } else {
    feed.appendChild(row);
  }
}

function connect() {
  const es = new EventSource('/monitor/events?key=' + KEY);
  es.onopen = () => {
    document.getElementById('status').innerHTML = '<span class="dot"></span>Live';
  };

  es.addEventListener('history', e => {
    const data    = JSON.parse(e.data);
    const events  = data.events || [];
    // Init total dari server counter yang akurat (bukan hanya panjang history slice)
    counts.total  = (data.totalEvents || events.length) - events.length;
    counts.stream = 0;
    counts.video  = 0;

    // Render history sekaligus pakai DocumentFragment — satu reflow, tidak lag
    const frag = document.createDocumentFragment();
    // events sudah terurut terbaru-dulu (reversed di server)
    events.forEach(ev => {
      counts.total++;
      if (ev.type === 'stream') counts.stream++;
      if (ev.type === 'video')  counts.video++;
      if (ev.ip) ips.add(ev.ip);

      const row     = document.createElement('div');
      row.className = 'ev'; // tidak animate saat bulk load
      const badge   = '<span class="badge b-' + ev.type + '">' + ev.type.replace('_', ' ') + '</span>';
      const ipShort = (ev.ip || '?').split(',')[0].trim().slice(0, 20);
      row.innerHTML  = '<span class="ev-time">' + fmt(ev.ts) + '</span>'
        + badge
        + '<span class="ev-id">' + (ev.id || '-') + '</span>'
        + '<span class="ev-ip">' + ipShort + '</span>';
      frag.appendChild(row);
    });

    feed.innerHTML = '';
    feed.appendChild(frag);

    document.getElementById('s-total').textContent  = counts.total;
    document.getElementById('s-stream').textContent = counts.stream;
    document.getElementById('s-video').textContent  = counts.video;
    document.getElementById('s-ip').textContent     = ips.size;

    if (data.totalEvents > events.length) {
      document.getElementById('hint').textContent =
        'Menampilkan ' + events.length + ' event terbaru dari total ' + data.totalEvents + ' event sejak server start.';
    }
  });

  es.addEventListener('event', e => {
    addRow(JSON.parse(e.data), true, true); // live event: prepend + animate
  });

  es.onerror = () => {
    document.getElementById('status').innerHTML = '<span style="color:#ef4444">● Disconnected — reconnecting…</span>';
    es.close();
    setTimeout(connect, 3000);
  };
}
connect();
</script>
</body>
</html>`;
}

/* ── Registrasi semua route monitor & health ke app ──
   getCacheStats: () => array of cache.stats() dari ketiga platform ── */
function registerMonitorRoutes(app, { getCacheStats }) {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: Date.now() });
  });

  app.get('/health/detail', (req, res) => {
    if (!checkMonitorKey(req, res, '/health/detail')) return;
    const uptime = process.uptime();
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;
    res.json({
      status: 'ok',
      uptime: uptimeStr,
      startedAt: new Date(Date.now() - uptime * 1000).toISOString(),
      memory: {
        rss:      (process.memoryUsage().rss      / 1024 / 1024).toFixed(1) + ' MB',
        heapUsed: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1) + ' MB',
      },
      caches: getCacheStats(),
      cdnAlerts: {
        total: cdnAlerts.length,
        items: cdnAlerts.slice().reverse(), // terbaru di atas
      },
    });
  });

  app.get('/monitor', (req, res) => {
    if (!checkMonitorKey(req, res)) return;
    const key = encodeURIComponent(req.query.key);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(monitorDashboardHtml(key));
  });

  app.get('/monitor/events', (req, res) => {
    if (!checkMonitorKey(req, res)) return;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Kirim hanya SSE_HISTORY event terbaru (bukan seluruh ring buffer),
    // sudah dibalik (terbaru dulu) supaya client cukup appendChild berurutan.
    const historySlice = monitorLog.slice(-SSE_HISTORY).reverse();
    res.write(`event: history\ndata: ${JSON.stringify({ events: historySlice, totalEvents })}\n\n`);

    monitorSSE.push(res);
    const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => {
      clearInterval(keepalive);
      monitorSSE = monitorSSE.filter(r => r !== res);
    });
  });
}

module.exports = { pushMonitorEvent, logCdnAlert, trackRequest, checkMonitorKey, registerMonitorRoutes };
