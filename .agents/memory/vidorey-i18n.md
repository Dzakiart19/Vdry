---
name: Vidorey i18n EN/ID Toggle
description: Full EN↔ID toggle implementation — architecture, file coverage, keys, and caveats.
---

## Rule
All user-visible strings in all 9 HTML pages and all JS files must use _t() / data-i18n attributes.
Default = Indonesian ('id'). Stored in localStorage('vidorey_lang'). Toggle button id="langToggle".

## Why
User requested full EN/ID bilingual toggle across all platforms.

## How to apply
- **i18n.js** loaded FIRST (before config.js) in every HTML file. Exports window._t(key) and window.VDRY_I18N.
- HTML: data-i18n (textContent), data-i18n-html (innerHTML for <strong> etc.), data-i18n-placeholder, data-i18n-aria.
- JS: _t('key') for dynamic strings. langchange CustomEvent triggers updateSearchHeading() in rb/yb/bk/sb/xn/zg.js.
- Toggle button: id="langToggle" class="lang-toggle-btn". Shows "EN" when in ID mode, "ID" when in EN mode.
- tp.html: toggle inside .tp-topbar with style="margin-left:auto" between title span and mute button.
- index.html: toggle inside topbar after breadcrumb nav.

## Key translation categories
- nav.*: drawer platform descriptions (nav.p1/p2/p8/tp, nav.tp.p1-p4, nav.tp.label, nav.select, nav.other)
- search.ph/btn, cat.btn/all/loading/empty: search & category UI
- state.loading/empty/retry: generic state views; state.p1empty, state.p1unavail: index.html specific
- err.content, err.video, err.hls, err.stream, err.video.title/app: error messages
- player.loading/back/share/related/folder: player modal
- toast.noShare/copied/newContent: toast notifications
- welcome.*: welcome popup (index.html only)
- tp.mute/unmute, tp.err.play/browser/load/load2: TikTok platform specifics
- heading.search/cat/clear/clearSearch: JS-built headings (clearSearch=✕Hapus for search, clear=✕Semua for cat)

## File coverage (all done)
- public/i18n.js: translation engine + boot + CustomEvent dispatch
- public/style.css: .lang-toggle-btn styles
- All 9 HTML (index, rb, yb, bk, sb, xn, vd, zg, tp): i18n.js script first, langToggle button, data-i18n attrs throughout
- rb/yb/bk/sb/xn/zg.js: heading builder uses _t(), langchange listener calls updateSearchHeading()
- vd/app/tp.js: _t() for toasts and errors
- utils.js: _t(cat.all) and _t(cat.empty) in initVdryCategoryPicker
- zg.js: own category renderer uses _t(cat.all/cat.empty)
