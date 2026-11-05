/* ── Generic in-memory cache with TTL + eviction + hit/miss stats.
   Dipakai independen oleh P1/P2/P3 — hanya factory function yang di-share,
   setiap platform tetap punya instance cache-nya sendiri (tidak ada data
   yang bocor antar platform). ── */
function makeCache(maxSize, defaultTtlMs, name = '') {
  const store = new Map();
  let hits = 0, misses = 0;
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) { misses++; return null; }
      if (entry.expires <= Date.now()) { store.delete(key); misses++; return null; }
      hits++;
      return entry.value;
    },
    set(key, value, ttlMs = defaultTtlMs) {
      if (store.size >= maxSize) {
        // Evict satu expired entry dulu, fallback FIFO
        for (const [k, v] of store) {
          if (v.expires <= Date.now()) { store.delete(k); break; }
        }
        if (store.size >= maxSize) store.delete(store.keys().next().value);
      }
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
    del(key) { store.delete(key); },
    has(key) { return this.get(key) !== null; },
    stats() {
      return { name, size: store.size, maxSize, hits, misses, hitRate: hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) + '%' : 'n/a' };
    },
  };
}

module.exports = { makeCache };
