---
name: RB Layout Scroll Fix + PackerJS Fix
description: Layout scroll fix for pagination and modal scroll-lock (via style.css body.rb-page rules, NOT inline style in html), and PackerJS regex fix for putarvid video extraction.
---

# RB Layout Scroll Fix

## The Rule
The scroll override for Platform 2 and Platform 3 lives in **`style.css`** via the `body.rb-page` class selector — NOT as an inline `<style>` block in `rb.html` / `yb.html`.

Both `rb.html` and `yb.html` set `<body class="rb-page">` — that is all they need in the HTML. The CSS takes care of the rest.

## Why
style.css sets `body { overflow: hidden; }` for Platform 1 (index.html) which uses an internal scroll container (.content). Platform 2/3 need natural page scroll for their sticky search bar + pagination layout. The override is scoped to `body.rb-page` so it never affects P1.

## How to Apply (current implementation in style.css lines ~1337–1371)
```css
/* Natural page scroll — override P1 body{overflow:hidden} */
body.rb-page {
  overflow-y: auto;
  height: auto;
  min-height: 100vh;
}

/* Modal scroll-lock — dipakai JS saat modal video terbuka */
body.rb-page.modal-open {
  overflow: hidden !important;
}

/* Shell: ikut konten, tidak fixed-height */
body.rb-page .shell {
  display: block;
  height: auto;
  min-height: calc(100vh - var(--topbar-h));
  padding-top: 0;
}

/* Content: tidak punya scroll sendiri, ikut page scroll */
body.rb-page .content {
  flex: unset;
  height: auto;
  overflow: visible;
  margin: 0;
  max-width: 100%;
  padding: 0 0 60px;
}
```

The `!important` on `body.rb-page.modal-open` is correct and necessary — it overrides the `overflow-y: auto` on `body.rb-page`.

In rb.js / yb.js, use class instead of inline style for modal scroll-lock:
```js
// openModal:  document.body.classList.add('modal-open');
// closeModal: document.body.classList.remove('modal-open');
```

**Why:** `rb-page.modal-open` is more specific than `rb-page` so the !important is only needed to beat specificity edge-cases; JS never needs to set inline overflow.

---

# Search Heading Visibility (P2 + P3)

## The Rule
Both `#rbSearchHeading` and `#ybSearchHeading` must have explicit `display: none` + `.visible { display: flex }` rules in style.css. Without them the heading shows an empty padding gap when no search query is active.

## Current CSS (style.css lines ~1444–1447)
```css
#rbSearchHeading         { display: none; }
#rbSearchHeading.visible { display: flex; align-items: center; gap: 4px; }
#ybSearchHeading         { display: none; }
#ybSearchHeading.visible { display: flex; align-items: center; gap: 4px; }
```

---

# PackerJS Decoder — putarvid Regex Fix

## The Rule
The `unpackPacker()` regex MUST anchor to `}\s*(` (closing brace of the IIFE function body) — not just `\(`.

## Why
Putarvid embeds use standard p,a,c,k,e,d PackerJS. The packed content string itself contains many `(` characters (e.g. `jwplayer("vplayer")`, `y("a0")`). Without anchoring to `}(`, a bare `\(` regex matches a `(` inside the packed string and fails to capture the arguments correctly, returning null.

## Correct Regex
```js
const re = /\}\s*\((['"])([\s\S]*?)\1,\s*(\d+),\s*(\d+),\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)\)/;
// Groups: 1=quote type, 2=packed string, 3=base, 4=count, 5=quote type, 6=keyword list
```

Supports both single- and double-quoted variants.

## m3u8 regex in resolveRbVideoUrl
```js
const m = decoded.match(/file:["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
```
CDN domain `*.streamruby.net` is already in `isAllowedRbCdnUrl` allowlist.
