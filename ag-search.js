/* Stone Room — audiogram search orchestrator (DOM-free).
   Owns everything about WHAT to measure next and WHEN a reading is done; app.js keeps audio,
   DOM, the practice tone, and the output-gain window placement. Two orders:

   'smart' (default) — GP-coupled blocked search. The per-frequency Ψ column stays (frequency
   certainty is worth real dB at threshold, and it preserves logs/censoring/anchor semantics);
   what the whole-curve model changes is the scaffolding around the column:
     · SEED: each new frequency's prior comes from a 1-D GP over log-f fitted on every locked,
       uncensored point — all points, uncertainty-weighted — not a two-point extrapolation.
     · ORDER: after the 1 kHz reference and a 4 kHz / 500 Hz spread, the next frequency is
       wherever the GP is least certain; inter-octave candidates are visited only while the
       curve there is still vague.
     · STOP: a frequency may stop early when its own posterior COMBINED with the leave-one-out
       GP prediction reaches the target — unless it DISAGREES with its neighbours by more than
       the notch gate, in which case borrowing switches off and the surprise must pay its own
       way at a tighter criterion with extra trials. Disagreement is structure, not noise.
     · CATCH: silent trials are ear-scoped and decay (heavy while the listener learns that
       silence is an answer, light once the lapse rate is constrained), instead of resetting
       at every frequency.
   'fixed' — a faithful port of the pre-v64 flow (base plan → slope-triggered infill → widest-CI
   verify → reference sentinel, per-frequency stopping, per-frequency catch caps). It is the
   benchmark baseline and the live fallback (?agorder=fixed).

   The harness (scratchpad ag_harness.js) drives this module with simulated listeners; the ELL
   and notch-gate constants below were chosen there, not guessed. */
(function(){
  "use strict";

  // ---- inference GP over u = log10(f), fitted on ABSOLUTE dBFS thresholds ----------------
  // Deliberately separate from fingerprint.js's render GP: this one reasons, that one draws.
  // Shorter length-scale (a 0.95-octave ell visibly shallows a 1-octave notch), absolute
  // levels (rel silently moves when auto-range shifts calOffset), censored points excluded —
  // a rail pin is a bound, not a measurement, and admitting it would make the GP confident
  // exactly where it is ignorant.
  let cholNulls=0;
  function chol(A){ const n=A.length, Lm=Array.from({length:n},()=>new Float64Array(n));
    for(let i=0;i<n;i++) for(let j=0;j<=i;j++){ let s=A[i][j];
      for(let k=0;k<j;k++) s-=Lm[i][k]*Lm[j][k];
      if(i===j){ if(s<=0) return null; Lm[i][j]=Math.sqrt(s); } else Lm[i][j]=s/Lm[j][j]; }
    return Lm; }
  function cholSolve(Lm,b){ const n=Lm.length, yv=new Float64Array(n), xv=new Float64Array(n);
    for(let i=0;i<n;i++){ let s=b[i]; for(let k=0;k<i;k++) s-=Lm[i][k]*yv[k]; yv[i]=s/Lm[i][i]; }
    for(let i=n-1;i>=0;i--){ let s=yv[i]; for(let k=i+1;k<n;k++) s-=Lm[k][i]*xv[k]; xv[i]=s/Lm[i][i]; }
    return xv; }
  const SF2=18*18;                                   // prior variance: ±18 dB is a plausible audiogram spread
  function gpInfer(pts, us, ell){                    // pts:[{u,y,sd}] absolute dBFS · us: query log10(f)
    const n=pts.length; if(!n) return null;
    // centred prior: a zero-mean GP in dBFS reverts weakly-supported predictions toward
    // 0 dBFS — "deafeningly loud" — which poisons long-jump seeds and fakes huge residuals
    // at the curve's edges. Fit the residuals around the data mean instead.
    let m0=0; for(const p of pts) m0+=p.y; m0/=n;
    const kf=(a,b)=>SF2*Math.exp(-((a-b)*(a-b))/(2*ell*ell));
    const K=[]; for(let i=0;i<n;i++){ K[i]=[];
      for(let j=0;j<n;j++){ let v=kf(pts[i].u,pts[j].u);
        if(i===j){ const sd=(pts[i].sd!=null&&isFinite(pts[i].sd))?pts[i].sd:25; v+=sd*sd+1e-6; } K[i][j]=v; } }
    const Lm=chol(K); if(!Lm){ cholNulls++; return null; }
    const al=cholSolve(Lm, pts.map(p=>p.y-m0));
    return us.map(uq=>{ const ks=pts.map(p=>kf(uq,p.u));
      let m=m0; for(let i=0;i<n;i++) m+=ks[i]*al[i];
      const vv=cholSolve(Lm,ks); let kss=SF2; for(let i=0;i<n;i++) kss-=ks[i]*vv[i];
      return { mean:m, sd:Math.sqrt(Math.max(kss,0)) }; });
  }

  const U=f=>Math.log10(f);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function newEar(o){
    const rng=o.rng||Math.random, psi=o.psi, room=o.room, order=o.order||'smart';
    const ell=(o.ellOct!=null?o.ellOct:0.65)*Math.log10(2);   // harness-swept: largest ell meeting the notch bar
    const targetSD=o.targetSD!=null?o.targetSD:6;   // half-width dB — reproduces ciTarget:12; do NOT lower
    const solidSD=o.solidSD!=null?o.solidSD:4;      // a flagged surprise must reach this on its own data
    const notchGate=o.notchGate!=null?o.notchGate:8;// dB of GP disagreement that switches borrowing OFF
    const ownMax=o.ownMax!=null?o.ownMax:20;        // never borrow into a wild posterior
    const minOwn=o.minOwn!=null?o.minOwn:3;         // never lock on fewer own trials — how notches vanish
    const physLo=room.physLo!=null?room.physLo:-94, physHi=room.physHi!=null?room.physHi:-10;
    const spanRef=Math.abs(room.ceil-room.floor);
    // 250 Hz is a core clinical audiometric frequency and low-frequency loss is a distinct
    // pattern the optional-only placement could skip entirely (it did, on Andrea's run — the
    // curve started at 500). 125 stays optional; even clinics rarely test it.
    // 125 joins the required set too: leaving it optional meant the low end simply never got
    // measured on a listener whose curve looked settled there, and the chart's axis starts at
    // 125 — so the curve visibly began in mid-air.
    const mandatory=(o.mandatory||[1000,500,2000,4000,8000,250,125,16000]).slice();
    const candidates=(o.candidates||[750,1500,3000,6000,10000,12000]).slice();
    const budget=o.budget!=null?o.budget:55;        // real-trial outer bound per ear (smart)

    const S={ pts:{}, meta:{}, notched:{}, engines:{}, tCount:{}, resumeAt:{},
      curF:null, curPhase:null, earTrials:0, catchTotal:0, requeues:0,
      sentinelDone:false, refFirst:null, pending:null,
      fix:{ plan:(o.baseplan||[1000,2000,4000,8000,12000,16000,500,250,125]).slice(), i:0,
            phaseB:false, phaseC:false, phaseD:false, catchThisFreq:0 } };

    function lockedPts(exceptF){
      return Object.keys(S.pts)
        .filter(f=>S.pts[f]!=null && !(S.meta[f]&&S.meta[f].cens) && +f!==exceptF)
        .map(f=>({u:U(+f), y:S.pts[f], sd:(S.meta[f]&&S.meta[f].ci!=null)?S.meta[f].ci/1.96:25}));
    }
    function gp(exceptF, us){ const p=lockedPts(exceptF); if(!p.length) return null; return gpInfer(p,us,ell); }

    // ---- seeding -------------------------------------------------------------------------
    function smartSeed(f, phase){
      if(phase==='sentinel') return {priorSeed:S.refFirst, priorSDscale:0.5, nMin:minOwn, openAtP:0.9};
      const g=gp(f,[U(f)]);
      if(!g) return {nMin:4};                                   // no support at all — true cold start
      let s=g[0].mean;
      // censored neighbours are one-sided information: don't let the GP (which excludes them)
      // seed a frequency next to a beyond-reach point as if that region were ordinary
      for(const fc of Object.keys(S.meta)){ const m=S.meta[fc]; if(!m||!m.cens) continue;
        if(Math.abs(U(+fc)-U(f))<=Math.log10(2)){
          if(S.pts[fc]>=physHi-3) s=Math.max(s, physHi-6);
          if(S.pts[fc]<=physLo+3) s=Math.min(s, physLo+6);
        } }
      // prior width tracks what the curve actually knows: a tight neighbourhood earns a tight
      // prior and nMin 3; a long jump gets a wide (but CENTRED) prior and a full nMin 4 —
      // the own-CI stopping rule below is what makes a mis-seeded start harmless (it runs
      // longer instead of locking wide)
      return {priorSeed:clamp(s,physLo,physHi), priorSDscale:clamp(g[0].sd/(spanRef*0.55),0.25,1.0), nMin:g[0].sd<8?minOwn:4, openAtP:0.9};
    }
    function fixedSeed(f, requeue){                              // faithful pre-v64 three-branch heuristic
      const pts=S.pts;
      if(requeue) return {priorSeed:pts[f]!=null?pts[f]:S.refFirst, priorSDscale:0.5, nMin:3};
      const spec=(o.infill||[]).find(c=>c.f===f);
      if(spec && pts[spec.lo]!=null && pts[spec.hi]!=null){
        const w=Math.log2(f/spec.lo)/Math.log2(spec.hi/spec.lo);
        return {priorSeed:pts[spec.lo]+w*(pts[spec.hi]-pts[spec.lo]), priorSDscale:0.4, nMin:3};
      }
      const done=Object.keys(pts).map(Number).filter(x=>pts[x]!=null)
        .sort((a,b)=>Math.abs(Math.log2(a/f))-Math.abs(Math.log2(b/f)));
      if(!done.length) return {nMin:4};
      let sd=pts[done[0]];
      if(done.length>=2){
        const n1=done[0], n2=done[1];
        const ext=pts[n1]+(pts[n1]-pts[n2])/Math.log2(n1/n2)*Math.log2(f/n1);
        sd=clamp(ext, pts[n1]-15, pts[n1]+15);
      }
      return {priorSeed:sd, priorSDscale:Math.abs(Math.log2(done[0]/f))<=1?0.45:0.55, nMin:4};
    }

    // ---- frequency selection -------------------------------------------------------------
    function sentinelOrDone(){
      if(!S.sentinelDone && S.pts[1000]!=null && !(S.meta[1000]&&S.meta[1000].cens)){
        S.sentinelDone=true; S.refFirst=S.pts[1000];
        return {f:1000, phase:'sentinel', fresh:true};
      }
      return {done:true};
    }
    function pickSmart(){
      if(S.pts[1000]==null) return {f:1000, phase:'tone', idx:1, of:mandatory.length};
      // spread before prediction: three points on a 2-decade axis is thin — 4 kHz and 500 Hz
      // give the GP real support before it is asked to choose or predict anything
      for(const f of [4000,500]) if(S.pts[f]==null && mandatory.indexOf(f)>=0)
        return {f, phase:'tone', idx:mandatory.length-mandatory.filter(x=>S.pts[x]==null).length+1, of:mandatory.length};
      // GP-residual re-queue replaces the widest-CI verify pass: it selects for structure
      // (a point that disagrees with its neighbours), not for noise. Resumed, not restarted.
      // the six mandatory octaves are EXEMPT from the budget — cutting one breaks the curve's
      // basic promise; the budget bounds the extras (candidates, re-queues)
      const remM=mandatory.filter(f=>S.pts[f]==null);
      if(remM.length){
        const g=gp(null, remM.map(U));
        let bf=remM[0];
        if(g){ let best=-1; remM.forEach((f,i)=>{ if(g[i].sd>best){best=g[i].sd; bf=f;} }); }
        return {f:bf, phase:'tone', idx:mandatory.length-remM.length+1, of:mandatory.length};
      }
      // GP-residual re-queue replaces the widest-CI verify pass; support counts every locked
      // uncensored point, targets exclude points already flagged (they paid at solidSD)
      if(S.requeues<2 && S.earTrials<budget+10){
        const support=Object.keys(S.pts).map(Number)
          .filter(f=>S.pts[f]!=null && !(S.meta[f]&&S.meta[f].cens));
        if(support.length>=5){
          let worst=null;
          for(const f of support){ if(S.notched[f]) continue;
            const g=gp(f,[U(f)]); if(!g) continue;
            const r=Math.abs(S.pts[f]-g[0].mean);
            if(r>notchGate && (!worst||r>worst.r)) worst={f,r}; }
          if(worst){ S.requeues++; S.notched[worst.f]=true; return {f:worst.f, phase:'surprise', resume:true}; }
        }
      }
      if(S.earTrials>=budget) return sentinelOrDone();
      const remC=candidates.filter(f=>S.pts[f]==null);
      if(remC.length){
        const g=gp(null, remC.map(U));
        if(g){ let best=-1, bf=null;
          remC.forEach((f,i)=>{ if(g[i].sd>best){best=g[i].sd; bf=f;} });
          if(best>targetSD) return {f:bf, phase:'gap'};         // only where the curve is still vague
        } else return {f:remC[0], phase:'gap'};
      }
      return sentinelOrDone();
    }
    function pickFixed(){
      const X=S.fix, base=(o.baseplan||[]).length||9;
      if(X.i>=X.plan.length){
        if(!X.phaseB){ X.phaseB=true;
          const add=planInfill(); if(add.length){ X.plan=X.plan.concat(add); } }
        if(X.i>=X.plan.length && !X.phaseC){ X.phaseC=true;
          const vf=planVerify(); if(vf.length){ X.plan=X.plan.concat(vf); } }
        if(X.i>=X.plan.length && !X.phaseD){ X.phaseD=true;
          if(S.pts[1000]!=null && !(S.meta[1000]||{}).cens){
            S.refFirst=S.pts[1000]; S.sentinelDone=true;
            X.plan=X.plan.concat([1000]); X.sentinelIdx=X.plan.length-1; } }
        if(X.i>=X.plan.length) return {done:true};
      }
      const f=X.plan[X.i];
      const requeue=S.pts[f]!=null;
      const phase = (X.sentinelIdx===X.i)?'sentinel' : X.phaseC&&requeue?'surprise' : X.phaseB&&X.i>=base?'gap' : 'tone';
      return {f, phase, requeue, idx:Math.min(X.i+1,base), of:base};
    }
    function planInfill(){                                       // faithful agPlanInfill
      const pts=S.pts, cap=o.infillCap!=null?o.infillCap:3, bud=o.trialBudget!=null?o.trialBudget:70, out=[];
      for(const c of (o.infill||[])){
        if(pts[c.lo]==null||pts[c.hi]==null) continue;
        const slope=Math.abs(pts[c.hi]-pts[c.lo])/Math.log2(c.hi/c.lo);
        if(c.always||slope>=(o.slopeTrig!=null?o.slopeTrig:8)) out.push({f:c.f,slope,always:c.always});
      }
      out.sort((a,b)=>(b.always-a.always)||(b.slope-a.slope));
      const chosen=[];
      for(const c of out){ if(chosen.length>=cap) break;
        if(!c.always && S.earTrials>=bud) continue; chosen.push(c.f); }
      return chosen.sort((a,b)=>a-b);
    }
    function planVerify(){                                       // faithful agPlanVerify
      return Object.keys(S.meta).map(Number)
        .filter(f=>S.meta[f] && !S.meta[f].cens && S.meta[f].ci!=null && S.meta[f].ci>=5)
        .sort((a,b)=>S.meta[b].ci-S.meta[a].ci).slice(0,2).sort((a,b)=>a-b);
    }

    // ---- the public loop -----------------------------------------------------------------
    function nextFreq(){
      const pick = order==='fixed' ? pickFixed() : pickSmart();
      if(pick.done){ S.curF=null; return pick; }
      const f=pick.f;
      S.curF=f; S.curPhase=pick.phase;
      if(pick.resume && S.engines[f]){                           // surprise: resume the posterior
        S.engines[f].z.bumpMax(4); S.resumeAt[f]=S.tCount[f]||0;
        delete S.pts[f];
      } else {
        const seed = order==='fixed' ? fixedSeed(f, pick.requeue||pick.phase==='sentinel') : smartSeed(f, pick.phase);
        // LIVE guess rate: the model assumed a fixed 3% "yes to silence" for the whole run, so a
        // liberal responder's thresholds were estimated during the run as if they never guessed —
        // biasing them LOW (the yes/no literature's central caveat). Each new frequency now starts
        // with the rate actually measured from this ear's silent catch trials so far.
        const gam = o.gammaLive ? o.gammaLive() : room.gamma;
        S.engines[f]=psi.forRoom(Object.assign({}, room, seed, {gamma:gam}));
        S.tCount[f]=0; S.resumeAt[f]=0; S.fix.catchThisFreq=0;
        if(pick.requeue||pick.phase==='sentinel') delete S.pts[f];
      }
      return pick;
    }
    function nextTrial(){
      const f=S.curF, eng=S.engines[f];
      const x=eng.z.next(), level=eng.levelOf(x);
      let isCatch=false;
      const t=S.tCount[f]||0;
      if(order==='fixed'){
        const cap=Math.max(2, Math.round((eng.nMax||12)*0.35));
        if(t>0 && S.fix.catchThisFreq<cap && rng()<0.2){ isCatch=true; S.fix.catchThisFreq++; }
      } else {
        // ear-scoped, decaying: heavy while "Nothing" is still being learned as a legitimate
        // answer, light once the lapse behaviour is constrained. Never the first of a frequency.
        const rate = S.earTrials<12?0.25 : S.earTrials<30?0.12 : 0.06;
        if(t>0 && S.catchTotal<(o.catchCap!=null?o.catchCap:8) && rng()<rate){ isCatch=true; S.catchTotal++; }
      }
      S.pending={x, level, isCatch};
      return {level, isCatch};
    }
    function shouldLock(f, eng, st, own){
      if(st.forceStop) return true;
      if(st.trial<minOwn) return false;
      if((S.tCount[f]||0) < (S.resumeAt[f]||0)+2 && S.curPhase==='surprise') return false;   // a re-visit earns ≥2 fresh trials
      // fixed keeps the shipped criterion (usable = CI target OR posterior gone dry); smart uses
      // the brief's strict rule — the dry-runs escape can fire after a few all-heard trials far
      // above threshold and lock a still-wide posterior tens of dB off. Never that.
      // smart also accepts a dried-out posterior, but ONLY when it is already reasonably tight
      // (≤8 dB half-width) — the unconditional dry escape once locked a 15.8 dB posterior
      const ownMet = order==='fixed' ? st.usable : (own<=targetSD || (st.usable && own<=8));
      if(order==='fixed') return ownMet;
      if(own>ownMax) return false;
      const others=lockedPts(f);
      if(others.length<4) return ownMet;                         // borrowing needs real support
      const g=gpInfer(others,[U(f)],ell);
      if(!g) return ownMet;                                      // chol failed → own data only, NEVER lock on borrow
      const pred=g[0], lvl=eng.levelOf(st.mean);
      if(Math.abs(lvl-pred.mean)>notchGate){
        if(!S.notched[f]){ S.notched[f]=true; eng.z.bumpMax(4); } // a surprise earns MORE trials, not fewer
        return own<=solidSD;
      }
      if(ownMet) return true;
      const comb=1/Math.sqrt(1/(own*own)+1/(pred.sd*pred.sd));
      return comb<=targetSD;
    }
    function record(heard){
      const f=S.curF, eng=S.engines[f], p=S.pending;
      eng.z.record(p.x, heard);
      S.tCount[f]=(S.tCount[f]||0)+1; S.earTrials++;
      const st=eng.z.stats();
      const loL=eng.levelOfRaw(st.ci[0]), hiL=eng.levelOfRaw(st.ci[1]);
      const own=Math.abs(hiL-loL)/2, lvl=eng.levelOf(st.mean);
      if(!shouldLock(f,eng,st,own)) return {locked:false, live:{lvl, ci:own}};
      const censDir = lvl>=physHi-3 ? 'hi' : (lvl<=physLo+3 ? 'lo' : null), cens=!!censDir;
      if(S.curPhase==='sentinel'){
        const drift=Math.abs(lvl-S.refFirst);
        S.pts[1000]=S.refFirst; S.meta[1000]={ci:own, cens};     // the ORIGINAL anchor stays the reading
        S.curF=null; if(order==='fixed') S.fix.i++;
        return {locked:true, sentinel:true, drift, f:1000, lvl:S.refFirst, ci:own, cens};
      }
      S.pts[f]=lvl; S.meta[f]={ci:own, cens, censDir};
      S.curF=null; if(order==='fixed') S.fix.i++;
      return {locked:true, f, lvl, ci:own, cens, censDir};
    }
    function censorAt(rail){                                     // mercy-skip / fast floor exit
      const f=S.curF, v=rail==='hi'?physHi:physLo;
      // the sentinel re-visits 1 kHz; a floor-exit or give-up here must NOT overwrite the
      // reference the whole curve is drawn against — that silently translated the entire curve
      // 15-24 dB, precisely in the volume-drift case the sentinel exists to flag (est. audit F1).
      if(S.curPhase==='sentinel'){
        S.pts[1000]=S.refFirst; S.meta[1000]={ci:null, cens:(S.meta[1000]&&S.meta[1000].cens)||false};
        S.curF=null; if(order==='fixed') S.fix.i++;
        return {locked:true, sentinel:true, drift:Math.abs(v-S.refFirst), f:1000, lvl:S.refFirst, ci:null, cens:false};
      }
      S.pts[f]=v; S.meta[f]={ci:null, cens:true, censDir:rail};
      S.curF=null; if(order==='fixed') S.fix.i++;
      return {locked:true, f, lvl:v, ci:null, cens:true, censDir:rail};
    }
    // accept a 1 kHz reading measured BEFORE the run (the two-ear anchor pass), so the ear starts
    // from a reference that was chosen with both ears in view instead of re-measuring it here
    function seedAnchor(lvl, ci, cens, censDir){
      // carry the anchor pass's censored verdict in: hardcoding cens:false hid a rail-pinned
      // reference from sentinelOrDone's guard and from everything downstream that must treat a
      // bound differently from a measurement
      S.pts[1000]=lvl; S.meta[1000]={ci:(ci!=null?ci:null), cens:!!cens, censDir:censDir||null};
    }
    function requeueAnchor(){                                    // window placement re-measure
      delete S.pts[1000]; delete S.meta[1000]; delete S.engines[1000];
      S.tCount[1000]=0;
      if(order==='fixed') S.fix.i=S.fix.plan.indexOf(1000);
    }
    return { nextFreq, nextTrial, record, censorAt, requeueAnchor, seedAnchor,
      state:()=>S, order, nulls:()=>cholNulls };
  }

  window.SR_AGSEARCH={ newEar, gpInfer, U, nulls:()=>cholNulls };
})();
