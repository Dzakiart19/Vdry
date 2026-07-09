/* ═══════════════════════════════════════════════════
   Vidorey Smartlinks — maksimal exposure
   4 trigger: first click, video card click, timer 5s, exit intent
   Rotate 3 links secara bergantian
═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LINKS = [
    'https://www.effectivecpmnetwork.com/zkphsh9h7u?key=f0ff67356a4540f8c243de58312a8121',
    'https://www.effectivecpmnetwork.com/n72teg1g?key=0cab9db782afe80175f267ef78551a08',
    'https://www.effectivecpmnetwork.com/khj65tru?key=188aaea14e197cc95790b8dca5bbbdfd'
  ];

  var CARD_SEL = '.video-card, .rb-card, .folder-card, .tp-slide';

  var idx = 0;
  var lastFireMs = 0;

  /* Buka link berikutnya — dedup 200ms agar 1 klik tidak trigger 2 link */
  function tryFire() {
    var now = Date.now();
    if (now - lastFireMs < 200) return;
    lastFireMs = now;
    var url = LINKS[(idx++) % LINKS.length];
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
  }

  /* ── 1. New tab saat klik pertama di halaman ── */
  document.addEventListener('click', function onFirst() {
    document.removeEventListener('click', onFirst);
    tryFire();
  });

  /* ── 2. Sebelum video main — setiap klik pada card/slide ── */
  document.addEventListener('click', function (e) {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest(CARD_SEL)) tryFire();
  });

  /* ── 3. Timer — buka tab baru setelah 5 detik ── */
  setTimeout(tryFire, 5000);

  /* ── 4. Exit intent ── */
  var exitFired = false;
  function fireExit() {
    if (exitFired) return;
    exitFired = true;
    tryFire();
  }
  // Desktop: mouse keluar dari atas viewport
  document.addEventListener('mouseleave', function (e) {
    if (e.clientY <= 0) fireExit();
  });
  // Mobile: back button / pindah tab
  window.addEventListener('pagehide', fireExit);

})();
