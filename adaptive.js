/* Stone Room — adaptive threshold estimator (ZEST-style, 1-parameter Bayesian).
   Posterior over threshold on a discrete grid; fixed slope; 2AFC guess=0.5, lapse.
   Next stimulus by one-step minimum-expected-variance. Stops on posterior SD.
   Refs: Watson & Pelli 1983 (QUEST); King-Smith 1994 (ZEST); Kontsevich & Tyler 1999 (Psi).
   Everything runs in an abstract difficulty coordinate x (higher x = easier). */
(function () {
  "use strict";

  function makeZest(cfg) {
    const M = cfg.M || 61;
    const nCand = cfg.nCand || 24;
    const gamma = cfg.gamma != null ? cfg.gamma : 0.5;
    const lambda = cfg.lambda != null ? cfg.lambda : 0.03;
    const w = cfg.w;
    const lo = cfg.xLo, hi = cfg.xHi, span = hi - lo;

    const A = new Array(M), p = new Array(M);
    for (let i = 0; i < M; i++) {
      A[i] = lo + span * i / (M - 1);
      const z = (A[i] - cfg.priorMean) / cfg.priorSD;
      p[i] = Math.exp(-0.5 * z * z) + 1e-6;   // broad Gaussian prior + floor
    }
    normalize(p);
    const cand = [];
    for (let i = 0; i < nCand; i++) cand.push(lo + span * i / (nCand - 1));

    let t = 0;
    const priorSD = moments(p).sd;

    function psi(x, a) { return gamma + (1 - gamma - lambda) / (1 + Math.exp(-(x - a) / w)); }
    function normalize(q) { let s = 0; for (let i = 0; i < q.length; i++) s += q[i]; for (let i = 0; i < q.length; i++) q[i] /= s; return q; }
    function moments(q) {
      let m = 0; for (let i = 0; i < M; i++) m += A[i] * q[i];
      let v = 0; for (let i = 0; i < M; i++) v += (A[i] - m) * (A[i] - m) * q[i];
      return { mean: m, sd: Math.sqrt(Math.max(v, 0)) };
    }
    function posteriorAfter(x, r) {
      const out = p.slice(); let s = 0;
      for (let i = 0; i < M; i++) { const pc = psi(x, A[i]); out[i] *= r ? pc : (1 - pc); s += out[i]; }
      for (let i = 0; i < M; i++) out[i] /= s;
      return out;
    }
    function varOf(q) { let m = 0; for (let i = 0; i < M; i++) m += A[i] * q[i]; let v = 0; for (let i = 0; i < M; i++) v += (A[i] - m) * (A[i] - m) * q[i]; return v; }

    // choose the next stimulus difficulty (returns x). First two trials deliberately easy.
    function next() {
      if (t === 0) return hi - span * 0.06;
      if (t === 1) return hi - span * 0.20;
      let best = cand[0], bestV = Infinity;
      for (const x of cand) {
        let pc = 0; for (let i = 0; i < M; i++) pc += p[i] * psi(x, A[i]);
        const eV = pc * varOf(posteriorAfter(x, 1)) + (1 - pc) * varOf(posteriorAfter(x, 0));
        if (eV < bestV) { bestV = eV; best = x; }
      }
      return best;
    }
    function record(x, correct) {
      const s = posteriorAfter(x, correct ? 1 : 0);
      for (let i = 0; i < M; i++) p[i] = s[i];
      t++;
    }
    function stats() {
      const mo = moments(p);
      return {
        mean: mo.mean, sd: mo.sd, trial: t,
        conf: Math.max(0, Math.min(1, 1 - mo.sd / priorSD)),
        usable: t >= cfg.nMin && mo.sd < cfg.sdUsable,
        precise: t >= cfg.nMin && mo.sd < cfg.sdPrecise,
        forceStop: t >= cfg.nMax
      };
    }
    return { next, record, stats, priorSD, _A: A, _p: p, psi };
  }

  // Build a ZEST estimator from a room's staircase params (ADAPT entry).
  // Works in x = dir*transform(level); higher x = easier to discriminate.
  function forRoom(P) {
    const log = P.log;
    const tf = v => log ? Math.log(v) : v;
    const inv = v => log ? Math.exp(v) : v;
    const dir = P.hard < 1 ? 1 : -1;              // 'hard' multiplier <1 shrinks level → easier grows with level
    const xf = lvl => dir * tf(lvl);
    const xa = xf(P.floor), xb = xf(P.ceil);
    const xLo = Math.min(xa, xb), xHi = Math.max(xa, xb), span = xHi - xLo;
    // neutral prior centred on the scoring range (between the two anchors) minimises
    // estimator bias where the score is actually read, not off at 'start'.
    const anchMid = (xf(P.anchors[0]) + xf(P.anchors[1])) / 2;
    const cfg = {
      xLo: xLo - span * 0.06, xHi: xHi + span * 0.06,
      w: span / 8,
      priorMean: anchMid, priorSD: span * 0.48,
      M: 61, nCand: 24,
      nMin: P.nMin || 9, nMax: P.nMax || 28,
      sdUsable: span * 0.13, sdPrecise: span * 0.082,
      lambda: P.lambda || 0.03
    };
    const z = makeZest(cfg);
    return {
      z, dir, span,
      levelOf(x) { return Math.max(P.floor, Math.min(P.ceil, inv(dir * x))); }
    };
  }

  window.SR_ZEST = { makeZest, forRoom };
})();
