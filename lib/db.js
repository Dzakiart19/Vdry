/* ── Shared PostgreSQL pool (Replit built-in database) ──────────────────
   Dipakai untuk data yang harus survive restart/redeploy — saat ini hanya
   shortlink registry. Skema (tabel `shortlinks`) sudah dibuat lewat migrasi
   dev biasa, BUKAN startup-time DDL di sini — lihat lib/shortlink.js. ── */
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', err => {
  console.error('[db] idle client error:', err.message);
});

module.exports = { pool };
