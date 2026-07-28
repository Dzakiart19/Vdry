/* ══════════════════════════════════════════════════════════════════
   Shortlink registry — token ↔ slug mapping.
   Token: 11 chars dari [a-z0-9] → terlihat acak, tidak mengandung
   judul video. Sama seperti style Platform 1.

   Two-tier: in-memory cache (makeCache, TTL 48h) untuk baca cepat di hot
   path + tabel Postgres `shortlinks` sebagai penyimpanan permanen supaya
   link yang sudah dibagikan tetap hidup walau server restart/redeploy
   (in-memory saja hilang setiap restart — makeCache tidak persist).
   Tabel dibuat lewat migrasi dev biasa (bukan startup-time DDL di sini).

   Write ke DB bersifat fire-and-forget (tidak diawait oleh caller) supaya
   registerSlug/resolveToken tetap sinkron seperti sebelumnya — semua
   pemanggil di p1/rb/yb/bk/tp/sb/xn/vd/zg tidak perlu diubah. Kalau DB
   sedang bermasalah, fallback-nya cuma "link ini tidak survive restart
   berikutnya", bukan error fatal. ══════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeCache } = require('./cache');
const { pool } = require('./db');

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TTL   = 48 * 60 * 60 * 1000; // 48 jam

// 20k slots — tiap entry hanya string pendek, aman di memory
const shortCache = makeCache(20000, TTL, 'shortlink');

/* ── JSON seed file — dilacak git, ikut ter-push ke GitHub ──────────────
   Replit Postgres TIDAK ikut ter-clone saat project dibuat ulang dari
   GitHub (database selalu mulai kosong di environment baru). File ini
   adalah snapshot berkala dari tabel `shortlinks` supaya saat project
   di-clone fresh dari GitHub, server bisa "mengisi ulang" DB yang kosong
   dari snapshot ini alih-alih mulai dari nol. ── */
const SEED_FILE = path.join(__dirname, '..', 'data', 'shortlinks-seed.json');
let seedExportPending = false;

function scheduleSeedExport() {
  if (seedExportPending) return;
  seedExportPending = true;
  setTimeout(async () => {
    seedExportPending = false;
    try {
      const { rows } = await pool.query(
        `SELECT platform, token, slug, expires_at FROM shortlinks WHERE expires_at > NOW() ORDER BY platform, token`
      );
      fs.mkdirSync(path.dirname(SEED_FILE), { recursive: true });
      fs.writeFileSync(SEED_FILE, JSON.stringify(rows, null, 2) + '\n');
    } catch (err) {
      console.error('[shortlink] seed export error:', err.message);
    }
  }, 5000); // debounce — banyak registerSlug beruntun cuma nulis file sekali
}

/* ── Kalau tabel DB kosong (mis. project baru di-clone dari GitHub, DB
   fresh) tapi file seed JSON tersedia (ikut ter-clone dari repo), isi
   ulang DB dari situ dulu sebelum hydrate cache. ── */
async function seedDbFromFileIfEmpty() {
  if (!fs.existsSync(SEED_FILE)) return;
  try {
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*)::int AS count FROM shortlinks');
    if (count > 0) return; // DB sudah ada isinya — jangan timpa

    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    if (!Array.isArray(seed) || seed.length === 0) return;

    let restored = 0;
    for (const row of seed) {
      if (!row.platform || !row.token || !row.slug || !row.expires_at) continue;
      if (new Date(row.expires_at).getTime() <= Date.now()) continue; // sudah expired
      await pool.query(
        `INSERT INTO shortlinks (platform, token, slug, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (platform, slug) DO NOTHING`,
        [row.platform, row.token, row.slug, row.expires_at]
      );
      restored++;
    }
    console.log(`[shortlink] restored ${restored} token(s) from data/shortlinks-seed.json into fresh database`);
  } catch (err) {
    console.error('[shortlink] seed-from-file error:', err.message);
  }
}

function makeToken() {
  const bytes = crypto.randomBytes(11);
  return Array.from(bytes, b => CHARS[b % CHARS.length]).join('');
}

/* ── Hydrate cache dari DB saat boot — supaya token lama (dari sebelum
   restart) langsung bisa di-resolve tanpa perlu tunggu cache-miss. ── */
async function hydrateFromDb() {
  try {
    const { rows } = await pool.query(
      `SELECT platform, token, slug, expires_at FROM shortlinks WHERE expires_at > NOW()`
    );
    const now = Date.now();
    let loaded = 0;
    for (const row of rows) {
      const remainingMs = new Date(row.expires_at).getTime() - now;
      if (remainingMs <= 0) continue;
      shortCache.set(`${row.platform}:slug:${row.slug}`, row.token, remainingMs);
      shortCache.set(`${row.platform}:token:${row.token}`, row.slug, remainingMs);
      loaded++;
    }
    console.log(`[shortlink] hydrated ${loaded} token(s) from database`);
  } catch (err) {
    console.error('[shortlink] hydrate error — starting with empty cache:', err.message);
  }
}

async function initShortlinkStore() {
  await seedDbFromFileIfEmpty();
  await hydrateFromDb();
  // Snapshot awal ke JSON supaya file selalu ada & up to date sejak boot
  scheduleSeedExport();
}
initShortlinkStore();

// Snapshot berkala — menangkap token baru yang register di antara boot,
// bukan hanya saat registerSlug dipanggil (jaga-jaga proses lama idle).
setInterval(scheduleSeedExport, 15 * 60 * 1000).unref();

/* ── Bersihkan baris expired secara berkala — bukan critical path ── */
setInterval(() => {
  pool.query(`DELETE FROM shortlinks WHERE expires_at <= NOW()`).catch(err =>
    console.error('[shortlink] cleanup error:', err.message));
}, 60 * 60 * 1000).unref();

function persistToken(platform, token, slug) {
  pool.query(
    `INSERT INTO shortlinks (platform, token, slug, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '48 hours')
     ON CONFLICT (platform, slug) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at`,
    [platform, token, slug]
  ).then(() => scheduleSeedExport())
   .catch(err => console.error('[shortlink] persist error:', err.message));
}

/**
 * Daftarkan slug ke registry, return 11-char token.
 * Idempoten: slug yang sama di platform yang sama selalu return token
 * yang sama selama belum expired (48 jam).
 */
function registerSlug(platform, slug) {
  const slugKey = `${platform}:slug:${slug}`;
  const existing = shortCache.get(slugKey);
  if (existing) return existing;

  const token = makeToken();
  shortCache.set(slugKey, token, TTL);
  shortCache.set(`${platform}:token:${token}`, slug, TTL);
  persistToken(platform, token, slug);
  return token;
}

/**
 * Lookup slug dari token. Return null jika token tidak ada / expired.
 */
function resolveToken(platform, token) {
  return shortCache.get(`${platform}:token:${token}`);
}

module.exports = { registerSlug, resolveToken, shortCache };
