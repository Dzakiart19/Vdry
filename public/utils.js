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
