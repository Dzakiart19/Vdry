---
name: Platform 1 Cross-Origin Video Playback
description: How Platform 1 watch view works — full-page modal, MP4 via proxy, related videos from folder, deep-link /watch/:id, and cross-origin video rules.
---

# Platform 1 — Watch View & Video Playback

## Watch View Architecture (updated: full-page modal)

P1 watch view sekarang menggunakan **full-page modal** (class `modal-fullpage`) persis seperti P2/P3/P4/P6, dengan perbedaan utama:

| Aspek | P1 (index.html) | P2/P3/P4 (rb/yb/bk) |
|---|---|---|
| Format video | MP4 via `/proxy/stream/:id` | HLS via m3u8 |
| Player library | Native `<video>` (tanpa hls.js) | hls.js |
| Related videos | `currentData.videos` (folder aktif) dikecualikan video sekarang | Dari API scraper per-video |
| Watch URL | `/watch/:id` | `/rb/watch/<token>` (shortlink) |
| Token system | Tidak ada | 11-char shortlink via `lib/shortlink.js` |
| Deep-link resolve | Langsung `openPlayer(id)` | Resolve token via `/api/s/rb/<token>` |

### HTML Modal IDs (p1PlayerModal)
```html
<div id="p1PlayerModal" class="modal modal-fullpage hidden">
  <div id="p1ModalBackdrop"></div>
  <div class="modal-panel modal-panel-watch">
    <div class="watch-topbar">
      <button id="p1ModalClose" class="watch-back-btn">Kembali</button>
      <span class="watch-platform-label">Vidorey 1</span>
    </div>
    <div class="modal-body" id="p1ModalBody">
      <div class="watch-layout">
        <div class="watch-main">
          <div class="video-stage">
            <div id="p1PlayerLoading" class="rb-player-loader">...</div>
            <video id="p1VideoEl" class="rb-player-video hidden" controls playsinline preload="metadata"></video>
          </div>
          <!-- watch-ad-slot watch-ad-below-player (300×250) -->
          <div class="watch-info">
            <h1 id="p1VideoTitle" class="watch-title"></h1>
            <button id="p1ShareBtn" class="watch-share-btn">Bagikan</button>
          </div>
        </div>
        <div class="watch-related hidden" id="p1RelatedSection">
          <div id="p1RelatedGrid" class="rb-grid rb-grid-related"></div>
          <div id="p1RelatedPagination" class="pagination hidden"></div>
          <!-- watch-ad-slot (300×250) -->
        </div>
      </div>
    </div>
  </div>
</div>
```

### JS Element References (app.js `el` object)
```javascript
el.modal             = $('p1PlayerModal')
el.backdrop          = $('p1ModalBackdrop')
el.modalBody         = $('p1ModalBody')
el.videoEl           = $('p1VideoEl')          // bukan el.video!
el.videoTitle        = $('p1VideoTitle')        // bukan el.title!
el.playerLoading     = $('p1PlayerLoading')
el.relatedGrid       = $('p1RelatedGrid')
el.relatedSection    = $('p1RelatedSection')
el.relatedPagination = $('p1RelatedPagination')
el.shareBtn          = $('p1ShareBtn')
```

---

## Rule: NEVER use `crossorigin` attribute on `<video>`

`<video id="p1VideoEl">` harus **tanpa** `crossorigin` attribute.

**Why:** `crossorigin="anonymous"` memaksa CORS mode. Android Chrome memblokir cross-origin video dalam CORS mode saat page Firebase → Replit. Tanpa atribut, browser load dalam no-cors/opaque mode — tidak ada CORS check, bekerja di semua device.

---

## Player Flow (MP4, tanpa HLS)

```javascript
// openPlayer(id, name, opts = {})
el.videoEl.src = `${API}/proxy/stream/${id}`;
el.videoEl.load();

// Tampilkan video hanya setelah metadata siap
el.videoEl.addEventListener('loadedmetadata', function onMeta() {
  el.videoEl.removeEventListener('loadedmetadata', onMeta);
  el.playerLoading.classList.add('hidden');
  el.videoEl.classList.remove('hidden');
  el.videoEl.play().catch(() => {});
});

// Fetch title + thumb di background — tidak blokir playback
fetchWithTimeout(`${API}/api/video/${id}`)
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(data => {
    if (currentVideoId !== id) return; // sesi berganti
    el.videoTitle.textContent = data.title;
    setVideoMeta(data.title, window.location.href, data.thumb, '');
  });
```

**Why set src sebelum title fetch:** `/api/video/:id` resolve embed.php → latency 300–800ms. Video sudah bisa mulai buffering sementara title masih diambil. `/proxy/stream/:id` resolve URL sendiri di server saat hit pertama.

---

## Watch URL: `/watch/:id`

- Saat video dibuka: `history.pushState({ p1Watch: true, p1Vid: id }, '', '/watch/:id')`
- Tombol Back: menutup modal, `replaceState` ke URL folder bersih
- Forward ke entry watch (setelah Back): `openPlayer(id, '', { fromHistory: true })` — skip `pushState` (entry sudah ada)
- Deep-link `/watch/:id` saat init: `watchHistoryPushed = true; openPlayer(id, '', { fromHistory: true })`
- Server: catch-all `app.get('*', ...)` di `server.js` serve `index.html` → SPA handle routing

**Perbedaan dari P2:** P1 tidak pakai shortlink token, ID langsung di URL. Tidak ada resolve `/api/s/p1/<token>` step.

---

## Related Videos

Related videos = video lain dari folder yang sedang aktif (`currentData.videos`), dikecualikan video yang sedang diputar.

```javascript
const related = (currentData?.videos || []).filter(v => v.id !== id);
renderRelated(related);
```

**Kenapa tidak dari API:** P1 adalah folder browser — data folder sudah ada di `currentData` dari `loadFolder()`. Tidak ada "per-video related" endpoint di backend P1. Ini berbeda dari P2/P3/P4 yang scrape related dari halaman video di source site.

---

## DoodStream CDN — `*.overfetch.video`

```javascript
if (u.hostname.endsWith('.overfetch.video')) return true;
```

Wildcard subdomain check ini wajib ada — DoodStream/Doodshare video pakai `meiva.overfetch.video` dan subdomain lain.

---

## Firebase ↔ Replit Deployment

- Firebase (`vidorey.web.app`) host static `public/`.
- `public/config.js` pakai placeholder `__REPLIT_BACKEND_URL__` — di-inject oleh `deploy.sh` saat deploy.
- Di dev (`*.replit.app`, `localhost`, `127.0.0.1`): `config.js` set `BACKEND_URL = ''` (relative) otomatis.
