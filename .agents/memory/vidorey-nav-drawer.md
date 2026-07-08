---
name: Vidorey Nav Drawer (Platform Switcher)
description: Platform switcher is now a hamburger sidebar drawer, not a dropdown. Old IDs are gone. Key z-index and scroll constraints.
---

## The Rule
Platform navigation is a **sidebar drawer** (hamburger ≡ button), NOT a dropdown in the topbar. The old dropdown structure has been fully removed.

## Why
The old dropdown (brand logo with chevron → ps-menu) was invisible to users who didn't know to click it. Replaced with a visible hamburger ≡ button in the topbar that opens a ChatGPT-style slide-in panel.

## IDs and classes — current state

### Still in HTML (new)
| Element | ID | Class |
|---|---|---|
| Hamburger button (in topbar .brand) | `navBurger` | `.nav-burger` |
| Backdrop overlay | `navOverlay` | `.nav-overlay` |
| Drawer panel | `navDrawer` | `.nav-drawer` |
| Close button (inside drawer) | `navClose` | `.nav-drawer-close` |
| Platform items | — | `.nav-plat-item` / `.nav-plat-item.active` |

### Removed from HTML (dead — do NOT reference)
- `id="platformSwitcher"` — wrapper div gone
- `id="psTrigger"` — dropdown trigger gone
- `id="psMenu"` — dropdown menu gone

### Avatar logo
All three `.ps-avatar` elements use **`<img src="/logo.png" alt="Vidorey">`** — the same Vidorey brand logo across all platforms. Do NOT use per-platform favicons or letter initials; consistency with the topbar brand is intentional.

CSS: `.ps-avatar` has `overflow:hidden`; `.ps-avatar img` fills the container with `object-fit:cover`.

### CSS dead code in style.css (harmless, not used)
`.ps-trigger`, `.ps-menu`, `.ps-chevron`, `@keyframes psIn` — still in CSS file but no HTML uses them. `.ps-avatar`, `.ps-info`, `.ps-name`, `.ps-desc`, `.ps-check` are still ACTIVE (reused by `.nav-plat-item` inside the drawer).

## Z-index hierarchy
| Layer | z-index |
|---|---|
| `.topbar` | 100 |
| `.nav-overlay` | 149 |
| `.nav-drawer` | 150 |
| `.modal` (video player) | 500 |

Drawer must stay BELOW modal. Overlay must stay BELOW drawer.

## Scroll interaction
- Drawer open/close does NOT touch `body.modal-open` — no conflict with P2/P3 modal scroll-lock.
- Drawer does NOT add any body class — purely CSS transform + pointer-events.

## How to Apply
When modifying platform nav: always use `navBurger/navDrawer/navOverlay/navClose` IDs. Never reference the old `psTrigger/psMenu/platformSwitcher` IDs — they no longer exist in any HTML file.

Active item per page:
- `index.html` → Vidorey 1 item has `.active` + `aria-current="page"`
- `rb.html` → Vidorey 2 item has `.active` + `aria-current="page"`
- `yb.html` → Vidorey 3 item has `.active` + `aria-current="page"`
- `bk.html` → Vidorey 4 item has `.active` + `aria-current="page"`

All four HTML files include all four platform items in their nav drawer. P4 avatar class is `.ps-avatar-bk`.
