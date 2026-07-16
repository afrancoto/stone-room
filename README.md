# Stone Room — a listening lab

A free, installable web app that does two things at once: **tests the headphones you own**
and **trains your ears**. Twenty-three short rooms each put one audiophile claim to the
test — soundstage, detail, sub-bass, treble air, sibilance, timing, micro-dynamics — using
**adaptive 2-alternative-forced-choice staircases** that hunt your exact limit and report it
in real **Hz and dB**, saved per pair so you can set one headphone against another.

No sign-up, no server, no tracking. Everything runs in the browser; results live in your
own device's storage.

## Why it's different

The market splits in two: tools that *train your ears* with no number attached to your gear
(Quiztones, Harman How to Listen), and databases that *measure a reference unit* on a lab rig
(squig.link, Crinacle) — never your unit, on your head, through your ears. Stone Room is the
only free tool that measures **your** headphones through **your own** ears, in Hz/dB, and
saves it for pair-vs-pair comparison. See `RESEARCH.md`.

## What's inside

| File | Role |
|------|------|
| `index.html` | App shell / screens |
| `styles.css` | Full-viewport responsive design |
| `content.js` | Room copy, verified benchmarks, science, real-model references, feedback pools |
| `adaptive.js` | ZEST-style Bayesian threshold estimator (the smart measurement core) |
| `app.js` | Audio synthesis (WebAudio), the adaptive rooms, scoring, storage, compare |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA — installable + offline |

## The measurement engine

Each 2AFC room runs a **1-parameter Bayesian estimator** (ZEST family: Watson & Pelli 1983;
King-Smith 1994) — a posterior over the threshold on a discrete grid, fixed slope,
guess = 0.5, lapse ≈ 0.03. The next trial is placed to **minimise expected posterior
variance**, and the room **stops when it's confident** (posterior SD below target) rather than
after a fixed count — so clear listeners finish in ~15 trials, and you can "Lock in" early or
let it sharpen. The score is unbiased at mid-scale; the residual precision is shown honestly as
a confidence band. Spatial rooms adapt difficulty and report localization **acuity in degrees**.

## Run locally

It's static — open `index.html`, or serve the folder:

```
npx serve .      # or: python -m http.server
```

## Deploy / configure

See `DEPLOY.md`. One thing to set before publishing: your tip link in `app.js`
(`CONFIG.COFFEE_URL`).
