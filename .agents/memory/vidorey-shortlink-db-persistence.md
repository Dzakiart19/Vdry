---
name: Vidorey shortlink DB persistence — table must exist
description: shortlinks table is created via manual migration, not app startup DDL — a fresh/cloned DB will 500 until the table is created once.
---

`lib/shortlink.js` / `lib/db.js` deliberately do NOT run `CREATE TABLE` at startup (by design, per code comments). This means any fresh environment (new Replit clone, DB reset) will log
`relation "shortlinks" does not exist` on every shortlink read/write until someone runs the migration once via the database skill (`executeSql`).

**Why:** the original author wanted schema changes to go through explicit dev migrations, not implicit boot-time DDL, to avoid startup races and match the project's "no startup-time DDL" convention (see db.js comment).

**How to apply:** if this project's logs show `relation "shortlinks" does not exist`, don't touch app code — just run the CREATE TABLE once via the database skill:
```sql
CREATE TABLE IF NOT EXISTS shortlinks (
  platform VARCHAR(16) NOT NULL,
  token VARCHAR(16) NOT NULL,
  slug TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (platform, token),
  UNIQUE (platform, slug)
);
```
After that, `data/shortlinks-seed.json` auto-restores previously shared tokens into the empty table on boot, and the token registry survives restarts going forward. Verify with two consecutive workflow restarts + checking for `[shortlink] hydrated N token(s) from database` in logs (not `error`).
