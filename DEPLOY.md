# Stone Room — deploy & configure

Stone Room is a static, installable PWA (HTML + CSS + JS + a service worker). No backend,
no build step, no database — results live in each visitor's browser. Hosting cost: **€0**.

---

## It's already live on GitHub Pages

This repo is pushed to `github.com/afrancoto/stone-room` with Pages enabled:

**→ https://afrancoto.github.io/stone-room/**

Give it a minute after each push for the CDN to update. To ship a change:

```bash
git add -A && git commit -m "…" && git push
```

Pages redeploys automatically. Because a service worker caches the app, bump `CACHE` in
`sw.js` (e.g. `stone-room-v3`) whenever you change the JS/CSS so returning visitors pull the
new version instead of the cached one.

---

## ✅ The one thing you must do: your tip link

Open `app.js`, near the top:

```js
const CONFIG = {
  COFFEE_URL: "https://www.paypal.me/YOURNAME",   // ← change this
  ...
```

Set it to **your** link, then commit + push. Options (all free, all keep the app free):

- **PayPal.me** — go to paypal.me, claim your handle, use `https://www.paypal.me/yourhandle`.
- **Buy Me a Coffee** — buymeacoffee.com, use `https://www.buymeacoffee.com/yourhandle`.
- **Ko-fi** — ko-fi.com, use `https://ko-fi.com/yourhandle`.

Until you change it, the ☕ button shows a gentle "set your coffee link" note instead of
going anywhere, so nothing breaks if you forget.

---

## Installing it as an app (this is the PWA part)

Once live, visitors can install it to their home screen — it then opens full-screen like a
native app and works offline:

- **Android / Chrome:** menu (⋮) → *Install app* / *Add to Home screen*.
- **iPhone / Safari:** Share → *Add to Home Screen*.

The manifest, icons and service worker that make this work are already in the repo. Nothing to do.

---

## Deep links (share one room)

Add `#<room>` to the URL to drop straight into a single room, e.g.
`…/stone-room/#foundation`, `#air`, `#shade`, `#orbit`, `#silk`. The end screen's **Share**
button builds the right link automatically, and **Copy results** produces a paste-ready
text summary with your measurements.

---

## Optional: a nicer domain

GitHub Pages supports a free custom domain. Buy a domain (e.g. `stoneroom.audio`), then repo
**Settings → Pages → Custom domain**, and add the DNS records GitHub shows you. HTTPS is
automatic.

---

## Later: comments & letting people publish scores

Kept out for now so the app stays 100% free, private and server-less. When you want it, the
zero-cost path is a lightweight embed rather than a backend:

- **Comments:** [Giscus](https://giscus.app) (free, backed by GitHub Discussions) or
  [utterances](https://utteranc.es) — one script tag, no server.
- **Publish a score:** the **Share** button already lets people post their result anywhere.
  A public leaderboard would need a tiny free backend (e.g. a Cloudflare Worker + KV) — say
  the word and it's a small add.

---

## Later: ads (deferred, per your call)

You chose to hold ads and lead with the coffee tip — good call while traffic is small. When
you're ready, the tasteful version:

- One unit on the **end screen only** — never inside a listening room (a mid-test ad
  contradicts the whole "nothing added to the sound" premise).
- **Google AdSense** or **Ethical Ads** (carbonads-style, less intrusive) are the usual free
  options. AdSense needs a live site with real traffic and an approval step.
- EU visitors will need a consent banner (Google's free Consent Management) and a short
  privacy page. Until then the app sets no cookies and sends no data — worth stating.
- **Pay to remove ads:** once ads exist, a one-time PayPal purchase can set a
  `localStorage` flag your code checks before rendering the ad slot. Straightforward to add.

---

## What runs where (so nothing surprises you)

- All audio is synthesised in the browser with the Web Audio API — no audio files to host.
- The only external request is Google Fonts; the service worker caches it, so after first
  load the app works fully offline.
- `legacy/stone-room-v1.html` is the original single-file version, kept for reference. The
  live app is `index.html` + the modules.
