---
name: RB Layout Scroll Fix
description: Why Platform 2 (rb.html) uses natural page scroll overrides and how modal scroll-lock works.
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
