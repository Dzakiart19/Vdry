---
name: Watch Modal Scroll/Overlap Fix
description: Root causes and fixes for watch modal "crash menumpuk" scroll issue and Social Bar ad overlap on mobile
---

## Problem
On mobile (Android Chrome), two issues on the watch modal:
1. Related video cards appeared to overlap/crash into the video player during scroll ("satu sama lain menumpuk")
2. Social Bar ad from effectivecpmnetwork.com rendered above the watch modal content

## Root Causes

### 1. Video GPU layer bleed (scroll crash)
Native `<video>` elements on Android Chrome render on their own hardware-accelerated compositing layer. This layer can appear ABOVE adjacent DOM elements during scroll, making related cards look like they crash into the player.

**Fix:** 
- `isolation: isolate` on `.watch-layout` — creates new stacking context, contains video layer
- `position: relative; z-index: 1` on `.watch-related` at ≤860px — forces related section above video compositing layer

### 2. Social Bar ad over modal (z-index)
Modal z-index was 500. Social Bar from effectivecpmnetwork.com uses z-index >> 500, rendering over the entire modal.

**Fix:**
- Modal z-index bumped to 10000 (from 500)
- Welcome overlay → 10001, adblock banner → 10001 (above modal)
- MutationObserver in ads.js watches `body.modal-open` and suppresses ALL `position:fixed/sticky` body children except `.modal`, `#toast`, `#vdry-adb-banner` — handles both pre-existing elements and dynamically injected ones (Social Bar)

### 3. Modal scroll on iOS
overflow-y:auto inside position:fixed doesn't enable momentum/bounce scroll on iOS by default.

**Fix:** Added `overscroll-behavior: contain; -webkit-overflow-scrolling: touch` to `.modal-fullpage .modal-body`

### 4. watch-ad-above-player ad overflow
Ad scripts could render children outside the container bounds, overlapping the player below.

**Fix:** `overflow: hidden; position: relative` on `.watch-ad-above-player`

## Where to find the code
- CSS: `public/style.css` — search `.watch-layout`, `.modal {`, `.watch-related`, `.watch-ad-above-player`, `.modal-fullpage .modal-body`
- JS suppressor: `public/ads.js` — Social Bar / Fixed Ad Suppressor section near bottom of IIFE

**Why:** These were not obvious CSS bugs — the crash was GPU compositing, the ad overlap was z-index warfare with ad networks.
