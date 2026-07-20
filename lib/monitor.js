/* ═══════════════════════════════════════
   MONITOR — real-time visitor dashboard + CDN alert log

   Arsitektur:
   - Server menyimpan hingga MON_BUF event di ring buffer
   - SSE hanya mengirim SSE_HISTORY event terbaru saat client connect
   - Client menyimpan semua event di JS array, render via virtual list
     (hanya baris yang visible di viewport yang menjadi DOM node)
   - Pagination: scroll ke bawah → auto-fetch event lebih lama via REST
═══════════════════════════════════════ */

const MONITOR_KEY   = process.env.SESSION_SECRET || '';
const MON_BUF       = 50_000;  // max event di memory (ring buffer)
const CDN_ALERT_MAX = 500;     // max CDN alert di memory
const SSE_HISTORY   = 200;     // event dikirim ke client baru saat SSE connect

const monitorLog = [];         // ring buffer, oldest-first
let   totalEvents = 0;         // counter akurat (tidak berkurang saat trim)
let   monitorSSE  = [];        // connected SSE clients

const cdnAlerts = [];          // ring buffer

function pushMonitorEvent(type, payload) {
  const ev = { ts: Date.now(), type, ...payload };
  totalEvents++;
  monitorLog.push(ev);
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

/* ── Middleware ── */
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
  else if (p.startsWith('/api/tp/video/'))  pushMonitorEvent('tp_video', { id: p.split('/')[4] || '?', ip, ua });
  else if (p.startsWith('/api/tp/posts'))   pushMonitorEvent('tp_posts', { ip, ua });
  else if (p.startsWith('/api/sb/video/'))  pushMonitorEvent('sb_video', { id: p.split('/')[4] || '?', ip, ua });
  else if (p.startsWith('/api/sb/posts'))   pushMonitorEvent('sb_posts', { ip, ua });
  else if (p.startsWith('/api/xn/video/'))  pushMonitorEvent('xn_video', { id: p.split('/')[4] || '?', ip, ua });
  else if (p.startsWith('/api/xn/posts'))   pushMonitorEvent('xn_posts', { ip, ua });
  else if (p.startsWith('/api/vd/video/'))  pushMonitorEvent('vd_video', { id: p.split('/')[4] || '?', ip, ua });
  else if (p.startsWith('/api/vd/posts'))   pushMonitorEvent('vd_posts', { ip, ua });
  else if (p.startsWith('/api/zg/video/'))  pushMonitorEvent('zg_video', { id: p.split('/')[4] || '?', ip, ua });
  else if (p.startsWith('/api/zg/posts'))   pushMonitorEvent('zg_posts', { ip, ua });
  next();
}

/* ── Auth ── */
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

/* ─────────────────────────────────────────
   Dashboard HTML — Virtual List Architecture
   allEvents[]: newest at index 0
   Virtual scroll: hanya baris visible yang jadi DOM node
   Auto-load older via REST /monitor/log saat scroll ke bawah
───────────────────────────────────────── */
function monitorDashboardHtml(key) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vidorey Monitor</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;overflow:hidden}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d0d12;color:#e0e0e8;
       display:flex;flex-direction:column;padding:12px 16px;gap:8px}
  h1{font-size:1.1rem;color:#a78bfa;letter-spacing:.05em}
  .topbar{display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
  .toplinks{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn-firebase{display:inline-flex;align-items:center;gap:6px;background:#1a1a24;border:1px solid #f59e0b44;
    color:#fbbf24;border-radius:8px;padding:5px 12px;font-size:.75rem;font-weight:600;text-decoration:none;transition:background .15s}
  .btn-firebase:hover{background:#2a2010}
  .btn-console{display:inline-flex;align-items:center;gap:6px;background:#1a1a24;border:1px solid #4285f444;
    color:#74a9ff;border-radius:8px;padding:5px 12px;font-size:.75rem;font-weight:600;text-decoration:none;transition:background .15s}
  .btn-console:hover{background:#101828}
  .stats{display:flex;gap:10px;flex-wrap:wrap;flex-shrink:0}
  .stat{background:#1a1a24;border:1px solid #2a2a3a;border-radius:8px;padding:8px 14px;min-width:100px}
  .stat-val{font-size:1.5rem;font-weight:700;color:#c4b5fd}
  .stat-lbl{font-size:.68rem;color:#6b6b80;margin-top:1px;text-transform:uppercase;letter-spacing:.05em}
  #status{font-size:.7rem;color:#52525b;flex-shrink:0}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:5px;animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

  /* ── Virtual Scroll Container ── */
  #scroll-wrap{flex:1;overflow-y:scroll;position:relative;border:1px solid #1f1f2e;
               border-radius:8px;min-height:0}
  #vlist{position:relative;width:100%}

  /* ── Baris event — fixed height ── */
  .ev{position:absolute;left:0;right:0;height:34px;
      display:grid;grid-template-columns:68px 78px 1fr 118px;gap:6px;align-items:center;
      background:#14141e;border-bottom:1px solid #1a1a2a;padding:0 10px;font-size:.74rem;
      overflow:hidden}
  .ev-time{color:#6b6b80;font-variant-numeric:tabular-nums;white-space:nowrap}
  .badge{display:inline-block;padding:1px 6px;border-radius:99px;font-size:.63rem;
         font-weight:700;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
  .b-stream  {background:#14532d;color:#4ade80}
  .b-video   {background:#1e3a5f;color:#60a5fa}
  .b-folder  {background:#2a2a2a;color:#a1a1aa}
  .b-rb_video{background:#3b1d5a;color:#c084fc}
  .b-rb_posts{background:#3b1d5a;color:#c084fc}
  .b-yb_video{background:#14532d;color:#4ade80}
  .b-yb_posts{background:#14532d;color:#4ade80}
  .b-bk_video{background:#1c2a3a;color:#38bdf8}
  .b-bk_posts{background:#1c2a3a;color:#38bdf8}
  .b-tp_video{background:#3a0a1a;color:#e91e8c}
  .b-tp_posts{background:#3a0a1a;color:#ff4d6d}
  .b-sb_video{background:#0a2e18;color:#34d399}
  .b-sb_posts{background:#0a2e18;color:#34d399}
  .b-xn_video{background:#3a1c0a;color:#fb923c}
  .b-xn_posts{background:#3a1c0a;color:#fb923c}
  .b-vd_video{background:#0a1e3a;color:#38bdf8}
  .b-vd_posts{background:#0a1e3a;color:#7dd3fc}
  .b-zg_video{background:#2d0a1e;color:#f472b6}
  .b-zg_posts{background:#2d0a1e;color:#fb7185}
  .ev-id{color:#d4d4d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ev-ip{color:#71717a;font-size:.68rem;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  /* ── Loading indicator di bottom ── */
  #loader{position:absolute;bottom:0;left:0;right:0;height:34px;display:flex;align-items:center;
          justify-content:center;font-size:.7rem;color:#3f3f52;background:#0d0d12;
          border-top:1px solid #1f1f2e}
  #info-bar{font-size:.68rem;color:#3f3f52;flex-shrink:0;text-align:right}
</style>
</head>
<body>
<div class="topbar">
  <h1>⬡ Vidorey Monitor</h1>
  <div class="toplinks">
    <a class="btn-firebase" href="https://vidorey.web.app" target="_blank" rel="noopener">🔥 vidorey.web.app</a>
    <a class="btn-console" href="https://analytics.google.com/analytics/web/?authuser=1&hl=en-US#/a338511152p518732508/reports/dashboard?r=firebase-overview" target="_blank" rel="noopener">📊 Analytics</a>
  </div>
</div>
<div id="status"><span class="dot"></span>Connecting…</div>
<div class="stats">
  <div class="stat"><div class="stat-val" id="s-total">0</div><div class="stat-lbl">Total Events</div></div>
  <div class="stat"><div class="stat-val" id="s-stream">0</div><div class="stat-lbl">Streams</div></div>
  <div class="stat"><div class="stat-val" id="s-video">0</div><div class="stat-lbl">Video Opens</div></div>
  <div class="stat"><div class="stat-val" id="s-ip">0</div><div class="stat-lbl">Unique IPs</div></div>
</div>
<div id="histats_wrap" style="flex-shrink:0;display:flex;align-items:center;gap:12px;padding:6px 12px 8px;min-height:44px;border-bottom:1px solid #1f1f2e">
  <!-- JS-rendered counter — di-inject oleh Histats js15_as.js ke dalam div ini -->
  <div id="histats_counter" style="display:inline-block;min-width:80px;min-height:31px;"></div>
  <!-- Fallback: link langsung ke halaman statistik Histats -->
  <a href="https://www.histats.com/viewstats/?act=20&sid=5040431" target="_blank" rel="noopener"
     style="font-size:11px;color:#a0a0b8;text-decoration:none;border:1px solid #2a2a3e;padding:3px 8px;border-radius:5px;white-space:nowrap;">
    📊 Lihat Statistik Histats
  </a>
</div>
<div id="scroll-wrap">
  <div id="vlist"></div>
  <div id="loader" style="display:none">Memuat event lama…</div>
</div>
<div id="info-bar">—</div>

<script>
const KEY    = '${key}';
const ROW_H  = 35;    // px per baris (34px height + 1px border-bottom)
const OVER   = 12;    // overscan: baris extra di atas/bawah viewport
const BATCH  = 200;   // event per pagination request

/* ── State ── */
let allEvents       = [];   // newest at index 0
let totalSvr        = 0;    // total dari server (akurat, incl. yang sudah trim)
let hasMore         = true; // masih ada event lebih lama di server?
let loadingMore     = false;
let streamCnt       = 0;
let videoCnt        = 0;
const ips           = new Set();

/* ── DOM refs ── */
const scrollWrap = document.getElementById('scroll-wrap');
const vlist      = document.getElementById('vlist');
const loader     = document.getElementById('loader');
const infoBar    = document.getElementById('info-bar');

/* ── Virtual list state ── */
// renderedMap: rowIndex → { el, evTs } — track apa yang sudah di-DOM
const renderedMap = new Map();
let rafId = null;

/* ─────────────────────────
   Utility
───────────────────────── */
function fmt(ts) {
  return new Date(ts).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function makeRowEl(ev, idx) {
  const el    = document.createElement('div');
  el.className = 'ev';
  el.style.top = (idx * ROW_H) + 'px';
  // ev.type is always a hardcoded string from server trackRequest — safe to use directly in class names.
  // ev.id and ev.ip come from request paths/headers — must be escaped before innerHTML.
  const badge   = '<span class="badge b-' + ev.type + '">' + ev.type.replace('_',' ') + '</span>';
  const ipShort = esc((ev.ip||'?').split(',')[0].trim().slice(0,20));
  el.innerHTML  = '<span class="ev-time">' + fmt(ev.ts) + '</span>'
    + badge
    + '<span class="ev-id">' + esc(ev.id||'—') + '</span>'
    + '<span class="ev-ip">' + ipShort + '</span>';
  return el;
}

/* ─────────────────────────
   Virtual Render
   Hanya baris dalam viewport + overscan yang ada di DOM.
   renderedMap cache elemen supaya tidak rebuild DOM jika belum berubah.
───────────────────────── */
function render() {
  rafId = null;
  const totalH   = allEvents.length * ROW_H;
  vlist.style.height = totalH + 'px';

  const scrollTop = scrollWrap.scrollTop;
  const clientH   = scrollWrap.clientHeight;
  const startIdx  = Math.max(0, Math.floor(scrollTop / ROW_H) - OVER);
  const endIdx    = Math.min(allEvents.length - 1, Math.ceil((scrollTop + clientH) / ROW_H) + OVER);

  // Hapus baris yang keluar dari window
  for (const [idx, el] of renderedMap) {
    if (idx < startIdx || idx > endIdx) {
      vlist.removeChild(el);
      renderedMap.delete(idx);
    }
  }

  // Tambah baris yang masuk ke window
  const frag = document.createDocumentFragment();
  for (let i = startIdx; i <= endIdx; i++) {
    if (!renderedMap.has(i)) {
      const el = makeRowEl(allEvents[i], i);
      renderedMap.set(i, el);
      frag.appendChild(el);
    }
  }
  if (frag.childNodes.length) vlist.appendChild(frag);

  updateInfoBar();
}

function scheduleRender() {
  if (!rafId) rafId = requestAnimationFrame(render);
}

/* ─────────────────────────
   Stats update
───────────────────────── */
function updateStats() {
  document.getElementById('s-total').textContent  = totalSvr.toLocaleString('id-ID');
  document.getElementById('s-stream').textContent = streamCnt.toLocaleString('id-ID');
  document.getElementById('s-video').textContent  = videoCnt.toLocaleString('id-ID');
  document.getElementById('s-ip').textContent     = ips.size.toLocaleString('id-ID');
}

function countEvent(ev) {
  if (ev.type === 'stream') streamCnt++;
  if (ev.type === 'video')  videoCnt++;
  if (ev.ip) ips.add(ev.ip.split(',')[0].trim());
}

function updateInfoBar() {
  const visible = allEvents.length;
  if (totalSvr > visible) {
    infoBar.textContent = 'Menampilkan ' + visible.toLocaleString('id-ID') + ' event'
      + (hasMore ? ' · Scroll ↓ untuk muat lebih lama' : ' · Semua event termuat')
      + ' | Total sejak start: ' + totalSvr.toLocaleString('id-ID');
  } else {
    infoBar.textContent = 'Total sejak start: ' + totalSvr.toLocaleString('id-ID') + ' event';
  }
}

/* ─────────────────────────
   Live event dari SSE
   Prepend ke allEvents → semua index shift +1
   Update top setiap DOM element yang ada, lalu render
───────────────────────── */
function addLiveEvent(ev) {
  allEvents.unshift(ev);
  totalSvr++;
  countEvent(ev);
  updateStats();

  // Shift semua existing DOM elements down by ROW_H
  // dan update Map key (idx+1)
  const shifted = new Map();
  for (const [idx, el] of renderedMap) {
    const newIdx = idx + 1;
    el.style.top = (newIdx * ROW_H) + 'px';
    shifted.set(newIdx, el);
  }
  renderedMap.clear();
  for (const [k, v] of shifted) renderedMap.set(k, v);

  // Jika user di dekat atas, scroll agar event baru terlihat
  if (scrollWrap.scrollTop < ROW_H * 3) {
    scrollWrap.scrollTop = 0;
  } else {
    // Maintain posisi visual: push scroll down by ROW_H
    scrollWrap.scrollTop += ROW_H;
  }

  scheduleRender();
}

/* ─────────────────────────
   Load history awal (dari SSE event: history)
───────────────────────── */
function loadHistory(events, serverTotal) {
  // events: newest-first (sudah di-reverse di server)
  allEvents  = events;
  totalSvr   = serverTotal;
  hasMore    = serverTotal > events.length;
  streamCnt  = 0; videoCnt = 0; ips.clear();
  events.forEach(countEvent);
  updateStats();

  // Clear DOM
  renderedMap.forEach(el => vlist.removeChild(el));
  renderedMap.clear();
  scrollWrap.scrollTop = 0;
  scheduleRender();
}

/* ─────────────────────────
   Load older events via REST
   Dipanggil saat user scroll ke dekat bottom
───────────────────────── */
async function loadMore() {
  if (loadingMore || !hasMore) return;
  loadingMore = true;
  loader.style.display = 'flex';

  try {
    const oldest = allEvents.length ? allEvents[allEvents.length - 1].ts : Date.now();
    const url    = '/monitor/log?key=' + encodeURIComponent(KEY)
                 + '&before=' + oldest + '&limit=' + BATCH;
    const res    = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data   = await res.json();

    if (data.events && data.events.length > 0) {
      // data.events: oldest-first dari server (chronological order)
      // append ke end of allEvents (yang merupakan older events)
      data.events.forEach(ev => { allEvents.push(ev); countEvent(ev); });
      hasMore = !!data.hasMore;
      updateStats();
      scheduleRender();
    } else {
      hasMore = false;
    }
  } catch (e) {
    console.warn('loadMore error:', e);
  }

  loader.style.display = 'none';
  loadingMore = false;
  updateInfoBar();
}

/* ─────────────────────────
   Scroll handler
───────────────────────── */
scrollWrap.addEventListener('scroll', () => {
  scheduleRender();
  // Auto-load saat dekat bottom (200px threshold)
  const { scrollTop, scrollHeight, clientHeight } = scrollWrap;
  if (hasMore && !loadingMore && scrollTop + clientHeight > scrollHeight - ROW_H * 8) {
    loadMore();
  }
}, { passive: true });

/* ─────────────────────────
   Live connect — SSE dengan polling fallback otomatis
   Replit dev proxy mem-buffer SSE → jika onopen tidak fired
   dalam 5 detik, otomatis beralih ke polling 2.5s via REST.
   Koyeb production: SSE langsung bekerja, polling tidak dipakai.
───────────────────────── */
let pollTimer = null;
let pollMode  = false;
let lastTs    = 0;       // ts event terbaru yang sudah diterima

function setStatus(html) {
  document.getElementById('status').innerHTML = html;
}

/* ── Initial history load via REST (untuk polling mode) ── */
async function fetchHistory() {
  try {
    const r = await fetch('/monitor/log?key=' + encodeURIComponent(KEY) + '&limit=200');
    if (!r.ok) return;
    const data = await r.json();
    // /monitor/log tanpa ?after returns oldest-first; loadHistory expects newest-first
    const evs = (data.events || []).slice().reverse();
    loadHistory(evs, data.total || 0);
    lastTs = evs.length > 0 ? evs[0].ts : Date.now();
  } catch(e) { console.warn('fetchHistory:', e); }
}

/* ── Poll events baru sejak lastTs ── */
async function pollNew() {
  try {
    const r = await fetch('/monitor/log?key=' + encodeURIComponent(KEY)
                        + '&after=' + lastTs + '&limit=100');
    if (!r.ok) return;
    const { events = [] } = await r.json();
    // server returns newest-first; addLiveEvent prepends → proses dari oldest ke newest
    for (let i = events.length - 1; i >= 0; i--) addLiveEvent(events[i]);
    if (events.length > 0) lastTs = events[0].ts;
  } catch(e) { console.warn('pollNew:', e); }
}

function startPolling() {
  if (pollMode) return;
  pollMode = true;
  setStatus('<span class="dot"></span>Live');
  fetchHistory().then(() => {
    pollTimer = setInterval(pollNew, 2500);
  });
}

function connect() {
  const es = new EventSource('/monitor/events?key=' + encodeURIComponent(KEY));
  let opened = false;

  // Jika onopen tidak fired dalam 5s → Replit proxy mem-buffer SSE → switch ke polling
  const sseTimer = setTimeout(() => {
    if (opened || pollMode) return;
    es.close();
    startPolling();
  }, 5000);

  es.onopen = () => {
    opened = true;
    clearTimeout(sseTimer);
    setStatus('<span class="dot"></span>Live');
  };

  es.addEventListener('history', e => {
    const data = JSON.parse(e.data);
    loadHistory(data.events || [], data.totalEvents || 0);
    if (data.events && data.events.length > 0) lastTs = data.events[0].ts;
  });

  es.addEventListener('event', e => {
    const ev = JSON.parse(e.data);
    addLiveEvent(ev);
    if (ev.ts > lastTs) lastTs = ev.ts;
  });

  es.onerror = () => {
    clearTimeout(sseTimer);
    if (pollMode) return;
    es.close();
    if (!opened) {
      // Gagal sebelum open (proxy reject/buffer) → langsung polling
      startPolling();
    } else {
      // Pernah terhubung, lalu putus → retry SSE
      opened = false;
      setStatus('<span style="color:#ef4444">● Disconnected — reconnecting…</span>');
      setTimeout(connect, 3000);
    }
  };
}

connect();
</script>
<!-- Histats.com  START  (async) — tracking saja, counter widget sudah di atas via static img -->
<script type="text/javascript">var _Hasync= _Hasync|| [];
_Hasync.push(['Histats.start', '1,5040431,4,5,172,25,00011111']);
_Hasync.push(['Histats.fasi', '1']);
_Hasync.push(['Histats.track_hits', '']);
(function() {
var hs = document.createElement('script'); hs.type = 'text/javascript'; hs.async = true;
hs.src = (document.location.protocol === 'https:' ? 'https://' : 'http://') + 's10.histats.com/js15_as.js';
(document.getElementsByTagName('head')[0] || document.getElementsByTagName('body')[0]).appendChild(hs);
})();</script>
<!-- Histats.com  END  -->
</body>
</html>`;
}

/* ── Register all monitor + health routes ── */
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
      monitorLog: { stored: monitorLog.length, total: totalEvents },
      cdnAlerts:  { total: cdnAlerts.length, items: cdnAlerts.slice().reverse() },
    });
  });

  /* ── REST: ambil event lama untuk pagination client ──
     Query params:
       before  : timestamp (unix ms) — ambil event lebih lama dari ini
       limit   : jumlah event (max 500, default 200)
     Response:
       events  : oldest-first (chronological), sudah difilter
       hasMore : masih ada lebih lama lagi?
       total   : totalEvents di server (akurat)
  ── */
  app.get('/monitor/log', (req, res) => {
    if (!checkMonitorKey(req, res, '/monitor/log')) return;
    const before = parseInt(req.query.before) || Infinity;
    const after  = parseInt(req.query.after)  || 0;
    const limit  = Math.min(parseInt(req.query.limit) || 200, 500);

    // Polling mode: ambil events setelah timestamp, newest-first
    if (after > 0) {
      const newEvs = monitorLog.filter(e => e.ts > after).slice(-limit).reverse();
      return res.json({ events: newEvs, hasMore: false, total: totalEvents });
    }

    // Pagination scroll ke bawah (before): oldest-first
    const filtered = isFinite(before)
      ? monitorLog.filter(e => e.ts < before)
      : monitorLog.slice();
    const slice   = filtered.slice(-limit);
    res.json({
      events:  slice,
      hasMore: filtered.length > limit,
      total:   totalEvents,
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
    res.setHeader('X-Accel-Buffering', 'no');       // nginx / Replit proxy
    res.setHeader('X-Pad', 'avoid browser bug');    // legacy flush trigger

    // Disable Nagle's algorithm — tanpa ini TCP menunggu buffer penuh
    // sebelum mengirim packet, menyebabkan SSE tertahan di kernel buffer
    if (res.socket) res.socket.setNoDelay(true);

    res.flushHeaders();

    // Flush segera — paksa proxy (Replit mTLS/Koyeb/Caddy) kirim headers ke browser
    // tanpa ini proxy buffer sampai chunk cukup besar → onopen tidak pernah fired
    res.write(': ok\n\n');
    if (typeof res.flush === 'function') res.flush(); // drain compression buffer (safety)

    // Kirim SSE_HISTORY event terbaru, sudah di-reverse (newest-first) supaya client langsung bisa prepend
    const slice = monitorLog.slice(-SSE_HISTORY).reverse();
    res.write(`event: history\ndata: ${JSON.stringify({ events: slice, totalEvents })}\n\n`);
    if (typeof res.flush === 'function') res.flush();

    monitorSSE.push(res);
    // 15s — lebih aman dari timeout proxy Replit mTLS / Koyeb (biasanya 30s)
    const keepalive = setInterval(() => {
      try {
        res.write(': ping\n\n');
        if (typeof res.flush === 'function') res.flush();
      } catch {}
    }, 15000);
    req.on('close', () => {
      clearInterval(keepalive);
      monitorSSE = monitorSSE.filter(r => r !== res);
    });
  });
}

module.exports = { pushMonitorEvent, logCdnAlert, trackRequest, checkMonitorKey, registerMonitorRoutes };
