/* Stone Room — the listening fingerprint card.
   A scorecard, not a data-dump: a hero score up top, one spectrum-reach band, then
   bullet bars grouped by domain. Bar LENGTH is the quality (longer = better) so the
   card reads at a glance; colour (green/gold/ember) is a redundant band cue and every
   bar carries its measured value + a plain word. Exports to PNG. */
(function () {
  "use strict";

  const COL = { bg:'#221C15', card:'#2A231C', line:'#3C332A', track:'#3a322a',
                stone:'#EDE4D6', muted:'#A2937F', dim:'#6f6456',
                ember:'#E27A45', gold:'#D9A24B', sage:'#8FB89A', good:'#9FC46E' };
  const FONT = "Space Grotesk, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

  // per-room: display name, domain group, and how to render the measured value
  const META = {
    Foundation:{ name:'Sub-bass reach', group:'edge', fmt:v=>Math.round(v)+' Hz' },
    Air:       { name:'Treble reach',   group:'edge', fmt:v=>(v/1000).toFixed(1)+' kHz' },
    Stage:     { group:'space', name:'Soundstage',    fmt:v=>'±'+Math.round(v)+'°' },
    Motion:    { group:'space', name:'Moving image',  fmt:v=>'±'+Math.round(v)+'°' },
    Orbit:     { group:'space', name:'360 imaging',   fmt:v=>'±'+Math.round(v)+'°' },
    Depth:     { group:'space', name:'Depth layers',  fmt:v=>'±'+Math.round(v)+'°' },
    Separation:{ group:'space', name:'Separation',    fmt:v=>'±'+Math.round(v)+'°' },
    Centre:    { group:'space', name:'Centre image',  fmt:v=>Math.round(v*100)+'% off' },
    Duet:      { group:'space', name:'Stereo width',  fmt:v=>Math.round(v*100)+'%' },
    Flyby:     { group:'space', name:'Distance',      fmt:v=>v.toFixed(1)+'× gap' },
    Echo:      { group:'space', name:'Reflections',   fmt:v=>Math.round(v*1000)+' ms' },
    Crowd:     { group:'detail',name:'Ensemble count',fmt:v=>Math.round(v)+' voices' },
    Whisper:   { group:'detail',name:'Buried detail', fmt:v=>Math.round(20*Math.log10(.2/v))+' dB under' },
    Silence:   { group:'detail',name:'Noise floor',   fmt:v=>Math.round(20*Math.log10(v/.45))+' dB' },
    Grain:     { group:'detail',name:'Timbre purity', fmt:v=>Math.round(v*100)+'% partial' },
    Halls:     { group:'detail',name:'Decay / rooms', fmt:v=>Math.round(v*100)+'% Δ' },
    Composure: { group:'detail',name:'Composure',     fmt:v=>'drive '+v.toFixed(1) },
    Grip:      { group:'tone',  name:'Bass grip',     fmt:v=>Math.round(v*100)+'% bloom' },
    Presence:  { group:'tone',  name:'Midrange',      fmt:v=>v.toFixed(1)+' dB dip' },
    Silk:      { group:'tone',  name:'Sibilance',     fmt:v=>'+'+Math.round(20*Math.log10((.05+v)/.05))+' dB' },
    Snap:      { group:'time',  name:'Slam / attack', fmt:v=>Math.round(v*1000)+' ms' },
    Pulse:     { group:'time',  name:'Timing',        fmt:v=>Math.round(v)+' ms' },
    Shade:     { group:'time',  name:'Micro-dynamics',fmt:v=>v.toFixed(2)+' dB' },
  };
  const GROUPS = [
    ['space','Space & imaging'],
    ['detail','Detail & resolution'],
    ['tone','Tone & frequency'],
    ['time','Time & dynamics'],
  ];
  function band(pct){
    if(pct>=82) return { word:'reference', col:COL.good };
    if(pct>=58) return { word:'strong',    col:COL.sage };
    if(pct>=34) return { word:'fair',      col:COL.gold };
    return { word:'weak', col:COL.ember };
  }
  function rankWord(pct){ return pct>=82?'Golden ear':pct>=60?'Tuned in':pct>=35?'Warming up':'First listen'; }
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const round1=(a,b)=>`<rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${a.r||3}" fill="${a.fill}"${a.op?` fill-opacity="${a.op}"`:''}/>`;

  function render(el, data){
    const W=384, PAD=22, IW=W-2*PAD;
    const rooms=data.rooms||{};
    const has=t=>rooms[t] && rooms[t].pct!=null;
    const score=data.score!=null?Math.round(data.score):null;

    // ---- assemble scorecard groups (everything except the spectrum edges) ----
    const sections=[];
    for(const [gk,gname] of GROUPS){
      const rows=Object.keys(META).filter(t=>META[t].group===gk && has(t))
        .map(t=>({tag:t, name:META[t].name, pct:rooms[t].pct, val:rooms[t].val}))
        .sort((a,b)=>a.pct-b.pct);                     // weakest first — problems read top of each block
      if(rows.length) sections.push({gname, rows});
    }
    const showSpectrum = has('Foundation') || has('Air');

    // ---- measure height ----
    let y = 52;                                         // after header
    if(score!=null) y += 78;                            // hero block
    if(showSpectrum) y += 78;
    const cardTop = 8;
    for(const s of sections){ y += 26 + s.rows.length*24; }
    y += 22;                                            // footer note
    const H = y + 12;

    // ================= draw =================
    let g='';
    // header
    g+=`<text x="${PAD}" y="24" fill="${COL.muted}" font-size="9.5" letter-spacing="2.4" font-family="${FONT}">STONE ROOM · FINGERPRINT</text>`;
    if(data.date) g+=`<text x="${W-PAD}" y="24" fill="${COL.dim}" font-size="9.5" text-anchor="end" font-family="${FONT}">${esc(data.date)}</text>`;
    g+=`<text x="${PAD}" y="43" fill="${COL.gold}" font-size="16" font-weight="600" font-family="${FONT}">${esc(data.device||'')}</text>`;
    let cy=52;

    // hero score
    if(score!=null){
      g+=`<text x="${PAD}" y="${cy+34}" fill="${COL.stone}" font-size="46" font-weight="600" font-family="${FONT}">${score}</text>`;
      const nx=PAD+ (score>=100?86:64);
      g+=`<text x="${nx}" y="${cy+20}" fill="${COL.muted}" font-size="13" font-family="${FONT}">/ 100</text>`;
      g+=`<text x="${nx}" y="${cy+37}" fill="${COL.stone}" font-size="15" font-weight="600" font-family="${FONT}">${rankWord(score)}</text>`;
      // overall bar
      const by=cy+50;
      g+=round1({x:PAD,y:by,w:IW,h:8,r:4,fill:COL.track});
      g+=round1({x:PAD,y:by,w:Math.max(6,IW*score/100),h:8,r:4,fill:score>=58?COL.good:score>=34?COL.gold:COL.ember});
      g+=`<text x="${PAD}" y="${by+24}" fill="${COL.muted}" font-size="10.5" font-family="${FONT}">${esc(data.context||'')}</text>`;
      cy+=78;
    }

    // spectrum reach
    if(showSpectrum){
      const x=f=>PAD + (Math.log10(Math.max(20,Math.min(20000,f))/20)/Math.log10(1000))*IW;
      g+=`<text x="${PAD}" y="${cy+12}" fill="${COL.muted}" font-size="9.5" letter-spacing="1.8" font-family="${FONT}">SPECTRUM REACH</text>`;
      g+=`<text x="${W-PAD}" y="${cy+12}" fill="${COL.dim}" font-size="9" text-anchor="end" font-family="${FONT}">of the 20 Hz–20 kHz audible range</text>`;
      const ay=cy+36;
      g+=round1({x:PAD,y:ay,w:IW,h:8,r:4,fill:COL.track});      // full 20–20k reference
      // guard missing/NaN val (imported or legacy profiles may carry pct/thr but no numeric val)
      const foundV = (has('Foundation') && isFinite(rooms.Foundation.val)) ? rooms.Foundation.val : null;
      const airV   = (has('Air') && isFinite(rooms.Air.val)) ? rooms.Air.val : null;
      const lo = foundV!=null ? foundV : 20, hi = airV!=null ? airV : 20000;
      const x1=x(lo), x2=x(hi);
      g+=round1({x:x1,y:ay,w:Math.max(4,x2-x1),h:8,r:4,fill:COL.sage});
      if(foundV!=null) g+=`<text x="${x1}" y="${ay-6}" fill="${COL.stone}" font-size="11.5" font-weight="600" text-anchor="start" font-family="${FONT}">${Math.round(lo)} Hz</text>`;
      if(airV!=null) g+=`<text x="${x2}" y="${ay-6}" fill="${COL.stone}" font-size="11.5" font-weight="600" text-anchor="end" font-family="${FONT}">${(hi/1000).toFixed(1)} kHz</text>`;
      // ticks
      [[20,'20'],[100,'100'],[1000,'1k'],[10000,'10k'],[20000,'20k']].forEach(([f,l],i,arr)=>{
        g+=`<text x="${x(f)}" y="${ay+22}" fill="${COL.dim}" font-size="8.5" text-anchor="${i===0?'start':i===arr.length-1?'end':'middle'}" font-family="${FONT}">${l}</text>`;
      });
      cy+=78;
    }

    // scorecard
    const nameX=PAD, trackX0=PAD+116, trackX1=W-PAD-72, twMax=trackX1-trackX0;
    for(const s of sections){
      g+=`<text x="${PAD}" y="${cy+14}" fill="${COL.muted}" font-size="10" letter-spacing="1.6" font-family="${FONT}">${s.gname.toUpperCase()}</text>`;
      cy+=26;
      for(const r of s.rows){
        const b=band(r.pct), rowY=cy;
        g+=`<text x="${nameX}" y="${rowY+4}" fill="${COL.stone}" font-size="12.5" font-family="${FONT}">${esc(r.name)}</text>`;
        g+=round1({x:trackX0,y:rowY-3,w:twMax,h:6,r:3,fill:COL.track});
        g+=round1({x:trackX0,y:rowY-3,w:Math.max(4,twMax*r.pct/100),h:6,r:3,fill:b.col});
        const vtxt = (META[r.tag].fmt && r.val!=null) ? META[r.tag].fmt(r.val) : '';
        g+=`<text x="${W-PAD}" y="${rowY+4}" fill="${COL.muted}" font-size="10.5" text-anchor="end" font-family="${FONT}">${esc(vtxt)}</text>`;
        cy+=24;
      }
    }
    // footer note
    g+=`<line x1="${PAD}" y1="${cy}" x2="${W-PAD}" y2="${cy}" stroke="${COL.line}" opacity="0.5"/>`;
    g+=`<text x="${PAD}" y="${cy+15}" fill="${COL.dim}" font-size="9" font-family="${FONT}">Longer bar = better. Measured through your own ears + gear.</text>`;

    let mark='';
    if(data.sample) mark=`<text x="${W/2}" y="${H/2}" fill="${COL.stone}" opacity="0.08" font-size="52" font-weight="700" letter-spacing="10" text-anchor="middle" transform="rotate(-16 ${W/2} ${H/2})" font-family="${FONT}">SAMPLE</text>`;

    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect x="1" y="1" width="${W-2}" height="${H-2}" rx="16" fill="${COL.bg}" stroke="${COL.line}"/>
${g}${mark}
</svg>`;
    el.innerHTML=svg;
    return el.firstChild;
  }

  // lazily load the embedded card font (only when someone actually exports)
  function loadCardFont(){
    if(window.SR_CARD_FONT) return Promise.resolve(window.SR_CARD_FONT);
    return new Promise(res=>{
      const s=document.createElement('script'); s.src='card-font.js';
      s.onload=()=>res(window.SR_CARD_FONT||null); s.onerror=()=>res(null);
      document.head.appendChild(s);
    });
  }
  async function toPNG(svgEl, scale){
    const s=scale||3;
    const font=await loadCardFont().catch(()=>null);
    let xml=new XMLSerializer().serializeToString(svgEl);
    if(font){
      const style=`<style>@font-face{font-family:'Space Grotesk';font-style:normal;font-weight:400 700;src:url('${font}') format('woff2');}</style>`;
      xml=xml.replace(/(<svg[^>]*>)/, '$1'+style);
    }
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml;charset=utf-8'}));
      const img=new Image();
      img.onload=()=>{
        const c=document.createElement('canvas');
        c.width=svgEl.viewBox.baseVal.width*s; c.height=svgEl.viewBox.baseVal.height*s;
        const g2=c.getContext('2d'); g2.drawImage(img,0,0,c.width,c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b=>b?resolve(b):reject(new Error('toBlob failed')),'image/png');
      };
      img.onerror=e=>{URL.revokeObjectURL(url); reject(e);};
      img.src=url;
    });
  }

  // ---- audiogram: Hz × dB relative-response line chart ----
  function renderCurve(el, data){
    const W=372, H=232, L=36, R=16, T=40, B=32;
    const curve=(data.curve||[]).filter(p=>p&&isFinite(p.rel));
    const fmin=125, fmax=16000, yMax=6, yMin=-54;
    const x=f=>L + (Math.log10(Math.max(fmin,Math.min(fmax,f))/fmin)/Math.log10(fmax/fmin))*(W-L-R);
    const y=v=>T + (yMax-Math.max(yMin,Math.min(yMax,v)))/(yMax-yMin)*(H-T-B);
    let g='';
    g+=`<text x="${L}" y="20" fill="${COL.muted}" font-size="9.5" letter-spacing="2" font-family="${FONT}">HEARING + HEADPHONE CURVE</text>`;
    g+=`<text x="${L}" y="34" fill="${COL.gold}" font-size="14" font-weight="600" font-family="${FONT}">${esc(data.device||'')}</text>`;
    // dB grid + labels
    [0,-20,-40].forEach(v=>{
      g+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="${COL.line}" opacity="${v===0?0.9:0.4}"${v===0?' stroke-dasharray="4 4"':''}/>`;
      g+=`<text x="${L-6}" y="${y(v)+3}" fill="${COL.dim}" font-size="9" text-anchor="end" font-family="${FONT}">${v}</text>`;
    });
    g+=`<text x="${L}" y="${T-6}" fill="${COL.muted}" font-size="9" font-family="${FONT}">dB vs your 1 kHz →</text>`;
    // freq ticks
    [[125,'125'],[500,'500'],[1000,'1k'],[2000,'2k'],[4000,'4k'],[8000,'8k'],[16000,'16k']].forEach(([f,l],i,arr)=>{
      g+=`<text x="${x(f)}" y="${H-B+18}" fill="${COL.dim}" font-size="8.5" text-anchor="${i===0?'start':i===arr.length-1?'end':'middle'}" font-family="${FONT}">${l}</text>`;
    });
    if(curve.length){
      const pts=curve.map(p=>`${x(p.f).toFixed(1)},${y(p.rel).toFixed(1)}`).join(' ');
      g+=`<polyline points="${pts}" fill="none" stroke="${COL.sage}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      curve.forEach(p=>{ const c=p.rel>=-6?COL.good:p.rel>=-20?COL.gold:COL.ember;
        g+=`<circle cx="${x(p.f).toFixed(1)}" cy="${y(p.rel).toFixed(1)}" r="3.4" fill="${c}" stroke="${COL.bg}" stroke-width="1"/>`; });
    }
    g+=`<text x="${W-R}" y="${H-4}" fill="${COL.dim}" font-size="8.5" text-anchor="end" font-family="${FONT}">flat = even response · dips = rolled off</text>`;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect x="1" y="1" width="${W-2}" height="${H-2}" rx="14" fill="${COL.bg}" stroke="${COL.line}"/>${g}</svg>`;
    el.innerHTML=svg;
    return el.firstChild;
  }

  // watermarked sample for the landing demo
  const SAMPLE={
    device:'Sample pair', sample:true, score:71, date:'',
    context:'above a typical first listen (~50–65%)',
    rooms:{
      Foundation:{pct:78,val:26}, Air:{pct:64,val:15200},
      Presence:{pct:72,val:2.4}, Silk:{pct:58,val:.06}, Grip:{pct:66,val:.12},
      Stage:{pct:82,val:8}, Motion:{pct:70,val:12}, Orbit:{pct:44,val:30}, Depth:{pct:61,val:16}, Separation:{pct:69,val:14}, Centre:{pct:88,val:.09}, Duet:{pct:74,val:.55}, Flyby:{pct:57,val:1.6}, Echo:{pct:63,val:.12},
      Crowd:{pct:50,val:5}, Whisper:{pct:66,val:.02}, Grain:{pct:72,val:.05}, Halls:{pct:55,val:.4}, Composure:{pct:80,val:1.1},
      Snap:{pct:75,val:.009}, Pulse:{pct:62,val:13}, Shade:{pct:48,val:.9}
    }
  };

  window.SR_FP={ render, renderCurve, toPNG, SAMPLE };
})();
