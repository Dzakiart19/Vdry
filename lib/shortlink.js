/* ══════════════════════════════════════════════════════════════════
   Shortlink registry — token ↔ slug mapping (in-memory, 48h TTL)
   Token: 11 chars dari [a-z0-9] → terlihat acak, tidak mengandung
   judul video. Sama seperti style Platform 1.
══════════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { makeCache } = require('./cache');

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TTL   = 48 * 60 * 60 * 1000; // 48 jam

// 20k slots — tiap entry hanya string pendek, aman di memory
const shortCache = makeCache(20000, TTL, 'shortlink');

function makeToken() {
  const bytes = crypto.randomBytes(11);
  return Array.from(bytes, b => CHARS[b % CHARS.length]).join('');
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
  return token;
}

/**
 * Lookup slug dari token. Return null jika token tidak ada / expired.
 */
function resolveToken(platform, token) {
  return shortCache.get(`${platform}:token:${token}`);
}

module.exports = { registerSlug, resolveToken, shortCache };
