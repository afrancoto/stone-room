/* Stone Room — the listening fingerprint card.
   Renders a measurement card as SVG: a log frequency axis (20 Hz–20 kHz) carrying the
   measured audible window (sub-bass floor → treble ceiling) and threshold glyphs at their
   true frequencies, plus space/time/level readings. Every mark is a real measurement from
   the run — nothing decorative. Exportable to PNG. */
(function () {
  "use strict";

  const COL = { bg:'#221C15', line:'#3C332A', stone:'#EDE4D6', muted:'#A2937F',
                ember:'#E27A45', sage:'#7BA79C', gold:'#D9A24B', iris:'#B7A6E3' };
  const FONT = "Space Grotesk, system-ui, sans-serif";

  // per-room: how to convert the raw stored value into a display number + which group it belongs to
  const SPEC = {
    Foundation:{ group:'freq' },
    Air:       { group:'freq' },
    Presence:  { group:'dip',  conv:v=>v,                          label:v=>`−${v.toFixed(1)} dB dip heard` },
    Silk:      { group:'spike',conv:v=>20*Math.log10((0.05+v)/0.05), label:v=>`+${v.toFixed(1)} dB spike heard` },
    Stage:     { group:'space', conv:v=>v, txt:v=>`Stage ${Math.round(v)}°` },
    Motion:    { group:'space', conv:v=>v, txt:v=>`Motion ${Math.round(v)}°` },
    Orbit:     { group:'space', conv:v=>v, txt:v=>`Orbit ${Math.round(v)}°` },
    Depth:     { group:'space', conv:v=>v, txt:v=>`Depth ${Math.round(v)}°` },
    Separation:{ group:'space', conv:v=>v, txt:v=>`Separation ${Math.round(v)}°` },
    Centre:    { group:'space', conv:v=>v*100, txt:v=>`Centre ${Math.round(v)}% off` },
    Duet:      { group:'space', conv:v=>v*100, txt:v=>`Width ${Math.round(v)}%` },
    Snap:      { group:'time',  conv:v=>v*1000, txt:v=>`Snap ${Math.round(v)} ms` },
    Pulse:     { group:'time',  conv:v=>v,      txt:v=>`Pulse ${Math.round(v)} ms` },
    Echo:      { group:'time',  conv:v=>v*1000, txt:v=>`Echo ${Math.round(v)} ms` },
    Shade:     { group:'level', conv:v=>v,                        txt:v=>`Shade ${v.toFixed(2)} dB` },
    Whisper:   { group:'level', conv:v=>20*Math.log10(.2/v),      txt:v=>`Detail ${Math.round(v)} dB under` },
    Silence:   { group:'level', conv:v=>20*Math.log10(v/.45),     txt:v=>`Hiss ${Math.round(v)} dB` },
    Grain:     { group:'texture', conv:v=>v*100, txt:v=>`Grain ${Math.round(v)}% partial` },
    Composure: { group:'texture', conv:v=>v,     txt:v=>`Drive ${v.toFixed(1)}` },
    Grip:      { group:'texture', conv:v=>v*100, txt:v=>`Bloom ${Math.round(v)}%` },
    Crowd:     { group:'texture', conv:v=>v,     txt:v=>`Crowd ${Math.round(v)} voices` },
  };
  const GROUP_COL = { space:COL.sage, time:COL.gold, level:COL.ember, texture:COL.iris };
  const GROUP_ORDER = ['space','time','level','texture'];

  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function render(el, data){
    const W=360, PAD=26;
    const rooms=data.rooms||{};
    const x = f => PAD + (Math.log10(Math.max(20,Math.min(20000,f))/20)/Math.log10(1000)) * (W-2*PAD);

    // ---- collect ----
    const found=rooms.Foundation, air=rooms.Air;
    const dip=rooms.Presence, spike=rooms.Silk;
    const rows=[];
    for(const g of GROUP_ORDER){
      for(const tag of Object.keys(SPEC)){
        const s=SPEC[tag];
        if(s.group!==g || !s.txt || !rooms[tag] || rooms[tag].val==null) continue;
        rows.push({ txt:s.txt(s.conv(rooms[tag].val)), col:GROUP_COL[g] });
      }
    }
    const nRows=rows.length, rowsPerCol=Math.ceil(nRows/2);
    const rowsH = nRows? rowsPerCol*19+16 : 0;
    const H = 172 + rowsH + 16;

    // ---- frequency block ----
    const TOP=44, LINE=86, BASE=126;
    let g='';
    // axis + ticks
    const ticks=[20,50,100,200,500,1000,2000,5000,10000,20000];
    const lbl={20:'20',100:'100',1000:'1k',10000:'10k',20000:'20k'};
    g+=`<line x1="${PAD}" y1="${BASE}" x2="${W-PAD}" y2="${BASE}" stroke="${COL.line}" stroke-width="1.5"/>`;
    for(const t of ticks){
      g+=`<line x1="${x(t)}" y1="${BASE}" x2="${x(t)}" y2="${BASE+4}" stroke="${COL.line}"/>`;
      if(lbl[t]) g+=`<text x="${x(t)}" y="${BASE+16}" fill="${COL.muted}" font-size="9" text-anchor="middle" font-family="${FONT}">${lbl[t]}</text>`;
    }
    g+=`<text x="${W-PAD}" y="${BASE+28}" fill="${COL.muted}" font-size="8" text-anchor="end" letter-spacing="2" font-family="${FONT}">FREQUENCY · Hz</text>`;

    // audible window
    const x1=found&&found.val?x(found.val):x(20), x2=air&&air.val?x(air.val):x(20000);
    if((found&&found.val)||(air&&air.val)){
      g+=`<rect x="${x1}" y="${TOP}" width="${Math.max(0,x2-x1)}" height="${BASE-TOP}" fill="${COL.sage}" opacity="0.07"/>`;
      g+=`<line x1="${x1}" y1="${LINE}" x2="${x2}" y2="${LINE}" stroke="${COL.sage}" stroke-width="1.5" opacity="0.85"/>`;
    }
    // confidence bands + edge markers
    const edge=(r,isLow)=>{
      if(!r||r.val==null) return '';
      let s='';
      if(r.lo!=null&&r.hi!=null&&r.hi>r.lo){
        s+=`<rect x="${x(r.lo)}" y="${LINE-9}" width="${Math.max(1,x(r.hi)-x(r.lo))}" height="18" rx="3" fill="${COL.ember}" opacity="0.18"/>`;
      }
      const X=x(r.val);
      s+=`<line x1="${X}" y1="${LINE-12}" x2="${X}" y2="${BASE}" stroke="${COL.ember}" stroke-width="2"/>`;
      const txt=isLow?`${Math.round(r.val)} Hz`:`${(r.val/1000).toFixed(1)} kHz`;
      const anchor=isLow?'end':'start', dx=isLow?-5:5;
      s+=`<text x="${X+dx}" y="${LINE-18}" fill="${COL.stone}" font-size="12" font-weight="600" text-anchor="${anchor}" font-family="${FONT}">${txt}</text>`;
      s+=`<text x="${X+dx}" y="${LINE-32}" fill="${COL.muted}" font-size="8" letter-spacing="1.5" text-anchor="${anchor}" font-family="${FONT}">${isLow?'YOUR FLOOR':'YOUR CEILING'}</text>`;
      return s;
    };
    g+=edge(found,true)+edge(air,false);

    // dip glyph (presence @1.8 kHz): depth = smallest audible scoop
    if(dip&&dip.val!=null){
      const X=x(1800), d=Math.min(26, SPEC.Presence.conv(dip.val)*2.0);
      g+=`<path d="M ${X-16} ${LINE} Q ${X} ${LINE+d*2} ${X+16} ${LINE}" fill="none" stroke="${COL.gold}" stroke-width="1.5"/>`;
      g+=`<text x="${X}" y="${LINE+d+22}" fill="${COL.gold}" font-size="8.5" text-anchor="middle" font-family="${FONT}">${esc(SPEC.Presence.label(SPEC.Presence.conv(dip.val)))}</text>`;
    }
    // spike glyph (sibilance @7 kHz): height = smallest audible spike
    if(spike&&spike.val!=null){
      const X=x(7000), h=Math.min(24, SPEC.Silk.conv(spike.val)*1.8);
      g+=`<path d="M ${X-9} ${LINE} L ${X} ${LINE-h*1.6} L ${X+9} ${LINE}" fill="none" stroke="${COL.iris}" stroke-width="1.5"/>`;
      // label sits left of the glyph so it can't collide with the ceiling marker
      g+=`<text x="${X-13}" y="${LINE-10}" fill="${COL.iris}" font-size="8.5" text-anchor="end" font-family="${FONT}">${esc(SPEC.Silk.label(SPEC.Silk.conv(spike.val)))}</text>`;
    }

    // ---- reading rows ----
    let rowsSvg='';
    if(nRows){
      const y0=172;
      rowsSvg+=`<line x1="${PAD}" y1="${y0-10}" x2="${W-PAD}" y2="${y0-10}" stroke="${COL.line}" opacity="0.6"/>`;
      rows.forEach((r,i)=>{
        const col=i<rowsPerCol?0:1;
        const rx=PAD+col*((W-2*PAD)/2+8), ry=y0+ (i%rowsPerCol)*19 + 8;
        rowsSvg+=`<circle cx="${rx+3}" cy="${ry-3.5}" r="3" fill="${r.col}"/>`;
        rowsSvg+=`<text x="${rx+12}" y="${ry}" fill="${COL.stone}" font-size="11.5" font-family="${FONT}">${esc(r.txt)}</text>`;
      });
    }

    // ---- header / footer / watermark ----
    const dev=esc(data.device||'');
    const dateStr=data.date?esc(data.date):'';
    let head=`<text x="${PAD}" y="22" fill="${COL.muted}" font-size="9" letter-spacing="2.5" font-family="${FONT}">STONE ROOM · LISTENING FINGERPRINT</text>`;
    head+=`<text x="${PAD}" y="36" fill="${COL.gold}" font-size="13" font-weight="600" font-family="${FONT}">${dev}</text>`;
    if(dateStr) head+=`<text x="${W-PAD}" y="22" fill="${COL.muted}" font-size="9" text-anchor="end" font-family="${FONT}">${dateStr}</text>`;
    let mark='';
    if(data.sample) mark=`<text x="${W/2}" y="${H/2+10}" fill="${COL.stone}" opacity="0.10" font-size="46" font-weight="600" letter-spacing="10" text-anchor="middle" transform="rotate(-14 ${W/2} ${H/2})" font-family="${FONT}">SAMPLE</text>`;

    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="${COL.bg}" stroke="${COL.line}"/>
${head}${g}${rowsSvg}${mark}
</svg>`;
    el.innerHTML=svg;
    return el.firstChild;
  }

  // rasterize the card to a PNG blob (2x) for sharing/saving
  function toPNG(svgEl, scale){
    return new Promise((resolve,reject)=>{
      const s=scale||3;
      const xml=new XMLSerializer().serializeToString(svgEl);
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

  // plausible sample for the landing demo — clearly watermarked, never presented as real
  const SAMPLE={
    device:'Sample pair',
    sample:true,
    rooms:{
      Foundation:{val:31,lo:27,hi:36}, Air:{val:13600,lo:12400,hi:14900},
      Presence:{val:3.2}, Silk:{val:.049},
      Stage:{val:11}, Orbit:{val:26}, Depth:{val:16},
      Snap:{val:.009}, Pulse:{val:13},
      Shade:{val:.9}, Whisper:{val:.018}, Silence:{val:.014},
      Grain:{val:.06}, Crowd:{val:5}
    }
  };

  window.SR_FP={ render, toPNG, SAMPLE };
})();
