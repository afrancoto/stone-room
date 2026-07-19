# Stone Room — a listening lab

A free, installable web app that does two things at once: **measures what you hear through
the headphones you own** and **trains your ears**. Twenty-five short rooms each put one
audiophile claim to the test — soundstage, detail, sub-bass, treble air, sibilance, timing,
micro-dynamics — plus a **per-ear hearing + headphone curve** (pulsed yes/no detection with
contralateral masking and silent catch trials). Every room runs an **adaptive Bayesian
track** — two-interval forced choice for the A/B rooms, yes/no detection for the curve,
adaptive difficulty for the spatial rooms — that hunts your exact limit and reports it in
real **Hz and dB**, saved per pair so you can set one headphone against another. Absolute
level is uncalibrated (browser, no SPL reference); shapes and differences are the honest output.

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
| `adaptive.js` | Ψ-marginal Bayesian threshold estimator (the smart measurement core) |
| `app.js` | Audio synthesis (WebAudio), the adaptive rooms, scoring, storage, compare |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA — installable + offline |

## The measurement engine

Every threshold room runs a **Ψ-marginal Bayesian estimator** (psi method: Kontsevich &
Tyler 1999; marginalisation: Prins 2013) — a 3-D posterior over threshold × slope × **lapse**,
with each trial placed to minimise the expected entropy of the marginal threshold posterior,
so one slip can't crater an estimate. Guess rate matches the task: 0.5 for the two-interval
rooms, 0.03 for the yes/no hearing curve (which adds ~20% silent catch trials for false-alarm
control, pulsed tones, and contralateral masking in per-ear mode). Level and base pitch are
**roved every trial** so nothing can be memorised. A room **stops when it's confident**
(credible interval below target) rather than after a fixed count — clear listeners finish
in ~10 trials — and the residual precision is always shown: confidence bands on the curve,
"% locked in" on rooms, open dots where a threshold sat beyond the playable range. Spatial
rooms adapt difficulty and report localization **acuity in degrees**.

## Run locally

It's static — open `index.html`, or serve the folder:

```
npx serve .      # or: python -m http.server
```

## Deploy / configure

See `DEPLOY.md`. One thing to set before publishing: your tip link in `app.js`
(`CONFIG.COFFEE_URL`).
