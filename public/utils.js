'use strict';
/* ── Vidorey shared utilities — VideoObject JSON-LD for SEO ── */

/** Inject or update VideoObject JSON-LD schema di <head> saat video dibuka. */
window.setVideoJsonLd = function (title, contentUrl, thumbnailUrl, description) {
  var el = document.getElementById('vidorey-jsonld');
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id   = 'vidorey-jsonld';
    document.head.appendChild(el);
  }
  var schema = {
    '@context': 'https://schema.org',
    '@type':    'VideoObject',
    name:         title || 'Video',
    description:  description || title || 'Free video streaming on Vidorey',
    thumbnailUrl: thumbnailUrl || '',
    contentUrl:   contentUrl  || window.location.href,
    embedUrl:     window.location.href,
  };
  el.textContent = JSON.stringify(schema);
};

/** Hapus VideoObject JSON-LD (panggil saat player ditutup / video baru dibuka). */
window.clearVideoJsonLd = function () {
  var el = document.getElementById('vidorey-jsonld');
  if (el) el.remove();
};

/* ── Dynamic canonical + Open Graph / Twitter Card per video ──────
   Saat video dibuka, URL yang dibagikan (link token /rb/watch/<token>
   dkk) harus match dengan meta tag di <head> — supaya preview di
   WhatsApp/Telegram/Facebook/X menampilkan judul & thumbnail video
   yang benar, bukan judul generik halaman listing.
   Nilai asli halaman disimpan sekali (lazy) supaya clearVideoMeta()
   bisa mengembalikannya saat player ditutup.
─────────────────────────────────────────────────────────────────── */
var _vdryOrigMeta = null;

function _vdryGetMetaEl(selector) {
  return document.querySelector(selector);
}

function _vdrySaveOrigMeta() {
  if (_vdryOrigMeta) return; // sudah tersimpan
  var canonicalEl = _vdryGetMetaEl('link[rel="canonical"]');
  _vdryOrigMeta = {
    canonical:        canonicalEl ? canonicalEl.getAttribute('href') : null,
    ogUrl:            _vdryMetaContent('meta[property="og:url"]'),
    ogTitle:          _vdryMetaContent('meta[property="og:title"]'),
    ogDescription:    _vdryMetaContent('meta[property="og:description"]'),
    ogImage:          _vdryMetaContent('meta[property="og:image"]'),
    twitterTitle:     _vdryMetaContent('meta[name="twitter:title"]'),
    twitterDescription: _vdryMetaContent('meta[name="twitter:description"]'),
    twitterImage:     _vdryMetaContent('meta[name="twitter:image"]'),
  };
}

function _vdryMetaContent(selector) {
  var el = _vdryGetMetaEl(selector);
  return el ? el.getAttribute('content') : null;
}

function _vdrySetMetaContent(selector, value) {
  if (value == null) return;
  var el = _vdryGetMetaEl(selector);
  if (el) el.setAttribute('content', value);
}

/** Update canonical + OG/Twitter meta ke URL & info video yang sedang dibuka. */
window.setVideoMeta = function (title, url, imageUrl, description) {
  _vdrySaveOrigMeta();

  var canonicalEl = _vdryGetMetaEl('link[rel="canonical"]');
  if (canonicalEl) canonicalEl.setAttribute('href', url);

  var desc = description || title || '';
  _vdrySetMetaContent('meta[property="og:url"]',             url);
  _vdrySetMetaContent('meta[property="og:title"]',            title);
  _vdrySetMetaContent('meta[property="og:description"]',      desc);
  if (imageUrl) _vdrySetMetaContent('meta[property="og:image"]', imageUrl);
  _vdrySetMetaContent('meta[name="twitter:title"]',            title);
  _vdrySetMetaContent('meta[name="twitter:description"]',      desc);
  if (imageUrl) _vdrySetMetaContent('meta[name="twitter:image"]', imageUrl);
};

/** Kembalikan canonical + OG/Twitter meta ke nilai asli halaman (panggil saat player ditutup). */
window.clearVideoMeta = function () {
  if (!_vdryOrigMeta) return;
  var canonicalEl = _vdryGetMetaEl('link[rel="canonical"]');
  if (canonicalEl && _vdryOrigMeta.canonical) canonicalEl.setAttribute('href', _vdryOrigMeta.canonical);

  _vdrySetMetaContent('meta[property="og:url"]',        _vdryOrigMeta.ogUrl);
  _vdrySetMetaContent('meta[property="og:title"]',       _vdryOrigMeta.ogTitle);
  _vdrySetMetaContent('meta[property="og:description"]', _vdryOrigMeta.ogDescription);
  _vdrySetMetaContent('meta[property="og:image"]',       _vdryOrigMeta.ogImage);
  _vdrySetMetaContent('meta[name="twitter:title"]',       _vdryOrigMeta.twitterTitle);
  _vdrySetMetaContent('meta[name="twitter:description"]', _vdryOrigMeta.twitterDescription);
  _vdrySetMetaContent('meta[name="twitter:image"]',       _vdryOrigMeta.twitterImage);
};
