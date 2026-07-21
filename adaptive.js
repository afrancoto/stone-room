/* Stone Room — adaptive threshold estimator (Ψ-marginal / psi-marginal).
   3-D Bayesian grid over threshold α, slope β, and lapse λ. Each trial is placed to
   MINIMISE the expected entropy of the MARGINAL posterior over threshold (Kontsevich &
   Tyler 1999; Watson 2017 QUEST+; Prins 2013 psi-marginal). Modelling λ as a nuisance
   dimension is what keeps a single wrong answer from cratering the estimate, and entropy-
   min placement brackets the threshold intelligently (bold early, fine near the end).
   Everything runs in an abstract difficulty coordinate x (higher x = easier). */
(function () {
  "use strict";

  function linspace(a, b, n){ const o=new Array(n); for(let i=0;i<n;i++) o[i]=a+(b-a)*i/(n-1); return o; }

  function makePsi(cfg){
    const nA = cfg.nA || 50;
    const gamma = (cfg.gamma!=null) ? cfg.gamma : 0.5;   // lower asymptote: 0.5 for 2AFC, ~0.03 for yes/no detection
    const span0 = cfg.xHi - cfg.xLo;               // initial span — anchors conf/slope so widening is stable
    const priorSDabs = cfg.priorSD || span0*0.5;
    // slope β in units of 1/x, fixed (absolute) so the psychometric shape survives widening.
    // PREFER cfg.slopeW: the 10–90% width of the psychometric function in the room's OWN level
    // units (dB, or log-units for log rooms). The legacy span-relative form made the assumed
    // width proportional to the room's range — for the audiogram that meant the model believed
    // the "sometimes I hear it" zone was ~54 dB wide, so the posterior could never tighten to
    // the stopping target, the credible-interval stop never fired, and the trial CAP ended every
    // run. The count only *looked* adaptive. 4.4/width is the logistic 10–90% relation.
    const bMid = cfg.slopeW ? (4.4/cfg.slopeW) : ((cfg.slope || 6) / span0);
    const BETA = [bMid*0.4, bMid*0.7, bMid, bMid*1.5, bMid*2.2];
    const LAM = [0.0, 0.01, 0.02, 0.04, 0.06];     // lapse grid (Wichmann & Hill rectangular, capped)
    const nB = BETA.length, nL = LAM.length, nC = nA*nB*nL;

    function psi(x,a,b,lam){ return gamma + (1-gamma-lam)/(1+Math.exp(-b*(x-a))); }
    function normalize(p){ let s=0; for(let i=0;i<p.length;i++) s+=p[i]; if(s>0) for(let i=0;i<p.length;i++) p[i]/=s; }

    // mutable grid + posterior — rebuilt when the listener runs off the hard/easy edge
    let xLo, xHi, span, ALPHA, LIK, P;
    function build(lo,hi){
      xLo=lo; xHi=hi; span=hi-lo;
      ALPHA=linspace(lo,hi,nA);
      LIK=new Array(nA);
      for(let xi=0; xi<nA; xi++){
        const arr=new Float64Array(nC); const x=ALPHA[xi]; let c=0;
        for(let ai=0; ai<nA; ai++) for(let bi=0; bi<nB; bi++) for(let li=0; li<nL; li++) arr[c++]=psi(x,ALPHA[ai],BETA[bi],LAM[li]);
        LIK[xi]=arr;
      }
      P=new Float64Array(nC); let c=0;
      for(let ai=0; ai<nA; ai++){
        const za=(ALPHA[ai]-cfg.priorMean)/priorSDabs, pa=Math.exp(-0.5*za*za)+1e-4;
        for(let bi=0; bi<nB; bi++){ const pb=bi===2?1.2:1.0; for(let li=0; li<nL; li++) P[c++]=pa*pb*(1-LAM[li]); }
      }
      normalize(P);
    }
    build(cfg.xLo, cfg.xHi);

    function marginalAlpha(p){
      const m=new Float64Array(nA); let c=0;
      for(let ai=0; ai<nA; ai++){ let s=0; for(let k=0;k<nB*nL;k++) s+=p[c++]; m[ai]=s; }
      return m;
    }
    function entropy(m){ let h=0; for(let i=0;i<m.length;i++){ const v=m[i]; if(v>1e-12) h-=v*Math.log(v);} return h; }
    function meanX(){ const m=marginalAlpha(P); let mn=0; for(let i=0;i<nA;i++) mn+=ALPHA[i]*m[i]; return mn; }
    function applyLik(x,r){
      let xi=0,best=Infinity; for(let i=0;i<nA;i++){ const d=Math.abs(ALPHA[i]-x); if(d<best){best=d;xi=i;} }
      const lik=LIK[xi]; for(let c=0;c<nC;c++) P[c]*= r?lik[c]:(1-lik[c]); normalize(P);
    }

    let t=0, lastXi=0, prevExpH=0, dryRuns=0, widenLo=0, widenHi=0, hardStreak=0, easyStreak=0, boldProbe=0, bracketed=false;
    const history=[];
    const priorH = entropy(marginalAlpha(P));
    prevExpH = priorH;

    // if the placer keeps landing at the hardest cell and the listener still passes (or the
    // easiest cell and they still fail), the true threshold is off the grid — extend that side
    // and replay history, so a listener better than the starting range gets a real threshold.
    // boldProbe (-1 hard / +1 easy) then tells next() to jump straight to that edge to find where
    // the listener finally crosses, instead of inching toward it one entropy-min step at a time.
    function maybeWiden(){
      if(t<3 || bracketed) return;    // once bracketed, stop widening — localise instead
      const mn=meanX(), nearLo = mn < xLo + span*0.12, nearHi = mn > xHi - span*0.12;
      if(widenLo<4 && (hardStreak>=2 || nearLo)){ build(xLo - span0*0.6, xHi); for(const h of history) applyLik(h.x,h.r); widenLo++; hardStreak=0; boldProbe=-1; }
      else if(widenHi<4 && (easyStreak>=2 || nearHi)){ build(xLo, xHi + span0*0.6); for(const h of history) applyLik(h.x,h.r); widenHi++; easyStreak=0; boldProbe=1; }
      else if(hardStreak>=2){ boldProbe=-1; }    // grid maxed but still passing hard — keep probing the extreme
      else if(easyStreak>=2){ boldProbe=1; }
    }

    // choose next stimulus: argmin expected marginal-α entropy. First 2 trials deliberately easy.
    function next(){
      // Openers are deliberately easy so the listener hears what they're hunting for. But they are
      // NON-ADAPTIVE, and on a SEEDED frequency (every one after the first) the prior already knows
      // roughly where threshold sits, so the second opener buys orientation we already have — two
      // fixed trials × 9–15 frequency visits is 18–30 wasted presentations per ear. With a seed,
      // keep ONE opener and place it at the prior's easy shoulder so it still contributes evidence.
      const seeded = cfg.priorSeed!=null;
      if(t===0){
        if(seeded && cfg.openAtP){
          // opener at the PRIOR's ~90%-heard point (plus one prior-SD of margin) instead of the
          // grid top: still clearly audible — the opener keeps its orientation job — but no
          // longer 40-60 dB above a seeded threshold, so it stops firing the contralateral
          // mask on every ordinary visit and its answer actually constrains the posterior.
          // margin raised after a field report: the p≈0.9+1SD opener was theoretically audible
          // but perceptually vanished for a real listener — "no beeps at all any more". A
          // frequency's first beep must be COMFORTABLY supra-threshold (~20-25 dB SL): it is the
          // listener's only proof per visit that the test is alive, and the trust it buys costs
          // at most a few dB of placement efficiency on one trial.
          const target=cfg.priorMean + 2.2/bMid + Math.max(2*priorSDabs, 20);
          let xi=nA-2; for(let i=0;i<nA;i++){ if(ALPHA[i]>=target){ xi=i; break; } }
          lastXi=Math.min(Math.max(xi,2), nA-2); return ALPHA[lastXi];
        }
        lastXi=nA-1-Math.round(nA*0.06); return ALPHA[lastXi];
      }
      if(t===1 && !seeded){ lastXi=nA-1-Math.round(nA*0.18); return ALPHA[lastXi]; }
      // BOLD BRACKET: threshold is off the grid — jump to the extreme (index 1 / nA-2, which still
      // counts as an edge for the streak logic) to find where the listener crosses, then localise.
      if(boldProbe<0){ boldProbe=0; lastXi=1; return ALPHA[1]; }
      if(boldProbe>0){ boldProbe=0; lastXi=nA-2; return ALPHA[nA-2]; }
      let bestXi=0, bestH=Infinity;
      for(let xi=0; xi<nA; xi++){
        const lik=LIK[xi];
        // p(correct | x)
        let pc=0; for(let c=0;c<nC;c++) pc+=P[c]*lik[c];
        if(pc<=1e-6||pc>=1-1e-6){ continue; }
        // hypothetical posteriors, marginalised to α, entropies
        const mC=new Float64Array(nA), mW=new Float64Array(nA);
        let c=0;
        for(let ai=0; ai<nA; ai++){ let sc=0,sw=0;
          for(let k=0;k<nB*nL;k++){ const v=P[c], l=lik[c]; sc+=v*l; sw+=v*(1-l); c++; }
          mC[ai]=sc/pc; mW[ai]=sw/(1-pc);
        }
        const H = pc*entropy(mC) + (1-pc)*entropy(mW);
        if(H<bestH){ bestH=H; bestXi=xi; }
      }
      lastXi=bestXi; prevExpH=bestH;
      return ALPHA[bestXi];
    }

    function record(x, correct){
      history.push({x, r: correct?1:0});
      // edge-placement streaks (uses the placement index from next(), before applyLik remaps)
      if(lastXi<=1 && correct) hardStreak++; else hardStreak=0;
      if(lastXi>=nA-2 && !correct) easyStreak++; else easyStreak=0;
      // the listener finally FAILING at the hard edge (or PASSING at the easy edge) brackets the
      // threshold — from here, stop the bold drive and let entropy-min localise between the edges.
      if((lastXi<=2 && !correct) || (lastXi>=nA-3 && correct)){ bracketed=true; boldProbe=0; }
      applyLik(x, correct?1:0);
      t++;
      const hNow = entropy(marginalAlpha(P));
      if(priorH - hNow > 0 && (prevExpH - hNow) < 0.015) dryRuns++; else dryRuns=0;
      maybeWiden();
    }

    function stats(){
      const m=marginalAlpha(P);
      let mean=0; for(let i=0;i<nA;i++) mean+=ALPHA[i]*m[i];
      let varr=0; for(let i=0;i<nA;i++) varr+=m[i]*(ALPHA[i]-mean)*(ALPHA[i]-mean);
      const sd=Math.sqrt(Math.max(varr,0));
      let cum=0, lo=ALPHA[0], hi=ALPHA[nA-1], gotLo=false;
      for(let i=0;i<nA;i++){ cum+=m[i]; if(!gotLo && cum>=0.025){ lo=ALPHA[i]; gotLo=true; } if(cum>=0.975){ hi=ALPHA[i]; break; } }
      const ciW=Math.abs(hi-lo);
      // conf is priced in the FROZEN currency of the quality gates (ciUsable = 0.28·span at
      // construction), never the current grid span: widening the grid must not BUY confidence.
      // The old span-relative form let a 2×-wider CI read HIGHER confidence after a widen —
      // the least certain readings scored best. conf ≥ 0.5 now coincides with `usable`.
      const conf=Math.max(0,Math.min(1, 1 - ciW/(2*cfg.ciUsable)));
      return {
        mean, sd, ci:[lo,hi], ciW, conf, trial:t, widened:widenLo+widenHi,
        usable: t>=cfg.nMin && (ciW<=cfg.ciUsable || dryRuns>=3),
        solid:  t>=cfg.nMin && ciW<=cfg.ciSolid,
        precise: t>=cfg.nMin && ciW<=cfg.ciSolid,
        // extra trials to localise a widened grid — but capped: at *4 a doubly-widened frequency
        // could run past 20 trials, which reads as the search flailing rather than converging
        forceStop: t >= cfg.nMax + Math.min((widenLo+widenHi)*2, 6)
      };
    }
    // raise the trial ceiling so a "Sharpen" request can keep adding trials past the initial cap
    return { next, record, stats, bumpMax(d){ cfg.nMax += d; }, bounds:()=>({lo:xLo, hi:xHi}) };
  }

  // Build a Ψ-marginal estimator from a room's staircase params (ADAPT entry).
  // x = dir*transform(level); higher x = easier to discriminate.
  function forRoom(P){
    const log = P.log;
    const tf = v => log ? Math.log(v) : v;
    const inv = v => log ? Math.exp(v) : v;
    const dir = P.hard < 1 ? 1 : -1;
    const xf = lvl => dir * tf(lvl);
    const xa = xf(P.floor), xb = xf(P.ceil);
    const xLo = Math.min(xa, xb), xHi = Math.max(xa, xb), span = xHi - xLo;
    const anchMid = (xf(P.anchors[0]) + xf(P.anchors[1])) / 2;
    // seeding (audiogram): a neighbouring frequency's threshold gives a tight informed prior,
    // so start there with a narrower SD and fewer required trials. priorSeed is in LEVEL units.
    const pMean = (P.priorSeed!=null) ? xf(P.priorSeed) : anchMid;
    const pSD = span * 0.55 * (P.priorSDscale || 1);
    const cfg = {
      nA: 50, xLo: xLo - span*0.05, xHi: xHi + span*0.05,
      slope: 7, slopeW: P.slopeW, priorSeed: P.priorSeed, priorMean: pMean, priorSD: pSD, openAtP: P.openAtP,
      nMin: P.nMin || 8, nMax: P.nMax || 16, gamma: P.gamma,   // undefined for 2AFC rooms → makePsi default 0.5
      // ciTarget/ciSolidTarget: stopping thresholds in the room's OWN units (dB). With these set,
      // the run length is genuinely governed by UNCERTAINTY — a clear listener finishes fast, an
      // ambiguous one earns more trials — instead of every run ending at the cap or at nMin.
      ciUsable: P.ciTarget!=null ? P.ciTarget : span*0.28,
      ciSolid:  P.ciSolidTarget!=null ? P.ciSolidTarget : span*0.16
    };
    const eng = makePsi(cfg);
    // clamp to a generous range that extends 1.5× the span past each end (sign-agnostic — works
    // for Hz, dB, and negative dBFS) so an auto-widened grid can report a threshold beyond the
    // original floor/ceil. That's the whole point of widening.
    const rLo=Math.min(P.floor,P.ceil), rHi=Math.max(P.floor,P.ceil), rSpan=rHi-rLo;
    let loB=rLo-1.5*rSpan, hiB=rHi+1.5*rSpan;
    // physical limits: a frequency room must not report a level that isn't a real percept (e.g.
    // sub-20 Hz "hearing" or supra-20 kHz), which auto-widening + a click-chasing listener would
    // otherwise drift into. physLo/physHi (in level units) hard-cap the reported threshold.
    if(P.physLo!=null) loB=Math.max(loB, P.physLo);
    if(P.physHi!=null) hiB=Math.min(hiB, P.physHi);
    return {
      z: eng, dir, span, nMin: cfg.nMin, nMax: cfg.nMax,
      levelOf(x){ return Math.max(loB, Math.min(hiB, inv(dir*x))); },
      // UNclamped companion for CI endpoints: clamping both ends of a rail-straddling CI to the
      // rail collapses its width to ~0 — a censored point would enter the GP as the MOST trusted.
      levelOfRaw(x){ return inv(dir*x); }
    };
  }

  window.SR_PSI = { makePsi, forRoom };
  window.SR_ZEST = window.SR_PSI;   // back-compat alias so app.js keeps working
})();
