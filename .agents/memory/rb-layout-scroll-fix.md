---
name: RB Layout Scroll Fix + PackerJS Fix
description: Layout scroll fix for pagination, modal scroll-lock, and PackerJS regex fix for putarvid video extraction.
---

# RB Layout Scroll Fix

## The Rule
rb.html must override global body/html styles with natural page scroll so pagination is reachable.

## Why
style.css sets `body { overflow: hidden; height: 100%; }` for Platform 1 (index.html) which uses an internal scroll container (.content). Platform 2 (rb.html) has a sticky search bar above the shell, which shifts the shell below the viewport clip. The internal scroll container becomes unreachable for pagination.

## How to Apply
In rb.html's inline `<style>` (after the linked stylesheet, so cascade wins WITHOUT !important):
```css
html, body { overflow-y: auto; height: auto; min-height: 100vh; }
body.modal-open { overflow: hidden !important; }  /* modal scroll-lock via class */
.shell { display: block; height: auto; min-height: calc(100vh - var(--topbar-h)); padding-top: 0; }
.content { flex: unset; height: auto; overflow: visible; }
.rb-searchbar { position: sticky; top: var(--topbar-h); margin-top: var(--topbar-h); }
```

In rb.js, use class instead of inline style for modal scroll-lock:
```js
// openModal:  document.body.classList.add('modal-open');
// closeModal: document.body.classList.remove('modal-open');
```

Do NOT use !important on overflow-y: auto — it would override JS inline style and break modal scroll-lock.

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
