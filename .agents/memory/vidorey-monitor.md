---
name: Vidorey Monitor — Real-Time SSE Dashboard
description: /monitor route architecture, auth pattern, event tracking middleware, and UX decisions.
---

# Vidorey Monitor

## Overview
`/monitor` is a password-protected real-time visitor dashboard served by the Replit backend (`server.js`). It is NOT present on the Firebase frontend — Firebase only serves static files.

---

## Auth Pattern — Form Login, Not 401

**Rule:** `/monitor` without `?key=` shows a login form, not a 401 error.

**Why:** Users accessing from the Replit dev preview or production URL don't know to append `?key=SESSION_SECRET`. Showing a password form is friendlier. The form does a GET to `/monitor` with the entered value as `?key=`, so a correct submission results in a bookmark-able URL.

**How to apply:**
- `checkMonitorKey(req, res)` — if key missing or wrong, render inline HTML login form and return `false`
- Key salah → same form with "⚠ Key salah" error div
- Auth is `process.env.SESSION_SECRET` (via `MONITOR_KEY` constant)

---

## SSE Event Architecture

```
monitorLog[]         — circular buffer, max 500 events in memory
monitorSSE[]         — array of active res objects (SSE clients)
pushMonitorEvent()   — appends to monitorLog, writes to all monitorSSE clients
```

On SSE connect (`/monitor/events?key=`):
1. Send full history as `event: history` (JSON array)
2. Push `res` into `monitorSSE[]`
3. Send `: ping` every 25s keepalive
4. On `req.close`, remove from `monitorSSE[]`

Client JS listens for two event types:
- `history` — bulk load past 500 events on connect
- `event` — individual new events pushed live

---

## Tracking Middleware

Fires BEFORE route handlers (registered after `express.static`):

```js
// Tracks: stream, video, folder, rb_video, rb_posts
// Captures: IP (x-forwarded-for first), UA (truncated 100 chars), resource ID
```

IP is extracted from `x-forwarded-for` (first value, trimmed) — important because Replit proxies all requests.

---

## Dashboard UI

- Dark theme matching app (`#0d0d12` background, `#a78bfa` accent)
- Stats bar: Total Events · Streams · Video Opens · Unique IPs
- Event rows: time · colored badge · resource ID · IP (truncated)
- Two top-right buttons:
  - **🔥 vidorey.web.app** → Firebase-hosted frontend
  - **📊 Firebase Analytics** → `https://analytics.google.com/analytics/web/?authuser=1&hl=en-US#/a338511152p518732508/reports/dashboard?r=firebase-overview`

---

## What Monitor Cannot Track

Firebase serves static files directly from CDN — page views and navigation on `vidorey.web.app` that don't call the Replit backend are invisible to this monitor. Only API calls (folder browse, video open, stream play) are visible. Use Firebase Analytics (Google Analytics) for page-view-level data.
