/* Stone Room — engine & flow.
   Audio synthesis (WebAudio), the adaptive rooms, scoring, screens, storage, compare.
   Content (copy/science/benchmarks/feedback) comes from content.js; the adaptive
   threshold estimator from adaptive.js. */
(() => {
  "use strict";
  const CONTENT = window.SR_CONTENT;
  const GROUPS = CONTENT.GROUPS;
  const INTRO = CONTENT.INTRO;
  const RC = CONTENT.ROOM;                       // per-room content by tag

  // ---- configuration you may edit before publishing ----
  const APP_VERSION = "v50";                          // keep in sync with the CACHE name in sw.js
  const CONFIG = {
    COFFEE_URL: "https://www.paypal.me/YOURNAME",   // ← set your PayPal.me / Buy-Me-a-Coffee link
    SHARE_TITLE: "Stone Room — a listening lab"
  };

  const LY = 95, RAD = 150;
  let ctx, master, reverb, hallSmall, hallMed, hallLarge, _noise;

  const liveStim=new Set();   // every scheduled source registers here so killStim can truly end a trial
  function initAudio(){
    if(ctx) return;
    ctx = new (window.AudioContext||window.webkitAudioContext)();
    // register every source at creation: stop() is one-shot per spec (all primitives schedule it
    // at creation), so a silenced trial's leftovers are removed by disconnect() instead. Without
    // this, killStim only muted the master bus — the next trial re-anchored master.gain and
    // UN-MUTED the previous interval's scheduled tail, which landed asymmetrically on interval A
    // (+~2 dB extra masking in the Noise room, a leftover near-threshold tone in the audiogram).
    ['createOscillator','createBufferSource'].forEach(k=>{
      const orig=ctx[k].bind(ctx);
      ctx[k]=function(){ const n=orig(); liveStim.add(n); n.addEventListener('ended',()=>liveStim.delete(n)); return n; };
    });
    const comp = ctx.createDynamicsCompressor();
    // limiter-style safety only: signal below ~-6 dBFS passes linearly, so the level
    // differences the lab rooms measure (Shade, Silk, Silence…) reach the ears intact
    comp.threshold.value=-6; comp.knee.value=4; comp.ratio.value=12; comp.attack.value=.003; comp.release.value=.25;
    master = ctx.createGain(); master.gain.value = 0.85;
    master.connect(comp); comp.connect(ctx.destination);
    reverb   = makeVerb(2.2, 2.6);
    hallSmall= makeVerb(0.45, 3.4);
    hallMed  = makeVerb(1.3, 2.6);
    hallLarge= makeVerb(3.6, 2.0);
  }
  function makeVerb(sec, decay){
    const cv=ctx.createConvolver();
    const len=Math.max(1,ctx.sampleRate*sec)|0, buf=ctx.createBuffer(2,len,ctx.sampleRate);
    for(let c=0;c<2;c++){const d=buf.getChannelData(c);
      for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);}
    cv.buffer=buf;
    const inG=ctx.createGain(), outG=ctx.createGain(); outG.gain.value=0.9;
    inG.connect(cv); cv.connect(outG); outG.connect(master);
    return {in:inG};
  }
  // one-off sized reverb (for the adaptive Halls room)
  function makeVerbNode(sec, decay){
    const cv=ctx.createConvolver();
    const len=Math.max(1,ctx.sampleRate*sec)|0, buf=ctx.createBuffer(2,len,ctx.sampleRate);
    for(let c=0;c<2;c++){const d=buf.getChannelData(c);
      for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);}
    cv.buffer=buf;
    // energy-normalize: a longer impulse (bigger room) has energy ∝ sec, which made the "bigger"
    // Halls pluck genuinely LOUDER — a level tell you could pick without judging the decay tail.
    // Scaling out by 1/√sec keeps loudness constant so the only cue is reverb time.
    const inG=ctx.createGain(), outG=ctx.createGain(); outG.gain.value=0.9/Math.sqrt(sec);
    inG.connect(cv); cv.connect(outG); outG.connect(master);
    return {in:inG};
  }
  function noiseBuf(sec){
    if(_noise && _noise.duration>=sec) return _noise;
    const len=(ctx.sampleRate*Math.max(sec,3))|0, b=ctx.createBuffer(1,len,ctx.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
    _noise=b; return b;
  }
  function pos(az,dist){const a=az*Math.PI/180; return {x:Math.sin(a)*dist, z:-Math.cos(a)*dist};}
  function makePanner(az,dist){
    const p=ctx.createPanner();
    p.panningModel='HRTF'; p.distanceModel='inverse'; p.refDistance=1; p.maxDistance=40; p.rolloffFactor=1.0;
    const {x,z}=pos(az,dist); p.positionX.value=x; p.positionY.value=0; p.positionZ.value=z;
    return p;
  }
  const TIMBRES={
    marimba:{wave:'sine',base:392,motif:[0,7,4,0],len:.26,rel:.28,ov:2,ovg:.25},
    bell:   {wave:'sine',base:523,motif:[0,4,7,12],len:.5,rel:.9,ov:2.7,ovg:.4},
    pluck:  {wave:'triangle',base:330,motif:[0,5,3,7],len:.22,rel:.2,ov:3,ovg:.15},
    wood:   {wave:'square',base:196,motif:[0,0,7,5],len:.16,rel:.12,ov:1,ovg:0,filt:700},
    chime:  {wave:'sine',base:1046,motif:[0,12,7],len:.3,rel:.7,ov:2.4,ovg:.3},
  };
  const T_KEYS=Object.keys(TIMBRES);
  const rndTimbre=()=>T_KEYS[Math.floor(Math.random()*T_KEYS.length)];
  const semis=(b,n)=>b*Math.pow(2,n/12);

  function makeVoice(key,az,dist,gain){
    const T=TIMBRES[key], panner=makePanner(az,dist);
    const dry=ctx.createGain(); dry.gain.value=gain; panner.connect(dry); dry.connect(master);
    const send=ctx.createGain(); send.gain.value=Math.min(.6,.1+dist*0.05); panner.connect(send); send.connect(reverb.in);
    let timer=null, stopped=true;
    function note(freq,t){
      const g=ctx.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(1,t+.008);
      g.gain.exponentialRampToValueAtTime(.0008,t+T.len+T.rel);
      let node=g;
      if(T.filt){const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=T.filt; g.connect(lp); node=lp;}
      node.connect(panner);
      const o=ctx.createOscillator(); o.type=T.wave; o.frequency.value=freq; o.connect(g); o.start(t); o.stop(t+T.len+T.rel+.05);
      if(T.ovg>0){const g2=ctx.createGain(); g2.gain.setValueAtTime(0,t); g2.gain.linearRampToValueAtTime(T.ovg,t+.008);
        g2.gain.exponentialRampToValueAtTime(.0006,t+T.len*.6+T.rel); g2.connect(panner);
        const o2=ctx.createOscillator(); o2.type='sine'; o2.frequency.value=freq*T.ov; o2.connect(g2); o2.start(t); o2.stop(t+T.len+T.rel+.05);}
    }
    function playOnce(start){let t=start; T.motif.forEach(s=>{note(semis(T.base*rvF,s),t); t+=T.len*1.02;}); return t;}
    function loop(){stopped=false; const step=()=>{if(stopped)return; const end=playOnce(ctx.currentTime+.02); timer=setTimeout(step,(end-ctx.currentTime+.32)*1000);}; step();}
    function stop(){
      stopped=true; if(timer){clearTimeout(timer);timer=null;}
      // a looped motif schedules up to ~1s of oscillators ahead; clearing the timer only stops
      // FUTURE notes, so ramp this voice's outputs to silence to kill whatever is already playing
      // the instant the listener answers — otherwise the sound "doesn't stop" and bleeds into the next round.
      try{ const now=ctx.currentTime;
        [dry,send].forEach(gn=>{ gn.gain.cancelScheduledValues(now); gn.gain.setValueAtTime(gn.gain.value, now); gn.gain.linearRampToValueAtTime(0, now+0.04); });
      }catch(e){}
    }
    function setAz(az2,ramp){const {x,z}=pos(az2,dist); const t=ctx.currentTime;
      if(ramp){ panner.positionX.linearRampToValueAtTime(x,t+ramp); panner.positionZ.linearRampToValueAtTime(z,t+ramp); }   // smooth step — 40 ms .value writes zippered
      else { panner.positionX.value=x; panner.positionZ.value=z; } }
    function glide(fromAz,toAz,dur){
      // follow the ARC, not the chord: a single Cartesian ramp cuts inside the circle, passing
      // closer to the head mid-glide (a ~4 dB loudness swell that isn't part of the motion cue).
      // Piecewise ramps along the arc stay at constant distance and remain zipper-free.
      const t=ctx.currentTime, N=8;
      for(let i=0;i<=N;i++){
        const p=pos(fromAz+(toAz-fromAz)*(i/N), dist);
        if(i===0){ panner.positionX.setValueAtTime(p.x,t); panner.positionZ.setValueAtTime(p.z,t); }
        else { panner.positionX.linearRampToValueAtTime(p.x,t+dur*i/N); panner.positionZ.linearRampToValueAtTime(p.z,t+dur*i/N); }
      }
    }
    return {loop,stop,playOnce,glide,setAz,timbre:key,az,dist};
  }

  // ---- audio primitives (each a controllable stimulus) ----
  function subTone(freq, when, dur, gain){
    // raised-cosine (Hann) attack/release, long enough that even a very low tone has NO audible
    // onset/offset click — otherwise the listener detects the click, not the bass, and the room
    // drifts to physically meaningless sub-audio frequencies.
    const g=ctx.createGain();
    const ramp=Math.min(0.3, dur*0.42), N=64, up=new Float32Array(N), dn=new Float32Array(N);
    for(let i=0;i<N;i++){ const c=0.5-0.5*Math.cos(Math.PI*i/(N-1)); up[i]=gain*c; dn[i]=gain*(1-c); }
    g.gain.setValueAtTime(0,when);
    g.gain.setValueCurveAtTime(up, when, ramp);
    g.gain.setValueCurveAtTime(dn, when+dur-ramp, ramp);
    g.connect(master);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=freq;
    o.connect(g); o.start(when); o.stop(when+dur+.05);
  }
  function pad(when,dur,gain){
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=420; lp.Q.value=.6;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when);
    g.gain.linearRampToValueAtTime(gain,when+.4);
    g.gain.setValueAtTime(gain,when+dur-.5); g.gain.linearRampToValueAtTime(0,when+dur);
    lp.connect(g); g.connect(master);
    [110,110.7,165.3].forEach(f=>{const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f; o.connect(lp); o.start(when); o.stop(when+dur+.05);});
  }
  function tick(when,gain){
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=2200;
    // 5 ms attack (not an instantaneous onset) so a faint tick isn't a broadband CLICK you can
    // detect far below where the intended level threshold sits.
    // decay target is RELATIVE to the level: the absolute .0005 floor inverted the envelope for
    // gain<.0005 (auto-widened trials for sharp ears), pinning the presented peak +up to 28 dB
    // above the level the engine believed it was testing
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(gain,when+.005); g.gain.exponentialRampToValueAtTime(Math.max(gain*0.0025,1e-7),when+.055);
    hp.connect(g); g.connect(master);
    const o=ctx.createOscillator(); o.type='square'; o.frequency.value=3000; o.connect(hp); o.start(when); o.stop(when+.07);
  }
  function grainNote(when,dirty,partialGain){
    // RMS-match the dirty note: the stray partial ADDS energy, so without compensation "impure"
    // was also slightly louder (~0.6 dB at the easy end). Scale the base tones down by the energy
    // the partial contributes (envelope-weighted; 2.42 ≈ τ3/(a1²τ1+a2²τ2) precomputed).
    const s=dirty?1/Math.sqrt(1+2.42*partialGain*partialGain):1;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.5*s,when+.01);
    g.gain.exponentialRampToValueAtTime(.0008,when+.9); g.connect(master);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=330*rvF; o.connect(g); o.start(when); o.stop(when+1);
    const g2=ctx.createGain(); g2.gain.setValueAtTime(0,when); g2.gain.linearRampToValueAtTime(.18*s,when+.01);
    g2.gain.exponentialRampToValueAtTime(.0006,when+.7); g2.connect(master);
    const o2=ctx.createOscillator(); o2.type='sine'; o2.frequency.value=660*rvF; o2.connect(g2); o2.start(when); o2.stop(when+1);
    if(dirty){
      const g3=ctx.createGain(); g3.gain.setValueAtTime(0,when); g3.gain.linearRampToValueAtTime(partialGain,when+.01);
      g3.gain.exponentialRampToValueAtTime(.0005,when+.6); g3.connect(master);
      const o3=ctx.createOscillator(); o3.type='sine'; o3.frequency.value=330*rvF*2.76; o3.connect(g3); o3.start(when); o3.stop(when+1);
    }
  }
  function hallPluck(when,hall,wet){
    const dry=ctx.createGain(); dry.gain.value=.26; dry.connect(master);
    const send=ctx.createGain(); send.gain.value=wet; send.connect(hall.in);
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(1,when+.006);
    g.gain.exponentialRampToValueAtTime(.0008,when+.35);
    g.connect(dry); g.connect(send);
    const o=ctx.createOscillator(); o.type='triangle'; o.frequency.value=440; o.connect(g); o.start(when); o.stop(when+.5);
  }
  function airChord(when,cutHz,cutDb){
    const shelf=ctx.createBiquadFilter(); shelf.type='highshelf'; shelf.frequency.value=cutHz; shelf.gain.value=cutDb;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.28,when+.06);
    g.gain.setValueAtTime(.28,when+1.4); g.gain.linearRampToValueAtTime(0,when+1.9);
    shelf.connect(g); g.connect(master);
    [440,660,880,1320,1980,2970,4455,6680].forEach((f,i)=>{
      const og=ctx.createGain(); og.gain.value=1/(i*0.9+1.2); og.connect(shelf);
      const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=f; o.connect(og); o.start(when); o.stop(when+2);});
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(2);
    const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=6000;
    const ng=ctx.createGain(); ng.gain.setValueAtTime(0,when); ng.gain.linearRampToValueAtTime(.05,when+.3); ng.gain.linearRampToValueAtTime(0,when+1.9);
    nb.connect(hp); hp.connect(ng); ng.connect(shelf); nb.start(when); nb.stop(when+2);
  }
  function warbleTone(freq,when,dur,amp){
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when);
    g.gain.linearRampToValueAtTime(amp,when+.06);
    g.gain.setValueAtTime(amp,when+dur-.08); g.gain.linearRampToValueAtTime(0,when+dur);
    g.connect(master);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=freq;
    const fm=ctx.createOscillator(); fm.frequency.value=5;
    const fg=ctx.createGain(); fg.gain.value=freq*0.025;
    fm.connect(fg); fg.connect(o.frequency);
    fm.start(when); fm.stop(when+dur+.05); o.connect(g); o.start(when); o.stop(when+dur+.05);
  }
  function shimmerBurst(f,t,dur,gain){
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(dur+.2);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=f; bp.Q.value=8;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+.08);
    g.gain.setValueAtTime(gain,t+dur-.15); g.gain.linearRampToValueAtTime(0,t+dur);
    nb.connect(bp); bp.connect(g); g.connect(master); nb.start(t); nb.stop(t+dur+.05);
  }
  function snapHit(when,attack){
    // decays end at FIXED absolute times, not attack+Δ: sliding the decay with the attack made a
    // slower attack also a LONGER (≈1–2 dB louder) event — a loudness anti-cue on the easy trials
    // that pinned the lapse dimension when a listener followed level instead of edge sharpness
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.8,when+attack);
    g.gain.exponentialRampToValueAtTime(.001,when+.36); g.connect(master);
    const o=ctx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(180,when); o.frequency.exponentialRampToValueAtTime(60,when+.25);
    o.connect(g); o.start(when); o.stop(when+.7);
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(0.3);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=3000; bp.Q.value=.7;
    const ng=ctx.createGain(); ng.gain.setValueAtTime(0,when); ng.gain.linearRampToValueAtTime(.45,when+attack); ng.gain.exponentialRampToValueAtTime(.0008,when+.12);
    nb.connect(bp); bp.connect(ng); ng.connect(master); nb.start(when); nb.stop(when+.25);
  }
  function duetChord(when,wide,detuneCents,panAmt){
    const mk=(cents,p)=>{
      const sp=ctx.createStereoPanner(); sp.pan.value=p;
      const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.2,when+.1);
      g.gain.setValueAtTime(.2,when+1.3); g.gain.linearRampToValueAtTime(0,when+1.8);
      g.connect(sp); sp.connect(master);
      const f=220*rvF*Math.pow(2,cents/1200);
      [f,f*1.5,f*2].forEach(fr=>{const o=ctx.createOscillator(); o.type='triangle'; o.frequency.value=fr; o.connect(g); o.start(when); o.stop(when+1.9);});
    };
    // Both chords carry identical spectral decorrelation (same detune magnitude) and identical
    // power; ONLY the stereo pan differs. Otherwise the narrow pair summed ~3 dB louder (coherent)
    // and you could pick "wider" by picking "quieter/less-buzzy" — an off-cue the audit caught.
    if(wide){ mk(-detuneCents,-panAmt); mk(detuneCents,panAmt); }
    else { mk(-detuneCents,0); mk(detuneCents,0); }
  }
  function flyby(when,dir,zDist,dur){
    const p=ctx.createPanner();
    p.panningModel='HRTF'; p.distanceModel='inverse'; p.refDistance=1; p.maxDistance=40; p.rolloffFactor=1.1;
    p.positionY.value=0; p.positionZ.value=-zDist;
    p.positionX.setValueAtTime(dir*-9,when);
    p.positionX.linearRampToValueAtTime(dir*9,when+dur);
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1400;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.9,when+.15);
    g.gain.setValueAtTime(.9,when+dur-.15); g.gain.linearRampToValueAtTime(0,when+dur);
    lp.connect(g); g.connect(p);
    const dry=ctx.createGain(); dry.gain.value=1; p.connect(dry); dry.connect(master);
    [150,150.8].forEach(base=>{
      const o=ctx.createOscillator(); o.type='sawtooth';
      o.frequency.setValueAtTime(base*1.06,when);
      o.frequency.setValueAtTime(base*1.06,when+dur*0.42);
      o.frequency.linearRampToValueAtTime(base*0.94,when+dur*0.58);
      o.connect(lp); o.start(when); o.stop(when+dur+.05);
    });
  }
  function clickEcho(when,delaySec){
    const mkClick=(t,gain,dull)=>{
      const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(0.1);
      const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=dull?1800:8000;
      const g=ctx.createGain(); g.gain.setValueAtTime(gain,t); g.gain.exponentialRampToValueAtTime(.0006,t+.06);
      nb.connect(f); f.connect(g); g.connect(master); nb.start(t); nb.stop(t+.1);
    };
    mkClick(when,.7,false);
    mkClick(when+delaySec,.32,true);
  }
  function dynNote(when,gainDb){
    // base level sits below the safety limiter knee so the dB difference is reproduced exactly
    const g=ctx.createGain(); const amp=.28*Math.pow(10,gainDb/20);
    g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(amp,when+.015);
    g.gain.exponentialRampToValueAtTime(.0008,when+.8); g.connect(master);
    [392,784].forEach((f,i)=>{const og=ctx.createGain(); og.gain.value=i?0.3:1; og.connect(g);
      const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=f*rvF; o.connect(og); o.start(when); o.stop(when+.9);});
  }
  function silenceTail(when,hissGain){
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.45,when+.01);
    g.gain.exponentialRampToValueAtTime(.0008,when+.5); g.connect(master);
    const o=ctx.createOscillator(); o.type='triangle'; o.frequency.value=523*rvF; o.connect(g); o.start(when); o.stop(when+.6);
    if(hissGain>0){
      const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(2.5);
      const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=4000; bp.Q.value=.4;
      const ng=ctx.createGain(); ng.gain.setValueAtTime(0,when+.3); ng.gain.linearRampToValueAtTime(hissGain,when+.6);
      ng.gain.setValueAtTime(hissGain,when+2.0); ng.gain.linearRampToValueAtTime(0,when+2.2);
      nb.connect(bp); bp.connect(ng); ng.connect(master); nb.start(when+.3); nb.stop(when+2.3);
    }
  }
  function pulsePattern(when,lateIdx,lateMs){
    const step=.32;
    for(let i=0;i<6;i++){
      const t=when+i*step+(i===lateIdx?pulseSign*lateMs/1000:0);
      const g=ctx.createGain(); g.gain.setValueAtTime(.5,t); g.gain.exponentialRampToValueAtTime(.0006,t+.12);
      const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1200;
      lp.connect(g); g.connect(master);
      const o=ctx.createOscillator(); o.type='square'; o.frequency.value=220*rvF; o.connect(lp); o.start(t); o.stop(t+.15);
    }
  }
  function bassNote(when,dirty,amt){
    // amt (bloom, 0..~.5) scales EVERY cue so the room measures the real bloom threshold instead of
    // a fixed on/off envelope. a=0 → tight note that stops dead; larger a → longer overhang, a
    // level wobble, and low overtones. At threshold (tiny a) it's barely distinguishable from tight.
    const a = dirty ? amt : 0;
    const end = when + .7 + a*1.3;                     // more bloom = longer ring-on (stays inside the slot)
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.85,when+.02);
    g.gain.setValueAtTime(.85,when+.2);
    // BOTH notes share the same envelope timeline — the old `if(a>0.001)` gate gave the altered
    // note a 0.42 s longer sustain even at vanishing amt, a FIXED structural cue that made the
    // room trivially easy below its intended range. Now every bloom cue (sag depth, overtones,
    // ring-on length) scales continuously with amt and vanishes as amt → 0.
    g.gain.linearRampToValueAtTime(.85-a*0.6, when+.42);    // sag… (flat hold when a=0)
    g.gain.linearRampToValueAtTime(.85-a*0.25, when+.62);   // …partial recovery (the wobble)
    g.gain.exponentialRampToValueAtTime(.001, end);
    g.connect(master);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=55*rvF; o.connect(g); o.start(when); o.stop(end+.1);
    if(a>0.001){
      [110,165].forEach((f,i)=>{const hg=ctx.createGain(); hg.gain.setValueAtTime(0,when); hg.gain.linearRampToValueAtTime(a/(i+1),when+.03);
        hg.gain.exponentialRampToValueAtTime(.0006,end); hg.connect(master);
        const ho=ctx.createOscillator(); ho.type='sine'; ho.frequency.value=f*rvF; ho.connect(hg); ho.start(when); ho.stop(end+.1);});
    }
  }
  function centreNote(when,panOff){
    const sp=ctx.createStereoPanner(); sp.pan.value=panOff;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.4,when+.03);
    g.gain.setValueAtTime(.4,when+1.0); g.gain.linearRampToValueAtTime(0,when+1.3);
    g.connect(sp); sp.connect(master);
    [494,988].forEach((f,i)=>{const og=ctx.createGain(); og.gain.value=i?.25:1; og.connect(g);
      const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=f*rvF; o.connect(og); o.start(when); o.stop(when+1.4);});
  }
  function silkPhrase(when,sibGain){
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.3,when+.05);
    g.gain.setValueAtTime(.3,when+.85); g.gain.linearRampToValueAtTime(0,when+1.05); g.connect(master);
    const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=220*rvF;   // carrier roves; the 7 kHz sibilance band (the measured variable's home) stays put
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1200;
    o.connect(lp); lp.connect(g); o.start(when); o.stop(when+1.1);
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(0.6);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=7000; bp.Q.value=1.2;
    const ng=ctx.createGain(); ng.gain.setValueAtTime(0,when+.9); ng.gain.linearRampToValueAtTime(sibGain,when+1.0);
    ng.gain.linearRampToValueAtTime(0,when+1.3);
    nb.connect(bp); bp.connect(ng); ng.connect(master); nb.start(when+.9); nb.stop(when+1.35);
  }
  function presenceVoice(when,cutDb){
    const peak=ctx.createBiquadFilter(); peak.type='peaking'; peak.frequency.value=1800; peak.Q.value=.9; peak.gain.value=cutDb;
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=3800;
    // compensate the energy the scoop removes, so the scooped voice isn't simply QUIETER — the cue
    // should be the veiled timbre, not a ~0.5 dB level difference you could pick on instead.
    const lvl=.3*Math.pow(10, Math.abs(cutDb)*0.08/20);
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(lvl,when+.06);
    g.gain.setValueAtTime(lvl,when+1.2); g.gain.linearRampToValueAtTime(0,when+1.5);
    peak.connect(lp); lp.connect(g); g.connect(master);
    const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=196*rvF;   // carrier roves per trial (the 1.8 kHz scoop is the measured variable and stays put)
    const vib=ctx.createOscillator(); vib.frequency.value=5; const vg=ctx.createGain(); vg.gain.value=3;
    vib.connect(vg); vg.connect(o.frequency); vib.start(when); vib.stop(when+1.6);
    o.connect(peak); o.start(when); o.stop(when+1.6);
  }
  function makeDriveCurve(k){
    const n=1024, c=new Float32Array(n);
    for(let i=0;i<n;i++){const x=i/(n-1)*2-1; c[i]=k?Math.tanh(k*x)/Math.tanh(k):x;}
    return c;
  }
  // one 55 Hz-period probe matching the REAL Composure chord (3 band-limited saws at .33): the
  // trim must be calibrated on a signal with the chord's own crest factor. Calibrating on a sine
  // (crest 1.41 vs the chord's ~2.8) under-corrected, leaving the driven interval up to ~1.9 dB
  // LOUDER than the clean one over the top half of the range — a loudness cue wearing a
  // distortion label, in a room that asks "which stayed clean?".
  const DRIVE_PROBE=(()=>{ const N=1024, H=24, p=new Float32Array(N);
    for(let i=0;i<N;i++){ const t=i/N; let x=0;
      for(const m of [2,3,4])                    // 110/165/220 Hz = 2/3/4 × the 55 Hz common period
        for(let h=1;h<=H;h++) x+=.33*(2/Math.PI)*Math.sin(2*Math.PI*m*h*t)/h;
      p[i]=x; }
    return p; })();
  function driveTrim(k){
    // soft-clipping raises RMS at equal peak — trim the driven chord back to the clean level
    if(!k) return 1;
    let se=0, ce=0;
    for(let i=0;i<DRIVE_PROBE.length;i++){const x=DRIVE_PROBE[i]; const y=Math.tanh(k*x)/Math.tanh(k); se+=x*x; ce+=y*y;}
    return Math.sqrt(se/ce);
  }
  function composureChord(when,drive){
    const sh=ctx.createWaveShaper(); sh.curve=makeDriveCurve(drive); sh.oversample='4x';   // suppress the shaper's own aliasing — it added inharmonic hash that wasn't the distortion under test
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=5000;
    const lvl=.55*driveTrim(drive);
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(lvl,when+.05);
    g.gain.setValueAtTime(lvl,when+1.3); g.gain.linearRampToValueAtTime(0,when+1.6);
    sh.connect(lp); lp.connect(g); g.connect(master);
    [110,165,220].forEach(f=>{const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f*rvF;
      const og=ctx.createGain(); og.gain.value=.33; o.connect(og); og.connect(sh); o.start(when); o.stop(when+1.7);});
  }
  function marker(t){
    const g=ctx.createGain(); g.gain.setValueAtTime(.06,t); g.gain.exponentialRampToValueAtTime(.0005,t+.04);
    g.connect(master);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=880; o.connect(g); o.start(t); o.stop(t+.06);
  }
  // pure sine at an absolute digital level (dBFS) — the audiogram detection stimulus. pan:
  // -1 = left ear only, +1 = right ear only (equal-power StereoPanner → the off-ear gets zero),
  // 0/undefined = both. Per-ear isolation is what lets the test see a left/right difference.
  // Raised-cosine (Hann) edges: a linear ramp's spectral splatter can make the ONSET audible when
  // the tone itself isn't — especially at low frequencies — which corrupts the threshold.
  const HANN_N=24, HANN_RISE=Float32Array.from({length:HANN_N},(_,i)=>0.5*(1-Math.cos(Math.PI*i/(HANN_N-1))));
  function detTone(freq, when, dur, dbfs, pan){
    const amp=Math.pow(10, dbfs/20), Rm=Math.min(.045, dur/3);
    const rise=HANN_RISE.map(v=>v*amp), fall=rise.slice().reverse();
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when);
    g.gain.setValueCurveAtTime(rise, when, Rm);
    g.gain.setValueCurveAtTime(fall, when+dur-Rm, Rm);
    if(pan){ const sp=ctx.createStereoPanner(); sp.pan.value=pan; g.connect(sp); sp.connect(master); }
    else g.connect(master);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=freq; o.connect(g); o.start(when); o.stop(when+dur+.05);
  }
  // contralateral masking for per-ear runs: matched-band noise in the NON-test ear. Physics: with
  // headphones, a loud tone reaches the far cochlea through the skull attenuated ~45+ dB — the good
  // ear "shadow-hears" and answers for the weak one, capping any measurable left/right gap. A mask
  // riding 18 dB below the tone sits well ABOVE that crossover (so the far ear can't help) while its
  // own crossover back into the test ear lands ~63 dB under the tone (so it can never mask the test).
  function detMask(freq, when, dur, dbfs, pan){
    const amp=Math.pow(10, dbfs/20);
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(dur+.3);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq; bp.Q.value=1;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(amp,when+.06);
    g.gain.setValueAtTime(amp,when+dur-.08); g.gain.linearRampToValueAtTime(0,when+dur);
    const sp=ctx.createStereoPanner(); sp.pan.value=pan;
    nb.connect(bp); bp.connect(g); g.connect(sp); sp.connect(master);
    nb.start(when); nb.stop(when+dur+.05);
  }
  // ---- calibration-robust masked detection: a tone hidden inside a band of noise centred on it.
  // WHY THIS ROOM IS DIFFERENT: the tone and its masker occupy the same narrow band and pass
  // through the same transducer at the same instant, so what's measured is a RATIO — turn the
  // volume up and both move together. Output-level error, and most of the headphone's frequency
  // response, divide out. That is the property that lets speech-in-noise screens work on
  // uncalibrated consumer headphones, and it's the one measurement here that barely cares that
  // the browser has no SPL reference. (The per-trial level rove rides on top of this: both the
  // tone and its masker pass through the same output gain, so the ratio is untouched by it.)
  const SNR_F=1000, SNR_A=0.16, SNR_Q=1.2;   // 1 kHz tone in a ~1-octave band of noise around it
  // Band-passing white noise strips most of its power, so the raw amplitude parameter is NOT the
  // acoustic ratio. TONE_K was MEASURED offline (OfflineAudioContext, masker RMS vs tone RMS):
  // without it the parameter ran +14.8 dB hot and the room's range sat entirely below threshold.
  // With it, the level parameter IS the true tone-RMS / masker-RMS ratio, so the reported "−8 dB
  // vs noise" is a real signal-to-noise ratio. (Nyquist-dependent to ~0.4 dB between 44.1/48 kHz.)
  const SNR_TONE_K=0.182;
  let snrOff=0;
  let pulseIdx=3, pulseSign=1;                        // Pulse room: anomalous-beat slot + late/early, frozen per trial
  function snrFreeze(){ snrOff=Math.random()*0.9; }   // one masker realisation per TRIAL, shared by A and B
  function snrMasked(t, dur, ratio, withTone){
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(3.2);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=SNR_F; bp.Q.value=SNR_Q;
    const ng=ctx.createGain(); ng.gain.setValueAtTime(0,t); ng.gain.linearRampToValueAtTime(SNR_A,t+.06);
    ng.gain.setValueAtTime(SNR_A,t+dur-.08); ng.gain.linearRampToValueAtTime(0,t+dur);
    nb.connect(bp); bp.connect(ng); ng.connect(master);
    nb.start(t, snrOff); nb.stop(t+dur+.05);
    if(!withTone) return;
    const amp=SNR_A*SNR_TONE_K*ratio, td=0.45;
    const on=t+0.35+Math.random()*Math.max(0.05,(dur-1.0));   // random onset inside the masker — no timing tell
    const rise=HANN_RISE.map(v=>v*amp), fall=HANN_RISE.map(v=>v*amp).reverse();
    const g=ctx.createGain(); g.gain.setValueAtTime(0,on);
    g.gain.setValueCurveAtTime(rise, on, .03);
    g.gain.setValueCurveAtTime(fall, on+td-.03, .03);
    g.connect(master);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=SNR_F; o.connect(g); o.start(on); o.stop(on+td+.05);
  }
  // short neutral noise wash between the two intervals — a "palate cleanser" that resets
  // the ear (releases forward masking) so A and B are judged fresh. Optional.
  function interNoise(when, dur){
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(dur+.2);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1400; bp.Q.value=.5;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.09,when+.05);
    g.gain.setValueAtTime(.09,when+dur-.06); g.gain.linearRampToValueAtTime(0,when+dur);
    nb.connect(bp); bp.connect(g); g.connect(master); nb.start(when); nb.stop(when+dur+.05);
  }
  // sized reverberant pluck for adaptive Halls: bigger 'sec' = bigger room
  function hallPluckSec(when,sec){
    const v=makeVerbNode(sec, 2.4);
    const dry=ctx.createGain(); dry.gain.value=.26; dry.connect(master);
    const send=ctx.createGain(); send.gain.value=.5; send.connect(v.in);
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(1,when+.006);
    g.gain.exponentialRampToValueAtTime(.0008,when+.35);
    g.connect(dry); g.connect(send);
    const o=ctx.createOscillator(); o.type='triangle'; o.frequency.value=440*rvF; o.connect(g); o.start(when); o.stop(when+.5);
  }
  // short HRTF-placed ping marking the true position after a spatial guess — a single ~0.4s tone
  // instead of a full 2-3s motif, so the confirmation can't overlap the next round's stimulus.
  function landingPing(az,dist,when){
    const p=makePanner(az,dist);
    const out=ctx.createGain(); out.gain.value=.5; p.connect(out); out.connect(master);
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.6,when+.02); g.gain.exponentialRampToValueAtTime(.0006,when+.4);
    g.connect(p);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=560; o.connect(g); o.start(when); o.stop(when+.45);
    const g2=ctx.createGain(); g2.gain.setValueAtTime(0,when); g2.gain.linearRampToValueAtTime(.14,when+.02); g2.gain.exponentialRampToValueAtTime(.0004,when+.3);
    g2.connect(p); const o2=ctx.createOscillator(); o2.type='sine'; o2.frequency.value=1120; o2.connect(g2); o2.start(when); o2.stop(when+.35);
  }

  // ---------- room table (behaviour) ----------
  // mode: 'stair' = adaptive 2AFC (ZEST); 'locate'/'sweep'/'orbit'/'depth'/'separate' = adaptive spatial;
  // 'count' = adaptive counting. Descriptive content merged from content.js by tag.
  const CH=[
    {group:'holo',tag:'Stage',title:'Point at the singer',tests:'soundstage width',mode:'locate',
     claim:'A great headphone paints instruments across a stage — you can point at each one.',
     learn:'Your brain places sound by comparing microsecond timing and level differences between your ears. Clean drivers keep those cues intact; sloppy ones blur the map.',
     notice:'One sound sits on the arc ahead. <b>Tap where you hear it</b> — one tap, no dragging. It tightens as you close in.'},
    {group:'holo',tag:'Motion',title:'Track the mover',tests:'imaging precision',mode:'sweep',
     claim:'Pinpoint imaging: when a sound moves, you can follow it like watching it.',
     learn:'Smooth motion means the inter-ear cues update without smearing. A blurry transducer turns a moving point into a travelling cloud.',
     notice:'A sound glides across the stage, then stops. <b>Tap where it landed.</b>'},
    {group:'holo',tag:'Centre',title:'Lock the vocalist',tests:'channel matching',mode:'stair',
     claim:'A perfectly matched pair nails the voice dead centre — zero drift.',
     learn:'A centre image only forms when left and right drivers match within about 1 dB. Any mismatch drags the vocalist off their stool. B&W hand-match pairs for exactly this.',
     notice:'The same note twice — one dead centre, one pulled aside. <b>Tap the one that stayed centred.</b>'},
    {group:'holo',tag:'Orbit',title:'Around your head',tests:'true holography',mode:'orbit',
     claim:'True holography: the music exists around you, not inside your skull.',
     learn:'Front vs back is the hardest cue — it lives in how your outer ear filters treble. Motion rescues it: your brain tracks the path continuously. A mirrored miss is a famous illusion, not a failure.',
     notice:'It circles your whole head — behind you too — then stops. <b>Tap the ring where it landed.</b> Eyes closed.'},
    {group:'holo',tag:'Depth',title:'Front row, back row',tests:'layering',mode:'depth',
     claim:'Layering: a good mix has a front row and a back row, and you can seat everyone.',
     learn:'Distance is decoded from cues that move together: how loud a sound arrives, and how much room reverb rides along with it — closer is louder and drier.',
     notice:'A sound plays near or far. <b>Tap the inner ring for near, the outer for far</b> — aimed at its direction.'},
    {group:'holo',tag:'Flyby',title:'How close did it pass?',tests:'distance rendering',mode:'stair',
     claim:'Distance is rendered, not implied — near and far are different physical things.',
     learn:'A pass distance is read from the loudness swell — how sharply it rises and falls as it crosses your stage. The pitch bend sells the motion; the swell carries the answer.',
     notice:'Two vehicles cross your stage, bending pitch as they pass. <b>Tap the one that passed closer.</b>'},
    {group:'holo',tag:'Echo',title:'Hear the walls',tests:'spatial cues',mode:'stair',
     claim:'Good transducers preserve the room’s reflections — you can hear the walls.',
     learn:'Your brain times the gap from click to reflection: roughly 6 ms per metre of wall distance, there and back. You were literally echolocating.',
     notice:'A click, then its echo — twice. A longer gap means a farther wall. <b>Tap the further wall.</b>'},
    {group:'holo',tag:'Duet',title:'Wall to wall',tests:'stereo width',mode:'stair',
     claim:'Width: the mix stretches ear to ear and past your shoulders.',
     learn:'Width is decorrelation — small deliberate differences between channels. Strong channel separation in the headphone keeps them from collapsing back toward mono.',
     notice:'The same chord twice — one wide, one narrow. <b>Tap the wider one.</b>'},
    {group:'res',tag:'Separation',title:'Pick one voice out',tests:'instrument separation',mode:'separate',
     claim:'Each instrument keeps its own pocket of space — nothing smears together.',
     learn:'Separation is position plus timbre staying stable per source. When drivers distort, sources bleed into each other and the mix turns to porridge.',
     notice:'Three sounds at once. You’ll hear your target alone first — then <b>tap it out of the crowd.</b>'},
    {group:'res',tag:'Crowd',title:'Count the ensemble',tests:'no congestion',mode:'count',
     claim:'A busy passage never collapses into mush — the mix stays countable.',
     learn:'Congestion is where busy mixes fold first: as voices stack up they mask and blur into one another. Countability is the bluntest possible test of whether each keeps its own place.',
     notice:'A small ensemble plays together, spread across the stage. <b>Tap how many voices you count.</b>'},
    {group:'res',tag:'Whisper',title:'Details under the music',tests:'detail retrieval',mode:'stair',
     claim:'You hear things in familiar albums you never knew were there.',
     learn:'Low-level detail rides 20–30 dB beneath the music. Low driver distortion and noise keep it audible instead of buried — that’s "detail retrieval".',
     notice:'A warm pad plays twice; one hides a faint tick. <b>Tap the one with the tick.</b>'},
    {group:'res',tag:'Silence',title:'The black background',tests:'noise floor',mode:'stair',
     claim:'Between the notes: true black. No hiss, no veil, just nothing.',
     learn:'"Black background" is a low noise floor — nothing added beneath quiet passages. You just resolved near-silence, which is exactly what the phrase means.',
     notice:'A note, then silence — twice. One silence hides a faint hiss. <b>Tap the one that hid it.</b>'},
    {group:'res',tag:'Digits',title:'Three digits in the noise',tests:'speech in noise',mode:'digits',
     claim:'The everyday test: following a voice while noise tries to bury it.',
     learn:'Three spoken digits play inside babble made from the same voice, and the measured number is the signal-to-noise ratio where you still catch all three. Speech and noise ride the same chain at the same instant, so this reading barely cares that nothing is calibrated — it is the sturdiest number in the whole app.',
     notice:'Noise, with three digits spoken inside it. <b>Tap the three digits you heard, in order.</b>'},
    {group:'res',tag:'Noise',title:'In the noise',tests:'signal in noise',mode:'stair',
     claim:'Clarity: a signal stays findable even when noise is trying to bury it.',
     learn:'Your ear analyses sound in narrow bands, and a tone becomes audible once it rises far enough above the noise inside its own band. Because the tone and the noise travel the same path at the same moment, this reading barely moves when you change the volume — it is the one measurement here that hardly cares about calibration.',
     notice:'Two bursts of noise — one hides a steady tone inside it. <b>Tap the burst that held the tone.</b>'},
    {group:'res',tag:'Grain',title:'Spot the impostor',tests:'timbre resolution',mode:'stair',
     claim:'Timbre is texture — and you can hear when a note’s texture is even slightly off.',
     learn:'Timbre lives in the balance of overtones. The impostor carried one stray partial at ~2.8× the fundamental — the sound of texture being subtly wrong.',
     notice:'The same note twice — one pure, one with a faint stray overtone. <b>Tap the pure one.</b>'},
    {group:'res',tag:'Halls',title:'How the note dies',tests:'decay resolution',mode:'stair',
     claim:'Notes don’t stop — they fade into a space, and you can hear the size of it.',
     learn:'A reverb tail falls some 60 dB into silence. Resolving where it ends — and how big the room was — is the classic test of low-level linearity.',
     notice:'The same pluck in two rooms. <b>Tap the bigger room</b> — it rings on longer.'},
    {group:'res',tag:'Composure',title:'Loud stays clean',tests:'low distortion',mode:'stair',
     claim:'Push it hard and it never hardens — composure under pressure.',
     learn:'Overdrive a bad driver and it clips: harmonics appear that were never in the music, heard as hardness or glare. Composure means loud and clean are the same thing.',
     notice:'The same big chord twice — one hardens and buzzes. <b>Tap the one that stayed clean.</b>'},
    {group:'tone',tag:'Foundation',title:'The floor beneath',tests:'sub-bass extension',mode:'stair',
     claim:'Real extension: bass you feel in your jaw, below what most gear can even produce.',
     learn:'Below ~40 Hz most gear rolls off and you only hear overtones. This room hunts your exact floor: the lowest frequency this chain — headphone plus your ears — still delivers.',
     notice:'Two intervals; one hides a low tone. <b>Tap the one that held it.</b> Each catch drives it deeper. Moderate volume.'},
    {group:'tone',tag:'Grip',title:'Taut, not flabby',tests:'bass control',mode:'stair',
     claim:'Bass with grip: taut and textured, never a shapeless boom.',
     learn:'Loose bass is an envelope problem: the cone keeps moving after the note should stop. Grip is a fast start AND a fast stop — extension’s stricter sibling.',
     notice:'Two bass notes — one taut, one blooming. <b>Tap the tighter one.</b>'},
    {group:'tone',tag:'Presence',title:'The voice in the room',tests:'midrange truth',mode:'stair',
     claim:'Honest mids put the singer in the room; scooped mids put them behind glass.',
     learn:'Voices live at 1–3 kHz. Cut that band and a singer steps backward and loses body — the "veiled" sound. Honest mids are why some gear feels intimate.',
     notice:'The same voice twice — one hollowed out, one full. <b>Tap the one in the room with you.</b>'},
    {group:'tone',tag:'Air',title:'Room to breathe',tests:'treble extension',mode:'stair',
     claim:'Air: the openness above the music, the shimmer that cheap gear shaves off.',
     learn:'The top octave (8 kHz and up) carries shimmer, space and "air". Roll it off and music breathes less — even when you can’t name what went missing.',
     notice:'Two intervals; one holds a faint high shimmer. <b>Tap the one that held it.</b> It climbs higher each catch.'},
    {group:'tone',tag:'Silk',title:'Smooth, never sharp',tests:'sibilance control',mode:'stair',
     claim:'Treble with silk: all the sparkle, none of the needle in the "s".',
     learn:'Sibilance is an energy spike near 6–8 kHz that turns an "s" into a stab. Smooth treble keeps the energy without the pain — the hardest tuning balance there is.',
     notice:'A voice-like phrase ending in "ss" — twice. <b>Tap the one whose "s" stabbed.</b>'},
    {group:'tone',tag:'Hearing',title:'Your hearing curve',tests:'hz × db response',mode:'curve',
     claim:'Your ears and these headphones share one frequency response — and you can measure its shape.',
     learn:'This is the idea behind Samsung’s Adapt Sound: at nine pitches from deep bass to high treble it finds the quietest tone you can hear, then plots the shape relative to 1 kHz. Dips are bands this pair — or your own ears, up high — render quieter.',
     notice:'Nine pitches, low to high. For each, <b>tap the interval that held the faint tone.</b> Set volume on the 1 kHz tone first.'},
    {group:'dyn',tag:'Snap',title:'Slam',tests:'transient attack',mode:'stair',
     claim:'Slam: a drum hit arrives instantly, with edges — that’s driver control.',
     learn:'A real transient rises in under a millisecond. Reproducing that edge takes a light, stiff, well-damped driver — exactly what exotic cone materials are for.',
     notice:'Two drum hits — one strikes instantly, one eases in. <b>Tap the one that truly hit.</b>'},
    {group:'dyn',tag:'Pulse',title:'The tight groove',tests:'timing · prat',mode:'stair',
     claim:'Pace, rhythm and timing: the groove locks, and nothing drags.',
     learn:'Humans detect timing errors down to ~10 ms. "PRaT" is gear preserving every attack edge so the groove stays locked instead of shuffling.',
     notice:'Two short grooves; in one, a beat lands late. <b>Tap the tight groove.</b>'},
    {group:'dyn',tag:'Shade',title:'Loud and louder',tests:'micro-dynamics',mode:'stair',
     claim:'Micro-dynamics: the difference between loud and slightly louder is where expression lives.',
     learn:'A performer’s expression is 1–2 dB shadings between notes. Any compression in the chain flattens those gradations into sameness.',
     notice:'The same note twice, at slightly different levels. <b>Tap the louder one.</b>'},
  ];
  const ROMANS=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV','XXVI','XXVII'];
  const DEVCOLORS=['#7BA79C','#E27A45','#D9A24B','#B7A6E3'];

  // ---------- adaptive 2AFC staircase params + stimulus (keyed by tag) ----------
  // type D: one interval holds the stimulus (pick it). type X: both play; one is altered.
  // play(level, t, flag): D → flag=stimulus present; X → flag=this interval is the altered one.
  const ADAPT={
    Foundation:{type:'D', q:'Which held a tone?', dur:1.4, start:40, floor:16, ceil:63, hard:.90, easy:1.15, log:true, betterHigh:false, anchors:[50,20], physLo:16, fmt:v=>Math.round(v)+' Hz',
      play:(lv,t,on)=>{marker(t); if(on) subTone(lv, t+.12, 1.15, lv<45?.85:.7);}},
    Air:{type:'D', q:'Which held a shimmer?', dur:1.1, start:13000, floor:8000, ceil:20000, hard:1.08, easy:.88, log:true, betterHigh:true, anchors:[10000,17000], physLo:7000, physHi:20500, fmt:v=>(v/1000).toFixed(1)+' kHz',
      // warble tone, not bandpassed noise: the Q=8 noise skirts leaked audible energy well BELOW
      // the nominal frequency, so listeners detected the skirt and the treble ceiling read high.
      // A frequency-modulated sine (±2.5% at 5 Hz — standard audiometric warble) has no skirts.
      play:(lv,t,on)=>{marker(t); if(on) warbleTone(lv, t+.15, .8, .16);}},
    Whisper:{type:'D', q:'Which pad hid a tick?', dur:1.7, start:.04, floor:.002, ceil:.2, hard:.78, easy:1.5, log:true, betterHigh:false, anchors:[.04,.008], physLo:0.00002, fmt:v=>Math.round(20*Math.log10(.2/v))+' dB under',
      play:(lv,t,on)=>{pad(t,1.6,.2); if(on) tick(t+.5+Math.random()*.7, lv);}},
    Silence:{type:'X', q:'Which hid a hiss?', dur:2.4, answerAltered:true, start:.04, floor:.004, ceil:.1, hard:.72, easy:1.6, log:true, betterHigh:false, anchors:[.05,.006], physLo:0.000045, fmt:v=>Math.round(20*Math.log10(v/.45))+' dB',
      play:(lv,t,alt)=>silenceTail(t, alt?lv:0)},
    // level here is the TONE/MASKER amplitude ratio — a ratio, so it survives the missing
    // calibration. physLo guards the physical limit: no ear detects a tone arbitrarily far
    // below noise in its own critical band.
    // range set from the measured calibration: a tone in same-band noise is typically detected
    // near −8 dB SNR, so start at 0 dB (clearly audible), anchor weak/reference at +4 / −20 dB,
    // and clamp at −24 dB — below any plausible masked threshold.
    Noise:{type:'D', q:'Which held a tone?', dur:2.0, start:1.0, floor:.05, ceil:4.0, hard:.85, easy:1.35, log:true, betterHigh:false, anchors:[1.6,.10], physLo:0.06,
      fmt:v=>Math.round(20*Math.log10(Math.max(v,1e-4)))+' dB vs noise',
      onTrial:()=>snrFreeze(),
      play:(lv,t,on)=>snrMasked(t, 2.0, lv, on)},
    Grain:{type:'X', q:'Which was pure?', dur:1.15, answerAltered:false, start:.1, floor:.008, ceil:.35, hard:.78, easy:1.4, log:true, betterHigh:false, anchors:[.15,.02], physLo:0.005, fmt:v=>'partial '+Math.round(v*100)+'%',
      play:(lv,t,alt)=>grainNote(t, alt, lv)},
    // fmt maps drive k → measured %THD of tanh soft-clip on a sine (harmonic projection, 8 harmonics):
    // "~25% THD" is a real number an engineer can check; "drive 3.0" was an internal knob
    Composure:{type:'X', q:'Which stayed clean?', dur:1.8, answerAltered:false, start:4.5, floor:.5, ceil:9, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[5,.8], physLo:0.15,
      fmt:v=>{const T=[[0.15,0.19],[0.3,0.73],[0.5,1.96],[0.8,4.61],[1.2,8.92],[2,17.3],[3,25.0],[4.5,31.7],[6,35.2],[9,38.3]];
        let i=0; while(i<T.length-1&&T[i+1][0]<v)i++;
        const [k0,t0]=T[i],[k1,t1]=T[Math.min(i+1,T.length-1)];
        const t=k1===k0?t0:t0+(t1-t0)*(v-k0)/(k1-k0);
        return '~'+(t<1?t.toFixed(1):Math.round(t))+'% THD';},
      play:(lv,t,alt)=>composureChord(t, alt?lv:0)},
    Grip:{type:'X', q:'Which was tighter?', dur:1.7, answerAltered:false, start:.15, floor:.02, ceil:.5, hard:.8, easy:1.4, log:true, betterHigh:false, anchors:[.35,.06], physLo:0.02, fmt:v=>'bloom '+Math.round(v*100)+'%',
      play:(lv,t,alt)=>bassNote(t, alt, lv)},
    Presence:{type:'X', q:'Which was in the room?', dur:1.7, answerAltered:false, start:2.5, floor:.5, ceil:6, hard:.8, easy:1.35, log:false, betterHigh:false, anchors:[5,1], physLo:0.5, fmt:v=>v.toFixed(1)+' dB scoop',
      play:(lv,t,alt)=>presenceVoice(t, alt?-lv:0)},
    Silk:{type:'X', q:'Which "s" stabbed?', dur:1.5, answerAltered:true, start:.1, floor:.005, ceil:.35, hard:.78, easy:1.4, log:true, betterHigh:false, anchors:[.15,.02], physLo:0.005, fmt:v=>'+'+Math.round(20*Math.log10((0.05+v)/0.05))+' dB sib',
      play:(lv,t,alt)=>silkPhrase(t, .05+(alt?lv:0))},
    Snap:{type:'X', q:'Which truly hit?', dur:.9, answerAltered:false, start:.035, floor:.004, ceil:.08, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[.04,.006], physLo:0.002, fmt:v=>Math.round(v*1000)+' ms attack',
      play:(lv,t,alt)=>snapHit(t, alt?lv:.001)},
    // the anomalous beat's position AND direction (late/early) re-randomise per trial — a fixed
    // "beat 4 is always late" was learnable without listening to the timing at all
    Pulse:{type:'X', q:'Which groove was tight?', dur:2.15, answerAltered:false, start:40, floor:5, ceil:80, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[45,8], physLo:6, fmt:v=>Math.round(v)+' ms',
      onTrial:()=>{ pulseIdx=2+Math.floor(Math.random()*3); pulseSign=Math.random()<.5?-1:1; },
      play:(lv,t,alt)=>pulsePattern(t, pulseIdx, alt?lv:0)},
    Shade:{type:'X', q:'Which was louder?', dur:.95, answerAltered:true, start:1.5, floor:.3, ceil:4, hard:.8, easy:1.4, log:true, betterHigh:false, anchors:[3,.5], physLo:0.25, fmt:v=>v.toFixed(2)+' dB',
      play:(lv,t,alt)=>dynNote(t, alt?lv:0)},
    // fmt reports the interaural LEVEL difference the pan offset creates (equal-power law:
    // ILD = 20·log10(tan((1+p)·π/4))) — "0.9 dB off" matches the literature's ~1 dB claim the
    // room's copy cites; "28% off" was an internal knob reading
    Centre:{type:'X', q:'Which sat dead centre?', dur:1.5, answerAltered:false, start:.25, floor:.03, ceil:.5, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[.28,.05], physLo:0.02, physHi:1.0,
      fmt:v=>{const p=Math.min(v,0.98); return (20*Math.log10(Math.tan((1+p)*Math.PI/4))).toFixed(1)+' dB off';},
      play:(lv,t,alt)=>centreNote(t, alt?(Math.random()<.5?1:-1)*lv:0)},
    Duet:{type:'X', q:'Which felt wider?', dur:2.0, answerAltered:true, start:.8, floor:.1, ceil:1, hard:.72, easy:1.5, log:true, betterHigh:false, anchors:[.9,.15], physLo:0.04, physHi:1.111, fmt:v=>'width '+Math.round(v*100)+'%',
      play:(lv,t,alt)=>duetChord(t, alt, 12*lv, .9*lv)},
    Echo:{type:'X', q:'Which wall was further?', dur:.85, answerAltered:true, start:.1, floor:.012, ceil:.3, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[.12,.02], physLo:0.006, fmt:v=>'+'+Math.round(v*1000)+' ms',
      play:(lv,t,alt)=>clickEcho(t, .12+(alt?lv:0))},
    // newly-adaptive 2AFC rooms
    Flyby:{type:'X', q:'Which passed closer?', answerAltered:true, start:2.2, floor:1.06, ceil:6, hard:.9, easy:1.4, log:true, betterHigh:false, anchors:[3.2,1.2], physLo:1.0, physHi:5.5, fmt:v=>v.toFixed(1)+'× gap', dur:2.6,
      play:(lv,t,alt)=>{const far=5.5; flyby(t, Math.random()<.5?1:-1, alt?far/lv:far, 2.4);}},
    // anchors tightened toward the ~5% reverb-time JND the literature supports (ref .07, was .3 —
    // the old ref meant even a reference-grade listener was only asked to resolve 30% size steps)
    Halls:{type:'X', q:'Which room was bigger?', answerAltered:true, start:.55, floor:.05, ceil:1.1, hard:.9, easy:1.4, log:true, betterHigh:false, anchors:[.85,.07], physLo:0.03, fmt:v=>Math.round(v*100)+'% larger', dur:2.7,
      play:(lv,t,alt)=>hallPluckSec(t, alt?1.1*(1+lv):1.1)},
  };

  // crisp "what to listen for" per A/B room — shown right above the buttons, in different words
  // from the scene-setting notice at the top, so it's the ONE line you read to know what to tap.
  const ASK={
    Foundation:'Tap the interval where you caught the deep tone',
    Air:'Tap the interval with the faint high shimmer',
    Whisper:'Tap the pad that hid a faint tick',
    Silence:'Tap the silence that wasn’t truly black',
    Noise:'Tap the noise burst that hid a steady tone',
    Digits:'Tap the three digits you heard, in order',
    Grain:'Tap the cleaner, purer of the two notes',
    Composure:'Tap the one that stayed clean under load',
    Grip:'Tap the tighter bass — the one that stops dead',
    Presence:'Tap the voice that felt closer, in the room',
    Silk:'Tap the harsher, more piercing “s”',
    Snap:'Tap the hit with the sharper, faster attack',
    Pulse:'Tap the groove that stayed in time',
    Shade:'Tap the very slightly louder note',
    Centre:'Tap the one pinned dead centre',
    Duet:'Tap the wider, more spread-out chord',
    Echo:'Tap the one with the longer gap to its echo',
    Flyby:'Tap the vehicle that swept closer',
    Halls:'Tap the pluck ringing in the bigger room'
  };

  // ---------- adaptive spatial specs (acuity in degrees) ----------
  // score maps median angular error to pct via [weakDeg, refDeg]; stops when the running
  // acuity estimate is confident (SE small) after a minimum, else at maxRounds.
  const SPATIAL={
    Stage:{minR:3, maxR:8, weak:40, ref:5, ecc:[40,58,74,86]},
    Motion:{minR:3, maxR:8, weak:45, ref:7, spd:[2.4,2.0,1.7,1.4]},
    Orbit:{minR:3, maxR:8, weak:75, ref:14, dur:[4.2,3.8,3.4,3.0]},
    Depth:{minR:3, maxR:6, weak:52, ref:10},
    Separation:{minR:3, maxR:8, weak:52, ref:10, spread:[64,48,36,28]},
  };

  // ---------- state ----------
  let order=[], oi=0, score=0, voices=[], target=null, guessLocked=false, replayFn=()=>{};
  let chScore={}, chPct={}, roomThr={}, roomVal={}, roomDone={};   // per-room score, readout, measurement; roomDone marks unscored rooms (curve) as completed
  let choiceTimers=[], orbitInt=null;
  // curated default tour (~11 non-redundant rooms across all four domains) — keeps the set
  // short. Every other room stays available on the select screen, just off by default.
  const DEFAULT_ROOMS = new Set(['Stage','Orbit','Depth','Crowd','Whisper','Digits','Grain','Foundation','Air','Presence','Snap','Shade']);   // Digits replaces Noise in the default tour (same principle, everyday percept)
  let selected = CH.map(c=>DEFAULT_ROOMS.has(c.tag));
  let device='';
  let db={devices:{}}, storageOK=false, cmpVisible={};
  let lastPct=0;
  const SCHEMA=3;                 // profile schema version (v3 superset of stoneroom_results_v2)
  let currentRunId=null;          // one id per measurement occasion (tour / standalone curve / single retake)
  let fromProfile=false;          // true when the room-select was opened from a profile (device preset → skip naming)
  let pvName=null;                // the pair whose detail view (#pfview) is open
  let methodsBack='intro';        // where the methods page returns to
  let pfReturn=false;             // a standalone curve was launched from the profile view → Done returns there
  function uid(pre){ const r=(window.crypto&&crypto.randomUUID)?crypto.randomUUID().replace(/-/g,'').slice(0,12):(Date.now().toString(36)+Math.random().toString(36).slice(2,8)); return (pre||'id')+'_'+r; }
  let st=null;                                    // active stair state
  let sp=null;                                    // active spatial state
  let cnt=null;                                   // active count state
  let kbAz=0, kbRad=110, kbActive=false;          // keyboard guess cursor (spatial rooms)
  // per-trial roving: defeats memorisation of a fixed reference. Level and base pitch are
  // randomised each trial (both intervals share the same rove) so only the tested DIFFERENCE
  // is informative — you can't learn the token, only hear the change.
  let noiseReset=false;                             // white-noise wash between A and B (user toggle)
  let rvF=1;
  function roveTrial(){
    rvF = Math.pow(2, (Math.random()*6-3)/12);     // ±3 semitones base transpose
    anchorMaster(0.85*(0.62+Math.random()*0.38)); // −4..0 dB
  }
  // silence the currently-playing A/B stimulus the instant the listener answers (stop-on-pick).
  // Safe because every trial re-anchors master.gain at its start (roveTrial / agTrial), so this
  // only mutes the leftover tail; it never leaves the output stuck at zero.
  // re-anchor the master bus SAFELY: killStim leaves a 35 ms ramp-to-zero scheduled, and a bare
  // setValueAtTime does NOT cancel it — the ramp resumes from the new value and lands at 0, so
  // anything played immediately after an answer was muted (the silent pre-check chime bug).
  function anchorMaster(v){ if(!master) return; const now=ctx.currentTime;
    master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(v, now); }
  function killStim(){
    if(!master) return;
    const now=ctx.currentTime;
    master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); master.gain.linearRampToValueAtTime(0, now+0.035);
    // then actually END the trial: disconnect every source scheduled so far, AFTER the 35 ms bus
    // ramp has reached silence (disconnect is instantaneous — doing it mid-ramp would click).
    // New sources created by the next trial are not in this snapshot.
    const snap=[...liveStim]; liveStim.clear();
    setTimeout(()=>{ snap.forEach(n=>{ try{n.disconnect();}catch(e){} }); }, 50);
  }

  const $=id=>document.getElementById(id);
  const scr={intro:$('intro'),cal:$('cal'),select:$('select'),device:$('device'),game:$('game'),end:$('end'),compare:$('compare'),curve:$('curve'),profiles:$('profiles'),pfview:$('pfview'),methods:$('methods')};
  let curveInTour=false;     // true while the hearing-curve room runs inside a tour
  const show=n=>{Object.values(scr).forEach(s=>s&&s.classList.remove('on')); scr[n].classList.add('on'); window.scrollTo(0,0);};
  const jit=(v,j)=>v+(Math.random()*2-1)*j;
  const chap=()=>CH[order[oi]];
  const wrapErr=(a,b)=>{let d=Math.abs(a-b)%360; return d>180?360-d:d;};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const setReplay=(on)=>{$('replay').disabled=!on||guessLocked;};
  const pick=a=>a[Math.floor(Math.random()*a.length)];
  const contentOf=tag=>RC[tag]||{};

  // ---- duration estimates, derived from the real trial parameters ----
  // q = typical run locking at the first checkpoint; f = running to full precision.
  function estRoom(c){
    if(c.mode==='stair'){
      const A=ADAPT[c.tag], d=A.dur||1.5;
      const t=0.25+2*d+0.3+1.7;                 // both intervals + answer + feedback pause
      return {q:9*t, f:16*t};
    }
    if(c.mode==='count') return {q:5*7.5, f:10*7.5};
    if(c.mode==='digits') return {q:9*5, f:15*5};
    if(c.mode==='curve') return {q:9*6*1.6+16, f:9*12*1.6+16};   // 9 pitches × trials + volume calibration
    const per={locate:7,sweep:8.5,depth:7.5,separate:10,orbit:11}[c.mode]||8;
    const S=SPATIAL[c.tag]||{minR:4,maxR:8};
    return {q:(S.minR+1)*per, f:S.maxR*per};
  }
  const fmtMin=s=>String(Math.max(1,Math.round(s/60)));
  const fmtRange=e=>{const a=fmtMin(e.q), b=fmtMin(e.f); return a===b?`~${a} min`:`~${a}–${b} min`;};

  // ---- persistent storage (per-device results, localStorage) ----
  const STORE_KEY='stoneroom_results_v2';   // key kept for back-compat; content is now schema-versioned
  // v3 is a strict SUPERSET of v2: the flat rooms[tag] latest projection stays exactly where every
  // read site expects it; we ADD id/name/createdAt/history[]/meta. migrate is additive + idempotent,
  // treats a missing schema as v2, and seeds a 1-entry history from the flat rooms — it NEVER rewrites
  // rooms[tag] and NEVER persists (the next write persists it, so loadDB stays non-destructive).
  function migrate(dbo){
    if(!dbo || typeof dbo!=='object') return {schema:SCHEMA, devices:{}};
    if(!dbo.devices || typeof dbo.devices!=='object') dbo.devices={};
    dbo.schema=SCHEMA;
    Object.keys(dbo.devices).forEach(name=>{
      let d=dbo.devices[name];
      if(!d || typeof d!=='object'){ d={rooms:{}}; dbo.devices[name]=d; }
      if(!d.id) d.id=uid('dev');
      d.name=name;
      d.createdAt = d.createdAt || d.date || new Date().toISOString();
      d.date = d.date || d.createdAt;
      if(!d.rooms || typeof d.rooms!=='object') d.rooms={};
      if(!d.meta) d.meta={};
      if(!Array.isArray(d.history)){                       // seed a snapshot WITHOUT touching d.rooms
        const snap={};
        Object.keys(d.rooms).forEach(tag=>{ const r=d.rooms[tag]; snap[tag]=(typeof r==='number')?{pct:r}:Object.assign({},r); });
        const e={ runId:'legacy-'+d.id, at:d.date, app:'v2', rooms:snap };
        if(Array.isArray(d.curve)) e.curve=d.curve;
        if(d.curveMethod) e.curveMethod=d.curveMethod;
        d.history=[e];
      }
    });
    return dbo;
  }
  async function loadDB(){
    try{ const r=localStorage.getItem(STORE_KEY); if(r) db=JSON.parse(r); storageOK=true; }
    catch(e){ storageOK=false; }
    if(!db || typeof db!=='object' || !db.devices) db={devices:{}};
    db=migrate(db);
  }
  // read-modify-write so a second tab (or an 'again' run on a stale cache) can't clobber devices
  // saved elsewhere: reload the stored map, overlay ours, persist. (Additive only — it can't DELETE
  // a key; delete/rename/import use persistFull instead.)
  async function saveDB(){
    try{
      let stored={schema:SCHEMA, devices:{}};
      try{ const r=localStorage.getItem(STORE_KEY); if(r){ const p=JSON.parse(r); if(p&&p.devices) stored=p; } }catch(e){}
      stored.schema=SCHEMA;
      Object.keys(db.devices).forEach(k=>{ stored.devices[k]=db.devices[k]; });
      db=stored;
      localStorage.setItem(STORE_KEY, JSON.stringify(db)); storageOK=true;
    }catch(e){ storageOK=false; }
  }
  // authoritative whole-DB write with NO reload-overlay — the only write that can actually remove a
  // key, so delete/rename/import go through here. Last-writer-wins across tabs (fine for explicit
  // foreground management actions).
  function persistFull(){
    try{ db.schema=SCHEMA; localStorage.setItem(STORE_KEY, JSON.stringify(db)); storageOK=true; return true; }
    catch(e){ storageOK=false; return false; }
  }
  // ---- single reading sink: everything writes through here, keyed by currentRunId, so one occasion
  // = one history entry (idempotent re-writes), and the flat rooms[tag] latest projection stays live.
  function ensureProfile(name){
    let d = hasDevice(name) && db.devices[name];
    if(!d){ d={rooms:{}}; db.devices[name]=d; }
    if(!d.id) d.id=uid('dev');
    d.name=name; d.createdAt=d.createdAt||new Date().toISOString();
    if(!d.rooms) d.rooms={}; if(!d.meta) d.meta={}; if(!Array.isArray(d.history)) d.history=[];
    return d;
  }
  function curHist(d){
    let e=d.history.find(h=>h.runId===currentRunId);
    if(!e){ e={runId:currentRunId||uid('r'), at:new Date().toISOString(), app:APP_VERSION, rooms:{}}; d.history.push(e); }
    return e;
  }
  function upsertRoomReading(name, tag, reading){
    const d=ensureProfile(name), e=curHist(d), now=new Date().toISOString();
    e.rooms[tag]=reading; e.at=now; d.rooms[tag]=reading; d.date=now;
  }
  function upsertCurve(name, curve, method){
    const d=ensureProfile(name), e=curHist(d), now=new Date().toISOString();
    e.curve=curve; e.curveMethod=method; e.at=now; d.curve=curve; d.curveMethod=method; d.date=now;
  }
  // rebuild the flat rooms/curve projection from history (newest-by-at wins per tag) — used after a merge
  function projectFromHistory(d){
    const rooms={}; let curve=null, method=null;
    (d.history||[]).slice().sort((a,b)=>(a.at||'').localeCompare(b.at||'')).forEach(h=>{
      Object.keys(h.rooms||{}).forEach(t=>{ rooms[t]=h.rooms[t]; });
      if(h.curve){ curve=h.curve; method=h.curveMethod; }
    });
    d.rooms=rooms; if(curve){ d.curve=curve; d.curveMethod=method; }
  }
  // ---- profile management (delete/rename need persistFull; saveDB can't remove a key) ----
  function deleteDevice(name){ if(hasDevice(name)){ delete db.devices[name]; if(!persistFull()) flashSaved('storage full — nothing saved'); } }
  function renameDevice(oldN,newN){
    newN=safeName(String(newN||'').trim()); if(!newN||newN===oldN) return false;
    if(hasDevice(newN)){ flashSaved('name already used'); return false; }
    if(!hasDevice(oldN)) return false;
    const d=db.devices[oldN]; d.name=newN; db.devices[newN]=d; delete db.devices[oldN];
    if(device===oldN) device=newN;
    if(!persistFull()){ flashSaved('storage full — nothing saved'); return false; }
    return true;
  }
  // ---- export / import (wrapped JSON; merge by id, union history by (runId,at); sanitize on the way in) ----
  const sanitizeStr = s => String(s==null?'':s).replace(/[<>]/g,'').slice(0,48);
  function sanitizeReading(r){
    if(typeof r==='number') return {pct:Number(r)||0};
    if(!r||typeof r!=='object') return {pct:0};
    const o={}; if(r.pct!=null) o.pct=Number(r.pct)||0;
    if(r.thr!=null) o.thr=sanitizeStr(r.thr);
    ['val','lo','hi'].forEach(k=>{ if(r[k]!=null && isFinite(r[k])) o[k]=Number(r[k]); });
    return o;
  }
  function exportBlob(name){
    const payload = name
      ? { kind:'stoneroom_profile', schema:SCHEMA, app:APP_VERSION, exportedAt:new Date().toISOString(), device:db.devices[name] }
      : { kind:'stoneroom_db', schema:SCHEMA, app:APP_VERSION, exportedAt:new Date().toISOString(), devices:db.devices };
    return JSON.stringify(payload, null, 2);
  }
  function downloadExport(name){
    try{
      const blob=new Blob([exportBlob(name)],{type:'application/json'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
      a.download='stone-room-'+(name?name.replace(/[^\w-]+/g,'_'):'all')+'-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(a); a.click(); a.remove();
    }catch(e){ flashSaved('could not export'); }
  }
  function importText(text){
    let inc; try{ inc=JSON.parse(text); }catch(e){ return {error:'not valid JSON'}; }
    const incDevices = inc.device ? { [inc.device.name||'Imported']: inc.device } : inc.devices;
    if(!incDevices || typeof incDevices!=='object') return {error:'not a Stone Room export'};
    if(inc.schema && inc.schema>SCHEMA) return {error:'from a newer version'};
    const norm = migrate({schema:inc.schema||2, devices:JSON.parse(JSON.stringify(incDevices))});
    const byId={}; Object.keys(db.devices).forEach(n=>{ if(db.devices[n].id) byId[db.devices[n].id]=n; });
    const sum={added:0, merged:0, readings:0};
    Object.keys(norm.devices).forEach(iname=>{
      const ip=norm.devices[iname];
      ip.name = sanitizeStr(ip.name||iname);
      (ip.history||[]).forEach(h=>{ if(h.rooms){ Object.keys(h.rooms).forEach(t=>{ h.rooms[t]=sanitizeReading(h.rooms[t]); }); } });
      if(ip.rooms){ Object.keys(ip.rooms).forEach(t=>{ ip.rooms[t]=sanitizeReading(ip.rooms[t]); }); }
      const localName = ip.id && byId[ip.id];
      if(!localName){
        let nm=safeName(ip.name||iname);
        if(hasDevice(nm)){ let k=2; while(hasDevice(nm+' '+k)) k++; nm=nm+' '+k; }
        ip.name=nm; db.devices[nm]=ip; byId[ip.id]=nm; sum.added++;
        sum.readings += (ip.history||[]).reduce((a,h)=>a+Object.keys(h.rooms||{}).length,0);
        return;
      }
      const lp=db.devices[localName]; sum.merged++; if(!Array.isArray(lp.history)) lp.history=[];
      // dedup by runId ALONE: `at` is a last-write timestamp, not identity — keying on runId+at let
      // two backups of the SAME run import as two "runs", so the repeatability panel compared a
      // reading against itself and reported ±0 ("perfect"). Same occasion now MERGES.
      const byRun={}; lp.history.forEach(h=>{ if(h.runId) byRun[h.runId]=h; });
      (ip.history||[]).forEach(h=>{
        const ex=h.runId && byRun[h.runId];
        if(!ex){ lp.history.push(h); if(h.runId) byRun[h.runId]=h; sum.readings+=Object.keys(h.rooms||{}).length; return; }
        const newer=(h.at||'')>(ex.at||'');
        if(!ex.rooms) ex.rooms={};
        Object.keys(h.rooms||{}).forEach(t=>{ if(newer || ex.rooms[t]==null) ex.rooms[t]=h.rooms[t]; });
        if(h.curve && (newer || !ex.curve)){ ex.curve=h.curve; ex.curveMethod=h.curveMethod; }
        if(newer) ex.at=h.at;
      });
      lp.history.sort((a,b)=>(a.at||'').localeCompare(b.at||''));
      projectFromHistory(lp);
      if(ip.createdAt && (!lp.createdAt || ip.createdAt<lp.createdAt)) lp.createdAt=ip.createdAt;
      if(ip.date && (!lp.date || ip.date>lp.date)) lp.date=ip.date;
    });
    if(!persistFull()) return {error:'storage full — nothing saved'};
    return sum;
  }
  // ---- in-progress run persistence (resume after a page refresh, or start anew) ----
  const RUN_KEY='stoneroom_run_v1';
  function saveRun(){
    if(!order.length) return;
    try{ localStorage.setItem(RUN_KEY, JSON.stringify({v:APP_VERSION, device, order, oi, score, chScore, chPct, roomThr, roomVal, roomDone, runId:currentRunId, ts:Date.now()})); }catch(e){}
  }
  function clearRun(){ try{ localStorage.removeItem(RUN_KEY); }catch(e){} }
  // only offer a resume for the SAME app version — CH indices could shift between releases
  function loadRun(){ try{ const r=localStorage.getItem(RUN_KEY); if(!r) return null; const o=JSON.parse(r);
    return (o && o.v===APP_VERSION && Array.isArray(o.order) && o.order.length) ? o : null; }catch(e){ return null; } }
  function offerResume(){
    const run=loadRun(); if(!run) return;
    const done=run.order.filter(i=>(run.chPct&&run.chPct[i]!=null)||(run.roomDone&&run.roomDone[i])).length;
    $('resumetext').innerHTML=`Resume your last run? <b>${(run.device||'Headphones').replace(/</g,'&lt;')}</b> · room ${Math.min((run.oi||0)+1,run.order.length)} of ${run.order.length}${done?` · ${done} done`:''}`;
    $('resumebar').removeAttribute('hidden');
  }
  function restoreRun(run){
    initAudio(); ctx.resume();
    device=run.device||suggestName();
    currentRunId=run.runId||uid('r');    // keep the resumed tour on ONE history entry
    order=run.order.slice(); score=run.score||0;
    chScore=run.chScore||{}; chPct=run.chPct||{}; roomThr=run.roomThr||{}; roomVal=run.roomVal||{}; roomDone=run.roomDone||{};
    oi=Math.max(0, Math.min(run.oi||0, order.length-1));
    $('score').textContent=score; $('devlabel').textContent=device;
    show('game'); loadChapter();
  }

  function deviceNames(){ return Object.keys(db.devices).sort((a,b)=>(db.devices[b].date||'').localeCompare(db.devices[a].date||'')); }
  const hasDevice=n=>Object.prototype.hasOwnProperty.call(db.devices,n);
  // a name that never collides with Object.prototype keys, and a fresh unique default
  function safeName(n){ return /^(__proto__|prototype|constructor)$/i.test(n) ? n+' ' : n; }
  function suggestName(){ const names=deviceNames(); let i=1; while(names.includes('Headphones '+i)) i++; return 'Headphones '+i; }

  // ---- deep link: #<room tag> jumps straight to that single room ----
  const deepRoom=(()=>{
    const h=decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
    if(!h) return -1;
    return CH.findIndex(c=>c.tag.toLowerCase()===h);
  })();
  function shareURL(){ const base=location.href.split('#')[0]; return base+(order.length===1?'#'+CH[order[0]].tag.toLowerCase():''); }

  // ---- intro rendering ----
  function buildIntro(){
    $('introHook').textContent=INTRO.hook;
    $('introLine').textContent=INTRO.line;
    $('introWhat').textContent=INTRO.what;
    $('introGap').textContent=INTRO.gap;
    $('introTips').textContent=INTRO.tips;
    $('introPromise').textContent=INTRO.promise;
    $('ver').textContent='Stone Room '+APP_VERSION;
    $('verEnd').textContent=APP_VERSION;
    try{ console.log('%cStone Room '+APP_VERSION, 'color:#D9A24B;font-weight:600'); }catch(e){}
  }

  // ---- wiring ----
  function wire(){
    $('begin').addEventListener('click',async()=>{
      initAudio(); ctx.resume(); await loadDB();
      if(deepRoom>=0){ buildDevice(); show('device'); }
      else { show('cal'); runCal(); }
    });
    $('goprofiles').addEventListener('click',async()=>{await loadDB(); buildProfiles(); show('profiles');});
    $('endprofiles').addEventListener('click',()=>{buildProfiles(); show('profiles');});
    $('pfcompare').addEventListener('click',()=>{ buildCompare(); show('compare'); });   // Compare is reached from Profiles now
    $('pf-back').addEventListener('click',()=>show(order.length?'end':'intro'));
    $('gomethods').addEventListener('click',()=>{ buildMethods(); methodsBack='intro'; show('methods'); });
    $('mdback').addEventListener('click',()=>show(methodsBack||'intro'));
    // ⌂ Home — the universal, progress-safe escape from any running test: audio stops, the tour
    // stays saved (the intro offers Resume), nothing is recorded for the interrupted room
    $('gohome').addEventListener('click',()=>{ stopVoices(); killStim(); clearTimers(); show('intro'); offerResume(); });
    $('cvhome').addEventListener('click',()=>{ stopCurveAudio(); clearTimers(); killStim(); ag=null; curveInTour=false;
      $('cvexit').textContent='Done'; pfReturn=false; show('intro'); offerResume(); });
    $('pv-back').addEventListener('click',()=>{ buildProfiles(); show('profiles'); });
    $('pv-test').addEventListener('click',()=>{ if(pvName) testPair(pvName); });
    $('pv-rename').addEventListener('click',()=>{ if(!pvName)return; const nn=prompt('Rename this pair:', pvName); if(!nn)return;
      const clean=safeName(String(nn).trim()); if(renameDevice(pvName,nn)){ pvName=clean; openProfile(pvName); } });
    $('pv-export').addEventListener('click',()=>{ if(pvName) downloadExport(pvName); });
    $('pv-delete').addEventListener('click',()=>{ if(pvName && confirm('Delete "'+pvName+'" and all its results?')){ deleteDevice(pvName); pvName=null; buildProfiles(); show('profiles'); } });
    $('pvsavecard').addEventListener('click',()=>{ if(!pvName)return;   // export the FULL card (the on-screen one is the compact hero)
      const dev=db.devices[pvName], data=dev&&cardData(pvName,dev); if(!data)return;
      const tmp=document.createElement('div'); window.SR_FP.render(tmp, data);
      const svg=tmp.querySelector('svg'); if(svg) sharePNG(svg,'stone-room-'+pvName.replace(/[^\w-]+/g,'_')+'.png').catch(()=>flashSaved('could not save card')); });
    $('pvsavecurve').addEventListener('click',()=>{ const svg=$('pvcurve').querySelector('svg'); if(svg) sharePNG(svg,'stone-room-curve-'+pvName.replace(/[^\w-]+/g,'_')+'.png').catch(()=>flashSaved('could not save curve')); });
    $('pf-exportall').addEventListener('click',()=>downloadExport());
    $('pf-import').addEventListener('click',()=>$('pf-file').click());
    $('pf-file').addEventListener('change',e=>{ const f=e.target.files&&e.target.files[0]; if(!f) return; const rd=new FileReader();
      rd.onload=()=>{ const res=importText(String(rd.result)); if(res.error) flashSaved(res.error); else { flashSaved(res.added+' added · '+res.merged+' merged'); buildProfiles(); } $('pf-file').value=''; };
      rd.readAsText(f); });
    $('resumebtn').addEventListener('click',()=>{ const run=loadRun(); if(run) restoreRun(run); });
    $('freshbtn').addEventListener('click',()=>{ clearRun(); $('resumebar').setAttribute('hidden',''); });
    // the two intro panels are mutually exclusive: opening one closes the other, so "What
    // you'll get" replaces "What is this?" (and vice versa) rather than stacking beneath it.
    const closeAbout=()=>{ $('introAbout').setAttribute('hidden',''); $('aboutToggle').setAttribute('aria-expanded','false'); $('aboutToggle').textContent='What is this?'; };
    const closeDemo =()=>{ $('introDemo').setAttribute('hidden',''); $('demoToggle').setAttribute('aria-expanded','false'); $('demoToggle').textContent='What you’ll get'; };
    $('aboutToggle').addEventListener('click',()=>{
      const opening=$('introAbout').hasAttribute('hidden');
      closeDemo();
      if(opening){ $('introAbout').removeAttribute('hidden'); $('aboutToggle').setAttribute('aria-expanded','true'); $('aboutToggle').textContent='Less'; }
      else closeAbout();
    });
    $('demoToggle').addEventListener('click',()=>{
      const d=$('introDemo'), opening=d.hasAttribute('hidden');
      closeAbout();
      if(opening){
        d.removeAttribute('hidden'); $('demoToggle').setAttribute('aria-expanded','true'); $('demoToggle').textContent='Hide';
        if(!d.dataset.built){ window.SR_FP.render($('fpDemo'), window.SR_FP.SAMPLE); d.dataset.built='1'; }
      } else closeDemo();
    });
    $('savecard').addEventListener('click',saveCard);
    $('calreplay').addEventListener('click',runCal);
    $('calgo').addEventListener('click',()=>{ fromProfile=false; buildSelect(); show('select');});
    $('calback').addEventListener('click',()=>show('intro'));
    $('selstart').addEventListener('click',()=>{ if(fromProfile){ fromProfile=false; startGame(); } else { buildDevice(); show('device'); } });
    $('selback').addEventListener('click',()=>{ if(fromProfile){ fromProfile=false; buildProfiles(); show('profiles'); } else show('intro'); });
    $('devback').addEventListener('click',()=>{ if(deepRoom>=0){ show('intro'); } else { buildSelect(); show('select'); } });
    try{ noiseReset = localStorage.getItem('stoneroom_noise')==='1'; }catch(e){}
    $('optnoise').checked = noiseReset;
    $('optnoise').addEventListener('change',e=>{ noiseReset=e.target.checked; try{ localStorage.setItem('stoneroom_noise', noiseReset?'1':'0'); }catch(_){} });
    $('devgo').addEventListener('click',()=>{ device=safeName(($('devinput').value.trim())||suggestName()); startGame(); });
    $('endcurve').addEventListener('click',()=>{ pfReturn=false; startCurve(); });    // post-tour shortcut: re-measure the curve for this pair
    $('cvexit').addEventListener('click',()=>{ if(curveInTour){ finishCurveRoom(); } else { stopCurveAudio();
      if(pfReturn){ pfReturn=false; buildProfiles(); openProfile(device); } else show(order.length?'end':'intro'); } });
    $('cvredo').addEventListener('click',()=>{ stopCurveAudio(); startCurve(); });
    $('cvsave').addEventListener('click',saveCurveCard);
    $('again').addEventListener('click',startGame);
    $('reselect').addEventListener('click',()=>{ fromProfile=false; buildSelect(); show('select');});
    $('cmpback').addEventListener('click',()=>{ buildProfiles(); show('profiles'); });   // Back → Profiles (Compare lives under it)
    $('cmpnew').addEventListener('click',()=>{ fromProfile=false; buildSelect(); show('select');});
    $('next').addEventListener('click',nextChapter);
    $('lockbtn').addEventListener('click',redoRoom);        // "↻ Redo" on the result
    $('contbtn').addEventListener('click',sharpenRoom);     // "Sharpen ↑" on the result
    $('field').addEventListener('pointerdown',e=>onTap(e,false));
    $('fieldO').addEventListener('pointerdown',e=>onTap(e,true));
    document.addEventListener('keydown',onKeydown);
    $('replay').addEventListener('click',()=>{ if(!guessLocked && !$('replay').disabled) replayFn(); });
    $('selall').addEventListener('click',()=>{selected=CH.map(()=>true); paintChips();});
    $('selnone').addEventListener('click',()=>{selected=CH.map(()=>false); paintChips();});
    $('infobtn').addEventListener('click',()=>openInfo(chap().tag));
    $('infoclose').addEventListener('click',closeInfo);
    $('modal').addEventListener('click',e=>{ if(e.target===$('modal')) closeInfo(); });
    $('roomsbtn').addEventListener('click',openRoomNav);
    $('navclose').addEventListener('click',closeRoomNav);
    $('navskip').addEventListener('click',()=>{ closeRoomNav(); skipRoom(); });
    $('roomnav').addEventListener('click',e=>{ if(e.target===$('roomnav')) closeRoomNav(); });
    $('skipbtn').addEventListener('click',skipRoom);
    $('sharelink').addEventListener('click',shareResults);
    $('copyres').addEventListener('click',copyResults);
    document.querySelectorAll('.coffee').forEach(b=>b.addEventListener('click',e=>{
      if(CONFIG.COFFEE_URL.includes('YOURNAME')){ e.preventDefault(); flashSaved('set your coffee link in app.js'); }
    }));

    if(deepRoom>=0){
      selected=CH.map((_,i)=>i===deepRoom);
      const c=CH[deepRoom], note=$('deepnote');
      note.style.display='block';
      note.textContent=`Direct entry · ${c.tag} — ${c.title}. You'll go straight to this room (${fmtRange(estRoom(c))}).`;
    }
  }

  // ---- coffee links ----
  function applyCoffeeLinks(){
    document.querySelectorAll('.coffee').forEach(a=>{ a.href=CONFIG.COFFEE_URL; a.target='_blank'; a.rel='noopener'; });
  }

  function runCal(){
    rvF=1; anchorMaster(0.85);   // clear any leftover rove
    const seq=[-90,0,90], bar=$('calbar'), dot=$('caldot');
    bar.classList.add('play');
    seq.forEach((az,i)=>{ setTimeout(()=>{ const v=makeVoice('bell',az,1.6,0.6); v.playOnce(ctx.currentTime+.02);
      dot.style.left=(50+az/90*46)+'%'; }, i*750); });
  }

  function buildDevice(){
    $('devinput').value = device || suggestName();
    const box=$('devchips'); box.innerHTML='';
    deviceNames().slice(0,4).forEach(n=>{
      const b=document.createElement('button'); b.className='devchip'; b.textContent=n;
      b.addEventListener('click',()=>{$('devinput').value=n;});
      box.appendChild(b);
    });
  }

  function buildSelect(){
    const wrap=$('selscroll'); wrap.innerHTML='';
    Object.keys(GROUPS).forEach(gk=>{
      const g=GROUPS[gk];
      const sec=document.createElement('div'); sec.className='ggroup';
      const head=document.createElement('div'); head.className='ghead';
      const idxs=CH.map((c,i)=>c.group===gk?i:-1).filter(i=>i>=0);
      const gEst=idxs.reduce((a,i)=>{const e=estRoom(CH[i]); a.q+=e.q; a.f+=e.f; return a;},{q:0,f:0});
      head.innerHTML=`<span><span class="gname">${g.name}</span><span class="gsub">${g.sub} · ${fmtRange(gEst)}</span></span>`;
      const tog=document.createElement('button');
      tog.addEventListener('click',()=>{ const allOn=idxs.every(i=>selected[i]); idxs.forEach(i=>selected[i]=!allOn); paintChips(); });
      head.appendChild(tog); sec.appendChild(head);
      const grid=document.createElement('div'); grid.className='chipgrid';
      const dv = device && hasDevice(device) ? db.devices[device] : null;   // show this pair's saved scores
      idxs.forEach(i=>{
        const c=CH[i];
        const rv = dv && dv.rooms && dv.rooms[c.tag];
        const pct = rv==null?null:(typeof rv==='number'?rv:rv.pct);
        const thr = (rv&&typeof rv==='object'&&rv.thr)?rv.thr:null;
        const b=document.createElement('button'); b.className='chip'+(pct!=null?' taken':''); b.dataset.idx=i;
        b.innerHTML=`<div class="cname">${c.tag}<span class="ctime">${fmtRange(estRoom(c))}</span></div><div class="cq">${c.tests}</div><div class="cclaim">${c.claim}</div><div class="cscore"></div>`;
        const sc=b.querySelector('.cscore');
        if(pct!=null){ sc.textContent = pct+'%'+(thr?' · '+thr:''); }   // textContent: an imported thr can't inject markup
        b.addEventListener('click',()=>{selected[i]=!selected[i]; paintChips();});
        grid.appendChild(b);
      });
      sec.appendChild(grid); wrap.appendChild(sec);
    });
    paintChips();
  }
  function paintChips(){
    document.querySelectorAll('#selscroll .chip').forEach(b=>{ b.classList.toggle('on', selected[+b.dataset.idx]); });
    document.querySelectorAll('#selscroll .ggroup').forEach((sec,gi)=>{
      const gk=Object.keys(GROUPS)[gi];
      const idxs=CH.map((c,i)=>c.group===gk?i:-1).filter(i=>i>=0);
      sec.querySelector('.ghead button').textContent = idxs.every(i=>selected[i]) ? 'skip group' : 'take group';
    });
    $('selstart').disabled = !selected.some(Boolean);
    const est=CH.reduce((a,c,i)=>{ if(selected[i]){const e=estRoom(c); a.n++; a.q+=e.q; a.f+=e.f;} return a; },{n:0,q:0,f:0});
    $('seltime').innerHTML = est.n
      ? `${est.n} room${est.n>1?'s':''} · <b>≈${fmtMin(est.q)} min</b> locking readings early · ≈${fmtMin(est.f)} min at full precision`
      : 'No rooms selected';
  }

  // interleave the tour so no two adjacent rooms share a domain — round-robin across the four
  // groups, preserving each group's internal order. This "one around each" ordering breaks the
  // monotony of a block of near-identical rooms WITHOUT interleaving at the trial level (which
  // would add task-switching noise and slow every reading). Each room still runs as one clean run.
  function interleaveByDomain(idxs){
    const gk=Object.keys(GROUPS);
    const buckets=gk.map(g=>idxs.filter(i=>CH[i].group===g));
    const out=[]; let added=true;
    while(added){ added=false;
      for(const b of buckets){ if(b.length){ out.push(b.shift()); added=true; } }
    }
    return out;
  }

  function startGame(){
    initAudio(); ctx.resume();
    order = interleaveByDomain(CH.map((_,i)=>i).filter(i=>selected[i]));
    if(!order.length) order=CH.map((_,i)=>i);
    score=0; oi=0; chScore={}; chPct={}; roomThr={}; roomVal={}; roomDone={};
    currentRunId=uid('r');           // one measurement occasion for this whole tour
    order.forEach(i=>{chScore[i]=0;});
    $('score').textContent='0'; $('devlabel').textContent=device;
    show('game'); loadChapter();
  }

  function loadChapter(){
    const c=chap();
    const remQ=order.slice(oi).reduce((a,ci)=>a+estRoom(CH[ci]).q,0);
    $('timeleft').textContent = order.length>1 ? ` · ~${fmtMin(remQ)} min left` : '';
    $('chapno').textContent=ROMANS[oi]; $('chaptag').textContent=c.tag; $('chaptitle').textContent=c.title;
    $('claim').textContent=c.claim; $('notice').innerHTML=c.notice;
    const cd=$('chapdots'); cd.innerHTML=''; order.forEach((ci,i)=>{const d=document.createElement('div');d.className='cdot'+(i===oi?' now':(chPct[ci]!=null||roomDone[ci])?' done':'');cd.appendChild(d);});
    $('learn').classList.remove('on'); $('next').classList.remove('on'); hideCheckpointBtns();
    setPrecision(0,''); $('precision').classList.remove('on');
    saveRun();                                       // checkpoint the tour so a refresh can resume here
    startChapter();
  }
  function clearTimers(){ choiceTimers.forEach(t=>clearTimeout(t)); choiceTimers=[]; }
  function stopVoices(){
    voices.forEach(v=>v.stop()); voices=[];
    clearTimers();
    if(orbitInt){clearInterval(orbitInt); orbitInt=null;}
    $('comet').classList.remove('on');
  }
  function showLearn(){ const c=chap(); const L=$('learn'); L.innerHTML=`<b>Why audiophiles care</b>${c.learn}`; L.classList.add('on'); }

  // precision meter — colour reflects the confidence value (red < 40% < amber < 70% < green)
  function setPrecision(frac,label){
    const f=clamp(frac,0,1);
    $('pfill').style.width=Math.round(f*100)+'%';
    $('pfill').style.background = f<0.4?'var(--ember)' : f<0.7?'var(--gold)' : 'var(--sage)';
    $('pvalue').textContent=label||'';
  }
  function showPrecisionUI(){ $('precision').classList.add('on'); }

  // ---- result-screen actions: the room finishes on its own; you may Sharpen or Redo ----
  function showResultBtns(canSharpen){ $('contbtn').classList.toggle('on', !!canSharpen); $('lockbtn').classList.add('on'); }
  function hideCheckpointBtns(){ $('lockbtn').classList.remove('on'); $('contbtn').classList.remove('on'); }
  // "Sharpen" grants more trials/rounds and keeps going — so a reading stuck at a low confidence
  // at the cap can always be pushed further, instead of dead-ending with only Redo/Next.
  function sharpenRoom(){
    hideCheckpointBtns(); $('next').classList.remove('on'); $('learn').classList.remove('on');
    if(st && st.done){ st.eng.z.bumpMax(6); st.eng.nMax+=6; st.done=false; st._shown=false; st.sharpen=true; guessLocked=false; stairTrial(); }
    else if(sp && sp._finished){ sp.maxR=sp.round+sp.diffLen; sp._finished=false; sp.done=false; sp.sharpen=true; guessLocked=false; spatialRound(); }   // Sharpen adds one FULL cycle, keeping the mix balanced
  }
  function redoRoom(){
    const i=order[oi], tag=CH[i].tag;
    if(chScore[i]!=null){ score-=chScore[i]; }
    chScore[i]=0; delete chPct[i]; delete roomThr[tag]; delete roomVal[tag];
    // un-persist the discarded reading too: recordRoom saves the instant a room finishes, so
    // without this a Redo-then-skip left the thrown-away number in the profile card, the
    // repeatability panel and the export — forever
    if(device && db.devices[device]){
      const d=db.devices[device];
      const e=(d.history||[]).find(h=>h.runId===currentRunId);
      if(e && e.rooms && e.rooms[tag]!=null){ delete e.rooms[tag]; projectFromHistory(d); persistFull(); }
    }
    $('score').textContent=score;
    hideCheckpointBtns();
    loadChapter();
  }

  function startChapter(){
    guessLocked=false; st=null; sp=null; cnt=null; dig=null; $('choices').classList.remove('digitpad'); stopVoices();
    ['guess','truthg','link','guessO','truthgO','linkO'].forEach(id=>$(id).classList.remove('on'));
    setReplay(true); $('skipbtn').classList.add('on');
    const c=chap();
    const isStair=c.mode==='stair', isOrbit=c.mode==='orbit', isCount=c.mode==='count', isCurve=c.mode==='curve', isDigits=c.mode==='digits';
    const isField = c.mode==='locate'||c.mode==='sweep'||c.mode==='depth'||c.mode==='separate';
    $('fieldwrap').classList.toggle('hidden', !(isField));
    $('fieldwrapO').classList.toggle('hidden', !isOrbit);
    $('choices').classList.toggle('on', isStair||isCount||isCurve||isDigits);
    // the hearing-curve room is a self-contained measurement on its own screen — offer one
    // button to launch it (Skip still available); the rest run inline here.
    if(isCurve){
      $('precision').classList.remove('on'); $('status').textContent=''; setReplay(false);
      $('hint').textContent='Nine pitches from deep bass to high treble.';
      buildChoices(['▶ Measure my curve'], null, startCurveRoom);
      return;
    }
    $('hint').textContent = isStair ? (ASK[c.tag]||'Tap A or B below')
      : isCount ? 'Tap how many voices you count'
      : isDigits ? 'Tap the three digits you heard, in order'
      : 'Tap the field where you hear it — one tap, no dragging';
    if(isStair) setupStair(c);
    else if(isDigits) setupDigits(c);
    else if(isCount) setupCount(c);
    else if(isOrbit) setupSpatial(c);
    else setupSpatial(c);
  }

  // ---------- adaptive 2AFC (ZEST) ----------
  function buildChoices(labels,subs,handler){
    const box=$('choices'); box.innerHTML='';
    labels.forEach((L,i)=>{
      const b=document.createElement('button'); b.className='choice';
      b.innerHTML=L+(subs&&subs[i]?'<small>'+subs[i]+'</small>':'');
      b.addEventListener('click',()=>handler(i));
      box.appendChild(b);
    });
    return [...box.children];
  }
  function setChoicesEnabled(on){[...$('choices').children].forEach(b=>b.disabled=!on);}

  function setupStair(c){
    $('precision').querySelector('.plabel span').textContent='Precision';
    const A=ADAPT[c.tag];
    const eng=window.SR_ZEST.forRoom(A);
    // one unscored familiarisation trial at an obvious level first: a listener still learning
    // what to listen FOR answers their first real trials badly, and that noise lands in the
    // estimate. Standard practice in psychophysics — the practice answer is discarded.
    st={A, tag:c.tag, eng, trial:0, side:0, curX:0, curLevel:A.start, done:false, dur:A.dur||1.5, warm:true};
    showPrecisionUI();
    stairTrial();
  }
  function stairTrial(){
    const A=st.A;
    st.curX=st.eng.z.next(); st.curLevel=st.eng.levelOf(st.curX);
    // warm-up plays at the EASY end of the room's own range so the difference is unmistakable
    if(st.warm) st.curLevel = A.anchors ? A.anchors[0] : A.start;
    st.side=Math.random()<.5?0:1;
    const btns=buildChoices(['A','B'],['first','second'],stairPick);
    const dur=st.dur, gap=.3;
    const play=()=>{
      choiceTimers.forEach(t=>clearTimeout(t)); choiceTimers=[];
      setChoicesEnabled(false); setReplay(false); roveTrial();
      if(A.onTrial) A.onTrial();          // per-trial stimulus prep (e.g. freeze one masker for both intervals)
      $('status').innerHTML = st.warm
        ? `<span class="pts">Practice</span> <span style="color:var(--muted)">· a clear one first — this doesn’t count</span>`
        : `Trial ${st.trial+1} <span style="color:var(--muted)">of ≤${st.eng.nMax}</span> · <span class="pts">honing in…</span>`;
      const wash = noiseReset ? 0.32 : 0;             // symmetric noise wash: before A and between A/B
      const g2 = gap + wash;
      const t0 = 0.25 + wash;                          // pre-roll leaves room for the before-A wash
      const t = ctx.currentTime + t0;
      if(noiseReset) interNoise(ctx.currentTime + 0.04, wash);     // wash BEFORE A
      for(let i=0;i<2;i++){
        const flag=(i===st.side);
        A.play(st.curLevel, t+i*(dur+g2), flag);
        choiceTimers.push(setTimeout(()=>{btns.forEach(b=>b.classList.remove('playing')); btns[i].classList.add('playing');},(t0+i*(dur+g2))*1000));
      }
      if(noiseReset) interNoise(t+dur+0.06, wash);                 // wash BETWEEN A and B
      // enable answering as soon as the SECOND sample begins — pick early if the difference is obvious
      choiceTimers.push(setTimeout(()=>{ $('status').innerHTML=`${A.q} <span style="color:var(--muted)">· tap as soon as you know</span>`; setChoicesEnabled(true); setReplay(true); },(t0+(dur+g2))*1000));
      choiceTimers.push(setTimeout(()=>{ btns.forEach(b=>b.classList.remove('playing')); },(t0+2*dur+g2)*1000));
    };
    replayFn=play; play();
  }
  function stairPick(i){
    if(!st || st.done) return;
    killStim();                            // stop the tones the instant you pick
    setChoicesEnabled(false); setReplay(false);
    const A=st.A;
    const answer = A.type==='D' ? st.side : (A.answerAltered ? st.side : 1-st.side);
    const hit=i===answer;
    [...$('choices').children].forEach((b,k)=>{ if(k===answer) b.classList.add('correct'); else if(k===i) b.classList.add('wrong'); });
    if(st.warm){                            // practice answer: shown, explained, never recorded
      st.warm=false;
      $('status').innerHTML = hit
        ? '✓ That’s the one — now it gets quieter.'
        : '○ That was the other one. Now you know what to listen for.';
      choiceTimers.push(setTimeout(()=>{ [...$('choices').children].forEach(b=>b.classList.remove('correct','wrong')); stairTrial(); }, 900));
      return;
    }
    st.eng.z.record(st.curX, hit);
    (st.log=st.log||[]).push([Math.round(st.eng.levelOf(st.curX)*1000)/1000, hit?1:0]);   // raw per-trial log — exported for anyone who wants to check the math
    st.trial++;
    const stt=st.eng.z.stats();
    const cont=contentOf(st.tag);
    const micro = hit ? pick(cont.hit||['Caught it.']) : pick(cont.miss||['Easing back.']);
    setPrecision(stt.conf, A.fmt(st.eng.levelOf(stt.mean)));
    const clearMarks=()=>[...$('choices').children].forEach(b=>b.classList.remove('correct','wrong'));
    // normal flow auto-finishes when confident; a Sharpen run continues to the tighter target
    const doneNow = st.sharpen ? (stt.solid || stt.forceStop) : (stt.usable || stt.forceStop);
    if(doneNow){
      $('status').innerHTML=`${hit?'✓':'○'} ${micro}`;
      choiceTimers.push(setTimeout(()=>{ clearMarks(); finishStair(); }, 480));
      return;
    }
    $('status').innerHTML = `${hit?'✓':'○'} ${micro} <span style="color:var(--muted)">· trial ${st.trial}</span>`;
    choiceTimers.push(setTimeout(()=>{ clearMarks(); stairTrial(); }, 520));
  }
  function finishStair(){
    if(st.done && st._shown) return; st.done=true; st._shown=true; guessLocked=true; clearTimers();
    const A=st.A, stt=st.eng.z.stats();
    const thr=st.eng.levelOf(stt.mean);
    const pct=pctFromThreshold(A,thr);
    const b1=st.eng.levelOf(stt.mean-1.96*stt.sd), b2=st.eng.levelOf(stt.mean+1.96*stt.sd);
    const loT=Math.min(b1,b2), hiT=Math.max(b1,b2);
    recordRoom(pct, A.fmt(thr), {val:thr, lo:loT, hi:hiT, trials:st.log});
    const conf=Math.round(stt.conf*100);
    $('status').innerHTML=`Your reading: <span class="pts">${A.fmt(thr)}</span> · +${pct} <span style="color:var(--muted)">· ${conf}% locked in</span>`;
    setPrecision(stt.conf, `${A.fmt(thr)}  ·  ${bandStr(A,loT,hiT)}`);
    showLearn(); appendTier(tierLine(st.tag,pct));
    showResultBtns(!stt.solid);      // Sharpen stays available (it now extends the trial budget)
    advanceUI();
  }
  const pctFromThreshold=(A,thr)=>{
    const [w,b]=A.anchors; let p;
    if(A.log){ const lw=Math.log(w),lb=Math.log(b),lt=Math.log(clamp(thr,Math.min(w,b),Math.max(w,b)));
      p = A.betterHigh ? (lt-lw)/(lb-lw) : (lw-lt)/(lw-lb); }
    else { const ct=clamp(thr,Math.min(w,b),Math.max(w,b)); p = A.betterHigh ? (ct-w)/(b-w) : (w-ct)/(w-b); }
    return Math.round(clamp(p,0,1)*100);
  };
  const bandStr=(A,lo,hi)=>{ const a=Math.min(lo,hi),b=Math.max(lo,hi); return `${A.fmt(a)}–${A.fmt(b)}`; };

  // ---------- adaptive count (Crowd) ----------
  function setupCount(c){
    cnt={ability:3.4, n:3, prevN:0, best:3, trial:0, minR:4, maxR:10, wrong:0, done:false, history:[]};   // maxR 10: the 2-hit credit rule needs room to prove a level
    showPrecisionUI();
    $('precision').querySelector('.plabel span').textContent='Progress';   // Crowd's meter tracks trials done, not certainty — say so
    countTrial();
  }
  // pick the next ensemble size near the running ability, jittered ±1 so the count is NEVER a
  // predictable "one more than last time" ladder — you have to actually count each ensemble,
  // not just add one to your last answer. Ability rises on a hit, falls harder on a miss.
  function nextCountLevel(){
    const c=Math.round(clamp(cnt.ability,3,7));
    let n, tries=0;
    do { n = clamp(c + (Math.floor(Math.random()*3)-1), 3, 7); tries++; }
    while(n===cnt.prevN && tries<6);
    cnt.prevN=n; cnt.n=n;
  }
  function countTrial(){
    nextCountLevel();
    const n=cnt.n;
    // slide the offered window so the true count lands at a RANDOM slot of the triple — with a
    // fixed [n-1,n,n+1] the correct answer was always the middle VALUE, so sorting the three
    // numbers in your head and tapping the median scored 100% without listening at all.
    const offLo=Math.max(-1, 2-(n-1)), offHi=Math.min(1, 8-(n+1));
    const off=offLo+Math.floor(Math.random()*(offHi-offLo+1));
    const vals=[n-1+off, n+off, n+1+off];
    for(let i=vals.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [vals[i],vals[j]]=[vals[j],vals[i]];}
    const btns=buildChoices(vals.map(String),['voices','voices','voices'],countPick);
    cnt.answerIdx=vals.indexOf(n);
    const keys=[...T_KEYS].sort(()=>Math.random()-.5);
    const chosen=[]; for(let k=0;k<n;k++) chosen.push(keys[k%keys.length]);
    const span=160, step=n>1?span/(n-1):0;
    const angs=chosen.map((_,i)=>-80+i*step+jit(0,7));
    const play=()=>{
      choiceTimers.forEach(t=>clearTimeout(t)); choiceTimers=[];
      stopVoices(); roveTrial(); setChoicesEnabled(false); setReplay(false); $('status').textContent='The ensemble…';
      voices=chosen.map((k,i)=>makeVoice(k,angs[i],1.7,0.42));
      voices.forEach(v=>v.loop());
      choiceTimers.push(setTimeout(()=>{voices.forEach(v=>v.stop()); $('status').textContent='How many voices?'; setChoicesEnabled(true); setReplay(true);},4600));
    };
    replayFn=play; play();
  }
  function countPick(i){
    if(!cnt || cnt.done) return;
    setChoicesEnabled(false); setReplay(false); stopVoices();
    const hit=i===cnt.answerIdx;
    [...$('choices').children].forEach((b,k)=>{ if(k===cnt.answerIdx) b.classList.add('correct'); else if(k===i) b.classList.add('wrong'); });
    cnt.trial++; cnt.history.push({n:cnt.n,hit});
    const cont=contentOf('Crowd');
    if(hit){ cnt.best=Math.max(cnt.best,cnt.n); cnt.ability=Math.min(7.4, cnt.ability + (cnt.n>=cnt.ability?0.7:0.3)); }
    else { cnt.wrong++; cnt.ability=Math.max(3, cnt.ability-0.9); }
    // confidence: proportion of run done + convergence of best
    const frac=clamp(cnt.trial/cnt.maxR,0,1);
    setPrecision(frac, `top count ${creditedCount()}`);
    const enough=cnt.trial>=cnt.minR && (cnt.wrong>=2);
    if(cnt.trial>=cnt.maxR || enough){ finishCount(); return; }
    $('status').innerHTML = hit? `✓ ${pick(cont.hit)}` : `○ ${pick(cont.miss)}`;
    choiceTimers.push(setTimeout(()=>{ [...$('choices').children].forEach(b=>b.classList.remove('correct','wrong')); countTrial(); }, 640));
  }
  // a count level is only CREDITED once two hits land at that size or larger — with three options
  // there's a 33% guess floor, so a single lucky tap at 7 was permanently pinning the score at 100%.
  function creditedCount(){
    for(let m=7;m>3;m--){ if(cnt.history.filter(h=>h.hit&&h.n>=m).length>=2) return m; }
    return 3;
  }
  function finishCount(){
    if(cnt.done) return; cnt.done=true; guessLocked=true; stopVoices();
    const best=creditedCount();                  // 3 is the smallest ensemble ever presented
    const pct=Math.round(clamp((best-3)/(7-3),0,1)*100);
    recordRoom(pct, best+' voices', {val:best});
    $('status').innerHTML=`You held <span class="pts">${best} voices</span> apart · +${pct}`;
    setPrecision(1, best+' voices');
    showLearn(); appendTier(tierLine('Crowd',pct));
    showResultBtns(false);   // Redo only (no "sharpen" for a counting task)
    advanceUI();
  }
  // ---------- digits-in-noise: three spoken digits inside babble made from the same voice ----------
  // The calibration-robust paradigm from the boothless-audiometry literature (Potgieter 2016 etc):
  // speech and masker share the transducer at the same moment, so the measured SRT is a RATIO and
  // level/frequency-response error largely cancels. Babble is built from the digit corpus itself,
  // so signal and noise share one long-term spectrum. Voice is synthetic (documented in Methods).
  const DIG={log:false, hard:.9, floor:-16, ceil:6, anchors:[0,-12], betterHigh:false,
    gamma:0.002, nMin:8, nMax:14, physLo:-18, physHi:7, fmt:v=>'SRT '+(v>0?'+':'')+Math.round(v)+' dB'};
  const DIG_NOISE_RMS=0.055;                 // masker RMS at master; digits ride at RMS·10^(SNR/20)
  let dig=null, DIGBUF=null;
  function loadDigits(){
    if(DIGBUF) return Promise.resolve(DIGBUF);
    if(!window.SR_DIGITS) return Promise.reject(new Error('digit corpus missing'));
    const toBuf=b64=>{ const bin=atob(b64), u=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
      return new Promise((res,rej)=>ctx.decodeAudioData(u.buffer,res,rej)); };
    return Promise.all(window.SR_DIGITS.map(toBuf)).then(digits=>{
      // babble: 18 randomly-offset digit tokens summed into 3.5 s — same spectrum as the speech
      const sr=ctx.sampleRate, len=Math.round(sr*3.5);
      const bb=ctx.createBuffer(1,len,sr), d=bb.getChannelData(0);
      for(let k=0;k<18;k++){
        const src=digits[Math.floor(Math.random()*10)].getChannelData(0);
        const at=Math.floor(Math.random()*(len-src.length));
        for(let i=0;i<src.length;i++) d[at+i]+=src[i];
      }
      let q=0; for(let i=0;i<len;i++) q+=d[i]*d[i];
      const g=1/Math.sqrt(q/len);            // normalise babble to unit RMS; playback gain sets level
      for(let i=0;i<len;i++) d[i]*=g;
      DIGBUF={digits, babble:bb};
      return DIGBUF;
    });
  }
  function digitTriplet(snrDb, trip){
    const t0=ctx.currentTime+0.15, dur=2.9;
    const nb=ctx.createBufferSource(); nb.buffer=DIGBUF.babble; nb.loop=true; nb.loopStart=0; nb.loopEnd=DIGBUF.babble.duration;
    nb.start(t0, Math.random()*2.0);
    const ng=ctx.createGain(); ng.gain.setValueAtTime(0,t0); ng.gain.linearRampToValueAtTime(DIG_NOISE_RMS,t0+.15);
    ng.gain.setValueAtTime(DIG_NOISE_RMS,t0+dur-.2); ng.gain.linearRampToValueAtTime(0,t0+dur);
    nb.connect(ng); ng.connect(master); nb.stop(t0+dur+.05);
    // digits: corpus is RMS-normalised to 0.10, so scale to noiseRMS·10^(SNR/20)
    const dgGain=DIG_NOISE_RMS*Math.pow(10,snrDb/20)/0.10;
    let at=t0+0.55;
    trip.forEach(d=>{
      const s=ctx.createBufferSource(); s.buffer=DIGBUF.digits[d];
      const g=ctx.createGain(); g.gain.value=dgGain;
      s.connect(g); g.connect(master); s.start(at); at+=DIGBUF.digits[d].duration+0.22;
    });
    return dur;
  }
  function setupDigits(c){
    $('precision').querySelector('.plabel span').textContent='Precision';
    showPrecisionUI();
    dig={eng:null, trial:0, trip:null, entered:[], warm:true, log:[], done:false};
    $('status').textContent='Loading the voice…';
    loadDigits().then(()=>{ if(!dig) return;
      dig.eng=window.SR_PSI.forRoom(DIG);
      digitsTrial();
    }).catch(()=>{ $('status').textContent='Could not load the voice — Skip this room.'; });
  }
  function digitsTrial(){
    const keys=[];
    for(let i=0;i<3;i++){ let d; do{ d=Math.floor(Math.random()*10); }while(keys.includes(d)); keys.push(d); }
    dig.trip=keys; dig.entered=[];
    dig.curX=dig.eng.z.next(); dig.curLevel=dig.warm? 6 : dig.eng.levelOf(dig.curX);
    const btns=buildChoices(['0','1','2','3','4','5','6','7','8','9'], null, digitsPick);
    $('choices').classList.add('digitpad');
    const play=()=>{
      choiceTimers.forEach(t=>clearTimeout(t)); choiceTimers=[];
      dig.entered=[]; setChoicesEnabled(false); setReplay(false); roveTrial();
      $('status').innerHTML = dig.warm
        ? '<span class="pts">Practice</span> <span style="color:var(--muted)">· loud and clear — this doesn’t count</span>'
        : `Trial ${dig.trial+1} <span style="color:var(--muted)">of ≤${dig.eng.nMax}</span> · <span class="pts">listen…</span>`;
      const dur=digitTriplet(dig.curLevel, dig.trip);
      choiceTimers.push(setTimeout(()=>{ setChoicesEnabled(true); setReplay(true);
        $('status').innerHTML='Which three digits, in order? <span style="color:var(--muted)">· · ·</span>'; },(dur+0.2)*1000));
    };
    replayFn=play; play();
  }
  function digitsPick(i){
    if(!dig || dig.done || dig.entered.length>=3) return;
    dig.entered.push(i);
    const dots=dig.entered.join(' ')+' '+['·','·','·'].slice(dig.entered.length).join(' ');
    $('status').innerHTML='Which three digits, in order? <span class="pts">'+dots.trim()+'</span>';
    if(dig.entered.length<3) return;
    setChoicesEnabled(false); setReplay(false); killStim();
    const hit=dig.entered.every((d,k)=>d===dig.trip[k]);
    const truth=dig.trip.join(' ');
    if(dig.warm){ dig.warm=false;
      $('status').innerHTML=(hit?'✓ '+truth:'○ It was <b>'+truth+'</b>')+' <span style="color:var(--muted)">— now the noise closes in</span>';
      choiceTimers.push(setTimeout(digitsTrial, 1100)); return;
    }
    dig.eng.z.record(dig.curX, hit); dig.trial++;
    dig.log.push([Math.round(dig.curLevel*10)/10, hit?1:0]);
    const st=dig.eng.z.stats();
    setPrecision(st.conf, DIG.fmt(dig.eng.levelOf(st.mean)));
    $('status').innerHTML = hit ? '✓ All three.' : '○ It was <b>'+truth+'</b>.';
    if(st.usable||st.forceStop){ choiceTimers.push(setTimeout(finishDigits, 600)); return; }
    choiceTimers.push(setTimeout(digitsTrial, 900));
  }
  function finishDigits(){
    if(!dig||dig.done) return; dig.done=true; guessLocked=true; clearTimers();
    const st=dig.eng.z.stats(), thr=dig.eng.levelOf(st.mean);
    const b1=dig.eng.levelOfRaw(st.ci[0]), b2=dig.eng.levelOfRaw(st.ci[1]);
    const pct=pctFromThreshold(DIG,thr);
    recordRoom(pct, DIG.fmt(thr), {val:thr, lo:Math.min(b1,b2), hi:Math.max(b1,b2), trials:dig.log});
    $('status').innerHTML=`You follow the voice down to <span class="pts">${DIG.fmt(thr)}</span> · +${pct} <span style="color:var(--muted)">· ${Math.round(st.conf*100)}% locked in</span>`;
    showLearn(); appendTier(tierLine('Digits',pct));
    showResultBtns(!st.solid);
    advanceUI();
  }

  // ---------- audiogram: a personalised Hz × dB curve (your ears + these headphones) ----------
  // For each frequency we find the quietest audible level with a single-interval YES/NO track: one
  // bounded listen window, "I hear it" vs "Nothing", plus ~20% SILENT catch trials for false-alarm
  // control. The Ψ-marginal engine runs with gamma=0.03 (near-zero guess floor) so the localised
  // point is a true detection threshold, not a 2AFC midpoint — and silence becomes an expected,
  // answerable state instead of the confusing "one interval is always empty" of a 2-interval task.
  // Absolute level uncalibrated; the curve SHAPE relative to your own 1 kHz is real (ears+headphone).
  const AG_FREQS=[125,250,500,1000,2000,4000,8000,12000,16000];
  // base pass (both modes) walks OUTWARD from 1 kHz so every new frequency is seeded by a measured neighbour
  const AG_BASE_PLAN=[1000,2000,4000,8000,12000,16000,500,250,125];
  // Phase-B inter-octave infill: always-add 3k/6k (the fast-moving 2–8 kHz roll-off band); adaptively
  // add 1.5k/750/10k only where the measured bracket slope is steep, so resolution is spent on knees.
  const AG_INFILL=[
    {f:3000, lo:2000, hi:4000, always:true},  {f:6000, lo:4000, hi:8000, always:true},
    {f:1500, lo:1000, hi:2000, always:false}, {f:750, lo:500, hi:1000, always:false},
    {f:10000,lo:8000, hi:12000,always:false},
  ];
  const AG_SLOPE_TRIG=8;                         // dB/octave bracket slope that triggers an adaptive insert
  const AG_INFILL_CAP={both:5, perear:3};        // per-ear cap (per-ear path is 2× the work → tighter)
  const AG_TRIAL_BUDGET={both:95, perear:70};    // skip further ADAPTIVE inserts once this ear's real trials pass this
  const EAR_PAN={R:1, L:-1, B:0}, EAR_NAME={R:'Right ear', L:'Left ear', B:'Both ears'};
  // tone level above which cross-hearing becomes plausible and contralateral masking is worth its
  // distraction. Below it the resting ear stays silent — which is most trials for a normal ear.
  const MASK_FROM=-45;
  const AG_ROOM={log:false, hard:.9, floor:-90, ceil:-12, anchors:[-26,-74], betterHigh:false, gamma:0.03, nMin:6, nMax:12, physLo:-94, physHi:-10, fmt:v=>Math.round(v)+' dBFS'};   // phys clamps: auto-widen can never wander past what we can actually play
  let ag=null;

  // hearing-curve as a tour room: launch the curve screen, then rejoin the tour on "Continue →"
  function startCurveRoom(){ curveInTour=true; $('skipbtn').classList.remove('on'); $('cvexit').textContent='Continue →'; startCurve(); }
  function finishCurveRoom(){
    curveInTour=false; $('cvexit').textContent='Done'; stopCurveAudio();
    roomDone[order[oi]]=true;                       // mark the curve room complete (unscored)
    show('game');
    if(oi<order.length-1){ oi++; loadChapter(); } else finish();
  }
  function startCurve(){
    initAudio(); ctx.resume(); stopVoices(); rvF=1; anchorMaster(0.85);
    if(!device) device=suggestName();
    if(!curveInTour) currentRunId=uid('r');    // standalone curve = its own occasion; in-tour reuses the tour runId
    ag={fi:0, phase:'cal', calTimer:null, mode:'both', pts:{R:{},L:{},B:{}}, ptsMeta:{R:{},L:{},B:{}}, faTot:{R:0,L:0,B:0}, caTot:{R:0,L:0,B:0}};
    // mid-run there is NO Continue/Done/Redo: a visible "Continue →" during the measurement read
    // as a normal next-step and silently ABORTED the room, marking it complete. The only mid-run
    // exit is ⌂ Home (progress-safe). The exit row returns when the curve actually finishes.
    $('cvsave').style.display='none'; $('cvexit').style.display='none'; $('cvredo').style.display='none';
    show('curve'); agCal();
  }
  async function saveCurveCard(){
    const svg=$('cvcard').querySelector('svg'); if(!svg) return;
    try{ await sharePNG(svg, `stone-room-curve-${device.replace(/[^\w-]+/g,'_')}.png`); }
    catch(e){ flashSaved('could not save curve'); }
  }
  function stopCurveAudio(){ if(ag&&ag.calTimer){clearTimeout(ag.calTimer); ag.calTimer=null;} clearTimers(); }
  function agCal(){
    $('cvTitle').textContent='Set your volume';
    $('cvNote').innerHTML='A steady <b>1 kHz</b> tone will play. Turn your device volume until it’s clearly but comfortably present — then leave it there. That’s your reference for the whole test.';
    $('cvprog').textContent=''; $('cvwrap').style.display='none';
    const box=$('cvChoices'); box.innerHTML='';
    const play=document.createElement('button'); play.className='btn'; play.textContent='▶ Play 1 kHz';
    const go=document.createElement('button'); go.className='btn ghost'; go.textContent='Volume set — begin'; go.style.display='none'; go.style.marginLeft='8px';
    play.onclick=()=>{ stopCurveAudio(); const step=()=>{ if(!ag||ag.phase!=='cal')return; detTone(1000, ctx.currentTime+.02, .5, -18, 0); ag.calTimer=setTimeout(step,720); }; step(); play.textContent='↺ Again'; go.style.display='inline-block'; };
    go.onclick=()=>{ stopCurveAudio(); killStim(); agPrecheck(); };
    box.appendChild(play); box.appendChild(go);
  }
  // PRE-CHECK — prove the signal chain before measuring. This is what stops the test from reading a
  // phone SPEAKER's bass roll-off or a fan's masking instead of the listener's ears: (1) a VERIFIABLE
  // left/right tone check (headphones on, sides not swapped), then (2) a quiet-room listen.
  function agPrecheck(){ ag.phase='pre'; ag.pcLevel=-14; $('cvwrap').style.display='none'; agPcChannel('L'); }
  function agPcChannel(side){
    ag.phase='pre'; ag.pcSide=side; ag.pcMiss=0; $('cvprog').textContent='Check · headphones';
    $('cvTitle').textContent='Headphone check';
    $('cvNote').innerHTML='Headphones on. A two-note chime is playing in <b>one</b> ear — which side is it on? If it’s faint, nudge your volume up.';
    const box=$('cvChoices'); box.innerHTML='';
    const mk=(lbl,val,sub,cls)=>{ const b=document.createElement('button'); b.className='choice'+(cls?' '+cls:''); b.innerHTML=lbl+(sub?`<small>${sub}</small>`:''); b.onclick=()=>agPcAnswer(val); return b; };
    box.appendChild(mk('Left','L')); box.appendChild(mk('Right','R'));
    const brk=document.createElement('span'); brk.className='brk'; box.appendChild(brk);   // L/R big on row 1; escapes smaller on row 2
    box.appendChild(mk('Both sides','B','can’t tell them apart','alt'));
    box.appendChild(mk('I don’t hear it','N','nothing this time','alt'));
    const rep=document.createElement('button'); rep.className='replay'; rep.innerHTML='<span>↺</span> Replay'; rep.onclick=()=>{ if(ag&&ag.pcPlay)ag.pcPlay(); }; box.appendChild(rep);
    const play=()=>{ stopCurveAudio(); clearTimers();
      anchorMaster(0.85);
      const pan = side==='L'?-1:1;
      // a low-mid two-note chime, not a lone quiet 1 kHz sine: the check must prove the CHANNEL,
      // not the listener — a notched or high-frequency loss in the tested ear shouldn't fail it.
      const step=()=>{ if(!ag||ag.phase!=='pre')return; const t=ctx.currentTime+.02;
        detTone(600, t, .30, ag.pcLevel, pan); detTone(900, t+.36, .30, ag.pcLevel, pan);
        ag.calTimer=setTimeout(step,1150); };
      step(); };
    ag.pcPlay=play; play();
  }
  function agPcAnswer(val){
    if(!ag||ag.phase!=='pre')return;
    stopCurveAudio(); killStim();
    if(val==='N'){                                          // didn't hear it → try louder before judging:
      if(ag.pcMiss<1){ ag.pcMiss++; ag.pcLevel=Math.min(-6, ag.pcLevel+8);   // a faint chime in a weaker
        $('cvNote').innerHTML='Turning it up — same side. Listen again…';    // ear is normal, and exactly
        if(ag.pcPlay)ag.pcPlay(); return; }                                  // what this test measures
      agPcFail('silent'); return;
    }
    if(val==='B'){ agPcFail('speaker'); return; }          // both ears at once → speaker or mono blend
    if(val!==ag.pcSide){ agPcFail('swapped'); return; }     // heard in the other ear → L/R reversed
    if(ag.pcSide==='L'){ agPcChannel('R'); return; }        // left ok → verify right
    agPcQuiet();                                            // both sides correct → quiet check
  }
  function agPcFail(kind){
    ag.phase='pre'; stopCurveAudio(); $('cvprog').textContent='Check · headphones';
    $('cvTitle').textContent = kind==='swapped' ? 'Channels look swapped' : kind==='silent' ? 'One side stayed quiet' : 'Sounds like a speaker';
    $('cvNote').innerHTML = kind==='swapped'
      ? 'That tone was in your <b>other</b> ear — your left/right channels look reversed, so a per-ear result would be mislabelled. Check the L/R on your headphones, or run the both-ears test instead.'
      : kind==='silent'
      ? 'Even louder, nothing came through on the <b>'+(ag.pcSide==='L'?'left':'right')+'</b>. Two honest possibilities: that side of the headphones isn’t playing (connection, cable, a Bluetooth hiccup) — or that ear needs more level than the other, which is exactly what this test measures. Reconnect and try again, or carry on and let the per-ear curve tell the story.'
      : 'It seemed to come from both sides at once. This test needs <b>headphones</b> — on a speaker it measures the speaker, not your ears, and can’t tell left from right.';
    const box=$('cvChoices'); box.innerHTML='';
    const retry=document.createElement('button'); retry.className='choice alt'; retry.innerHTML='Try again<small>re-check headphones</small>'; retry.onclick=()=>agPcChannel('L');
    const anyway=document.createElement('button'); anyway.className='choice alt'; anyway.innerHTML='Continue anyway<small>results may be off</small>'; anyway.onclick=()=>agPcQuiet();
    box.appendChild(retry); box.appendChild(anyway);
  }
  function agPcQuiet(){
    ag.phase='pre'; stopCurveAudio(); $('cvprog').textContent='Check · quiet room';
    $('cvTitle').textContent='Quiet check';
    $('cvNote').innerHTML='Headphones confirmed. Now the room — <b>stop and listen</b> for a few seconds with nothing playing. Background sound (a fan, traffic, a hum) hides the quietest tones and bends the curve.';
    const box=$('cvChoices'); box.innerHTML='';
    const listen=document.createElement('button'); listen.className='btn half'; listen.textContent='▶ Listen (4s)';
    const brkQ=document.createElement('span'); brkQ.className='brk';
    const silent=document.createElement('button'); silent.className='choice alt'; silent.innerHTML='It was silent<small>ready to test</small>'; silent.style.display='none';
    const noisy=document.createElement('button'); noisy.className='choice alt'; noisy.innerHTML='I heard noise<small>quieter spot is better</small>'; noisy.style.display='none';
    // optional: measure the room with the device mic. This is a QUALITY-CONTROL check (is background
    // noise likely to swamp the quietest tones?) — NOT a calibration. A phone mic has no known
    // sensitivity, so it can compare your room to itself, never to a decibel standard. Nothing is
    // recorded, stored or sent; the stream is released the moment the reading ends.
    let micBtn=null;
    const canMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
    if(canMic){
      const mic=document.createElement('button'); mic.className='btn ghost half'; mic.textContent='🎙 Measure the room';
      mic.onclick=async()=>{
        mic.disabled=true; stopCurveAudio(); clearTimers();
        anchorMaster(0.0001);
        let stream=null;
        try{
          stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false, autoGainControl:false, noiseSuppression:false}});
          const src=ctx.createMediaStreamSource(stream);
          const an=ctx.createAnalyser(); an.fftSize=2048; src.connect(an);
          const sink=ctx.createGain(); sink.gain.value=0; an.connect(sink); sink.connect(ctx.destination);   // silent sink keeps the graph pulled; nothing is audible
          ag.micNodes=[src,an,sink];
          const buf=new Float32Array(an.fftSize);
          let peak=0, sum=0, n=0, ticks=0;
          $('cvNote').innerHTML='Listening to the room… stay quiet and still.';
          await new Promise(res=>{
            const step=()=>{
              if(!ag||ag.phase!=='pre'){ res(); return; }
              an.getFloatTimeDomainData(buf);
              let q=0; for(let i=0;i<buf.length;i++) q+=buf[i]*buf[i];
              const rms=Math.sqrt(q/buf.length);
              sum+=rms; n++; if(rms>peak) peak=rms;
              const db=20*Math.log10(Math.max(rms,1e-8));
              const pctBar=clamp((db+80)/60,0,1)*100;     // −80…−20 dBFS across the meter
              $('cvprog').textContent='Room level '+'▇'.repeat(Math.round(pctBar/10))+'▁'.repeat(10-Math.round(pctBar/10));
              if(++ticks<40){ ag.calTimer=setTimeout(step,100); } else res();
            };
            step();
          });
          const avg=20*Math.log10(Math.max(sum/Math.max(n,1),1e-8));
          const pk=20*Math.log10(Math.max(peak,1e-8));
          const verdict = avg<=-55 ? {t:'Sounds like a quiet room.', ok:true}
            : avg<=-45 ? {t:'There’s some background noise.', ok:false}
            : {t:'That’s a noisy room for this test.', ok:false};
          $('cvprog').textContent='Check · quiet room';
          $('cvNote').innerHTML = verdict.t+' <span style="color:var(--muted)">(rough reading: your mic averaged '
            +Math.round(avg)+' dBFS, peaks near '+Math.round(pk)+'. A phone mic isn’t calibrated, so this compares your room to itself — it is not a decibel measurement.)</span>'
            +(verdict.ok?' Good to go.':' A quieter spot — or turning off a fan — makes the quietest tones measurable rather than guessed.');
          silent.style.display=''; noisy.style.display=''; listen.textContent='↺ Listen again';
        }catch(e){
          $('cvNote').innerHTML='No microphone reading (permission declined or unavailable) — no problem, just listen for yourself instead.';
          silent.style.display=''; noisy.style.display='';
        }finally{
          if(stream) stream.getTracks().forEach(t=>t.stop());     // release the mic immediately
          if(ag&&ag.micNodes){ ag.micNodes.forEach(n=>{ try{n.disconnect();}catch(e){} }); ag.micNodes=null; }
          anchorMaster(0.85);
          mic.disabled=false;
        }
      };
      micBtn=mic;
    }
    listen.onclick=()=>{ stopCurveAudio(); clearTimers(); anchorMaster(0.0001);
      $('cvNote').innerHTML='Listening… stay still.'; let n=4; $('cvprog').textContent='Quiet check · '+n+'s';
      const tick=()=>{ if(!ag||ag.phase!=='pre')return; n--;
        if(n>0){ $('cvprog').textContent='Quiet check · '+n+'s'; ag.calTimer=setTimeout(tick,1000); }
        else { $('cvprog').textContent='Check · quiet room'; $('cvNote').innerHTML='In that quiet, did you hear any background noise (a fan, traffic, a hum)?';
          silent.style.display=''; noisy.style.display=''; listen.textContent='↺ Listen again'; anchorMaster(0.85); } };
      ag.calTimer=setTimeout(tick,1000); };
    silent.onclick=()=>agMode();
    noisy.onclick=()=>{ $('cvNote').innerHTML='A quieter spot gives a truer curve — but you can carry on. Just treat the very quietest tones as rough.';
      const b=$('cvChoices'); b.innerHTML='';
      const go=document.createElement('button'); go.className='choice alt'; go.innerHTML='Test anyway<small>continue</small>'; go.onclick=()=>agMode();
      const again=document.createElement('button'); again.className='choice alt'; again.innerHTML='Re-check<small>listen again</small>'; again.onclick=()=>agPcQuiet();
      b.appendChild(go); b.appendChild(again); };
    box.appendChild(listen); if(micBtn) box.appendChild(micBtn);
    box.appendChild(brkQ); box.appendChild(silent); box.appendChild(noisy);   // actions row, then answers row
  }
  // per-ear (the only way to see a left/right difference) vs both-ears quick
  function agMode(){
    ag.phase='mode'; $('cvwrap').style.display='none';
    $('cvTitle').textContent='How to test'; $('cvprog').textContent='';
    $('cvNote').innerHTML='Testing each ear on its own is the only way to see a <b>left/right difference</b> — a strong ear otherwise hides a weak one. When a tone has to get loud, a <b>soft rush</b> joins in the resting ear; that’s deliberate, and it keeps that ear from secretly helping. Both-ears is quicker.';
    const box=$('cvChoices'); box.innerHTML='';
    const per=document.createElement('button'); per.className='choice alt'; per.innerHTML='Each ear<small>finds a left/right difference · ~4 min</small>'; per.onclick=()=>agStartRun('perear');
    const both=document.createElement('button'); both.className='choice alt'; both.innerHTML='Both ears<small>quicker · one curve · ~2 min</small>'; both.onclick=()=>agStartRun('both');
    box.appendChild(per); box.appendChild(both);
  }
  function agStartRun(mode){
    ag.mode=mode; ag.ears = mode==='perear'?['R','L']:['B']; ag.ei=0;
    ag.pts={R:{},L:{},B:{}}; ag.ptsMeta={R:{},L:{},B:{}}; ag.faTot={R:0,L:0,B:0}; ag.caTot={R:0,L:0,B:0};
    ag.log={R:{},L:{},B:{}};   // raw [level, heard] per frequency — exported, and reused by the gamma refit
    ag.phase='run';
    $('cvwrap').style.display='block'; agLiveDraw();       // reveal the curve canvas; it fills in as we go
    agEar();
  }
  function agEar(){
    ag.curEar=ag.ears[ag.ei]; ag.pan=EAR_PAN[ag.curEar]; ag.fi=0; ag.prevThr=null;
    ag.earTrials=0; ag.phaseB=false; ag.phaseC=false;      // per-ear tally + infill-pass + verify-pass flags
    ag.warm = ag.ei===0;                                   // one obvious practice tone before the first ear
    ag.plan = AG_BASE_PLAN.slice();                         // base octaves; Phase-B appends inter-octaves
    agFreq();
  }
  // Phase-B: after the base octaves lock, pick inter-octave infill points for this ear — always the
  // half-octaves (3k/6k), plus adaptive knees (1.5k/750/10k) where the bracket slope is steep. Each
  // infill point sits between two LOCKED neighbours, so agFreq interpolation-seeds it → ~3–4 trials.
  function agPlanInfill(ear){
    const pts=ag.pts[ear], key=ag.mode==='perear'?'perear':'both';
    const cap=AG_INFILL_CAP[key], budget=AG_TRIAL_BUDGET[key], out=[];
    for(const c of AG_INFILL){
      if(pts[c.lo]==null||pts[c.hi]==null) continue;
      const slope=Math.abs(pts[c.hi]-pts[c.lo])/Math.log2(c.hi/c.lo);   // level units are dB here
      if(c.always||slope>=AG_SLOPE_TRIG) out.push({f:c.f,slope,always:c.always});
    }
    out.sort((a,b)=>(b.always-a.always)||(b.slope-a.slope));            // always-adds first, then steepest
    const chosen=[];
    for(const c of out){ if(chosen.length>=cap) break;
      if(!c.always && (ag.earTrials||0)>=budget) continue; chosen.push(c.f); }
    return chosen.sort((a,b)=>a-b);
  }
  // verify pass: the 1-2 measured points with the widest Ψ CI (≥5 dB, not ceiling-pinned) get a
  // short anchored re-test — a few extra trials that either confirm the reading or pull it true
  function agPlanVerify(ear){
    const meta=ag.ptsMeta[ear]||{};
    return Object.keys(meta).map(Number)
      .filter(f=>meta[f] && !meta[f].cens && meta[f].ci!=null && meta[f].ci>=5)
      .sort((a,b)=>meta[b].ci-meta[a].ci).slice(0,2).sort((a,b)=>a-b);
  }
  function agFreq(){
    const f=ag.plan[ag.fi];
    // seed the prior: an infill point interpolates BOTH its locked brackets; a base point uses the
    // previous locked threshold of THIS ear. Either way → a tight informed prior → fewer trials.
    const pts=ag.pts[ag.curEar], spec=AG_INFILL.find(c=>c.f===f);
    let seed={};
    if(pts[f]!=null){
      // verify re-test: anchor on the existing reading and confirm/refine it in a few trials
      seed={priorSeed:pts[f], priorSDscale:0.5, nMin:3};
    } else if(spec && pts[spec.lo]!=null && pts[spec.hi]!=null){
      const w=Math.log2(f/spec.lo)/Math.log2(spec.hi/spec.lo);
      seed={priorSeed: pts[spec.lo]+w*(pts[spec.hi]-pts[spec.lo]), priorSDscale:0.4, nMin:3};
    } else {
      // slope-aware seed from the two nearest locked points (in log-f): flat-carrying the previous
      // threshold made every new frequency on a steep loss start far too quiet and burn trials
      // chasing the dive; continuing the local trend starts it where the ear actually is. Also fixes
      // the plan's 16k→500 jump, which used to seed the lows from the treble.
      const done=Object.keys(pts).map(Number).filter(x=>pts[x]!=null)
        .sort((a,b)=>Math.abs(Math.log2(a/f))-Math.abs(Math.log2(b/f)));
      if(done.length){
        let sd=pts[done[0]];
        if(done.length>=2){
          const n1=done[0], n2=done[1];
          const ext=pts[n1]+(pts[n1]-pts[n2])/Math.log2(n1/n2)*Math.log2(f/n1);
          sd=clamp(ext, pts[n1]-15, pts[n1]+15);          // cap the extrapolation — trends bend
        }
        seed={priorSeed:sd, priorSDscale: Math.abs(Math.log2(done[0]/f))<=1?0.45:0.55, nMin:4};
      }
    }
    ag.eng=window.SR_PSI.forRoom(Object.assign({}, AG_ROOM, seed)); ag.trial=0;
    ag.catchCount=0; ag.fa=0; ag.faShown=0; ag.noneMax=0;
    ag.catchCap=Math.max(2, Math.round((ag.eng.nMax||12)*0.35));   // ≤ ~4 silent trials per frequency
    const earLbl = ag.mode==='perear' ? EAR_NAME[ag.curEar]+' · ' : '';
    $('cvTitle').textContent = earLbl + (f>=1000?(f/1000)+' kHz':f+' Hz');
    $('cvprog').textContent = `${EAR_NAME[ag.curEar]} · tone ${ag.fi+1} of ${ag.plan.length}`;
    agTrial();
  }
  function agTrial(){
    ag.curX=ag.eng.z.next(); ag.curLevel=ag.eng.levelOf(ag.curX);
    if(ag.warm) ag.curLevel=-30;              // practice: unmistakably audible, never recorded
    // ~20% SILENT catch trials — never the first of a frequency (need one real reference), capped —
    // so "I heard nothing" is a normal, expected answer and false alarms can be measured.
    ag.catch = !ag.warm && ag.trial>0 && (ag.catchCount||0)<ag.catchCap && Math.random()<0.2;
    if(ag.catch){ ag.catchCount=(ag.catchCount||0)+1; if(ag.caTot) ag.caTot[ag.curEar]=(ag.caTot[ag.curEar]||0)+1; }   // presented-catch tally → FA is judged as a RATE
    const f=ag.plan[ag.fi];
    const box=$('cvChoices'); box.innerHTML='';
    const hear=document.createElement('button'); hear.className='choice'; hear.innerHTML='I hear it<small>tap the moment you do</small>'; hear.onclick=()=>agAnswer('hear');
    const none=document.createElement('button'); none.className='choice'; none.innerHTML='Nothing<small>silence this time</small>'; none.onclick=()=>agAnswer('none');
    box.appendChild(hear); box.appendChild(none);
    if((ag.noneMax||0)>=3){   // several "Nothing"s at the loudest we can play → offer the honest exit
      const brk=document.createElement('span'); brk.className='brk'; box.appendChild(brk);
      const giveup=document.createElement('button'); giveup.className='choice alt';
      giveup.innerHTML='I can’t hear this one<small>mark beyond reach · continue</small>';
      giveup.onclick=()=>agGiveUp(); box.appendChild(giveup);
    }
    const rep=document.createElement('button'); rep.className='replay'; rep.innerHTML='<span>↺</span> Replay'; rep.onclick=()=>{ if(ag&&ag.replay)ag.replay(); }; box.appendChild(rep);
    const play=()=>{
      clearTimers(); hear.disabled=true; none.disabled=true; hear.classList.remove('playing');
      anchorMaster(0.85);   // constant reference each trial
      $('cvNote').textContent = (ag.pan && ag.curLevel>MASK_FROM && !ag.rushSaid)
        ? 'Listen… a soft rush in your other ear keeps it from helping on the louder tones.' : 'Listen…';
      if(ag.pan && ag.curLevel>MASK_FROM) ag.rushSaid=true;   // explain the rush the first time it appears
      const lead=.18, win=1.30, t0=ctx.currentTime+lead;
      // clinical-style PULSED tone (3 short bursts): a steady tone is easy to confuse with tinnitus —
      // which tends to live exactly where hearing is weakest; pulses are unmistakably "the test".
      if(!ag.catch){ const pd=.28, gap=.12;
        for(let k=0;k<3;k++) detTone(f, t0+k*(pd+gap), pd, ag.curLevel, ag.pan); }
      // Per-ear runs: mask the resting ear ONLY where cross-hearing is actually possible. A tone
      // must be loud before it reaches the far cochlea through the skull (~45 dB of interaural
      // attenuation), so masking a quiet tone protects nothing and just fills that ear with noise.
      // The old floor — max(−70, tone−18) — stopped the mask descending with the tone, so once the
      // tone passed −52 dBFS the "mask" was LOUDER than the tone it was meant to sit under: the
      // resting ear became a wall of noise and the beeps vanished beneath it.
      // Now: silent for quiet tones; above the gate it rides a true 18 dB under the tone.
      // Independent of ag.catch, so a silent trial sounds identical — the rush is never a tell.
      if(ag.pan && ag.curLevel>MASK_FROM) detMask(f, t0-.06, win, ag.curLevel-18, -ag.pan);
      // "I hear it" answerable exactly at window onset (identical timing on catch trials — no tell)
      choiceTimers.push(setTimeout(()=>{ if(ag&&ag.phase==='run'){ hear.disabled=false; hear.classList.add('playing'); $('cvNote').innerHTML='Now — tap <b>I hear it</b> the instant you notice it.'; } }, lead*1000));
      // "Nothing" answerable only AFTER the window has fully passed
      choiceTimers.push(setTimeout(()=>{ if(ag&&ag.phase==='run'){ none.disabled=false; hear.classList.remove('playing'); $('cvNote').innerHTML='Heard it, or nothing?'; } }, Math.max((lead+win)*1000, 260)));
    };
    ag.replay=play; play();
  }
  function agAnswer(ans){
    if(!ag||ag.phase!=='run')return;
    clearTimers();                         // kill the pending enable-timers too: a stale 'Nothing'-enable
                                           // re-armed a disabled button after a late 'I hear it' tap and
                                           // invited a contradictory second record into the wrong slot
    killStim();                            // stop the tone the instant you answer
    // disable EVERY control including Replay: a Replay tapped in the post-lock gap re-fired the
    // finished trial while ag.fi had already advanced, writing the old frequency's threshold
    // into the NEXT frequency's slot (tens of dB wrong) and skipping a point — silently
    ag.replay=null;
    [...$('cvChoices').querySelectorAll('button')].forEach(b=>b.disabled=true);
    const heard = ans==='hear';
    if(ag.warm){                             // practice tone: teaches the window, never recorded
      ag.warm=false;
      $('cvNote').innerHTML = heard
        ? 'That’s it — from here they get quieter, and some rounds are <b>silent</b> on purpose.'
        : 'That one was clearly there. Turn the volume up a little, then carry on — and remember some rounds are <b>silent</b> on purpose.';
      choiceTimers.push(setTimeout(agTrial,900));
      return;
    }
    if(ag.catch){
      // catch trial: EXCLUDED from the estimate — tallies false alarms per ear (gates the warning) and nudges
      if(heard){ ag.fa=(ag.fa||0)+1; ag.faTot[ag.curEar]=(ag.faTot[ag.curEar]||0)+1;
        if((ag.faShown||0)<2){ ag.faShown=(ag.faShown||0)+1; $('cvNote').innerHTML='That one was <b>silent</b> — listen carefully for the tone.'; }
        else $('cvNote').textContent='That one was silent.';
      } else $('cvNote').textContent='Right — silence.';
      choiceTimers.push(setTimeout(agTrial,700));
      return;
    }
    if(!heard && ag.curLevel>=(AG_ROOM.physHi!=null?AG_ROOM.physHi:-10)-2) ag.noneMax=(ag.noneMax||0)+1;   // "Nothing" at max level
    else if(heard) ag.noneMax=0;
    ag.eng.z.record(ag.curX, heard); ag.trial++; ag.earTrials=(ag.earTrials||0)+1;
    if(ag.log){ const f=ag.plan[ag.fi]; (ag.log[ag.curEar][f]=ag.log[ag.curEar][f]||[]).push([Math.round(ag.curLevel*10)/10, heard?1:0]); }
    const st=ag.eng.z.stats();
    if(st.usable||st.forceStop){
      const f=ag.plan[ag.fi];
      const lvl=ag.eng.levelOf(st.mean);
      ag.pts[ag.curEar][f]=lvl; ag.prevThr=lvl;
      // CI half-width from the UNCLAMPED posterior: when a CI straddles a rail, clamping both
      // endpoints to the rail collapsed the width to ~0 — the least-certain points entered the
      // GP as the most trusted and the band drew tightest exactly where the data ran out.
      const loL=ag.eng.levelOfRaw(st.ci[0]), hiL=ag.eng.levelOfRaw(st.ci[1]);
      // cens is SYMMETRIC: pinned at the loud rail (can't play louder) OR the quiet rail (can't
      // play quieter) — both mean "the true threshold lies beyond what this chain can measure"
      const pHi=(AG_ROOM.physHi!=null?AG_ROOM.physHi:-10), pLo=(AG_ROOM.physLo!=null?AG_ROOM.physLo:-94);
      ag.ptsMeta[ag.curEar][f]={ ci: Math.abs(hiL-loL)/2, cens: lvl>=pHi-3 || lvl<=pLo+3 };
      agLiveDraw();                                        // redraw the curve as each point locks
      agNextPoint(); return;
    }
    choiceTimers.push(setTimeout(agTrial,340));
  }
  // advance past the current frequency: base plan → Phase-B infill → verify pass → next ear/finish
  function agNextPoint(){
    ag.fi++;
    if(ag.fi>=ag.plan.length){
      if(!ag.phaseB){
        ag.phaseB=true; const add=agPlanInfill(ag.curEar);
        if(add.length){ ag.plan=ag.plan.concat(add); choiceTimers.push(setTimeout(agFreq,320)); return; }
      }
      if(!ag.phaseC){
        ag.phaseC=true; const vf=agPlanVerify(ag.curEar);
        if(vf.length){ ag.plan=ag.plan.concat(vf); choiceTimers.push(setTimeout(agFreq,320)); return; }
      }
      ag.ei++;
      if(ag.ei>=ag.ears.length){ finishCurve(); return; }
      choiceTimers.push(setTimeout(agEar,650)); return;
    }
    choiceTimers.push(setTimeout(agFreq,320)); return;
  }
  // mercy-skip: a frequency this ear genuinely can't reach shouldn't be a grind of tapping
  // "Nothing" into a void — mark it beyond reach (censored, honest) and move on
  function agGiveUp(){
    if(!ag||ag.phase!=='run')return; killStim(); clearTimers();
    const f=ag.plan[ag.fi], hi=(AG_ROOM.physHi!=null?AG_ROOM.physHi:-10);
    ag.pts[ag.curEar][f]=hi; ag.prevThr=hi;
    ag.ptsMeta[ag.curEar][f]={ci:null, cens:true};
    ag.noneMax=0; agLiveDraw();
    $('cvNote').textContent='Marked beyond reach — moving on.';
    agNextPoint();
  }
  // build one ear's curve, dB re that ear's OWN 1 kHz (so the equal-power pan offset cancels).
  // each point carries its Ψ CI half-width so the render GP can weight it and draw an honest band.
  function agBuildCurve(ear){
    const pts=ag.pts[ear]; const fs=Object.keys(pts).map(Number).sort((a,b)=>a-b);
    if(!fs.length) return [];
    const ref = pts[1000]!=null ? pts[1000] : pts[fs[0]];
    const meta=(ag.ptsMeta&&ag.ptsMeta[ear])||{};
    return fs.map(f=>({ f, rel: Math.round((ref - pts[f])*10)/10, ci: (meta[f]&&meta[f].ci)||null, cens: !!(meta[f]&&meta[f].cens) }));
  }
  // L−R asymmetry in the high band (≥2 kHz, where a sensorineural loss shows). +ve = left worse.
  function agAsym(R,L){
    const rmap={}; R.forEach(p=>{ rmap[p.f]=p.rel; });
    let max=0, atF=0;
    L.forEach(p=>{ if(p.f>=2000 && rmap[p.f]!=null){ const d=rmap[p.f]-p.rel; if(Math.abs(d)>Math.abs(max)){ max=d; atF=p.f; } } });
    return {max, atF};
  }
  function agLiveDraw(){
    if(!ag) return;
    if(ag.mode==='perear') window.SR_FP.renderCurve($('cvcard'), { device, ears:{R:agBuildCurve('R'), L:agBuildCurve('L')} });
    else window.SR_FP.renderCurve($('cvcard'), { device, curve:agBuildCurve('B') });
  }
  // gamma feedback: the estimator assumes a 3% "yes to silence" rate; a click-happy listener's
  // real rate can be 10–25%, which biases thresholds low near the ceiling. Each ear whose
  // MEASURED catch-trial false-alarm rate runs high is refitted from its raw trial log with the
  // measured rate as the model's guess asymptote. (AG_ROOM is linear with dir=1, so x = level.)
  function agRefitEar(ear){
    const fa=ag.faTot[ear]||0, ca=ag.caTot[ear]||0;
    if(ca<4 || !ag.log || !ag.log[ear]) return false;
    const emp=fa/ca; if(emp<=0.08) return false;
    const g=clamp(emp,0.03,0.30);
    const pHi=(AG_ROOM.physHi!=null?AG_ROOM.physHi:-10), pLo=(AG_ROOM.physLo!=null?AG_ROOM.physLo:-94);
    Object.keys(ag.log[ear]).forEach(f=>{
      const trials=ag.log[ear][f]; if(!trials||trials.length<3) return;
      const eng=window.SR_PSI.forRoom(Object.assign({}, AG_ROOM, {gamma:g}));
      trials.forEach(t=>eng.z.record(t[0], !!t[1]));
      const st=eng.z.stats(), lvl=eng.levelOf(st.mean);
      const loL=eng.levelOfRaw(st.ci[0]), hiL=eng.levelOfRaw(st.ci[1]);
      ag.pts[ear][f]=lvl;
      ag.ptsMeta[ear][f]={ci:Math.abs(hiL-loL)/2, cens: lvl>=pHi-3||lvl<=pLo+3, refit:Math.round(g*100)/100};
    });
    return true;
  }
  async function finishCurve(){
    ag.phase='done'; clearTimers();
    $('cvTitle').textContent='Your curve'; $('cvprog').textContent=''; $('cvChoices').innerHTML='';
    $('cvwrap').style.display='block'; $('cvsave').style.display='inline-block';
    $('cvexit').style.display=''; $('cvredo').style.display='';   // the run is over — Continue/Done/Redo return
    if(ag.mode==='perear'){
      const refitR=agRefitEar('R'), refitL=agRefitEar('L');   // must run BEFORE the curves are built
      const R=agBuildCurve('R'), L=agBuildCurve('L'), asym=agAsym(R,L);
      // gate on the false-alarm RATE, not a count: per-ear mode presents ~2× the silent trials,
      // so a fixed count over-flagged exactly the mode whose job is finding an asymmetry
      const caShown=(ag.caTot?ag.caTot.R+ag.caTot.L:0);
      const faHi=caShown>0 && (ag.faTot.R+ag.faTot.L)/caShown>=0.25;
      window.SR_FP.renderCurve($('cvcard'), { device, ears:{R,L} });
      // REVIEW: medical framing — screening only, never a diagnosis, never names a condition.
      let note;
      if(faHi){
        note='A few silent rounds got tapped as “heard”, so the left/right read isn’t reliable this time — worth a calm retry in a quiet room. Shape is relative; the absolute level isn’t calibrated.';
      } else if(Math.abs(asym.max)>=15){
        const worse=asym.max>0?'left':'right', kHz=asym.atF>=1000?(asym.atF/1000)+' kHz':asym.atF+' Hz';
        note=`Your <b>${worse} ear</b> needed noticeably more level than the other above ~${kHz}. A left–right difference is the one thing a home test can legitimately flag — it’s worth showing to an audiologist. This isn’t a diagnosis, just a listening pattern on these headphones.`;
      } else {
        note='Your two ears track closely. A shared roll-off up top can be these headphones or the connection — but if conversation has also been getting harder lately, a matching dip in <b>both</b> ears deserves a proper hearing check too. Shape is relative; the absolute level isn’t calibrated.';
      }
      // cap honesty: past a point a home test undershoots a large gap (crossover + output ceiling),
      // even with the masking rush — say so rather than let the drawn gap read as the whole story
      const hiCens=['R','L'].some(e=>Object.keys(ag.ptsMeta[e]||{}).some(f=>+f>=2000 && ag.ptsMeta[e][f].cens));
      if(!faHi && Math.abs(asym.max)>=15 && (hiCens || Math.abs(asym.max)>=30)){
        note+=' One more honesty note: a home test can only see so much of a gap — beyond its reach the quieter ear stops being measurable, so the real difference may be <b>larger</b> than drawn, not smaller.';
      }
      if(refitR||refitL) note+=' Your silent-round tap rate ran high, so the curve was refitted using your measured guess rate.';
      $('cvNote').innerHTML=note;
      // persist the false-alarm verdict WITH the curve (gates every later surface), plus the raw
      // [level, heard] trial log and the measured FA rates — the export carries the actual data
      await loadDB(); upsertCurve(device, {mode:'perear', ears:{R,L}, asym, faHi,
        log:{R:ag.log&&ag.log.R, L:ag.log&&ag.log.L},
        faRate:{R:(ag.caTot.R?Math.round(100*ag.faTot.R/ag.caTot.R)/100:null), L:(ag.caTot.L?Math.round(100*ag.faTot.L/ag.caTot.L)/100:null)}}, 'yesno-perear'); await saveDB();
    } else {
      const refitB=agRefitEar('B');
      const curve=agBuildCurve('B');
      window.SR_FP.renderCurve($('cvcard'), { device, curve });
      const faHiB=(ag.caTot&&ag.caTot.B>0) ? (ag.faTot.B||0)/ag.caTot.B>=0.25 : false;   // same RATE gate as per-ear
      $('cvNote').innerHTML=(faHiB?'A few silent rounds got tapped as “heard”, so treat the quietest points as rough — a calm retry in a quiet room reads truer. ':'')+'How loud a tone had to be for you to hear it, at each pitch — <b>relative to 1 kHz</b>. A dip means that band is quieter on this pair (rolled off by the headphone, or your own hearing). This tests both ears at once, so a strong ear can hide a weaker one — use “Each ear” to reveal a left/right difference. Shape is relative; the absolute level isn’t calibrated.'+(refitB?' Your silent-round tap rate ran high, so the curve was refitted using your measured guess rate.':'');
      await loadDB(); upsertCurve(device, curve, 'yesno'); await saveDB();
    }
  }

  // ---------- adaptive spatial ----------
  // force reflow on the wrapping HTML div (offsetWidth is undefined on <svg> in Firefox)
  function listen(){$('fieldwrap').classList.remove('listening'); void $('fieldwrap').offsetWidth; $('fieldwrap').classList.add('listening');}
  function listenO(){$('fieldwrapO').classList.remove('listening'); void $('fieldwrapO').offsetWidth; $('fieldwrapO').classList.add('listening');}

  function setupSpatial(c){
    $('precision').querySelector('.plabel span').textContent='Precision';
    const S=SPATIAL[c.tag];
    // difficulty CYCLES beyond the ladder instead of pinning at the hardest entry. Pinning meant
    // every Sharpen round ran at max eccentricity/speed, whose errors are intrinsically larger —
    // so the median acuity ROSE with extra rounds even when the answers were good ("sharpening
    // made me worse"). Cycling resamples the same difficulty mix, so more rounds = convergence.
    const diffLen=(S.ecc||S.spd||S.spread||S.dur||[]).length || S.maxR;
    sp={c, S, mode:c.mode, round:0, errs:[], done:false, minR:S.minR, maxR:S.maxR, diffLen};
    showPrecisionUI();
    spatialRound();
  }
  function spatialRound(){
    guessLocked=false; sp.locked=false; sp.canAnswer=true;   // sweep sets this false until the glide lands
    ['guess','truthg','link','guessO','truthgO','linkO'].forEach(id=>$(id).classList.remove('on'));
    setReplay(true); roveTrial();
    kbActive=false; kbAz=0; kbRad = sp.mode==='orbit'?112 : sp.mode==='depth'?90 : 110;
    const c=sp.c, S=sp.S, r=sp.round % sp.diffLen;   // difficulty index cycles; sp.round still counts rounds
    // record which difficulty this round ran at — persisted with the reading so the eccentricity
    // weights (the future normalization model) can be re-fit from real aggregated data
    sp.curDiff=(S.ecc&&S.ecc[r])||(S.spd&&S.spd[r])||(S.spread&&S.spread[r])||(S.dur&&S.dur[r])||r;
    if(c.mode==='locate'){
      const ecc=S.ecc[Math.min(r,S.ecc.length-1)];
      const az=(Math.random()<.5?-1:1)*jit(ecc,6), key=rndTimbre();
      sp.target={az:clamp(az,-88,88),dist:1.6,mode:'locate'};
      const build=()=>{stopVoices(); const v=makeVoice(key,sp.target.az,1.6,0.55); voices=[v]; choiceTimers.push(setTimeout(()=>voices[0]&&voices[0].loop(),200));};
      replayFn=()=>{listen(); build();}; $('status').textContent='Where is it?'; listen(); build();
    } else if(c.mode==='sweep'){
      const spd=S.spd[Math.min(r,S.spd.length-1)];
      const from=jit((Math.random()<.5?-1:1)*80,6), to=jit((Math.random()<.5?-1:1)*55,10), key=rndTimbre();
      sp.target={az:to,dist:1.6,mode:'sweep'};
      const build=()=>{stopVoices(); sp.canAnswer=false;   // no taps until the glide has LANDED —
        // the scored quantity is where it stops, which mid-glide the listener cannot yet know
        const v=makeVoice(key,from,1.6,0.55); voices=[v];
        choiceTimers.push(setTimeout(()=>{ if(!voices[0])return; v.loop(); v.glide(from,to,spd);
          // silence shortly after landing — left looping parked at the endpoint, this room was
          // just static localization (wait, then point at the parked sound). Now you mark where
          // the MOTION ended, which is what "track the mover" claims to test.
          choiceTimers.push(setTimeout(()=>{ sp.canAnswer=true;
            if(voices[0]===v && !guessLocked){ v.stop(); $('status').textContent='Gone. Tap where it stopped.'; } },(spd+0.35)*1000));
        },200));};
      replayFn=()=>{listen(); build();}; $('status').textContent='It moves…'; listen(); build();
    } else if(c.mode==='depth'){
      const near=Math.random()<.5; const az=jit((Math.random()<.5?-1:1)*(30+r*6),6);
      const d=near?jit(1.3,.2):jit(6+r,1);
      sp.target={az:clamp(az,-80,80),dist:d,mode:'depth'};
      const key=rndTimbre();
      const build=()=>{stopVoices(); const v=makeVoice(key,sp.target.az,sp.target.dist,0.55); voices=[v]; choiceTimers.push(setTimeout(()=>voices[0]&&voices[0].loop(),200));};
      replayFn=()=>{listen(); build();}; $('status').textContent='Near or far — and where?'; listen(); build();
    } else if(c.mode==='separate'){
      const spread=S.spread[Math.min(r,S.spread.length-1)];
      const centre=jit(0,25), keys=[...T_KEYS].sort(()=>Math.random()-.5).slice(0,3);
      const angs=[centre-spread,centre,centre+spread].map(a=>clamp(a,-86,86));
      const ti=Math.floor(Math.random()*3);
      sp.target={az:angs[ti],dist:1.7,mode:'separate',key:keys[ti]};
      sp.sepVoices=keys.map((k,i)=>({az:angs[i],timbre:k}));
      const play=(solo)=>{ stopVoices(); voices=keys.map((k,i)=>makeVoice(k,angs[i],1.7,0.5));
        if(solo){ $('status').textContent='Your target, alone…'; let t=ctx.currentTime+0.3;
          // preview the target's TIMBRE from dead centre — previewing it at its true position
          // pre-revealed the answer (spatial memory, not in-crowd segregation, got scored)
          const pv=makeVoice(keys[ti],0,1.7,0.5); t=pv.playOnce(t);
          choiceTimers.push(setTimeout(()=>pv.stop(),(t-ctx.currentTime+0.15)*1000));
          choiceTimers.push(setTimeout(()=>{ if(guessLocked)return; $('status').textContent='Now — find it.'; voices.forEach(v=>v.loop()); },(t-ctx.currentTime+0.5)*1000));
        } else { $('status').textContent='Find it.'; voices.forEach(v=>v.loop()); } };
      replayFn=()=>{listen(); play(false);}; listen(); play(true);
    } else if(c.mode==='orbit'){
      const startAz=Math.random()*360, dir=Math.random()<.5?1:-1, sweep=360+Math.random()*180;
      const endAz=((startAz+dir*sweep)%360+360)%360;
      const dur=S.dur[Math.min(r,S.dur.length-1)];
      sp.target={az:endAz,dist:1.6,mode:'orbit'};
      const key=rndTimbre();
      // no visual comet: it would trace the true path and reveal the answer. Localize by ear.
      const build=()=>{ stopVoices();
        const v=makeVoice(key,startAz,1.6,0.55); voices=[v]; v.loop();
        const t0=performance.now();
        orbitInt=setInterval(()=>{
          const f=Math.min(1,(performance.now()-t0)/(dur*1000));
          const az=startAz+dir*sweep*f; v.setAz(az, 0.045);   // ramped — the orbit no longer zippers
          if(f>=1){clearInterval(orbitInt); orbitInt=null; if(!guessLocked)$('status').textContent='It stopped. Tap where you heard it land.';}
        },40);
      };
      replayFn=()=>{listenO(); $('status').textContent='It circles…'; build();};
      $('status').textContent='It circles…'; listenO(); build();
    }
  }
  function svgPoint(e,svg,vb){ const r=svg.getBoundingClientRect(); return {x:((e.clientX-r.left)/r.width)*vb.w+vb.x, y:((e.clientY-r.top)/r.height)*vb.h+vb.y}; }
  const angErr=(a,b)=>Math.abs(a-b);
  function onTap(e,isOrbit){
    if(!sp || guessLocked || sp.canAnswer===false) return; e.preventDefault();
    if(isOrbit){
      if(orbitInt) return;
      const {x,y}=svgPoint(e,$('fieldO'),{x:-160,y:-160,w:320,h:320});
      const rad=Math.min(Math.hypot(x,y),150);
      let az=Math.atan2(x,-y)*180/Math.PI; az=(az+360)%360;
      lockOrbit(az,rad);
    } else {
      const {x,y}=svgPoint(e,$('field'),{x:-168,y:-78,w:336,h:208});
      const dx=x, dy=LY-y; const rad=Math.min(Math.hypot(dx,dy),RAD);
      let az=Math.atan2(dx,dy)*180/Math.PI; az=Math.max(-90,Math.min(90,az));
      lockField(az,rad);
    }
  }
  function confirmNote(key,az,dist){ choiceTimers.push(setTimeout(()=>{ landingPing(az,dist,ctx.currentTime+.03); },180)); }

  // keyboard guess cursor for spatial rooms (accessibility): arrows move, Enter locks
  function showKbCursor(){
    if(sp.mode==='orbit'){
      const gx=Math.sin(kbAz*Math.PI/180)*kbRad, gy=-Math.cos(kbAz*Math.PI/180)*kbRad;
      $('guessO').setAttribute('cx',gx); $('guessO').setAttribute('cy',gy); $('guessO').classList.add('on');
    } else {
      const gx=Math.sin(kbAz*Math.PI/180)*kbRad, gy=LY-Math.cos(kbAz*Math.PI/180)*kbRad;
      $('guess').setAttribute('cx',gx); $('guess').setAttribute('cy',gy); $('guess').classList.add('on');
    }
  }
  function onKeydown(e){
    if(!sp || guessLocked || sp._finished || orbitInt || sp.canAnswer===false) return;
    const isOrbit=sp.mode==='orbit', step=4;
    if(e.key==='ArrowLeft') kbAz = isOrbit ? (kbAz-step+360)%360 : clamp(kbAz-step,-90,90);
    else if(e.key==='ArrowRight') kbAz = isOrbit ? (kbAz+step)%360 : clamp(kbAz+step,-90,90);
    else if(e.key==='ArrowUp') kbRad = clamp(kbRad+8,20,150);
    else if(e.key==='ArrowDown') kbRad = clamp(kbRad-8,20,150);
    else if(e.key==='Enter'||e.key===' '){ if(!kbActive){ kbActive=true; showKbCursor(); e.preventDefault(); return; }
      e.preventDefault(); if(isOrbit) lockOrbit(kbAz,kbRad); else lockField(kbAz,kbRad); return; }
    else return;
    kbActive=true; e.preventDefault(); showKbCursor();
  }

  function lockField(az,rad){
    guessLocked=true; $('fieldwrap').classList.remove('listening'); $('replay').disabled=true;
    const c=sp.c, mode=c.mode;
    const key=sp.target.key||voices[0]?.timbre||'bell';
    const sepVoices=sp.sepVoices||[];
    stopVoices();
    const g={x:Math.sin(az*Math.PI/180)*rad, y:LY-Math.cos(az*Math.PI/180)*rad};
    $('guess').setAttribute('cx',g.x); $('guess').setAttribute('cy',g.y); $('guess').classList.add('on');
    let truthRad = mode==='depth' ? (sp.target.dist<3?74:RAD) : 110;
    const tm={x:Math.sin(sp.target.az*Math.PI/180)*truthRad, y:LY-Math.cos(sp.target.az*Math.PI/180)*truthRad};
    $('truth').setAttribute('cx',tm.x); $('truth').setAttribute('cy',tm.y); $('truthg').classList.add('on');
    const L=$('link'); L.setAttribute('x1',g.x);L.setAttribute('y1',g.y);L.setAttribute('x2',tm.x);L.setAttribute('y2',tm.y); L.classList.add('on');
    confirmNote(key,sp.target.az,sp.target.dist);

    const err=angErr(az,sp.target.az);
    let effErr=err, msg='';
    if(mode==='separate'){
      let best=999,bestKey=null; sepVoices.forEach(v=>{const e=angErr(az,v.az); if(e<best){best=e;bestKey=v.timbre;}});
      const hit=bestKey===sp.target.key&&best<50; effErr=hit?err:90;
      msg=hit?pick(contentOf('Separation').hit):'That was another voice.';
    } else if(mode==='depth'){
      // credit near vs far by which side of the mid-radius the tap fell — this matches the
      // drawn inner (r74, near) and outer (r150, far) arcs, so following the instruction scores.
      const boundary=112, near=sp.target.dist<3;
      const dOk = near ? rad<boundary : rad>=boundary;
      const aOk = err<24;
      effErr = err + (dOk?0:35);
      msg = aOk&&dOk ? pick(contentOf('Depth').hit) : dOk ? 'Right distance, off bearing.' : aOk ? 'Right bearing — wrong row.' : 'Missed bearing and row.';
    } else {
      msg = err<12?pick(contentOf(sp.c.tag).hit):err<32?'Close.':pick(contentOf(sp.c.tag).miss);
    }
    sp.errs.push({eff:effErr, raw:err, d:sp.curDiff});   // eff scores; raw feeds the spread stats; d = this round's difficulty
    $('status').innerHTML=`${msg} <span style="color:var(--muted)">· ${Math.round(err)}° off</span>`;
    afterSpatialRound();
  }
  function lockOrbit(az,rad){
    guessLocked=true; $('fieldwrapO').classList.remove('listening'); $('replay').disabled=true;
    const key=voices[0]?.timbre||'bell'; stopVoices();
    const gx=Math.sin(az*Math.PI/180)*rad, gy=-Math.cos(az*Math.PI/180)*rad;
    $('guessO').setAttribute('cx',gx); $('guessO').setAttribute('cy',gy); $('guessO').classList.add('on');
    const tr=112, tx=Math.sin(sp.target.az*Math.PI/180)*tr, ty=-Math.cos(sp.target.az*Math.PI/180)*tr;
    $('truthO').setAttribute('cx',tx); $('truthO').setAttribute('cy',ty); $('truthgO').classList.add('on');
    const L=$('linkO'); L.setAttribute('x1',gx);L.setAttribute('y1',gy);L.setAttribute('x2',tx);L.setAttribute('y2',ty); L.classList.add('on');
    confirmNote(key,sp.target.az,1.6);
    const we=wrapErr(az,sp.target.az);
    const mirrorAz=((180-sp.target.az)%360+360)%360;
    let effErr=we, msg;
    // a mirror miss keeps its MEASUREMENT (how tight the mirror was) plus a penalty — the old
    // constant 45 made every mirroring listener identical, collapsed the MAD to zero, and read
    // "100% locked in" for a run of nothing but front/back flips
    if(we>50 && wrapErr(az,mirrorAz)<20){ effErr=wrapErr(az,mirrorAz)+35; msg='Mirrored — the classic front/back flip.'; }
    else msg = we<16?pick(contentOf('Orbit').hit):we<40?'In the area.':pick(contentOf('Orbit').miss);
    sp.errs.push({eff:effErr, raw:we, d:sp.curDiff});
    $('status').innerHTML=`${msg} <span style="color:var(--muted)">· ${Math.round(we)}° off</span>`;
    afterSpatialRound();
  }
  function acuityStats(){
    // SCORES come from eff (measured error + any penalty); SPREAD statistics come from raw
    // measured errors ONLY. Feeding penalty constants into the spread collapsed the MAD to zero,
    // so a run of nothing-but-wrong answers read "100% locked in", auto-stopped at the earliest
    // legal round, and hid the Sharpen button — maximum confidence for the worst possible run.
    const eff=sp.errs.map(x=>typeof x==='number'?x:x.eff);
    const raw=sp.errs.map(x=>typeof x==='number'?x:x.raw);
    const pen=sp.errs.filter(x=>typeof x!=='number' && x.eff!==x.raw).length;
    const medOf=a=>{const s=a.slice().sort((p,q)=>p-q); return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
    const med=medOf(eff);
    const mean=eff.reduce((a,b)=>a+b,0)/eff.length;
    const rmean=raw.reduce((a,b)=>a+b,0)/raw.length;
    const varr=raw.reduce((a,b)=>a+(b-rmean)*(b-rmean),0)/raw.length;
    const se=Math.sqrt(varr/raw.length);
    // confidence reflects how CONSISTENT your taps are — MAD about the median of the RAW errors
    // vs the room's reference acuity: erratic taps stay low even at the last round. It can go DOWN.
    const rmed=medOf(raw);
    const dev=raw.map(v=>Math.abs(v-rmed)).sort((a,b)=>a-b);
    const mad = dev.length%2 ? dev[(dev.length-1)/2] : (dev[dev.length/2-1]+dev[dev.length/2])/2;
    let conf = clamp(1 - mad/(sp.S.ref*1.3), 0, 1);
    if(raw.length < sp.minR) conf *= raw.length/sp.minR;   // a couple of taps can't be fully certain yet
    if(pen>=Math.ceil(sp.errs.length/2)) conf=Math.min(conf,0.6);   // mostly-penalised runs are never "locked in"
    return {med,mean,se,mad,conf,pen};
  }
  function afterSpatialRound(){
    sp.round++;
    const a=acuityStats();
    setPrecision(a.conf, `≈ ${Math.round(a.med)}° acuity`);
    // never auto-finish before the room's whole difficulty ladder has been presented — stopping
    // early meant a confident listener was scored on the EASY eccentricities/speeds only, while a
    // wobblier one also faced the hard end: same ability, different numbers.
    // BALANCED stopping: auto-finish only on COMPLETE difficulty cycles. Stopping mid-cycle let
    // the trial mix tilt the median — the same listener printed 47 or 58 depending purely on the
    // stop round (and the cleaner run scored WORSE). Model-free fix; maxR is a cycle multiple.
    const enough = sp.round>=Math.max(sp.minR, sp.diffLen) && sp.round % sp.diffLen === 0 && a.se < sp.S.ref*0.6;
    // normal flow auto-finishes when confident; a Sharpen run continues to maxR
    if(sp.round>=sp.maxR || (!sp.sharpen && enough)){ choiceTimers.push(setTimeout(finishSpatial, 700)); return; }
    choiceTimers.push(setTimeout(()=>spatialRound(), 820));
  }
  function finishSpatial(){
    if(sp._finished) return; sp.done=true; sp._finished=true; clearTimers(); guessLocked=true;
    const S=sp.S, a=acuityStats();
    // map median error (deg) between ref (100%) and weak (0%) in log space
    const lw=Math.log(S.weak), lb=Math.log(S.ref), lt=Math.log(clamp(a.med,S.ref,S.weak));
    const pct=Math.round(clamp((lw-lt)/(lw-lb),0,1)*100);
    recordRoom(pct, `${Math.round(a.med)}° acuity`, {val:a.med, lo:Math.max(1,a.med-1.96*a.se), hi:a.med+1.96*a.se,
      trials:sp.errs.map(e=>typeof e==='number'?[null,e,e]:[e.d,Math.round(e.raw*10)/10,Math.round(e.eff*10)/10])});   // [difficulty, raw°, eff°] per round — exported
    $('status').innerHTML=`Your acuity: <span class="pts">${Math.round(a.med)}°</span> · +${pct} <span style="color:var(--muted)">· ${Math.round(a.conf*100)}% locked in</span>`;
    setPrecision(a.conf, `${Math.round(a.med)}° · ${sp.round} rounds`);
    showLearn(); appendTier(tierLine(sp.c.tag,pct));
    showResultBtns(a.conf < 0.9 || a.pen > 0);    // Sharpen stays available whenever any round was penalised
    advanceUI();
  }

  // ---------- shared result plumbing ----------
  function recordRoom(pct, readout, extra){
    const i=order[oi], tag=CH[i].tag;
    if(chScore[i]!=null) score-=chScore[i];        // replace (not accumulate) — Sharpen re-records
    chScore[i]=pct; chPct[i]=pct; roomThr[tag]=readout;
    if(extra && extra.val!=null){ roomVal[tag]={val:extra.val, lo:extra.lo, hi:extra.hi};
      if(extra.trials) roomVal[tag].trials=extra.trials; }   // per-trial [level, correct] pairs ride into storage + export
    score+=pct; $('score').textContent=score;
    saveRun();                                       // persist the in-progress tour for resume
    // accumulate this reading onto the headphone's saved profile RIGHT AWAY, so partial tours and
    // rooms done across different sessions all add up on the same pair (not only completed tours).
    if(device){
      upsertRoomReading(device, tag, Object.assign({pct, thr:readout}, roomVal[tag]||{}));
      saveDB();
    }
  }
  function tierLine(tag,pct){
    const T=contentOf(tag).tiers||{};
    const band = pct>=82?'reference':pct>=58?'strong':pct>=34?'fair':'weak';
    return T[band]||'';
  }
  function appendTier(line){
    if(!line) return;
    const L=$('learn');
    // prepend the personalised verdict above the science teaser
    L.innerHTML = `<div style="color:var(--stone);font-family:var(--disp);font-style:italic;font-size:13.5px;margin-bottom:8px">${line}</div>` + L.innerHTML;
  }

  function advanceUI(){
    $('hint').textContent='';                        // room done — clear the interaction hint
    $('skipbtn').classList.remove('on');             // finished — no skipping now, press Next
    const lastC=oi>=order.length-1;
    $('next').textContent=lastC?'See result':'Next'; $('next').classList.add('on');
  }
  function nextChapter(){
    stopVoices(); hideCheckpointBtns();
    if(oi<order.length-1){ oi++; loadChapter(); }
    else finish();
  }

  // ---------- info sheet ----------
  function openInfo(tag){
    const c=CH.find(x=>x.tag===tag), C2=contentOf(tag);
    $('mTag').textContent=`${c.tag} · ${c.tests}`;
    $('mTitle').textContent=c.title;
    $('mBench').textContent=C2.benchmark||'';
    $('mScience').textContent=C2.science||c.learn;
    $('mModels').innerHTML=C2.models?`<b>Heard on:</b> ${C2.models}`:'';
    $('modal').classList.add('on');
  }
  function closeInfo(){ $('modal').classList.remove('on'); }

  // ---------- room navigator + skip ----------
  function openRoomNav(){ buildRoomNav(); $('roomnav').classList.add('on'); }
  function closeRoomNav(){ $('roomnav').classList.remove('on'); }
  function buildRoomNav(){
    const list=$('navlist'); list.innerHTML='';
    order.forEach((ci,pos)=>{
      const c=CH[ci], scored=chPct[ci]!=null, done=scored||roomDone[ci], isNow=pos===oi;
      const row=document.createElement('button');
      row.className='navrow'+(isNow?' now':done?' done':' pending');
      let right;
      if(isNow) right='<span class="nstate">now</span>';
      else if(scored) right=`<span class="ntrack"><span class="nfill" style="width:${chPct[ci]}%"></span></span><span class="npct">${chPct[ci]}%${roomThr[c.tag]?' · '+roomThr[c.tag]:''}</span>`;
      else if(roomDone[ci]) right='<span class="nstate">✓ measured</span>';
      else right='<span class="nstate">—</span>';
      row.innerHTML=`<span class="nnum">${ROMANS[pos]}</span><span class="nmain"><span class="nname">${c.tag}</span><span class="nsub">${c.tests}</span></span><span class="nright">${right}</span>`;
      row.addEventListener('click',()=>jumpToRoom(pos));
      list.appendChild(row);
    });
  }
  // jump straight to any room in the tour (re-running a finished room re-measures it — recordRoom
  // replaces rather than accumulates, so the score stays correct)
  function jumpToRoom(pos){
    if(pos===oi){ closeRoomNav(); return; }
    closeRoomNav(); stopVoices(); hideCheckpointBtns(); $('skipbtn').classList.remove('on');
    oi=pos; loadChapter();
  }
  // leave the current room unscored (it's excluded from the total) and move on, or finish
  function skipRoom(){
    stopVoices(); hideCheckpointBtns(); guessLocked=true; $('skipbtn').classList.remove('on');
    if(oi<order.length-1){ oi++; loadChapter(); }
    else finish();
  }

  // ---------- share / copy ----------
  function flashSaved(msg){ const el=$('saved'), keep=el.textContent; el.textContent=msg; setTimeout(()=>{el.textContent=keep;},1700); }
  async function shareResults(){
    const url=shareURL();
    const text=`I ran Stone Room on my ${device}: ${score} pts (${Math.round(lastPct*100)}%). Test your headphones:`;
    try{ if(navigator.share){ await navigator.share({title:CONFIG.SHARE_TITLE, text, url}); } else { await navigator.clipboard.writeText(text+' '+url); flashSaved('link copied'); } }
    catch(e){ flashSaved('could not share'); }
  }
  async function copyResults(){
    const lines=[`Stone Room — ${device} · ${score} pts (${Math.round(lastPct*100)}%)`];
    order.forEach(i=>{ if(chPct[i]==null) return; const c=CH[i]; lines.push(`  ${c.tag} (${c.tests}): ${roomThr[c.tag]||chPct[i]+'%'} · ${chPct[i]}%`);});
    lines.push(shareURL());
    try{ await navigator.clipboard.writeText(lines.join('\n')); flashSaved('results copied'); }
    catch(e){ flashSaved('could not copy'); }
  }

  // ---------- end ----------
  async function finish(){
    stopVoices(); clearRun(); show('end');      // tour complete — nothing left to resume
    // only scored rooms count toward the total; skipped rooms are excluded, and the hearing
    // curve is "measured" (unscored) rather than skipped.
    const nDone=order.filter(i=>chPct[i]!=null).length;
    const skipped=order.filter(i=>chPct[i]==null && !roomDone[i]).length;
    const curveDone=order.some(i=>roomDone[i]);
    const max=nDone*100;
    const pct=max?score/max:0; lastPct=pct; const pctR=Math.round(pct*100);
    // never end on a bare zero: an empty run is the instrument declining to guess, not the
    // listener failing — say so, and point at the one measurement that always yields a shape
    $('finalnum').textContent = (nDone||curveDone) ? score : '—';
    $('finalout').innerHTML = nDone
      ? `of <b>${max}</b> · <b>${pctR}%</b> across ${nDone} room${nDone!==1?'s':''}`
        + (skipped?` <span style="color:var(--muted)">· ${skipped} skipped</span>`:'')
        + (curveDone?` <span style="color:var(--muted)">· curve measured</span>`:'')
      : (curveDone ? 'Hearing curve measured' : 'nothing locked in this run');
    // ONE rank ladder: the card's rankWord is the single source (the end screen's own 85% top cut
    // disagreed with the card's 82% — same screen, two verdicts for a 83% run)
    let rank,verdict;
    if(!nDone && !curveDone){rank='No reading yet'; verdict='Not a failure — an honest instrument declining to guess. A quieter spot, a touch more volume, or a Replay before answering usually unlocks it.';}
    else{
      rank=window.SR_FP.rankWord(pctR);
      verdict = rank==='Golden ear' ? `Every claim verified on the ${device} — holography, slam, air, silk, the lot. The reviews weren’t poetry after all.`
        : rank==='Tuned in' ? 'Most claims verified. Whatever scored lowest below is the quality worth hunting for in your next album.'
        : rank==='Warming up' ? 'Critical listening is a learned skill. Another lap and the claims start proving themselves.'
        : 'All of this lives in the sound — it takes a few laps to hear it. Pick one group and drill it.';
    }
    $('rank').textContent=rank; $('verdict').textContent=verdict;
    // honest benchmark context + what drives the gap (hearing vs headphones)
    const where = pctR>=80 ? 'a strong run on this chain — trained-ear territory'
      : pctR>=55 ? 'a solid run on this chain'
      : pctR>=35 ? 'room to grow — the rooms you missed are the ones to drill'
      : 'early days — try a smaller set and turn the volume up a little';
    // find weakest room and note whether it's hearing- or headphone-limited
    const hearingRooms={Air:'your ears (treble fades with age)',Foundation:'your ears and the headphones together'};
    let worst=null,worstP=101; order.forEach(i=>{ if(chPct[i]<worstP){worstP=chPct[i];worst=CH[i].tag;} });
    const drive = worst && hearingRooms[worst] ? `Your lowest room, ${worst}, leans on ${hearingRooms[worst]}.`
      : worst ? `Your lowest room was ${worst} — mostly down to the headphones and practice.` : '';
    $('benchnote').innerHTML = (!nDone && !curveDone)
      ? 'For a guaranteed take-away, start with the <b>hearing curve</b> (~3 min) — it always produces the shape of what you hear.'
      : `${pctR}% is ${where}. ${drive} To separate your ears from the gear, run the same rooms on a second pair — your ears stay constant, so the difference is the headphones.`;
    order.forEach(i=>{ if(chPct[i]==null) return; const tag=CH[i].tag;   // re-upsert under the SAME runId — idempotent, no dup history entry
      upsertRoomReading(device, tag, Object.assign({pct:chPct[i], thr:roomThr[tag]}, roomVal[tag]||{}));
    });
    const dev = db.devices[device] || ensureProfile(device); await saveDB();
    renderCard(dev);
    $('saved').textContent = storageOK ? `saved · ${device}` + (deviceNames().length>1 ? ' · compare available' : '')
      : 'storage unavailable — results kept for this session only';
    const bd=$('breakdown'); bd.innerHTML='';
    Object.keys(GROUPS).forEach(gk=>{
      const idxs=order.filter(i=>CH[i].group===gk && chPct[i]!=null);   // skipped rooms don't show
      if(!idxs.length) return;
      const h=document.createElement('div'); h.className='bghead'; h.textContent=GROUPS[gk].name; bd.appendChild(h);
      idxs.forEach(i=>{
        const c=CH[i], p=chPct[i], val=roomThr[c.tag]||`${p}%`;
        const row=document.createElement('div'); row.className='brow';
        row.innerHTML='<span class="bname"></span><div class="btrack"><div class="bfill"></div></div><span class="bpct"></span>';
        row.querySelector('.bname').textContent=c.tag;
        row.querySelector('.bpct').textContent=val;      // textContent: an imported reading can't inject markup
        bd.appendChild(row);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{row.querySelector('.bfill').style.width=p+'%';}));
      });
    });
  }

  // ---------- fingerprint card ----------
  // everything measured on a pair → the card's data contract, or null if nothing scored yet
  function cardData(name, dev){
    const rooms={}; const ps=[];
    Object.keys(dev.rooms||{}).forEach(tag=>{ const r=dev.rooms[tag]; if(r && r.pct!=null){ rooms[tag]={pct:r.pct, val:r.val}; ps.push(r.pct); } });
    if(!ps.length) return null;
    const score=Math.round(ps.reduce((a,b)=>a+b,0)/ps.length);
    // no invented norm: this app is fully local and has never seen anyone else's run, so it must
    // not quote a population figure. Describe the run on its own chain instead.
    const context = score>=80?'trained-ear territory on this chain'
      : score>=55?'a solid run on this chain'
      : score>=35?'room to grow — the misses below are the ones to drill'
      : 'early days on this chain — try fewer rooms, a touch louder';
    return { device:name, date:new Date().toLocaleDateString(), score, context, rooms };
  }
  function renderCard(dev){
    // full picture of THIS pair: this run merged with anything measured before
    const data=cardData(device, dev);
    const wrap=$('fpwrap');
    if(!data){ wrap.style.display='none'; return; }
    wrap.style.display='block';
    window.SR_FP.render($('fpcard'), data);
  }
  // a saved curve back on screen — handles both shapes ({mode:'perear',ears} and the flat both-ears array)
  function renderSavedCurve(box, name, dev){
    const c=dev.curve;
    if(c && c.ears) window.SR_FP.renderCurve(box, { device:name, ears:c.ears });
    else if(Array.isArray(c) && c.length) window.SR_FP.renderCurve(box, { device:name, curve:c });
    else return false;
    return true;
  }
  async function sharePNG(svg, filename){
    const blob=await window.SR_FP.toPNG(svg,3);
    const file=new File([blob], filename, {type:'image/png'});
    if(navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title:CONFIG.SHARE_TITLE}); }
    else{
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=file.name;
      document.body.appendChild(a); a.click(); a.remove();
    }
  }
  async function saveCard(){
    const svg=$('fpcard').querySelector('svg'); if(!svg) return;
    try{ await sharePNG(svg, `stone-room-${device.replace(/[^\w-]+/g,'_')}.png`); }
    catch(e){ flashSaved('could not save card'); }
  }

  // ---------- comparison ----------
  function buildCompare(){
    const names=deviceNames();
    const leg=$('legend'); leg.innerHTML='';
    names.forEach((n,i)=>{ if(!(n in cmpVisible)) cmpVisible[n]=i<4; });
    names.forEach((n,i)=>{
      const b=document.createElement('button'); b.className='legchip'+(cmpVisible[n]?' on':'');
      const col=DEVCOLORS[i%DEVCOLORS.length];
      const dot=document.createElement('span'); dot.className='dot'; dot.style.background=col;
      b.appendChild(dot); b.appendChild(document.createTextNode(n));
      b.addEventListener('click',()=>{cmpVisible[n]=!cmpVisible[n]; b.classList.toggle('on',cmpVisible[n]); renderCompareRows(names);});
      leg.appendChild(b);
    });
    renderCompareRows(names);
  }
  const deviceTotal=(n,only)=>{                 // `only`: optional Set of tags — used by compare's shared-rooms mean
    const rooms=db.devices[n].rooms||{};
    const keys=only?Object.keys(rooms).filter(k=>only.has(k)):Object.keys(rooms);
    const ps=keys.map(k=>{const v=rooms[k]; return typeof v==='number'?v:(v&&v.pct);}).filter(p=>p!=null);
    return ps.length ? Math.round(ps.reduce((a,b)=>a+b,0)/ps.length) : null;
  };
  function renderCompareRows(names){
    const box=$('cmpscroll'); box.innerHTML='';
    if(!names.length){ box.innerHTML='<div class="cmpempty">No saved results yet.<br>Finish a tour with a headphone name and it lands here — then run the same rooms on a second pair.</div>'; return; }
    const active=names.filter(n=>cmpVisible[n]);
    // overall score per device, up top
    const th=document.createElement('div'); th.className='bghead'; th.textContent='Overall'; box.appendChild(th);
    const trow=document.createElement('div'); trow.className='cmprow';
    // head-to-head means must cover the SAME rooms: each pair averaged over its own self-selected
    // room set let a brand-new pair (two easy rooms) "beat" a thoroughly-tested one on zero shared
    // rooms — inverting the app's own "difference is the headphones" claim
    let common=null;
    if(active.length>=2){
      active.forEach(n=>{ const s=new Set(Object.keys(db.devices[n].rooms||{}).filter(t=>{const v=db.devices[n].rooms[t]; return v!=null&&(typeof v==='number'||v.pct!=null);}));
        common = common ? new Set([...common].filter(t=>s.has(t))) : s; });
    }
    trow.innerHTML='<div class="rname">'+(common ? (common.size ? 'Average across the '+common.size+' room'+(common.size!==1?'s':'')+' all shown pairs ran' : 'No rooms in common yet — run the same rooms on each pair') : 'Average across rooms')+'</div>';
    active.forEach(n=>{
      const tot=common ? (common.size?deviceTotal(n,common):null) : deviceTotal(n), col=DEVCOLORS[names.indexOf(n)%DEVCOLORS.length];
      const bar=document.createElement('div'); bar.className='cmpbar';
      bar.innerHTML = tot!=null ? `<div class="track"><div class="fill" style="width:${tot}%;background:${col}"></div></div><span class="pct"><b>${tot}%</b></span>` : `<div class="track"></div><span class="pct">—</span>`;
      trow.appendChild(bar);
    });
    box.appendChild(trow);
    Object.keys(GROUPS).forEach(gk=>{
      const rooms=CH.filter(c=>c.group===gk).filter(c=>active.some(n=>{const v=db.devices[n].rooms[c.tag]; return v!=null && (typeof v==='number'||v.pct!=null);}));
      if(!rooms.length) return;
      const h=document.createElement('div'); h.className='bghead'; h.textContent=GROUPS[gk].name; box.appendChild(h);
      rooms.forEach(c=>{
        const row=document.createElement('div'); row.className='cmprow';
        row.innerHTML=`<div class="rname">${c.tag} · ${c.tests}</div>`;
        // with exactly two pairs shown, say whether the runs can actually tell them apart:
        // non-overlapping 95% CIs = a difference the measurements support; overlapping = honest
        // "too close to call" (a bar-length gap alone is NOT evidence)
        if(active.length===2){
          const va=db.devices[active[0]].rooms[c.tag], vb=db.devices[active[1]].rooms[c.tag];
          if(va&&vb&&typeof va==='object'&&typeof vb==='object'&&va.lo!=null&&va.hi!=null&&vb.lo!=null&&vb.hi!=null){
            const overlap=!(va.hi<vb.lo||vb.hi<va.lo);
            const s=document.createElement('span'); s.className='cmpsig'+(overlap?'':' real');
            s.textContent=overlap?'≈ too close to call':'differs for real';
            row.querySelector('.rname').appendChild(s);
          }
        }
        active.forEach(n=>{
          const v=db.devices[n].rooms[c.tag];
          const p = v==null ? null : (typeof v==='number' ? v : v.pct);
          const label = v==null ? '—' : (typeof v==='object' && v.thr ? v.thr : p+'%');
          const col=DEVCOLORS[names.indexOf(n)%DEVCOLORS.length];
          const bar=document.createElement('div'); bar.className='cmpbar';
          if(p!=null){
            bar.innerHTML='<div class="track"><div class="fill"></div></div><span class="pct"></span>';
            const f=bar.querySelector('.fill'); f.style.width=p+'%'; f.style.background=col;
            const pctEl=bar.querySelector('.pct'); pctEl.textContent=label; pctEl.style.color=col;   // value carries its pair's legend colour; textContent: imported thr can't inject
          } else bar.innerHTML='<div class="track"></div><span class="pct">—</span>';
          row.appendChild(bar);
        });
        box.appendChild(row);
      });
    });
  }

  // ---------- profiles (manage headphone pairs: retake a room, rename, delete, export, import) ----------
  function buildProfiles(){
    const list=$('profileList'); list.innerHTML='';
    const names=deviceNames();
    if(!names.length){ list.innerHTML='<div class="cmpempty">No saved pairs yet.<br>Finish a room with a headphone name and it lands here — each pair keeps its own results.</div>'; $('pfcompare').style.display='none'; return; }
    names.forEach(n=>{
      const dev=db.devices[n]||{rooms:{}};
      const tot=deviceTotal(n);
      const done=CH.filter(c=>{const v=dev.rooms&&dev.rooms[c.tag]; return v!=null && (typeof v==='number'||v.pct!=null);}).length;
      const card=document.createElement('div'); card.className='pfcard';
      const head=document.createElement('button'); head.className='pfhead'; head.title='See everything measured on this pair';
      const nm=document.createElement('span'); nm.className='pfname'; nm.textContent=n;   // textContent: no XSS from a stored/imported name
      const meta=document.createElement('span'); meta.className='pfmeta'; meta.innerHTML='';
      meta.textContent=(tot!=null?tot+'% · ':'')+done+'/'+CH.length+' rooms'+(dev.curve?' · curve':'');
      const chev=document.createElement('span'); chev.className='pfchev'; chev.textContent='›';
      head.appendChild(nm); head.appendChild(meta); head.appendChild(chev);
      head.addEventListener('click',()=>openProfile(n));    // profile tap → RESULTS first; testing is a tap further
      card.appendChild(head);
      const dots=document.createElement('div'); dots.className='pfdots';
      CH.forEach(c=>{
        const v=dev.rooms&&dev.rooms[c.tag]; const p=v==null?null:(typeof v==='number'?v:v.pct);
        const d=document.createElement('button'); d.className='pfdot'+(p!=null?' filled':''); d.title=c.tag+(p!=null?' · '+p+'%':' · not taken');
        if(p!=null) d.style.background = p>=70?'var(--sage)':p>=45?'var(--gold)':'var(--ember)';
        d.addEventListener('click',()=>openProfile(n));
        dots.appendChild(d);
      });
      card.appendChild(dots);
      list.appendChild(card);
    });
    $('pfcompare').style.display = names.length>=2 ? 'inline-flex' : 'none';   // Compare lives under Profiles
  }
  // profile detail: the pair's results FIRST — card, saved hearing curve, and every room with its
  // reading; tapping a room (re)takes exactly that room on this pair. Rename/export/delete live here.
  function openProfile(name){
    const dev=db.devices[name];
    if(!dev){ buildProfiles(); show('profiles'); return; }
    pvName=name;
    $('pvname').textContent=name;                       // textContent: stored/imported names can't inject
    const tot=deviceTotal(name);
    const done=CH.filter(c=>{const v=dev.rooms&&dev.rooms[c.tag]; return v!=null && (typeof v==='number'||v.pct!=null);}).length;
    $('pvmeta').textContent=(tot!=null?tot+'% overall · ':'')+done+' of '+CH.length+' rooms'
      +(dev.curve?' · curve measured':'')+(dev.date?' · last '+new Date(dev.date).toLocaleDateString():'');
    const data=cardData(name, dev);
    $('pvcardwrap').style.display=data?'block':'none';
    $('pvsavecard').style.display=data?'':'none';
    if(data) window.SR_FP.render($('pvcard'), data, {compact:true});   // hero+spectrum only — the room list below IS the scorecard (no double display); Save card still exports the full artifact
    const hasCurve=renderSavedCurve($('pvcurve'), name, dev);
    $('pvcurvewrap').style.display=hasCurve?'block':'none';
    $('pvsavecurve').style.display=hasCurve?'':'none';
    // the audiologist guidance persists with the saved curve — the one actionable output
    // shouldn't evaporate after the results screen
    const asym=dev.curve&&dev.curve.asym;
    if(hasCurve && asym && !(dev.curve&&dev.curve.faHi) && Math.abs(asym.max)>=15){   // same false-alarm gate as the results screen
      const worse=asym.max>0?'left':'right', atF=asym.atF>=1000?(asym.atF/1000)+' kHz':asym.atF+' Hz';
      $('pvcurvenote').textContent='On this run your '+worse+' ear needed noticeably more level above ~'+atF+'. A left–right difference is worth showing to an audiologist — screening, not a diagnosis.';
      $('pvcurvenote').style.display='block';
    } else $('pvcurvenote').style.display='none';
    $('pvempty').style.display=(data||hasCurve)?'none':'block';
    const list=$('pvrooms'); list.innerHTML='';
    const FPMETA=(window.SR_FP&&window.SR_FP.META)||{};   // one vocabulary: the list uses the card's names
    Object.keys(GROUPS).forEach(gk=>{
      const rooms=CH.map((c,i)=>({c,i})).filter(x=>x.c.group===gk);
      if(!rooms.length) return;
      const h=document.createElement('div'); h.className='bghead'; h.textContent=GROUPS[gk].name; list.appendChild(h);
      rooms.forEach(({c,i})=>{
        const v=dev.rooms&&dev.rooms[c.tag];
        const p=v==null?null:(typeof v==='number'?v:v.pct);
        const isCurve=c.mode==='curve';
        const taken=isCurve?!!dev.curve:p!=null;
        // each row is a self-contained result: plain name, the reading, a plain-words verdict of
        // what it MEANS, the action, and an ⓘ into the science sheet — no audiophile decoding needed
        const band = p==null?null : p>=82?'excellent':p>=58?'strong':p>=34?'fair':'weak';
        const bcol = band==null?null : (band==='excellent'||band==='strong')?'var(--sage)':band==='fair'?'var(--gold)':'var(--ember)';
        const row=document.createElement('div'); row.className='pvrow'+(taken?' taken':''); row.dataset.tag=c.tag;
        const main=document.createElement('button'); main.className='pvmain';
        const nm=document.createElement('span'); nm.className='rn'; nm.textContent=isCurve?'Hearing curve':((FPMETA[c.tag]&&FPMETA[c.tag].name)||c.title);
        const rt=document.createElement('span'); rt.className='rt'; rt.textContent=c.tag+' · '+c.tests;
        const rv=document.createElement('span'); rv.className='rv';
        const ra=document.createElement('span'); ra.className='ract';
        main.appendChild(nm); main.appendChild(rv); main.appendChild(rt); main.appendChild(ra);
        if(isCurve){
          rv.textContent = taken?'✓ measured':'not yet';
          ra.textContent = taken?'tap to redo ↻':'tap to measure ▶';
        } else if(p!=null){
          rv.textContent=((typeof v==='object'&&v.thr)?v.thr+' · ':'')+p+'%';   // textContent: imported thr can't inject
          rv.style.color=bcol;
          ra.textContent='tap to redo ↻';
          const bar=document.createElement('span'); bar.className='rbar';       // the card's bullet bar, now living on the row itself
          const bf=document.createElement('span'); bf.className='rfill'; bf.style.width=p+'%'; bf.style.background=bcol;
          bar.appendChild(bf); main.appendChild(bar);
          const T=contentOf(c.tag).tiers||{};
          let tierTxt=T[band==='excellent'?'reference':band]||'';
          // some tier lines open with their own quality word ("Strong; centre holds…") — strip it
          // so the row doesn't read "Strong — Strong; …"
          tierTxt=tierTxt.replace(/^(excellent|strong|fair|weak|reference)[\s;,—–-]+\s*/i,'');
          if(tierTxt) tierTxt=tierTxt[0].toUpperCase()+tierTxt.slice(1);
          const vd=document.createElement('span'); vd.className='rverdict';
          const bw=document.createElement('b'); bw.textContent=band[0].toUpperCase()+band.slice(1); bw.style.color=bcol;
          vd.appendChild(bw); if(tierTxt) vd.appendChild(document.createTextNode(' — '+tierTxt));
          main.appendChild(vd);
          // the review-word decoded for THIS room lives on the row itself — score, verdict and
          // what-it-means-when-reviews-say-it are one unit, not parallel sections
          const D=((window.SR_CONTENT&&window.SR_CONTENT.DECODER)||[]).find(d=>d.tag===c.tag);
          if(D){ const numVal=(typeof v==='object'&&isFinite(v.val))?v.val:null;
            let dline=null; try{ dline=D.line(numVal,p); }catch(e){}
            if(dline){ const dc=document.createElement('span'); dc.className='rdecode';
              const dt=document.createElement('b'); dt.textContent=D.term+' · ';
              dc.appendChild(dt); dc.appendChild(document.createTextNode(dline));
              main.appendChild(dc); } }
        } else {
          rv.textContent='not yet';
          ra.textContent='tap to run ▶ · '+fmtRange(estRoom(c));
        }
        main.addEventListener('click',()=>{
          if(isCurve){ initAudio(); ctx.resume(); device=safeName(name); pfReturn=true; startCurve(); }
          else retakeRoom(name, i);
        });
        const info=document.createElement('button'); info.className='iconbtn pvinfo'; info.textContent='i';
        info.title='What this measures'; info.setAttribute('aria-label','What "'+nm.textContent+'" measures');
        info.addEventListener('click',e=>{ e.stopPropagation(); openInfo(c.tag); });
        row.appendChild(main); row.appendChild(info);
        list.appendChild(row);
      });
    });
    buildDrift(dev);
    show('pfview');
  }
  function buildMethods(){
    const box=$('mdoc'); if(box.dataset.built) return; box.innerHTML='';
    ((window.SR_CONTENT&&window.SR_CONTENT.METHODS)||[]).forEach(s=>{
      const h=document.createElement('div'); h.className='bghead'; h.textContent=s.h; box.appendChild(h);
      s.p.forEach(t=>{ const p=document.createElement('p'); p.className='mdp'; p.innerHTML=t; box.appendChild(p); });
    });
    box.dataset.built='1';
  }
  // ---- repeatability: the one claim an uncalibrated instrument can genuinely earn. Compare a
  // pair's repeated runs of the SAME room and report the agreement, unedited, against published
  // benchmarks for home/automated/booth audiometry.
  function curvePoints(c){                     // normalise both stored curve shapes → [{ear,f,rel,cens}]
    const out=[];
    const grab=(arr,ear)=>{ if(!Array.isArray(arr)) return;
      const ref=arr.find(p=>p&&p.f===1000);
      const refCens=!!(ref&&ref.cens);       // a censored 1 kHz reference poisons every rel in this ear-run
      arr.forEach(p=>{ if(p&&isFinite(p.rel)) out.push({ear,f:p.f,rel:p.rel,cens:!!p.cens||refCens}); });
    };
    if(c&&c.ears){ grab(c.ears.R,'R'); grab(c.ears.L,'L'); }
    else if(Array.isArray(c)) grab(c,'B');
    return out;
  }
  function curveRepeat(hist){
    const runs=hist.filter(h=>h.curve).map(h=>curvePoints(h.curve)).filter(a=>a.length);
    if(runs.length<2) return null;
    const diffs=[];
    for(let i=1;i<runs.length;i++){
      const prev={}; runs[i-1].forEach(p=>{ prev[p.ear+'|'+p.f]=p; });
      // skip 1 kHz (0 by construction) AND any pair with a censored side: a point pinned at a
      // playback rail returns the same sentinel every run — that is the CLAMP repeating, not the
      // measurement, and it deflated the honesty panel's headline figure
      runs[i].forEach(p=>{ if(p.f===1000||p.cens) return; const q=prev[p.ear+'|'+p.f]; if(q&&!q.cens) diffs.push(Math.abs(p.rel-q.rel)); });
    }
    if(diffs.length<3) return null;
    const mean=diffs.reduce((a,b)=>a+b,0)/diffs.length;
    return { n:diffs.length, runs:runs.length, mean,
      w5:Math.round(100*diffs.filter(d=>d<=5).length/diffs.length),
      w10:Math.round(100*diffs.filter(d=>d<=10).length/diffs.length) };
  }
  function roomRepeat(hist, tag){
    const vals=hist.filter(h=>h.rooms&&h.rooms[tag]!=null).map(h=>h.rooms[tag])
      .map(r=>(typeof r==='number'?{pct:r}:r)).filter(r=>r&&r.pct!=null);
    if(vals.length<2) return null;
    // a score pinned at 0 or 100 every run is the ANCHOR CLAMP repeating, not the measurement —
    // reporting ±0 there would manufacture perfect repeatability in the one panel about honesty
    if(vals.every(v=>v.pct===0||v.pct===100)) return { runs:vals.length, pinned:true };
    // prefer the raw threshold in the room's own units; fall back to score points
    const A=ADAPT[tag], raw=vals.filter(v=>isFinite(v.val)).map(v=>v.val);
    if(A && A.fmt && raw.length===vals.length && raw.length>=2){
      const d=[]; for(let i=1;i<raw.length;i++) d.push(A.log ? Math.abs(Math.log(raw[i]/raw[i-1])) : Math.abs(raw[i]-raw[i-1]));
      const m=d.reduce((a,b)=>a+b,0)/d.length;
      // a log-scaled room's gap is a proportion, not an absolute — say it that way
      return { runs:vals.length, spread: A.log ? '±'+Math.round((Math.exp(m)-1)*100)+'%' : '±'+A.fmt(m) };
    }
    const dp=[]; for(let i=1;i<vals.length;i++) dp.push(Math.abs(vals[i].pct-vals[i-1].pct));
    return { runs:vals.length, meanPct: dp.reduce((a,b)=>a+b,0)/dp.length };
  }
  // one history entry per OCCASION: older profiles may carry duplicate runIds from the pre-v45
  // import bug — collapse them (newest write wins) so no reading is ever compared to itself
  function histByRun(dev){
    const m={}; ((dev&&dev.history)||[]).forEach(h=>{ const k=h.runId||('t'+h.at);
      if(!m[k] || (h.at||'')>(m[k].at||'')) m[k]=h; });
    return Object.values(m).filter(h=>h.at).sort((a,b)=>a.at.localeCompare(b.at));
  }
  function buildDrift(dev){
    const box=$('pvdrift'); box.innerHTML='';
    const M=(window.SR_FP&&window.SR_FP.META)||{};
    const hist=histByRun(dev);
    const rows=[];
    CH.forEach(c=>{ if(c.mode==='curve')return;
      const runs=hist.filter(h=>h.rooms&&h.rooms[c.tag]!=null&&((h.rooms[c.tag].pct!=null)||typeof h.rooms[c.tag]==='number'));
      if(runs.length<2) return;
      const first=runs[0], last=runs[runs.length-1];
      if(first.at.slice(0,10)===last.at.slice(0,10)) return;   // same-day repeats are practice, not drift
      const a=first.rooms[c.tag], b=last.rooms[c.tag];
      const pa=typeof a==='number'?a:a.pct, pb=typeof b==='number'?b:b.pct;
      const ta=(typeof a==='object'&&a.thr)||pa+'%', tb=(typeof b==='object'&&b.thr)||pb+'%';
      rows.push({name:(M[c.tag]&&M[c.tag].name)||c.title, ta, tb, dp:pb-pa});
    });
    const nCurves=hist.filter(h=>h.curve).length;
    const cr=curveRepeat(hist);
    const rr=CH.filter(c=>c.mode!=='curve').map(c=>({c, r:roomRepeat(hist,c.tag)})).filter(x=>x.r);
    if(!rows.length && nCurves<2 && !cr && !rr.length){ box.style.display='none'; return; }
    // repeatability first — it is the headline claim, not a footnote
    if(cr||rr.length){
      const rh=document.createElement('div'); rh.className='bghead'; rh.textContent='Does it repeat?'; box.appendChild(rh);
      const rs=document.createElement('div'); rs.className='pvdsub';
      rs.textContent='the honest test of an uncalibrated instrument: measure again and see if it says the same thing'; box.appendChild(rs);
      if(cr){
        const el=document.createElement('div'); el.className='pvrep';
        const big=document.createElement('span'); big.className='rbig'; big.textContent='±'+cr.mean.toFixed(1)+' dB';
        const lab=document.createElement('span'); lab.className='rlab';
        lab.textContent='average gap in curve SHAPE between your runs (each run is referenced to its own 1 kHz, so an overall level change — volume, seal, ambient noise — is subtracted out) · '+cr.w5+'% within 5 dB · '+cr.w10+'% within 10 dB · '+cr.runs+' runs, '+cr.n+' point pairs';
        el.appendChild(big); el.appendChild(lab); box.appendChild(el);
        const bm=document.createElement('div'); bm.className='pvdsub';
        bm.textContent='Not directly comparable: the studies below measured ABSOLUTE thresholds, a harder test than shape agreement. Treat them as context, not a scoreboard. Unsupervised home audiometry averaged 4.7 dB with 74% within 5 dB; automated audiometry in clinic conditions 3.3–3.6 dB with 91% within 5 dB; booth audiometry is generally taken as repeatable to 5–10 dB.';
        box.appendChild(bm);
      }
      rr.forEach(({c,r})=>{
        const el=document.createElement('div'); el.className='pvxrow';
        const n=document.createElement('span'); n.className='xn'; n.textContent=((window.SR_FP&&window.SR_FP.META[c.tag]||{}).name)||c.title;
        const v=document.createElement('span'); v.className='xv';
        v.textContent = r.pinned ? 'at this room’s limit — repeatability can’t be read here'
          : r.spread ? 'typical gap between runs '+r.spread+' · '+r.runs+' runs'
          : '±'+Math.round(r.meanPct)+' pts across '+r.runs+' runs';
        el.appendChild(n); el.appendChild(v); box.appendChild(el);
      });
      if(!cr && nCurves===1){
        const nudge=document.createElement('div'); nudge.className='pvdsub';
        nudge.textContent='Measure the hearing curve once more — on another day, same headphones — and this becomes a real repeatability figure in decibels.';
        box.appendChild(nudge);
      }
    }
    if(!rows.length && nCurves<2){ box.style.display='block'; return; }
    const h=document.createElement('div'); h.className='bghead'; h.textContent='Over time — same pair, different days'; box.appendChild(h);
    const sub=document.createElement('div'); sub.className='pvdsub'; sub.textContent='small moves are normal run to run; big, persistent moves are the ones that matter'; box.appendChild(sub);
    rows.forEach(r=>{
      const el=document.createElement('div'); el.className='pvxrow';
      const n=document.createElement('span'); n.className='xn'; n.textContent=r.name;
      const v=document.createElement('span'); v.className='xv'; v.textContent=r.ta+' → '+r.tb;   // textContent: stored thr can't inject
      const d=document.createElement('span'); d.className='xd';
      if(r.dp>=8){ d.textContent='▲ better'; d.style.color='var(--sage)'; }
      else if(r.dp<=-8){ d.textContent='▼ down'; d.style.color='var(--ember)'; }
      else { d.textContent='≈ steady'; d.style.color='var(--muted)'; }
      el.appendChild(n); el.appendChild(v); el.appendChild(d); box.appendChild(el);
    });
    if(nCurves>=2){
      // real drift check: earliest vs latest curve ≥28 days apart, same ear+frequency, ≥2 kHz,
      // censored points excluded. rel is referenced to each run's own 1 kHz, so a volume change
      // between sessions cancels — a ≥10 dB worsening in rel is a real shape change, not a knob.
      const runs=hist.filter(h=>h.curve);
      const days=(new Date(runs[runs.length-1].at)-new Date(runs[0].at))/864e5;
      let worst=null;
      if(days>=28){
        const a=curvePoints(runs[0].curve), b=curvePoints(runs[runs.length-1].curve);
        const am={}; a.forEach(p=>{ if(!p.cens) am[p.ear+'|'+p.f]=p.rel; });
        b.forEach(p=>{ if(p.cens||p.f<2000) return; const q=am[p.ear+'|'+p.f]; if(q==null) return;
          const d=q-p.rel;                      // positive = needs more level now = worse
          if(d>=10 && (!worst||d>worst.d)) worst={d, f:p.f, ear:p.ear}; });
      }
      const cn=document.createElement('div'); cn.className='pvdsub';
      cn.textContent = worst
        ? 'Between these runs ('+Math.round(days)+' days apart), your '+(worst.ear==='L'?'left ear':worst.ear==='R'?'right ear':'hearing')+' needed ~'+Math.round(worst.d)+' dB more at '+(worst.f>=1000?(worst.f/1000)+' kHz':worst.f+' Hz')+' relative to its own 1 kHz. Seal, room noise and an off day all move this — but if it persists on a calm retest, it is worth a hearing check. Screening, not a diagnosis.'
        : 'Curve measured '+nCurves+' times. A large (10 dB or more), persistent worsening at one pitch — not explained by a different volume — is worth a hearing check.';
      box.appendChild(cn);
    }
    box.style.display='block';
  }
  // open a pair for testing: pick which rooms to run in the room-select, with this pair active
  function testPair(name){
    initAudio(); ctx.resume();
    device=safeName(name); fromProfile=true;
    buildSelect(); show('select');
  }
  // retake (or first-take) a single room for a chosen pair — a fresh occasion (new runId → new history row)
  function retakeRoom(name, chIdx){
    initAudio(); ctx.resume();
    device=name; currentRunId=uid('r');
    order=[chIdx]; oi=0; score=0; chScore={}; chPct={}; roomThr={}; roomVal={}; roomDone={};
    chScore[chIdx]=0;
    $('score').textContent='0'; $('devlabel').textContent=device;
    show('game'); loadChapter();
  }

  // ---------- lab (?lab=1): stimulus variants for live listening sessions — invisible otherwise ----------
  // Whisper redesign candidates. The shipped room's pad (<420 Hz) and tick (>2.2 kHz) occupy
  // disjoint bands, so no masking occurs. Each variant creates REAL in-band masking a different
  // way; the session's job is choosing which one sounds like "detail buried under music".
  function labPad(when,dur,gain,lpFreq){          // V1: pad with its lowpass raised into the tick's band
    const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=lpFreq; lp.Q.value=.6;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when);
    g.gain.linearRampToValueAtTime(gain,when+.4);
    g.gain.setValueAtTime(gain,when+dur-.5); g.gain.linearRampToValueAtTime(0,when+dur);
    lp.connect(g); g.connect(master);
    [110,110.7,165.3].forEach(f=>{const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f; o.connect(lp); o.start(when); o.stop(when+dur+.05);});
  }
  function labTickLow(when,gain){                 // V2: tick moved low — 300 Hz, deliberately OFF every pad
    // harmonic (the pad has partials at exactly 330.0 and 330.6 Hz; a 330 Hz tick would add
    // coherently onto them → increment-detection + 0.6 Hz beats, not masking)
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=300; bp.Q.value=2;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(gain,when+.005); g.gain.exponentialRampToValueAtTime(Math.max(gain*0.0025,1e-7),when+.055);
    bp.connect(g); g.connect(master);
    const o=ctx.createOscillator(); o.type='square'; o.frequency.value=300; o.connect(bp); o.start(when); o.stop(when+.07);
  }
  function labAir(when,dur,gain){                 // V3: air narrowed to ~1 ERB around 3 kHz (348 Hz wide, Q≈8.6)
    // so the eventual "dB re air" is the true in-band SNR with no bandwidth correction — the
    // design review's key honesty requirement (a broadband gain here would be the old lie anew)
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(dur+.3);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=3000; bp.Q.value=8.6;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(gain,when+.4);
    g.gain.setValueAtTime(gain,when+dur-.5); g.gain.linearRampToValueAtTime(0,when+dur);
    nb.connect(bp); bp.connect(g); g.connect(master); nb.start(when); nb.stop(when+dur+.05);
  }
  function labPlayWhisper(variant, hard){
    initAudio(); ctx.resume(); killStim(); rvF=1; anchorMaster(0.85);
    const t=ctx.currentTime+.1, lv=hard?.008:.04, tickAt=t+.6+Math.random()*.5;
    if(variant===0){ pad(t,1.6,.2); tick(tickAt,lv); }
    else if(variant===1){ labPad(t,1.6,.2,4000); tick(tickAt,lv); }
    else if(variant===2){ pad(t,1.6,.2); labTickLow(tickAt,lv); }
    else { pad(t,1.6,.2); labAir(t,1.6,.1); tick(tickAt,lv); }
  }
  function buildLab(){
    const box=$('labpanel'); box.innerHTML='';
    const h=document.createElement('div'); h.className='bghead'; h.textContent='Lab · Whisper masker variants'; box.appendChild(h);
    const sub=document.createElement('div'); sub.className='pvdsub';
    sub.textContent='Each plays the pad with a tick at an easy (.04) or faint (.008) level. The decisive checks: V1 — a clean high pip, or a FLUTTER/roughness (≈10–30 Hz)? Flutter = beat detection, reject. V2 — a distinct low detail, or the note momentarily SWELLING thicker? Swell = increment detection, reject. V3 — a clean pip emerging from steady pitchless hiss, smoothly more audible as it rises = the textbook case. V0 control: change your volume — the tick’s findability shouldn’t depend on the pad at all (that’s the bug).';
    box.appendChild(sub);
    [['V0 · shipped',0],['V1 · brighter pad',1],['V2 · tick moved low',2],['V3 · pad + air',3]].forEach(([name,v])=>{
      const row=document.createElement('div'); row.className='labrow';
      const lbl=document.createElement('span'); lbl.className='labname'; lbl.textContent=name;
      const easy=document.createElement('button'); easy.className='btn ghost half'; easy.textContent='▶ easy';
      easy.onclick=()=>labPlayWhisper(v,false);
      const hardB=document.createElement('button'); hardB.className='btn ghost half'; hardB.textContent='▶ faint';
      hardB.onclick=()=>labPlayWhisper(v,true);
      row.appendChild(lbl); row.appendChild(easy); row.appendChild(hardB); box.appendChild(row);
    });
    box.style.display='block';
  }
  // ---------- boot ----------
  buildIntro(); applyCoffeeLinks(); wire();
  if(new URLSearchParams(location.search).has('lab')) buildLab();
  // platform-aware setup guidance — Android codec instructions on an iPhone read as broken homework
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(isIOS){
    $('introTips').textContent='Best in a quiet room, at a moderate volume, with Spatialize Audio and any EQ switched off.';
    const w=document.querySelector('#device .warnbox');
    if(w) w.innerHTML='<b>Comparing pairs?</b> Match loudness first: replay the calibration notes on each pair and set the volume until they sound equally loud. Keep ANC in the same mode, and turn off <em>Spatialize Audio</em> (press and hold the volume slider in Control Centre) and any headphone EQ.';
  }
  (async()=>{ await loadDB(); if(deviceNames().length){ $('goprofiles').style.display='inline'; $('pfsep').style.display='inline'; } offerResume(); })();
  if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }

  // storage/profiles API surface (also the future state/store.js module boundary) — lets the app's
  // own tooling exercise migration/import/merge directly, and keeps the seam explicit for the decompose.
  window.SR_STORE = {
    migrate, loadDB, saveDB, persistFull, importText, exportBlob, downloadExport,
    deleteDevice, renameDevice, upsertRoomReading, upsertCurve, projectFromHistory, SCHEMA,
    get db(){ return db; }, set db(v){ db=v; },
    get device(){ return device; }, set device(v){ device=v; },
    get runId(){ return currentRunId; }, set runId(v){ currentRunId=v; }
  };
})();
