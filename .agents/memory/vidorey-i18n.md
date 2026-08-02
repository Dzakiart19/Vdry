---
name: Vidorey i18n EN/ID Toggle
description: Full EN↔ID toggle implementation — architecture, default language, button label logic, key inventory, cache-busting, and caveats.
---

## Rule
All user-visible strings in all 10 HTML pages and all JS files must use `_t()` / `data-i18n` attributes.
**Default = English ('en').** Stored in `localStorage('vidorey_lang')`. Toggle button `id="langToggle"`.

## Why
User requested full EN/ID bilingual toggle. Default changed to 'en' to match SEO/Tier-1 traffic strategy.

## How to apply
- **i18n.js** loaded FIRST (with cache-bust query `?v=3`) before `config.js` in every HTML file.
  Exports `window._t(key)` and `window.VDRY_I18N`.
- HTML: `data-i18n` (textContent), `data-i18n-html` (innerHTML for `<strong>` etc.), `data-i18n-placeholder`, `data-i18n-aria`.
- JS: `_t('key')` for dynamic strings. `langchange` CustomEvent triggers `updateSearchHeading()` in rb/yb/bk/sb/xn/zg/er.js.
- **Toggle button label shows CURRENT language** (not target):
  - `_lang === 'id'` → button shows `'ID'`
  - `_lang === 'en'` → button shows `'EN'`
  - Line in i18n.js: `if (btn) btn.textContent = _lang === 'id' ? 'ID' : 'EN';`
- tp.html: toggle inside `.tp-topbar` with `id="langToggleTp"` between title span and mute button.
- index.html: toggle inside topbar after breadcrumb nav.
- **langToggle CSS must have `position: relative; z-index: 200`** — nav-overlay has z-index:149 when open and `pointer-events: all`; without this the button click is blocked by the overlay.

## Cache-busting
i18n.js is referenced as `/i18n.js?v=3` in all 10 HTML files. Bump the version number whenever i18n.js content changes significantly, to force browsers to fetch fresh copy instead of serving cached version.

## Key translation categories
- `nav.*`: drawer platform descriptions
  - `nav.p1` … `nav.p7`, `nav.p8`, `nav.p9`, `nav.er` — each platform has its own unique key
  - `nav.tp`, `nav.tp.label`, `nav.tp.p1`–`nav.tp.p4`
  - `nav.select`, `nav.other`
- `search.ph/btn`, `cat.btn/all/loading/empty`: search & category UI
- `state.loading/empty/retry`: generic state views; `state.p1empty`, `state.p1unavail`: index.html specific
- `err.content`, `err.video`, `err.hls`, `err.stream`, `err.video.title/app`: error messages
- `player.loading/back/share/download/related/folder`: player modal
- `toast.noShare/copied/newContent`: toast notifications
- `welcome.*`: welcome popup (index.html only)
- `tp.mute/unmute`, `tp.err.play/browser/load/load2`, `tp.search.ph`: TikTok platform specifics
- `heading.search/cat/clear/clearSearch`: JS-built headings
- `smartlink.name/desc`: partner sites entry in nav drawer

## Nav key mapping (all confirmed present in i18n.js)
| Key | Platform | URL |
|-----|----------|-----|
| `nav.p1` | P1 vdy.to | `/` |
| `nav.p2` | P2 ruangbokep | `/rb` |
| `nav.p3` | P3 yobokep | `/yb` |
| `nav.p4` | P4 bokepking | `/bk` |
| `nav.p5` | P6 situsbokep | `/sb` |
| `nav.p6` | P8 xchina | `/xn` |
| `nav.p7` | P7 videy | `/vd` |
| `nav.p8` | P9 zoig | `/zg` |
| `nav.p9` / `nav.er` | P10 erome | `/er` (er.html uses `nav.er` for its own active entry; all other HTML use `nav.p9`) |
| `nav.tp` | P5 tik.porn | `/tp` |

## Copy style
All strings use platform-appropriate copy with emojis (🔥💦🥵🫦🔞). Not plain/corporate.
Example: `'state.loading': 'Lagi nyari yang hot… 💦'`, `'welcome.btn': 'Gas Sekarang 🔥'`.

## File coverage (all done)
- `public/i18n.js`: translation engine + boot + CustomEvent dispatch
- `public/style.css`: `.lang-toggle-btn` styles (includes `position: relative; z-index: 200`)
- All 10 HTML (index, rb, yb, bk, sb, xn, vd, zg, er, tp): `i18n.js?v=3` script first, `langToggle` button, `data-i18n` attrs throughout
- rb/yb/bk/sb/xn/zg/er.js: heading builder uses `_t()`, `langchange` listener calls `updateSearchHeading()`
- vd/app/tp.js: `_t()` for toasts and errors
- utils.js: `_t('cat.all')` and `_t('cat.empty')` in `initVdryCategoryPicker`
- zg.js: own category renderer uses `_t('cat.all'/'cat.empty')`
