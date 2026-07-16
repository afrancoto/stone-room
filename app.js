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
  const CONFIG = {
    COFFEE_URL: "https://www.paypal.me/YOURNAME",   // ← set your PayPal.me / Buy-Me-a-Coffee link
    SHARE_TITLE: "Stone Room — a listening lab"
  };

  const LY = 95, RAD = 150;
  let ctx, master, reverb, hallSmall, hallMed, hallLarge, _noise;

  function initAudio(){
    if(ctx) return;
    ctx = new (window.AudioContext||window.webkitAudioContext)();
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
    const inG=ctx.createGain(), outG=ctx.createGain(); outG.gain.value=0.9;
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
    function stop(){stopped=true; if(timer){clearTimeout(timer);timer=null;}}
    function setAz(az2){const {x,z}=pos(az2,dist); panner.positionX.value=x; panner.positionZ.value=z;}
    function glide(fromAz,toAz,dur){
      const t=ctx.currentTime, a=pos(fromAz,dist), b=pos(toAz,dist);
      panner.positionX.setValueAtTime(a.x,t); panner.positionZ.setValueAtTime(a.z,t);
      panner.positionX.linearRampToValueAtTime(b.x,t+dur); panner.positionZ.linearRampToValueAtTime(b.z,t+dur);
    }
    return {loop,stop,playOnce,glide,setAz,timbre:key,az,dist};
  }

  // ---- audio primitives (each a controllable stimulus) ----
  function subTone(freq, when, dur, gain){
    const g=ctx.createGain();
    g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(gain,when+.15);
    g.gain.setValueAtTime(gain,when+dur-.2); g.gain.linearRampToValueAtTime(0,when+dur);
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
    const g=ctx.createGain(); g.gain.setValueAtTime(gain,when); g.gain.exponentialRampToValueAtTime(.0005,when+.05);
    hp.connect(g); g.connect(master);
    const o=ctx.createOscillator(); o.type='square'; o.frequency.value=3000; o.connect(hp); o.start(when); o.stop(when+.07);
  }
  function grainNote(when,dirty,partialGain){
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.5,when+.01);
    g.gain.exponentialRampToValueAtTime(.0008,when+.9); g.connect(master);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=330*rvF; o.connect(g); o.start(when); o.stop(when+1);
    const g2=ctx.createGain(); g2.gain.setValueAtTime(0,when); g2.gain.linearRampToValueAtTime(.18,when+.01);
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
  function shimmerBurst(f,t,dur,gain){
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(dur+.2);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=f; bp.Q.value=8;
    const g=ctx.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+.08);
    g.gain.setValueAtTime(gain,t+dur-.15); g.gain.linearRampToValueAtTime(0,t+dur);
    nb.connect(bp); bp.connect(g); g.connect(master); nb.start(t); nb.stop(t+dur+.05);
  }
  function snapHit(when,attack){
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.8,when+attack);
    g.gain.exponentialRampToValueAtTime(.001,when+attack+.35); g.connect(master);
    const o=ctx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(180,when); o.frequency.exponentialRampToValueAtTime(60,when+.25);
    o.connect(g); o.start(when); o.stop(when+.7);
    const nb=ctx.createBufferSource(); nb.buffer=noiseBuf(0.3);
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=3000; bp.Q.value=.7;
    const ng=ctx.createGain(); ng.gain.setValueAtTime(0,when); ng.gain.linearRampToValueAtTime(.45,when+attack); ng.gain.exponentialRampToValueAtTime(.0008,when+attack+.07);
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
    if(wide){ mk(-detuneCents,-panAmt); mk(detuneCents,panAmt); }
    else { mk(0,0); mk(0.6,0); }
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
      const t=when+i*step+(i===lateIdx?lateMs/1000:0);
      const g=ctx.createGain(); g.gain.setValueAtTime(.5,t); g.gain.exponentialRampToValueAtTime(.0006,t+.12);
      const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1200;
      lp.connect(g); g.connect(master);
      const o=ctx.createOscillator(); o.type='square'; o.frequency.value=220*rvF; o.connect(lp); o.start(t); o.stop(t+.15);
    }
  }
  function bassNote(when,dirty,amt){
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.85,when+.02);
    if(dirty){
      g.gain.setValueAtTime(.85,when+.25);
      g.gain.linearRampToValueAtTime(.5,when+.5);
      g.gain.linearRampToValueAtTime(.65,when+.7);
      g.gain.exponentialRampToValueAtTime(.001,when+1.5);
    } else {
      g.gain.setValueAtTime(.85,when+.2); g.gain.exponentialRampToValueAtTime(.001,when+.8);
    }
    g.connect(master);
    const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=55*rvF; o.connect(g); o.start(when); o.stop(when+1.6);
    if(dirty){
      [110,165].forEach((f,i)=>{const hg=ctx.createGain(); hg.gain.setValueAtTime(0,when); hg.gain.linearRampToValueAtTime(amt/(i+1),when+.03);
        hg.gain.exponentialRampToValueAtTime(.0006,when+1.2); hg.connect(master);
        const ho=ctx.createOscillator(); ho.type='sine'; ho.frequency.value=f*rvF; ho.connect(hg); ho.start(when); ho.stop(when+1.3);});
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
    const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=220;
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
    const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(.3,when+.06);
    g.gain.setValueAtTime(.3,when+1.2); g.gain.linearRampToValueAtTime(0,when+1.5);
    peak.connect(lp); lp.connect(g); g.connect(master);
    const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=196;
    const vib=ctx.createOscillator(); vib.frequency.value=5; const vg=ctx.createGain(); vg.gain.value=3;
    vib.connect(vg); vg.connect(o.frequency); vib.start(when); vib.stop(when+1.6);
    o.connect(peak); o.start(when); o.stop(when+1.6);
  }
  function makeDriveCurve(k){
    const n=1024, c=new Float32Array(n);
    for(let i=0;i<n;i++){const x=i/(n-1)*2-1; c[i]=k?Math.tanh(k*x)/Math.tanh(k):x;}
    return c;
  }
  function driveTrim(k){
    // soft-clipping raises RMS at equal peak — trim the driven chord back to the clean level
    if(!k) return 1;
    let se=0, ce=0;
    for(let i=0;i<512;i++){const x=.6*Math.sin(2*Math.PI*i/512); const y=Math.tanh(k*x)/Math.tanh(k); se+=x*x; ce+=y*y;}
    return Math.sqrt(se/ce);
  }
  function composureChord(when,drive){
    const sh=ctx.createWaveShaper(); sh.curve=makeDriveCurve(drive);
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

  // ---------- room table (behaviour) ----------
  // mode: 'stair' = adaptive 2AFC (ZEST); 'locate'/'sweep'/'orbit'/'depth'/'separate' = adaptive spatial;
  // 'count' = adaptive counting. Descriptive content merged from content.js by tag.
  const CH=[
    {group:'holo',tag:'Stage',title:'Point at the singer',tests:'soundstage width',mode:'locate',
     claim:'A great headphone paints instruments across a stage — you can point at each one.',
     learn:'Your brain places sound by comparing microsecond timing and level differences between your ears. Clean drivers keep those cues intact; sloppy ones blur the map.',
     notice:'One sound on the stage in front of you. Tap the arc where it sits. It plays tighter as you dial in.'},
    {group:'holo',tag:'Motion',title:'Track the mover',tests:'imaging precision',mode:'sweep',
     claim:'Pinpoint imaging: when a sound moves, you can follow it like watching it.',
     learn:'Smooth motion means the inter-ear cues update without smearing. A blurry transducer turns a moving point into a travelling cloud.',
     notice:'The sound glides across the stage, then stops. Tap where it came to rest.'},
    {group:'holo',tag:'Centre',title:'Lock the vocalist',tests:'channel matching',mode:'stair',
     claim:'A perfectly matched pair nails the voice dead centre — zero drift.',
     learn:'A centre image only forms when left and right drivers match within about 1 dB. Any mismatch drags the vocalist off their stool. B&W hand-match pairs for exactly this.',
     notice:'The same note twice. One sits exactly between your ears; one drifts a hair to one side. The drift shrinks as you catch it.'},
    {group:'holo',tag:'Orbit',title:'Around your head',tests:'true holography',mode:'orbit',
     claim:'True holography: the music exists around you, not inside your skull.',
     learn:'Front vs back is the hardest cue — it lives in how your outer ear filters treble. Motion rescues it: your brain tracks the path continuously. A mirrored miss is a famous illusion, not a failure.',
     notice:'The sound circles your whole head — behind you too — then stops. Tap the ring where it landed. Eyes closed, seriously.'},
    {group:'holo',tag:'Depth',title:'Front row, back row',tests:'layering',mode:'depth',
     claim:'Layering: a good mix has a front row and a back row, and you can seat everyone.',
     learn:'Distance is decoded from three cues at once: loudness, treble roll-off, and how much room reverb rides along with the direct sound.',
     notice:'Tap the <em>inner</em> arc for a near sound, the <em>outer</em> for a far one.'},
    {group:'holo',tag:'Flyby',title:'How close did it pass?',tests:'distance rendering',mode:'stair',
     claim:'Distance is rendered, not implied — near and far are different physical things.',
     learn:'A pass distance is computed from the Doppler pitch bend plus the loudness swell. The closer the pass, the sharper both curves — action-movie physics, verified.',
     notice:'Two vehicles cross your stage, pitch bending as they pass. Which came closer? The gap narrows as you catch it.'},
    {group:'holo',tag:'Echo',title:'Hear the walls',tests:'spatial cues',mode:'stair',
     claim:'Good transducers preserve the room’s reflections — you can hear the walls.',
     learn:'Your brain times the gap from click to reflection: roughly 6 ms per metre of wall distance, there and back. You were literally echolocating.',
     notice:'A click, then its reflection. Longer silence = further wall. Which wall is further?'},
    {group:'holo',tag:'Duet',title:'Wall to wall',tests:'stereo width',mode:'stair',
     claim:'Width: the mix stretches ear to ear and past your shoulders.',
     learn:'Width is decorrelation — small deliberate differences between channels. Strong channel separation in the headphone keeps them from collapsing back toward mono.',
     notice:'The same chord twice. One fills the space between your ears; one stays narrow. Which was wide?'},
    {group:'res',tag:'Separation',title:'Pick one voice out',tests:'instrument separation',mode:'separate',
     claim:'Each instrument keeps its own pocket of space — nothing smears together.',
     learn:'Separation is position plus timbre staying stable per source. When drivers distort, sources bleed into each other and the mix turns to porridge.',
     notice:'Three sounds at once. You hear your target alone first — then tap it out of the crowd.'},
    {group:'res',tag:'Crowd',title:'Count the ensemble',tests:'no congestion',mode:'count',
     claim:'A busy passage never collapses into mush — the mix stays countable.',
     learn:'Congestion is where cheap gear folds first: as sources stack up, intermodulation smears them together. Countability is the bluntest possible test of it.',
     notice:'A small ensemble plays at once, spread across the stage. Count the distinct voices. It grows as you keep up.'},
    {group:'res',tag:'Whisper',title:'Details under the music',tests:'detail retrieval',mode:'stair',
     claim:'You hear things in familiar albums you never knew were there.',
     learn:'Low-level detail rides 20–30 dB beneath the music. Low driver distortion and noise keep it audible instead of buried — that’s "detail retrieval".',
     notice:'A warm pad plays twice; one hides a single faint tick. Which? It sinks deeper each time you catch it.'},
    {group:'res',tag:'Silence',title:'The black background',tests:'noise floor',mode:'stair',
     claim:'Between the notes: true black. No hiss, no veil, just nothing.',
     learn:'"Black background" is a low noise floor — nothing added beneath quiet passages. You just resolved near-silence, which is exactly what the phrase means.',
     notice:'A note, then silence — twice. One silence hides a faint hiss. Which was truly black?'},
    {group:'res',tag:'Grain',title:'Spot the impostor',tests:'timbre resolution',mode:'stair',
     claim:'Timbre is texture — and you can hear when a note’s texture is even slightly off.',
     learn:'Timbre lives in the balance of overtones. The impostor carried one stray partial at ~2.8× the fundamental — the sound of texture being subtly wrong.',
     notice:'The same note twice — one pure, one with a faint stray overtone. Pick the pure one. The impostor gets subtler with every catch.'},
    {group:'res',tag:'Halls',title:'How the note dies',tests:'decay resolution',mode:'stair',
     claim:'Notes don’t stop — they fade into a space, and you can hear the size of it.',
     learn:'A reverb tail falls some 60 dB into silence. Resolving where it ends — and how big the room was — is the classic test of low-level linearity.',
     notice:'The same pluck, in two different rooms. Which room was bigger? The difference narrows as you catch it.'},
    {group:'res',tag:'Composure',title:'Loud stays clean',tests:'low distortion',mode:'stair',
     claim:'Push it hard and it never hardens — composure under pressure.',
     learn:'Overdrive a bad driver and it clips: harmonics appear that were never in the music, heard as hardness or glare. Composure means loud and clean are the same thing.',
     notice:'The same big chord twice. One version subtly hardens and buzzes. Which stayed clean?'},
    {group:'tone',tag:'Foundation',title:'The floor beneath',tests:'sub-bass extension',mode:'stair',
     claim:'Real extension: bass you feel in your jaw, below what most gear can even produce.',
     learn:'Below ~40 Hz most gear rolls off and you only hear overtones. This room hunts your exact floor: the lowest frequency this chain — headphone plus your ears — still delivers.',
     notice:'Two intervals; one hides a low tone. Which? Each catch drives the tone deeper until it vanishes — your floor in Hz. Moderate volume.'},
    {group:'tone',tag:'Grip',title:'Taut, not flabby',tests:'bass control',mode:'stair',
     claim:'Bass with grip: taut and textured, never a shapeless boom.',
     learn:'Loose bass is an envelope problem: the cone keeps moving after the note should stop. Grip is a fast start AND a fast stop — extension’s stricter sibling.',
     notice:'Two bass notes. One is clean and controlled; one blooms and wobbles. Which was tighter?'},
    {group:'tone',tag:'Presence',title:'The voice in the room',tests:'midrange truth',mode:'stair',
     claim:'Honest mids put the singer in the room; scooped mids put them behind glass.',
     learn:'Voices live at 1–3 kHz. Cut that band and a singer steps backward and loses body — the "veiled" sound. Honest mids are why some gear feels intimate.',
     notice:'The same voice-like tone twice. One has its core hollowed out. Which was in the room with you?'},
    {group:'tone',tag:'Air',title:'Room to breathe',tests:'treble extension',mode:'stair',
     claim:'Air: the openness above the music, the shimmer that cheap gear shaves off.',
     learn:'The top octave (8 kHz and up) carries shimmer, space and "air". Roll it off and music breathes less — even when you can’t name what went missing.',
     notice:'Two intervals; one holds a faint high shimmer. Which? It climbs higher each time you catch it — your ceiling in kHz.'},
    {group:'tone',tag:'Silk',title:'Smooth, never sharp',tests:'sibilance control',mode:'stair',
     claim:'Treble with silk: all the sparkle, none of the needle in the "s".',
     learn:'Sibilance is an energy spike near 6–8 kHz that turns an "s" into a stab. Smooth treble keeps the energy without the pain — the hardest tuning balance there is.',
     notice:'A voice-like phrase ending in "ss" — twice. One "ss" stabs; one stays silk. Which was smoother?'},
    {group:'dyn',tag:'Snap',title:'Slam',tests:'transient attack',mode:'stair',
     claim:'Slam: a drum hit arrives instantly, with edges — that’s driver control.',
     learn:'A real transient rises in under a millisecond. Reproducing that edge takes a light, stiff, well-damped driver — exactly what exotic cone materials are for.',
     notice:'Two drum hits. One strikes instantly; the other eases in by a hair. Which truly <em>hit</em>?'},
    {group:'dyn',tag:'Pulse',title:'The tight groove',tests:'timing · prat',mode:'stair',
     claim:'Pace, rhythm and timing: the groove locks, and nothing drags.',
     learn:'Humans detect timing errors down to ~10 ms. "PRaT" is gear preserving every attack edge so the groove stays locked instead of shuffling.',
     notice:'Two short grooves. In one, a beat lands a hair late. Which groove was tight?'},
    {group:'dyn',tag:'Shade',title:'Loud and louder',tests:'micro-dynamics',mode:'stair',
     claim:'Micro-dynamics: the difference between loud and slightly louder is where expression lives.',
     learn:'A performer’s expression is 1–2 dB shadings between notes. Any compression in the chain flattens those gradations into sameness.',
     notice:'The same note twice, at slightly different levels. Which was louder?'},
  ];
  const ROMANS=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII'];
  const DEVCOLORS=['#7BA79C','#E27A45','#D9A24B','#B7A6E3'];

  // ---------- adaptive 2AFC staircase params + stimulus (keyed by tag) ----------
  // type D: one interval holds the stimulus (pick it). type X: both play; one is altered.
  // play(level, t, flag): D → flag=stimulus present; X → flag=this interval is the altered one.
  const ADAPT={
    Foundation:{type:'D', q:'Which held a tone?', dur:1.4, start:40, floor:16, ceil:63, hard:.90, easy:1.15, log:true, betterHigh:false, anchors:[50,20], fmt:v=>Math.round(v)+' Hz',
      play:(lv,t,on)=>{marker(t); if(on) subTone(lv, t+.12, 1.15, lv<45?.85:.7);}},
    Air:{type:'D', q:'Which held a shimmer?', dur:1.1, start:13000, floor:8000, ceil:20000, hard:1.08, easy:.88, log:true, betterHigh:true, anchors:[10000,17000], fmt:v=>(v/1000).toFixed(1)+' kHz',
      play:(lv,t,on)=>{marker(t); if(on) shimmerBurst(lv, t+.15, .8, .16);}},
    Whisper:{type:'D', q:'Which pad hid a tick?', dur:1.7, start:.04, floor:.002, ceil:.2, hard:.78, easy:1.5, log:true, betterHigh:false, anchors:[.04,.008], fmt:v=>Math.round(20*Math.log10(.2/v))+' dB under',
      play:(lv,t,on)=>{pad(t,1.6,.2); if(on) tick(t+.5+Math.random()*.7, lv);}},
    Silence:{type:'X', q:'Which hid a hiss?', dur:2.4, answerAltered:true, start:.04, floor:.004, ceil:.1, hard:.72, easy:1.6, log:true, betterHigh:false, anchors:[.05,.006], fmt:v=>Math.round(20*Math.log10(v/.45))+' dB',
      play:(lv,t,alt)=>silenceTail(t, alt?lv:0)},
    Grain:{type:'X', q:'Which was pure?', dur:1.15, answerAltered:false, start:.1, floor:.008, ceil:.35, hard:.78, easy:1.4, log:true, betterHigh:false, anchors:[.15,.02], fmt:v=>'partial '+Math.round(v*100)+'%',
      play:(lv,t,alt)=>grainNote(t, alt, lv)},
    Composure:{type:'X', q:'Which stayed clean?', dur:1.8, answerAltered:false, start:4.5, floor:.5, ceil:9, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[5,.8], fmt:v=>'drive '+v.toFixed(1),
      play:(lv,t,alt)=>composureChord(t, alt?lv:0)},
    Grip:{type:'X', q:'Which was tighter?', dur:1.7, answerAltered:false, start:.15, floor:.02, ceil:.5, hard:.8, easy:1.4, log:true, betterHigh:false, anchors:[.35,.06], fmt:v=>'bloom '+Math.round(v*100)+'%',
      play:(lv,t,alt)=>bassNote(t, alt, lv)},
    Presence:{type:'X', q:'Which was in the room?', dur:1.7, answerAltered:false, start:2.5, floor:.5, ceil:6, hard:.8, easy:1.35, log:false, betterHigh:false, anchors:[5,1], fmt:v=>v.toFixed(1)+' dB scoop',
      play:(lv,t,alt)=>presenceVoice(t, alt?-lv:0)},
    Silk:{type:'X', q:'Which "s" stabbed?', dur:1.5, answerAltered:true, start:.1, floor:.005, ceil:.35, hard:.78, easy:1.4, log:true, betterHigh:false, anchors:[.15,.02], fmt:v=>'+'+Math.round(20*Math.log10((0.05+v)/0.05))+' dB sib',
      play:(lv,t,alt)=>silkPhrase(t, .05+(alt?lv:0))},
    Snap:{type:'X', q:'Which truly hit?', dur:.9, answerAltered:false, start:.035, floor:.004, ceil:.08, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[.04,.006], fmt:v=>Math.round(v*1000)+' ms attack',
      play:(lv,t,alt)=>snapHit(t, alt?lv:.001)},
    Pulse:{type:'X', q:'Which groove was tight?', dur:2.15, answerAltered:false, start:40, floor:5, ceil:80, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[45,8], fmt:v=>Math.round(v)+' ms',
      play:(lv,t,alt)=>pulsePattern(t, 3, alt?lv:0)},
    Shade:{type:'X', q:'Which was louder?', dur:.95, answerAltered:true, start:1.5, floor:.3, ceil:4, hard:.8, easy:1.4, log:true, betterHigh:false, anchors:[3,.5], fmt:v=>v.toFixed(2)+' dB',
      play:(lv,t,alt)=>dynNote(t, alt?lv:0)},
    Centre:{type:'X', q:'Which sat dead centre?', dur:1.5, answerAltered:false, start:.25, floor:.03, ceil:.5, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[.28,.05], fmt:v=>Math.round(v*100)+'% off',
      play:(lv,t,alt)=>centreNote(t, alt?(Math.random()<.5?1:-1)*lv:0)},
    Duet:{type:'X', q:'Which felt wider?', dur:2.0, answerAltered:true, start:.8, floor:.1, ceil:1, hard:.72, easy:1.5, log:true, betterHigh:false, anchors:[.9,.15], fmt:v=>'width '+Math.round(v*100)+'%',
      play:(lv,t,alt)=>duetChord(t, alt, 12*lv, .9*lv)},
    Echo:{type:'X', q:'Which wall was further?', dur:.85, answerAltered:true, start:.1, floor:.012, ceil:.3, hard:.75, easy:1.5, log:true, betterHigh:false, anchors:[.12,.02], fmt:v=>'+'+Math.round(v*1000)+' ms',
      play:(lv,t,alt)=>clickEcho(t, .12+(alt?lv:0))},
    // newly-adaptive 2AFC rooms
    Flyby:{type:'X', q:'Which passed closer?', answerAltered:true, start:2.2, floor:1.06, ceil:6, hard:.9, easy:1.4, log:true, betterHigh:false, anchors:[3.2,1.2], fmt:v=>v.toFixed(1)+'× gap', dur:2.6,
      play:(lv,t,alt)=>{const far=5.5; flyby(t, Math.random()<.5?1:-1, alt?far/lv:far, 2.4);}},
    Halls:{type:'X', q:'Which room was bigger?', answerAltered:true, start:.55, floor:.12, ceil:1.1, hard:.9, easy:1.4, log:true, betterHigh:false, anchors:[.9,.3], fmt:v=>Math.round(v*100)+'% larger', dur:2.7,
      play:(lv,t,alt)=>hallPluckSec(t, alt?1.1*(1+lv):1.1)},
  };

  // ---------- adaptive spatial specs (acuity in degrees) ----------
  // score maps median angular error to pct via [weakDeg, refDeg]; stops when the running
  // acuity estimate is confident (SE small) after a minimum, else at maxRounds.
  const SPATIAL={
    Stage:{minR:3, maxR:6, weak:40, ref:5, ecc:[40,58,74,86]},
    Motion:{minR:3, maxR:6, weak:45, ref:7, spd:[2.4,2.0,1.7,1.4]},
    Orbit:{minR:3, maxR:6, weak:75, ref:14, dur:[4.2,3.8,3.4,3.0]},
    Depth:{minR:3, maxR:6, weak:52, ref:10},
    Separation:{minR:3, maxR:6, weak:52, ref:10, spread:[64,48,36,28]},
  };

  // ---------- state ----------
  let order=[], oi=0, score=0, voices=[], target=null, guessLocked=false, replayFn=()=>{};
  let chScore={}, chPct={}, roomThr={}, roomVal={};   // per-room score, readout text, numeric measurement
  let choiceTimers=[], orbitInt=null;
  // curated default tour (~11 non-redundant rooms across all four domains) — keeps the set
  // short. Every other room stays available on the select screen, just off by default.
  const DEFAULT_ROOMS = new Set(['Stage','Orbit','Depth','Crowd','Whisper','Grain','Foundation','Air','Presence','Snap','Shade']);
  let selected = CH.map(c=>DEFAULT_ROOMS.has(c.tag));
  let device='';
  let db={devices:{}}, storageOK=false, cmpVisible={};
  let lastPct=0;
  let st=null;                                    // active stair state
  let sp=null;                                    // active spatial state
  let cnt=null;                                   // active count state
  let kbAz=0, kbRad=110, kbActive=false;          // keyboard guess cursor (spatial rooms)
  // per-trial roving: defeats memorisation of a fixed reference. Level and base pitch are
  // randomised each trial (both intervals share the same rove) so only the tested DIFFERENCE
  // is informative — you can't learn the token, only hear the change.
  let rvF=1;
  function roveTrial(){
    rvF = Math.pow(2, (Math.random()*6-3)/12);     // ±3 semitones base transpose
    if(master) master.gain.setValueAtTime(0.85*(0.62+Math.random()*0.38), ctx.currentTime); // −4..0 dB
  }

  const $=id=>document.getElementById(id);
  const scr={intro:$('intro'),cal:$('cal'),select:$('select'),device:$('device'),game:$('game'),end:$('end'),compare:$('compare')};
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
    if(c.mode==='count') return {q:5*7.5, f:8*7.5};
    const per={locate:7,sweep:8.5,depth:7.5,separate:10,orbit:11}[c.mode]||8;
    const S=SPATIAL[c.tag]||{minR:4,maxR:8};
    return {q:(S.minR+1)*per, f:S.maxR*per};
  }
  const fmtMin=s=>String(Math.max(1,Math.round(s/60)));
  const fmtRange=e=>{const a=fmtMin(e.q), b=fmtMin(e.f); return a===b?`~${a} min`:`~${a}–${b} min`;};

  // ---- persistent storage (per-device results, localStorage) ----
  const STORE_KEY='stoneroom_results_v2';
  async function loadDB(){
    try{ const r=localStorage.getItem(STORE_KEY); if(r) db=JSON.parse(r); storageOK=true; }
    catch(e){ storageOK=false; }
    if(!db || typeof db!=='object' || !db.devices) db={devices:{}};
  }
  // read-modify-write so a second tab (or an 'again' run on a stale cache) can't clobber
  // devices saved elsewhere: reload the stored map, overlay ours, persist.
  async function saveDB(){
    try{
      let stored={devices:{}};
      try{ const r=localStorage.getItem(STORE_KEY); if(r){ const p=JSON.parse(r); if(p&&p.devices) stored=p; } }catch(e){}
      Object.keys(db.devices).forEach(k=>{ stored.devices[k]=db.devices[k]; });
      db=stored;
      localStorage.setItem(STORE_KEY, JSON.stringify(db)); storageOK=true;
    }catch(e){ storageOK=false; }
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
  }

  // ---- wiring ----
  function wire(){
    $('begin').addEventListener('click',async()=>{
      initAudio(); ctx.resume(); await loadDB();
      if(deepRoom>=0){ buildDevice(); show('device'); }
      else { show('cal'); runCal(); }
    });
    $('gocompare').addEventListener('click',async()=>{await loadDB(); buildCompare(); show('compare');});
    $('aboutToggle').addEventListener('click',()=>{
      const a=$('introAbout'), t=$('aboutToggle'), opening=a.hasAttribute('hidden');
      if(opening){ a.removeAttribute('hidden'); t.setAttribute('aria-expanded','true'); t.textContent='Less'; }
      else { a.setAttribute('hidden',''); t.setAttribute('aria-expanded','false'); t.textContent='What is this?'; }
    });
    $('demoToggle').addEventListener('click',()=>{
      const d=$('introDemo'), t=$('demoToggle'), opening=d.hasAttribute('hidden');
      if(opening){
        d.removeAttribute('hidden'); t.setAttribute('aria-expanded','true'); t.textContent='Hide';
        if(!d.dataset.built){ window.SR_FP.render($('fpDemo'), window.SR_FP.SAMPLE); d.dataset.built='1'; }
      } else { d.setAttribute('hidden',''); t.setAttribute('aria-expanded','false'); t.textContent='What you’ll get'; }
    });
    $('savecard').addEventListener('click',saveCard);
    $('calreplay').addEventListener('click',runCal);
    $('calgo').addEventListener('click',()=>{buildSelect(); show('select');});
    $('selstart').addEventListener('click',()=>{buildDevice(); show('device');});
    $('devgo').addEventListener('click',()=>{ device=safeName(($('devinput').value.trim())||suggestName()); startGame(); });
    $('again').addEventListener('click',startGame);
    $('reselect').addEventListener('click',()=>{buildSelect(); show('select');});
    $('endcompare').addEventListener('click',()=>{buildCompare(); show('compare');});
    $('cmpback').addEventListener('click',()=>{show(order.length?'end':'intro');});
    $('cmpnew').addEventListener('click',()=>{buildSelect(); show('select');});
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
    rvF=1; if(master) master.gain.setValueAtTime(0.85, ctx.currentTime);   // clear any leftover rove
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
      idxs.forEach(i=>{
        const c=CH[i];
        const b=document.createElement('button'); b.className='chip'; b.dataset.idx=i;
        b.innerHTML=`<div class="cname">${c.tag}<span class="ctime">${fmtRange(estRoom(c))}</span></div><div class="cq">${c.tests}</div><div class="cclaim">${c.claim}</div>`;
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

  function startGame(){
    initAudio(); ctx.resume();
    order = CH.map((_,i)=>i).filter(i=>selected[i]);
    if(!order.length) order=CH.map((_,i)=>i);
    score=0; oi=0; chScore={}; chPct={}; roomThr={}; roomVal={};
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
    const cd=$('chapdots'); cd.innerHTML=''; order.forEach((_,i)=>{const d=document.createElement('div');d.className='cdot'+(i<oi?' done':i===oi?' now':'');cd.appendChild(d);});
    $('learn').classList.remove('on'); $('next').classList.remove('on'); hideCheckpointBtns();
    setPrecision(0,''); $('precision').classList.remove('on');
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
  function sharpenRoom(){
    hideCheckpointBtns(); $('next').classList.remove('on'); $('learn').classList.remove('on');
    if(st && st.done){ st.done=false; st.sharpen=true; guessLocked=false; stairTrial(); }
    else if(sp && sp._finished){ sp._finished=false; sp.done=false; sp.sharpen=true; guessLocked=false; spatialRound(); }
  }
  function redoRoom(){
    const i=order[oi], tag=CH[i].tag;
    if(chScore[i]!=null){ score-=chScore[i]; }
    chScore[i]=0; delete chPct[i]; delete roomThr[tag]; delete roomVal[tag];
    $('score').textContent=score;
    hideCheckpointBtns();
    loadChapter();
  }

  function startChapter(){
    guessLocked=false; st=null; sp=null; cnt=null; stopVoices();
    ['guess','truthg','link','guessO','truthgO','linkO'].forEach(id=>$(id).classList.remove('on'));
    setReplay(true);
    const c=chap();
    const isStair=c.mode==='stair', isOrbit=c.mode==='orbit', isCount=c.mode==='count';
    const isField = c.mode==='locate'||c.mode==='sweep'||c.mode==='depth'||c.mode==='separate';
    $('fieldwrap').classList.toggle('hidden', !(isField));
    $('fieldwrapO').classList.toggle('hidden', !isOrbit);
    $('choices').classList.toggle('on', isStair||isCount);
    if(isStair) setupStair(c);
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
    const A=ADAPT[c.tag];
    const eng=window.SR_ZEST.forRoom(A);
    st={A, tag:c.tag, eng, trial:0, side:0, curX:0, curLevel:A.start, done:false, dur:A.dur||1.5};
    showPrecisionUI();
    stairTrial();
  }
  function stairTrial(){
    const A=st.A;
    st.curX=st.eng.z.next(); st.curLevel=st.eng.levelOf(st.curX);
    st.side=Math.random()<.5?0:1;
    const btns=buildChoices(['A','B'],['first','second'],stairPick);
    const dur=st.dur, gap=.3;
    const play=()=>{
      choiceTimers.forEach(t=>clearTimeout(t)); choiceTimers=[];
      setChoicesEnabled(false); setReplay(false); roveTrial();
      $('status').innerHTML=`Trial ${st.trial+1} <span style="color:var(--muted)">of ≤${st.eng.nMax}</span> · <span class="pts">honing in…</span>`;
      const t=ctx.currentTime+.25;
      for(let i=0;i<2;i++){
        const flag=(i===st.side);
        A.play(st.curLevel, t+i*(dur+gap), flag);
        choiceTimers.push(setTimeout(()=>{btns.forEach(b=>b.classList.remove('playing')); btns[i].classList.add('playing');},(0.25+i*(dur+gap))*1000));
      }
      choiceTimers.push(setTimeout(()=>{btns.forEach(b=>b.classList.remove('playing')); $('status').innerHTML=`${A.q} <span style="color:var(--muted)">· ${A.type==='D'?'first or second':'A or B'}</span>`; setChoicesEnabled(true); setReplay(true);},(0.25+2*dur+gap)*1000));
    };
    replayFn=play; play();
  }
  function stairPick(i){
    if(!st || st.done) return;
    setChoicesEnabled(false); setReplay(false);
    const A=st.A;
    const answer = A.type==='D' ? st.side : (A.answerAltered ? st.side : 1-st.side);
    const hit=i===answer;
    [...$('choices').children].forEach((b,k)=>{ if(k===answer) b.classList.add('correct'); else if(k===i) b.classList.add('wrong'); });
    st.eng.z.record(st.curX, hit);
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
    recordRoom(pct, A.fmt(thr), {val:thr, lo:loT, hi:hiT});
    const conf=Math.round(stt.conf*100);
    $('status').innerHTML=`Your reading: <span class="pts">${A.fmt(thr)}</span> · +${pct} <span style="color:var(--muted)">· ${conf}% confident</span>`;
    setPrecision(stt.conf, `${A.fmt(thr)}  ·  ${bandStr(A,loT,hiT)}`);
    showLearn(); appendTier(tierLine(st.tag,pct));
    showResultBtns(!stt.solid && stt.trial < st.eng.nMax);
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
    cnt={n:3, best:3, trial:0, minR:4, maxR:8, wrong:0, done:false, history:[]};
    showPrecisionUI();
    countTrial();
  }
  function countTrial(){
    const n=cnt.n;
    // shuffle the three options so the true count isn't always the middle button (a positional tell)
    const vals=[n-1,n,n+1];
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
    if(hit){ cnt.best=Math.max(cnt.best,cnt.n); cnt.n=Math.min(7,cnt.n+1); }
    else { cnt.wrong++; cnt.n=Math.max(3,cnt.n-1); }
    // confidence: proportion of run done + convergence of best
    const frac=clamp(cnt.trial/cnt.maxR,0,1);
    setPrecision(frac, `top count ${cnt.best}`);
    const enough=cnt.trial>=cnt.minR && (cnt.wrong>=2);
    if(cnt.trial>=cnt.maxR || enough){ finishCount(); return; }
    $('status').innerHTML = hit? `✓ ${pick(cont.hit)}` : `○ ${pick(cont.miss)}`;
    choiceTimers.push(setTimeout(()=>{ [...$('choices').children].forEach(b=>b.classList.remove('correct','wrong')); countTrial(); }, 640));
  }
  function finishCount(){
    if(cnt.done) return; cnt.done=true; guessLocked=true; stopVoices();
    const best=Math.max(cnt.best,3);             // 3 is the smallest ensemble ever presented
    const pct=Math.round(clamp((best-3)/(7-3),0,1)*100);
    recordRoom(pct, best+' voices', {val:best});
    $('status').innerHTML=`You held <span class="pts">${best} voices</span> apart · +${pct}`;
    setPrecision(1, best+' voices');
    showLearn(); appendTier(tierLine('Crowd',pct));
    showResultBtns(false);   // Redo only (no "sharpen" for a counting task)
    advanceUI();
  }
  // ---------- adaptive spatial ----------
  // force reflow on the wrapping HTML div (offsetWidth is undefined on <svg> in Firefox)
  function listen(){$('fieldwrap').classList.remove('listening'); void $('fieldwrap').offsetWidth; $('fieldwrap').classList.add('listening');}
  function listenO(){$('fieldwrapO').classList.remove('listening'); void $('fieldwrapO').offsetWidth; $('fieldwrapO').classList.add('listening');}

  function setupSpatial(c){
    const S=SPATIAL[c.tag];
    sp={c, S, mode:c.mode, round:0, errs:[], done:false, minR:S.minR, maxR:S.maxR};
    showPrecisionUI();
    spatialRound();
  }
  function spatialRound(){
    guessLocked=false; sp.locked=false;
    ['guess','truthg','link','guessO','truthgO','linkO'].forEach(id=>$(id).classList.remove('on'));
    setReplay(true); roveTrial();
    kbActive=false; kbAz=0; kbRad = sp.mode==='orbit'?112 : sp.mode==='depth'?90 : 110;
    const c=sp.c, S=sp.S, r=sp.round;
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
      const build=()=>{stopVoices(); const v=makeVoice(key,from,1.6,0.55); voices=[v];
        choiceTimers.push(setTimeout(()=>{ if(!voices[0])return; v.loop(); v.glide(from,to,spd); },200));};
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
        if(solo){ $('status').textContent='Your target, alone…'; let t=ctx.currentTime+0.3; t=voices[ti].playOnce(t);
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
          const az=startAz+dir*sweep*f; v.setAz(az);
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
    if(!sp || guessLocked) return; e.preventDefault();
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
  function confirmNote(key,az,dist){ choiceTimers.push(setTimeout(()=>{ const tv=makeVoice(key,az,dist,0.6); tv.playOnce(ctx.currentTime+.05); },200)); }

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
    if(!sp || guessLocked || sp._finished || orbitInt) return;
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
    sp.errs.push(effErr);
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
    if(we>50 && wrapErr(az,mirrorAz)<20){ effErr=45; msg='Mirrored — the classic front/back flip.'; }
    else msg = we<16?pick(contentOf('Orbit').hit):we<40?'In the area.':pick(contentOf('Orbit').miss);
    sp.errs.push(effErr);
    $('status').innerHTML=`${msg} <span style="color:var(--muted)">· ${Math.round(we)}° off</span>`;
    afterSpatialRound();
  }
  function acuityStats(){
    // robust central error and a confidence from spread & count
    const e=sp.errs.slice().sort((a,b)=>a-b);
    const med = e.length%2 ? e[(e.length-1)/2] : (e[e.length/2-1]+e[e.length/2])/2;
    const mean=e.reduce((a,b)=>a+b,0)/e.length;
    const varr=e.reduce((a,b)=>a+(b-mean)*(b-mean),0)/e.length;
    const se=Math.sqrt(varr/e.length);
    const conf=clamp(1 - se/ (sp.S.weak*0.5), 0, 1) * clamp(sp.errs.length/sp.maxR,0,1);
    return {med,mean,se,conf};
  }
  function afterSpatialRound(){
    sp.round++;
    const a=acuityStats();
    setPrecision(a.conf, `≈ ${Math.round(a.med)}° acuity`);
    const enough = sp.round>=sp.minR && a.se < sp.S.ref*0.6;
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
    recordRoom(pct, `${Math.round(a.med)}° acuity`, {val:a.med, lo:Math.max(1,a.med-1.96*a.se), hi:a.med+1.96*a.se});
    $('status').innerHTML=`Your acuity: <span class="pts">${Math.round(a.med)}°</span> · +${pct} <span style="color:var(--muted)">· ${Math.round(a.conf*100)}% confident</span>`;
    setPrecision(a.conf, `${Math.round(a.med)}° · ${sp.round} rounds`);
    showLearn(); appendTier(tierLine(sp.c.tag,pct));
    showResultBtns(sp.round < sp.maxR);
    advanceUI();
  }

  // ---------- shared result plumbing ----------
  function recordRoom(pct, readout, extra){
    const i=order[oi], tag=CH[i].tag;
    if(chScore[i]!=null) score-=chScore[i];        // replace (not accumulate) — Sharpen re-records
    chScore[i]=pct; chPct[i]=pct; roomThr[tag]=readout;
    if(extra && extra.val!=null) roomVal[tag]={val:extra.val, lo:extra.lo, hi:extra.hi};
    score+=pct; $('score').textContent=score;
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
    order.forEach(i=>{const c=CH[i]; lines.push(`  ${c.tag} (${c.tests}): ${roomThr[c.tag]||chPct[i]+'%'} · ${chPct[i]}%`);});
    lines.push(shareURL());
    try{ await navigator.clipboard.writeText(lines.join('\n')); flashSaved('results copied'); }
    catch(e){ flashSaved('could not copy'); }
  }

  // ---------- end ----------
  async function finish(){
    stopVoices(); show('end');
    const max=order.length*100; $('finalnum').textContent=score;
    const pct=max?score/max:0; lastPct=pct; const pctR=Math.round(pct*100);
    $('finalout').innerHTML=`of <b>${max}</b> · <b>${pctR}%</b> across ${order.length} room${order.length>1?'s':''}`;
    let rank,verdict;
    if(pct>=.85){rank='Golden ear'; verdict=`Every claim verified on the ${device} — holography, slam, air, silk, the lot. The reviews weren’t poetry after all.`;}
    else if(pct>=.6){rank='Tuned in'; verdict='Most claims verified. Whatever scored lowest below is the quality worth hunting for in your next album.';}
    else if(pct>=.35){rank='Warming up'; verdict='Critical listening is a learned skill. Another lap and the claims start proving themselves.';}
    else{rank='First listen'; verdict='All of this lives in the sound — it takes a few laps to hear it. Pick one group and drill it.';}
    $('rank').textContent=rank; $('verdict').textContent=verdict;
    // honest benchmark context + what drives the gap (hearing vs headphones)
    const where = pctR>=80 ? 'well above the ~50–65% most people score on a first run — trained-ear territory'
      : pctR>=55 ? 'right around where most first-time listeners land (~50–65%)'
      : pctR>=35 ? 'a touch below the ~50–65% typical first run — the rooms you missed are the ones to drill'
      : 'below a typical first run — try a smaller set and turn the volume up a little';
    // find weakest room and note whether it's hearing- or headphone-limited
    const hearingRooms={Air:'your ears (treble fades with age)',Foundation:'your ears and the headphones together'};
    let worst=null,worstP=101; order.forEach(i=>{ if(chPct[i]<worstP){worstP=chPct[i];worst=CH[i].tag;} });
    const drive = worst && hearingRooms[worst] ? `Your lowest room, ${worst}, leans on ${hearingRooms[worst]}.`
      : worst ? `Your lowest room was ${worst} — mostly down to the headphones and practice.` : '';
    $('benchnote').innerHTML = `${pctR}% is ${where}. ${drive} To separate your ears from the gear, run the same rooms on a second pair — your ears stay constant, so the difference is the headphones.`;
    const dev = (hasDevice(device) && db.devices[device]) || {rooms:{}};
    order.forEach(i=>{ const tag=CH[i].tag;
      dev.rooms[tag] = Object.assign({pct:chPct[i], thr:roomThr[tag]}, roomVal[tag]||{});
    });
    dev.date=new Date().toISOString(); db.devices[device]=dev; await saveDB();
    renderCard(dev);
    $('saved').textContent = storageOK ? `saved · ${device}` + (deviceNames().length>1 ? ' · compare available' : '')
      : 'storage unavailable — results kept for this session only';
    const bd=$('breakdown'); bd.innerHTML='';
    Object.keys(GROUPS).forEach(gk=>{
      const idxs=order.filter(i=>CH[i].group===gk);
      if(!idxs.length) return;
      const h=document.createElement('div'); h.className='bghead'; h.textContent=GROUPS[gk].name; bd.appendChild(h);
      idxs.forEach(i=>{
        const c=CH[i], p=chPct[i], val=roomThr[c.tag]||`${p}%`;
        const row=document.createElement('div'); row.className='brow';
        row.innerHTML=`<span class="bname">${c.tag}</span><div class="btrack"><div class="bfill"></div></div><span class="bpct">${val}</span>`;
        bd.appendChild(row);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{row.querySelector('.bfill').style.width=p+'%';}));
      });
    });
  }

  // ---------- fingerprint card ----------
  function renderCard(dev){
    // full picture of THIS pair: this run merged with anything measured before
    const rooms={};
    Object.keys(dev.rooms||{}).forEach(tag=>{ const r=dev.rooms[tag]; if(r && r.val!=null) rooms[tag]={val:r.val, lo:r.lo, hi:r.hi}; });
    const wrap=$('fpwrap');
    if(!Object.keys(rooms).length){ wrap.style.display='none'; return; }
    wrap.style.display='block';
    window.SR_FP.render($('fpcard'), { device, date:new Date().toLocaleDateString(), rooms });
  }
  async function saveCard(){
    const svg=$('fpcard').querySelector('svg'); if(!svg) return;
    try{
      const blob=await window.SR_FP.toPNG(svg,3);
      const file=new File([blob], `stone-room-${device.replace(/[^\w-]+/g,'_')}.png`, {type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title:CONFIG.SHARE_TITLE}); }
      else{
        const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=file.name;
        document.body.appendChild(a); a.click(); a.remove();
      }
    }catch(e){ flashSaved('could not save card'); }
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
  const deviceTotal=n=>{
    const rooms=db.devices[n].rooms||{}; const ps=Object.keys(rooms).map(k=>{const v=rooms[k]; return typeof v==='number'?v:(v&&v.pct);}).filter(p=>p!=null);
    return ps.length ? Math.round(ps.reduce((a,b)=>a+b,0)/ps.length) : null;
  };
  function renderCompareRows(names){
    const box=$('cmpscroll'); box.innerHTML='';
    if(!names.length){ box.innerHTML='<div class="cmpempty">No saved results yet.<br>Finish a tour with a headphone name and it lands here — then run the same rooms on a second pair.</div>'; return; }
    const active=names.filter(n=>cmpVisible[n]);
    // overall score per device, up top
    const th=document.createElement('div'); th.className='bghead'; th.textContent='Overall'; box.appendChild(th);
    const trow=document.createElement('div'); trow.className='cmprow';
    trow.innerHTML='<div class="rname">Average across rooms</div>';
    active.forEach(n=>{
      const tot=deviceTotal(n), col=DEVCOLORS[names.indexOf(n)%DEVCOLORS.length];
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
        active.forEach(n=>{
          const v=db.devices[n].rooms[c.tag];
          const p = v==null ? null : (typeof v==='number' ? v : v.pct);
          const label = v==null ? '—' : (typeof v==='object' && v.thr ? v.thr : p+'%');
          const col=DEVCOLORS[names.indexOf(n)%DEVCOLORS.length];
          const bar=document.createElement('div'); bar.className='cmpbar';
          bar.innerHTML = p!=null
            ? `<div class="track"><div class="fill" style="width:${p}%;background:${col}"></div></div><span class="pct">${label}</span>`
            : `<div class="track"></div><span class="pct">—</span>`;
          row.appendChild(bar);
        });
        box.appendChild(row);
      });
    });
  }

  // ---------- boot ----------
  buildIntro(); applyCoffeeLinks(); wire();
  (async()=>{ await loadDB(); if(deviceNames().length){ $('gocompare').style.display='inline'; $('cmpsep').style.display='inline'; } })();
  if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }
})();
