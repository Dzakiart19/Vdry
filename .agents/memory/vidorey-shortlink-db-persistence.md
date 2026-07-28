---
name: Vidorey shortlink DB persistence — auto DDL on startup
description: shortlinks table is now created automatically at startup via ensureTable() in lib/shortlink.js — no manual migration needed on fresh project/clone.
---

`lib/shortlink.js` menjalankan `ensureTable()` di awal `initShortlinkStore()` saat startup.
`CREATE TABLE IF NOT EXISTS` + dua index dibuat otomatis — aman dijalankan berulang kali (no-op jika sudah ada).

**Urutan boot:**
1. `ensureTable()` — buat tabel + index jika belum ada
2. `seedDbFromFileIfEmpty()` — isi DB kosong dari `data/shortlinks-seed.json` (ikut ter-clone dari GitHub)
3. `hydrateFromDb()` — load semua token aktif ke in-memory cache

**Why:** user sering buat project baru dari GitHub fresh clone; startup DDL menghilangkan kebutuhan migrasi manual di setiap environment baru.

**How to apply:** tidak perlu tindakan apapun — berjalan otomatis. Verifikasi via log:
`[shortlink] hydrated N token(s) from database` (bukan error) setelah restart.
