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
    const gamma = 0.5;                              // 2AFC guess rate
    const xLo = cfg.xLo, xHi = cfg.xHi, span = xHi - xLo;
    const ALPHA = linspace(xLo, xHi, nA);          // threshold candidates == stimulus candidates
    // slope β in units of 1/x. A wider psychometric = smaller β. Cover ±½ decade.
    const bMid = (cfg.slope || 6) / span;
    const BETA = [bMid*0.4, bMid*0.7, bMid, bMid*1.5, bMid*2.2];
    const LAM = [0.0, 0.01, 0.02, 0.04, 0.06];     // lapse grid (Wichmann & Hill rectangular, capped)
    const nB = BETA.length, nL = LAM.length, nC = nA*nB*nL;

    function psi(x,a,b,lam){ return gamma + (1-gamma-lam)/(1+Math.exp(-b*(x-a))); }

    // precompute likelihood of a CORRECT response for every (candidate x, cell)
    // LIK[xi] is a Float64Array over cells; index = ai*(nB*nL)+bi*nL+li
    const LIK = new Array(nA);
    for(let xi=0; xi<nA; xi++){
      const arr = new Float64Array(nC); const x = ALPHA[xi];
      let c=0;
      for(let ai=0; ai<nA; ai++) for(let bi=0; bi<nB; bi++) for(let li=0; li<nL; li++){
        arr[c++] = psi(x, ALPHA[ai], BETA[bi], LAM[li]);
      }
      LIK[xi] = arr;
    }

    // prior: broad Gaussian on α centred on cfg.priorMean, mild on β, gentle taper on λ
    const P = new Float64Array(nC);
    { let c=0;
      for(let ai=0; ai<nA; ai++){
        const za=(ALPHA[ai]-cfg.priorMean)/(cfg.priorSD||span*0.5);
        const pa=Math.exp(-0.5*za*za)+1e-4;
        for(let bi=0; bi<nB; bi++){
          const pb = bi===2?1.2 : 1.0;                        // slight favour to the middle slope
          for(let li=0; li<nL; li++){
            const pl = 1.0 - LAM[li];                          // gentle preference for low lapse
            P[c++] = pa*pb*pl;
          }
        }
      }
    }
    normalize(P);

    function normalize(p){ let s=0; for(let i=0;i<p.length;i++) s+=p[i]; if(s>0) for(let i=0;i<p.length;i++) p[i]/=s; }
    function marginalAlpha(p){
      const m=new Float64Array(nA); let c=0;
      for(let ai=0; ai<nA; ai++){ let s=0; for(let k=0;k<nB*nL;k++) s+=p[c++]; m[ai]=s; }
      return m;
    }
    function entropy(m){ let h=0; for(let i=0;i<m.length;i++){ const v=m[i]; if(v>1e-12) h-=v*Math.log(v);} return h; }

    let t=0, lastXi=0;
    const prior0 = marginalAlpha(P);
    const priorH = entropy(prior0);
    let prevExpH = priorH, dryRuns = 0;

    // choose next stimulus: argmin expected marginal-α entropy. First 2 trials deliberately easy.
    function next(){
      if(t===0){ lastXi=nA-1-Math.round(nA*0.06); return ALPHA[lastXi]; }
      if(t===1){ lastXi=nA-1-Math.round(nA*0.18); return ALPHA[lastXi]; }
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
      // locate the grid index for x (x came from ALPHA, so exact-ish)
      let xi=lastXi, best=Infinity;
      for(let i=0;i<nA;i++){ const d=Math.abs(ALPHA[i]-x); if(d<best){best=d;xi=i;} }
      const lik=LIK[xi];
      for(let c=0;c<nC;c++){ P[c] *= correct ? lik[c] : (1-lik[c]); }
      normalize(P);
      t++;
      // diminishing-returns tracker: how much did this trial actually reduce marginal entropy?
      const hNow = entropy(marginalAlpha(P));
      if(priorH - hNow > 0 && (prevExpH - hNow) < 0.015) dryRuns++; else dryRuns=0;
    }

    function stats(){
      const m=marginalAlpha(P);
      let mean=0; for(let i=0;i<nA;i++) mean+=ALPHA[i]*m[i];
      let varr=0; for(let i=0;i<nA;i++) varr+=m[i]*(ALPHA[i]-mean)*(ALPHA[i]-mean);
      const sd=Math.sqrt(Math.max(varr,0));
      // 95% CI from the marginal CDF
      let cum=0, lo=ALPHA[0], hi=ALPHA[nA-1], gotLo=false;
      for(let i=0;i<nA;i++){ cum+=m[i]; if(!gotLo && cum>=0.025){ lo=ALPHA[i]; gotLo=true; } if(cum>=0.975){ hi=ALPHA[i]; break; } }
      const ciW=Math.abs(hi-lo);
      const conf=Math.max(0,Math.min(1, 1 - ciW/(span*0.5)));
      return {
        mean, sd, ci:[lo,hi], ciW, conf, trial:t,
        usable: t>=cfg.nMin && (ciW<=cfg.ciUsable || dryRuns>=3),
        solid:  t>=cfg.nMin && ciW<=cfg.ciSolid,
        precise: t>=cfg.nMin && ciW<=cfg.ciSolid,   // alias
        forceStop: t>=cfg.nMax,
        edge: (lastXi<=1 || lastXi>=nA-2)          // sitting at a grid edge → possible ceiling/floor
      };
    }
    return { next, record, stats, _ALPHA:ALPHA };
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
    const cfg = {
      nA: 50, xLo: xLo - span*0.05, xHi: xHi + span*0.05,
      slope: 7, priorMean: anchMid, priorSD: span*0.55,
      nMin: P.nMin || 8, nMax: P.nMax || 16,
      ciUsable: span*0.28, ciSolid: span*0.16
    };
    const eng = makePsi(cfg);
    return {
      z: eng, dir, span, nMin: cfg.nMin, nMax: cfg.nMax,
      levelOf(x){ return Math.max(P.floor, Math.min(P.ceil, inv(dir*x))); }
    };
  }

  window.SR_PSI = { makePsi, forRoom };
  window.SR_ZEST = window.SR_PSI;   // back-compat alias so app.js keeps working
})();
