/* Stone Room — content. Room copy, science, benchmarks, real-model references,
   feedback pools and intro text. All numbers web-verified (2026). Applies to ANY
   headphones and ANY listener — no model-specific tailoring. Pure data; behaviour
   (audio + staircase params) lives in app.js. */
(function () {
  "use strict";

  const GROUPS = {
    holo: { name: 'The Out-of-Head Illusion', sub: 'space & imaging' },
    res:  { name: 'Hearing Everything', sub: 'resolution' },
    tone: { name: 'Truth of Tone', sub: 'frequency & timbre' },
    dyn:  { name: 'Speed & Dynamics', sub: 'time & level' },
  };

  const INTRO = {
    hook: "Measure your hearing. Train your ears. Know your headphones.",
    line: "Twenty-six rooms, including a per-ear hearing curve and a speech-in-noise test. Run them one at a time — each measures one claim the reviews make — as your ears actually hear it through your pair — and saves the shape so you can compare.",
    what: "Each room plays a sound and asks one simple question. Answer, and it hunts your exact limit — telling you, in real numbers, where your headphones and your hearing actually land. You learn what the words mean by hearing them.",
    gap: "Other free tools do half the job: they train your ears with no number attached, or they publish lab readings of a unit that isn't on your head. This one measures what YOU hear through YOUR pair — ears and headphones as one chain — and saves it, so you can compare pairs and watch your own hearing over time.",
    tips: "Best in a quiet room, at a moderate volume, with any phone spatializer, Dolby Atmos and EQ switched off.",
    promise: "Free. Nothing leaves your phone."
  };

  // Per-room content keyed by tag. hit/miss = per-trial micro-feedback pools;
  // tiers = end-of-room verdicts by score band; science/benchmark/models feed the info sheet.
  const C = {
    Stage: {
      benchmark: "Straight ahead, you can separate two sources barely 1° apart — a fingertip held at arm's length.",
      science: "A wide stage needs each driver to launch a clean wavefront and the pair to stay closely matched. Open-back designs vent rear pressure so the diaphragm swings freely and the arc opens; sealed cups and uneven damping pull the edges inward.",
      models: "The Sennheiser HD 800 S, HiFiMan Arya, and Beyerdynamic DT 1990 Pro are loved for a broad, airy stage.",
      hit: ["Dead on.", "Pinned it.", "Right on the singer."],
      miss: ["Widening the arc.", "A bigger target.", "Easing it open."],
      tiers: { reference: "Reference width — the arc opens wall to wall, every point yours.", strong: "Strong staging; you point true across the whole arc.", fair: "A usable stage, though the far edges blur together.", weak: "The arc collapses toward centre; width is a guess." }
    },
    Motion: {
      benchmark: "A slowly gliding sound can be pinned within about 2°; speed it up and that blurs past 10°.",
      science: "Tracking a mover means resolving its shifting timing and level cues moment to moment. Fast, well-damped drivers settle quickly and keep the trail sharp; slow or resonant ones ring on, so the stopping point drifts.",
      models: "The HD 800 S and Focal Utopia hold a moving image cleanly from edge to edge.",
      hit: ["Nailed the stop.", "You tracked it.", "Right where it landed."],
      miss: ["Slowing the glide.", "A shorter path.", "Easing the motion."],
      tiers: { reference: "Reference tracking — you mark the stop to the degree.", strong: "Strong; the mover's path stays sharp end to end.", fair: "You catch direction, but the exact stop slips.", weak: "The trail smears; the landing is a guess." }
    },
    Centre: {
      benchmark: "A centre image only forms when left and right match within about 1 dB; a hair more and the voice drifts.",
      science: "Dead centre is a phantom — it exists only when both drivers deliver equal level and timing. Tight channel matching holds it still; a small sensitivity imbalance or a leaky pad seal slides it off to one side.",
      models: "The Sennheiser HD 600, HD 650, and Focal Clear pair drivers tightly for a rock-steady centre.",
      hit: ["Locked centre.", "Dead middle.", "You held it."],
      miss: ["Nudging it wider.", "A clearer offset.", "Easing the gap."],
      tiers: { reference: "Reference centre — the voice sits nailed to the middle.", strong: "Strong; centre holds, drift only at the margins.", fair: "Centre wanders a little; you catch the big shifts.", weak: "The middle won't sit still for you." }
    },
    Orbit: {
      benchmark: "Behind you, localization blurs to 5–6° — several times coarser than in front — and front/back flips are common.",
      science: "Up-down and front-back cues live in how your outer ear filters sound, cues headphones bypass by firing straight at the canal. Angled baffles and open backs push the image slightly out and forward; without your own HRTF, true 360 stays imperfect.",
      models: "Angled-driver open-backs like the HD 800 S and AKG K1000 externalise better than most.",
      hit: ["All the way round.", "You caught it.", "Behind you — got it."],
      miss: ["Bringing it front.", "A wider gap.", "Easing the circle."],
      tiers: { reference: "Reference — the sound truly circles, front and back.", strong: "Strong; only the rear quadrant slips now and then.", fair: "Sides read clean; front and back confuse you.", weak: "It all collapses inside your head." }
    },
    Depth: {
      benchmark: "Near versus far is read from cues that move together: closer arrives louder and drier, farther comes softer with more of the room riding along.",
      science: "Layering depends on resolving how much dry sound arrives against its reflected tail. Low distortion and quick decay keep the near and far strata distinct; a smeary, resonant driver folds the back row into the front.",
      models: "The HD 800 S and HiFiMan Susvara render clear front-to-back layers.",
      hit: ["Right row.", "You read the depth.", "Front and back — got it."],
      miss: ["Spreading the rows.", "A clearer gap.", "Pulling them apart."],
      tiers: { reference: "Reference depth — every row sits at its own distance.", strong: "Strong; near and far separate cleanly.", fair: "You get near from far, but middle rows merge.", weak: "The rows flatten into one plane." }
    },
    Flyby: {
      benchmark: "Inside about 1 m the level gap between your ears grows fast — a strong closeness cue speakers can't give.",
      science: "Closeness rides on how sharply the level swells and falls as something crosses — the pitch bend sells the motion, the swell carries the distance. Clean, matched drivers preserve that shape; distortion or channel imbalance flattens the pass into a vague blur.",
      models: "The Focal Utopia and HD 800 S render a convincing near pass.",
      hit: ["Closest one — got it.", "You felt it pass.", "Right up close."],
      miss: ["Widening the gap.", "A clearer pass.", "Easing them apart."],
      tiers: { reference: "Reference — you feel exactly how near it swept.", strong: "Strong; the closer pass is obvious.", fair: "You sense closeness, but near ties fool you.", weak: "Both passes feel the same distance." }
    },
    Echo: {
      benchmark: "A wall a metre farther away delays its echo by about 6 ms, there and back — and trained listeners resolve gap changes of a few milliseconds.",
      science: "Here the click and its echo arrive clearly apart, and what's measured is how finely you resolve a CHANGE in that gap — the difference between a nearer and a farther wall. Revealing drivers keep the two clicks' edges distinct; smeared transients blur the gap and the walls with it.",
      models: "Open-backs like the HD 800 S and Beyerdynamic DT 1990 Pro expose reflections clearly.",
      hit: ["Farther wall — got it.", "You heard the gap.", "Right room."],
      miss: ["Stretching the gap.", "A clearer echo.", "Easing them apart."],
      tiers: { reference: "Reference — you read the wall from the gap alone.", strong: "Strong; you separate close reflections cleanly.", fair: "Big gaps are clear; short ones fuse on you.", weak: "Source and echo blur into one." }
    },
    Duet: {
      benchmark: "Headphones give near-total left/right isolation, so width rides on how much the two channels differ — here, deliberate level and detune differences between your ears.",
      science: "Perceived width tracks interaural correlation: identical channels sound narrow and central, decorrelated ones spread wide and enveloping. With no acoustic crosstalk between cups, a headphone lays that decorrelation bare — matched, low-distortion drivers keep the spread honest.",
      models: "The HD 800 S and HiFiMan Arya throw an unusually wide, enveloping image.",
      hit: ["Wider one — got it.", "You felt the spread.", "Wall to wall."],
      miss: ["Widening the gap.", "A clearer spread.", "Easing them apart."],
      tiers: { reference: "Reference — you read width down to the finest spread.", strong: "Strong; the wider chord is clear.", fair: "Big width gaps land; subtle ones slip.", weak: "Both chords feel the same size." }
    },
    Separation: {
      benchmark: "Among competing voices, people reliably pick out only about 3–5 at once; timbre and space pull one clear.",
      science: "Finding one line is stream segregation, and it fails under informational masking when voices share pitch or space. Fast, low-distortion drivers preserve the fine timing and timbre that keep strands apart; a congested, resonant one lets them mask each other.",
      models: "The Focal Utopia and HiFiMan Susvara pick voices apart with ease.",
      hit: ["Found your voice.", "You held the thread.", "Picked it clean."],
      miss: ["Thinning the mix.", "A clearer target.", "Easing the others back."],
      tiers: { reference: "Reference — you lift any line clean from the mix.", strong: "Strong; the target voice stays yours throughout.", fair: "You find it, but lose it in dense passages.", weak: "The voices blur into one another." }
    },
    Crowd: {
      benchmark: "Past roughly 3–4 simultaneous voices, listeners stop counting reliably and start estimating.",
      science: "Counting depends on holding each source as its own object without them fusing. Quick, uncongested drivers keep every voice distinct up to the crowd's limit; a slow or distorting one blends neighbours, and your count falls short.",
      models: "Fast planars like the HiFiMan Susvara and Audeze LCD-X stay uncongested when packed.",
      hit: ["Right count.", "You caught them all.", "Every voice."],
      miss: ["Thinning the crowd.", "Fewer to count.", "Easing it out."],
      tiers: { reference: "Reference — you count the full ensemble, however packed.", strong: "Strong; you hold the count until it's truly dense.", fair: "Small groups are exact; big ones you estimate.", weak: "The crowd fuses; counting turns to guessing." }
    },
    Whisper: {
      benchmark: "A sound about 20–30 dB below a masker near its pitch vanishes; nudge it away in time or frequency and it returns.",
      science: "Detail retrieval is a fight against masking — a loud pad raises the threshold for anything close to it. Low-distortion drivers with quick settling let buried transients poke through; a resonant one adds its own haze and swallows them.",
      models: "The HiFiMan Susvara, Focal Utopia, and HD 800 S are famed detail-diggers.",
      hit: ["Caught the tick.", "You heard it.", "Under the music — got it."],
      miss: ["Lifting the detail.", "A louder tick.", "Thinning the pad."],
      tiers: { reference: "Reference retrieval — nothing hides under the music from you.", strong: "Strong; you surface faint detail with ease.", fair: "Clear ticks land; the faintest slip past.", weak: "The quiet details stay buried." }
    },
    Silence: {
      benchmark: "What's measured is relative: how far below the music a hiss must fall before it vanishes for you — on this chain, at your volume. Uncalibrated, absolute silence can't be claimed; the depth of your floor can.",
      science: "A black background means the driver and its source add no audible noise of their own. Sensitive headphones expose faint amp or source hiss; low-noise electronics and, in sealed designs, good isolation keep the silence truly silent.",
      models: "Well-isolating closed-backs like the Dan Clark Stealth and Sony MDR-Z1R rest on a quiet floor.",
      hit: ["Spotted the hiss.", "You heard through it.", "Right silence."],
      miss: ["Raising the hiss.", "A louder floor.", "Easing it up."],
      tiers: { reference: "Reference silence — you catch a hiss at the threshold.", strong: "Strong; faint noise floors don't fool you.", fair: "Obvious hiss is clear; the faintest hides.", weak: "The two silences sound the same." }
    },
    Grain: {
      benchmark: "A single partial mistuned by only a few percent pops out as a separate tone — here it sits far off, near 2.8× the fundamental.",
      science: "Timbre resolution is your ear hearing out a partial that doesn't belong. Low-distortion drivers add no stray overtones of their own, so an impostor stands clear; a driver that already generates harmonics masks or mimics it.",
      models: "Beryllium and electrostatic designs — the Focal Utopia and Stax SR-009 — render timbre with rare purity.",
      hit: ["Spotted the impostor.", "You heard it out.", "Wrong note — got it."],
      miss: ["Louder overtone.", "A clearer stray.", "Easing it out."],
      tiers: { reference: "Reference — the false overtone can't hide from you.", strong: "Strong; you hear out the odd partial cleanly.", fair: "Gross strays land; subtle ones slip past.", weak: "The impostor blends into the note." }
    },
    Halls: {
      benchmark: "You can hear about a 5% difference in reverberation time — a bigger room simply rings on longer.",
      science: "Room size lives in the decay tail, and resolving it needs a driver that stops cleanly when the note does. Quick, well-damped diaphragms let the true tail ring out; a resonant one adds its own decay and inflates every room.",
      models: "The HD 800 S and HiFiMan Susvara resolve decay tails with clarity.",
      hit: ["Bigger room — got it.", "You heard the tail.", "Right hall."],
      miss: ["Stretching the tail.", "A clearer decay.", "Easing them apart."],
      tiers: { reference: "Reference — you size the room from its tail alone.", strong: "Strong; you read decay differences cleanly.", fair: "Big rooms are clear; close ones merge.", weak: "The tails blur; both halls feel alike." }
    },
    Composure: {
      benchmark: "Most listeners can't hear harmonic distortion until it passes ~1%, though harsh high-order components show near 0.1%.",
      science: "Distortion rises as the diaphragm strains at high level, most in the bass where excursion is largest. Planar and beryllium drivers move with low distortion and stay clean when pushed; smaller or under-damped ones soft-clip and add a harsh edge.",
      models: "Planars like the HiFiMan Susvara and Audeze LCD-X, and Focal's beryllium drivers, stay composed loud.",
      hit: ["Clean one — got it.", "You heard it hold.", "Stayed pure."],
      miss: ["Adding some grit.", "A clearer break.", "Pushing it harder."],
      tiers: { reference: "Reference composure — it never breaks a sweat for you.", strong: "Strong; you catch distortion as it creeps in.", fair: "Obvious clipping lands; subtle grain slips.", weak: "Clean and strained sound the same to you." }
    },
    Foundation: {
      benchmark: "A bass guitar's lowest string sits at about 41 Hz; below ~30 Hz you feel it more than hear it.",
      science: "Reaching flat into the sub-bass takes a driver that can move air at long wavelengths without the earcup or seal letting it leak away. Small or poorly sealed drivers roll off early, so you get a low note's overtones but not its true floor. A firm seal and a driver tuned for extension keep the fundamental intact.",
      models: "Planar sets like the Audeze LCD-X and HiFiMan Arya, and the Focal Utopia, are prized for extension that stays flat to the bottom.",
      hit: ["You felt the floor.", "Deep and clean.", "That's the real bottom."],
      miss: ["Nudged it up a touch.", "Brought the floor closer.", "A bit easier there."],
      tiers: { reference: "Full extension — the lowest notes arrive whole, not merely hinted at.", strong: "Reaches deep; only the very bottom softens.", fair: "Solid to the mid-bass, then it thins out.", weak: "The floor drops away early — you hear overtones, not roots." }
    },
    Grip: {
      benchmark: "One cycle of a 55 Hz bass note lasts 18 ms; a controlled driver settles in a few, so the note ends before the next begins.",
      science: "Grip is how fast the diaphragm stops after it's pushed. Lighter, well-damped drivers — planars, or dynamics with strong motor control — follow the signal and halt on command; heavier cones and resonant enclosures keep ringing, adding bloom the recording never had. A leaky seal drains bass level and softens the punch.",
      models: "Focal's Clear and Utopia and most HiFiMan planars are known for bass that punches, then gets out of the way.",
      hit: ["Tight and clean.", "No wobble there.", "It stopped on time."],
      miss: ["Loosened it slightly.", "More bloom to spot.", "Easier to hear now."],
      tiers: { reference: "Bass starts and stops with the note — no overhang, no blur.", strong: "Mostly taut; a little bloom on the lowest notes.", fair: "Punchy, but the edges round off.", weak: "Bass smears into the next beat — more wobble than grip." }
    },
    Presence: {
      benchmark: "The midrange, roughly 250 Hz–4 kHz, carries voices; a dip at 1–3 kHz pushes singers behind glass.",
      science: "The 1–3 kHz region is where a voice's body and intelligibility live. A headphone's tuning target decides how much of it survives; scoop it to flatter the bass and treble and vocals recede, veiled and distant. Fill it honestly and the singer steps into the room.",
      models: "The Sennheiser HD 600 and HD 650 are longtime references for midrange truth, with the Focal Clear close behind.",
      hit: ["She stepped forward.", "Right in the room.", "Voice, uncovered."],
      miss: ["Brought the voice closer.", "Lifted the veil a little.", "Made it plainer."],
      tiers: { reference: "Voices sit front and center — honest, present, unforced.", strong: "Present and natural; a hint of distance up top.", fair: "Clear enough, but set a step back.", weak: "Vocals behind glass — veiled and hard to reach." }
    },
    Air: {
      benchmark: "Young ears reach near 20 kHz, but by middle age most top out around 15–16 kHz — the top octave is ‘air’.",
      science: "Air is the last octave above ~8 kHz: cymbal shimmer, the breath around a voice, the sense of a room. Small resonances and pad damping decide how far a driver extends and how cleanly; some roll it off for smoothness, others push it out to open the stage. Your own hearing sets a ceiling no headphone can raise.",
      models: "The Sennheiser HD 800S, Beyerdynamic DT 1990 Pro, and HiFiMan Arya are celebrated for open, extended air up top.",
      hit: ["You caught the shimmer.", "Air, opened up.", "Heard the room."],
      miss: ["Added a little sparkle.", "Made the top clearer.", "Easier to catch."],
      tiers: { reference: "The top octave opens wide — shimmer and air, effortless.", strong: "Extended and clean; just shy of the very top.", fair: "Enough sparkle, but the ceiling comes early.", weak: "Closed in up top — cymbals dull, no air." }
    },
    Silk: {
      benchmark: "Sibilance is an energy spike near 5–8 kHz that turns an 's' into a stab.",
      science: "The 'ess' and 'ch' sounds pile energy between about 5 and 8 kHz, higher for female voices. A peak in a headphone's tuning there exaggerates them into harshness; a smooth, well-damped response lets consonants stay crisp without cutting. Pad wear and seal shift this band, so the same pair can sting or soothe depending on fit.",
      models: "The Sennheiser HD 650 and Audeze LCD-2 are loved for treble that stays smooth and never spits.",
      hit: ["Smooth, no sting.", "Crisp, not sharp.", "No stab there."],
      miss: ["Sharpened it a touch.", "Made the 's' bite more.", "Easier to flag now."],
      tiers: { reference: "Consonants stay crisp and clean — never a stab.", strong: "Smooth overall; the odd 's' edges up.", fair: "Mostly fine, but sibilance pokes through.", weak: "Every 's' stings — harsh and fatiguing." }
    },
    Snap: {
      benchmark: "A drum's leading edge rises in well under a millisecond — and an attack smeared by even a few milliseconds reads as soft instead of sharp.",
      science: "Snap is how faithfully a driver renders the instant a note begins — the leading edge before the tone settles. Lower moving mass, as in planars and electrostatics, starts and stops faster, so attacks land sharp and hard; heavier diaphragms soften the strike. Tight motor control turns voltage into motion without lag or overshoot.",
      models: "The Focal Utopia and the Audeze LCD line are known for the fast, physical slam of a hard transient.",
      hit: ["That one hit.", "Sharp and hard.", "Clean strike."],
      miss: ["Gave it more punch.", "Made the hit harder.", "Easier to feel."],
      tiers: { reference: "Every strike lands sharp and physical — real slam.", strong: "Quick and solid; softens on the hardest hits.", fair: "Decent punch, but edges round off.", weak: "Attacks arrive dull — no snap, no slam." }
    },
    Pulse: {
      benchmark: "Listeners feel timing shifts of only a few milliseconds; groove studies show deviations under ~20 ms change how a beat sits.",
      science: "Pulse — pace, rhythm and timing — is whether notes land where the groove wants them. A driver that controls attack and decay keeps each hit's edges sharp, so the ear locks onto the beat; smear the starts and stops and the rhythm loosens. It's less about tone than about how cleanly events begin and end.",
      models: "Grado headphones and Focal's dynamic drivers are often praised for a lively, driving sense of rhythm.",
      hit: ["Locked to the beat.", "Right in the pocket.", "You felt the groove."],
      miss: ["Widened the gap.", "Made it easier to feel.", "Nudged it clearer."],
      tiers: { reference: "The groove locks — every hit exactly in the pocket.", strong: "Tight timing; loosens only on busy passages.", fair: "Keeps the beat, but the pocket softens.", weak: "Timing smears — the groove slips its grip." }
    },
    Shade: {
      benchmark: "Trained ears resolve about a 1 dB change in level — and near 0.25 dB in the midrange at higher volume.",
      science: "Shade is the small swells and dips — 1 or 2 dB — that give a phrase its breathing life. Honestly framed: this room mostly measures YOUR smallest reliable level step through this chain; differences between competent headphones here are subtle, so the reading is about your resolution more than the driver. Clean amplification with headroom keeps the quietest shadings from vanishing.",
      models: "Stax electrostatics, the Focal Utopia, and the Sennheiser HD 800S are prized for reading the faintest level shadings.",
      hit: ["You caught the swell.", "Heard the shading.", "Louder — and you knew."],
      miss: ["Widened the gap.", "Made the step bigger.", "Easier to hear."],
      tiers: { reference: "The faintest 1 dB swell reads clearly — fully alive.", strong: "Reads most shadings; the subtlest slip past.", fair: "Big moves land, small ones blur.", weak: "Loud and soft flatten together — no shading." }
    },
    Digits: {
      benchmark: "Published digits-in-noise tests place typical hearing near −8 to −10 dB SNR. This room's voice is synthetic, so hold the absolute number gently — and your own comparisons (pair vs pair, month vs month) firmly.",
      science: "The speech and the noise ride the same chain at the same instant, so the measured threshold is a ratio — turn the volume up and both move together. That's why digits-in-noise screens work on ordinary uncalibrated headphones, and why this is the sturdiest number in the app. The babble here is built from the same voice as the digits, so signal and masker share one spectrum.",
      models: "Less about the driver than almost any room: your own speech-in-noise ability and your room dominate. Struggling here while the tones test reads fine is itself worth knowing.",
      hit: ["All three, out of the noise.", "You held the voice.", "Caught them clean."],
      miss: ["Lifting the voice a little.", "A touch clearer next.", "The noise wins that one."],
      tiers: { reference: "Exceptional — you follow speech deep into noise that swallows it for most people.", strong: "Strong — busy rooms cost you less than most.", fair: "Fair — you need the voice to stand a bit proud of the noise.", weak: "Noise takes the voice from you early — if conversation in crowds is hard, that's the real-world echo of this number." }
    },
    Noise: {
      benchmark: "Struggling to follow a voice in a busy room is the complaint that sends most people to an audiologist — and hearing a signal buried in noise is the ability behind it.",
      science: "Your inner ear behaves like a bank of narrow filters. A tone becomes audible when it stands far enough above the noise inside its own filter — so what's measured is a ratio, not a loudness. That's why this room is the sturdiest one here: the tone and the noise ride the same chain at the same instant, so turning the volume up moves both together and the answer stays put. Screening tests built on this principle work on ordinary consumer headphones without calibration.",
      models: "Less about the driver than most rooms: background noise in your room, a poor seal, or your own hearing move this number far more than the headphone does.",
      hit: ["Found it in there.", "You heard through the noise.", "Caught it buried."],
      miss: ["Lifting it out a little.", "A clearer tone next.", "Making it stand prouder."],
      tiers: { reference: "Exceptional — you pull a tone out of noise that hides it from most people.", strong: "Strong — you follow a signal well into the noise.", fair: "Fair — the tone needs to stand clear of the noise before you catch it.", weak: "The noise has to drop away before the tone appears — worth retrying somewhere quiet." }
    },
    Hearing: {
      benchmark: "Young ears span ~20 Hz–20 kHz; the top end falls with age, and every headphone rolls off somewhere of its own.",
      science: "A browser has no absolute SPL reference, so the loudness isn't calibrated — but the SHAPE is real: the combined response of these headphones and your own ears, the same idea behind Samsung's Adapt Sound. Dips are bands this chain renders quieter; the high end also shows your own hearing's ceiling.",
      models: "Any pair — the curve is specific to this headphone on your ears, not a lab reading of the model."
    }
  };

  // ---- review-decoder: what the review vocabulary is worth, given YOUR measured numbers ----
  // one line per term, always anchored to this listener on this pair; honest about the chain.
  const kHz = v=>(v/1000).toFixed(1)+' kHz';
  const DECODER = [
    { term:'"air" · treble extension', tag:'Air', line:(v,p)=> v==null ? null
      : v>=16000 ? `Your window on this pair reaches ${kHz(v)} — "air" praised above 15 kHz is genuinely audible to you. Worth paying for.`
      : v>=13500 ? `Your ceiling here is ${kHz(v)}. "Air" celebrated above 15 kHz sits mostly past your window — read those reviews calmly.`
      : `This chain fades out near ${kHz(v)} for you. Treble-extension poetry above that line describes a view you won't see.` },
    { term:'sub-bass "extension" · reach', tag:'Foundation', line:(v,p)=> v==null ? null
      : v<=32 ? `Your floor reaches ${Math.round(v)} Hz — "sub-bass extension" claims are worth real attention (and money) to you.`
      : v<=48 ? `You hear down to ~${Math.round(v)} Hz on this chain. Below that, deep-bass talk will land as pressure, not pitch.`
      : `This chain lets go near ${Math.round(v)} Hz. Most "seismic sub-bass" copy describes a floor you won't visit on this pair.` },
    { term:'"sibilance" · hot treble', tag:'Silk', line:(v,p)=>
      p>=70 ? `You catch a sibilant edge early — "hot treble" warnings in reviews are load-bearing for you. Smooth-treble pairs will repay you.`
      : p>=40 ? `You notice sibilance at moderate levels. Treble-smoothness claims matter to you, with some headroom.`
      : `Sibilance barely registers for you — "harsh S" complaints are largely other people's problem.` },
    { term:'"detail retrieval"', tag:'Whisper', line:(v,p)=>
      p>=70 ? `You surface buried detail with ease — "detail retrieval" praise will be audible to you, not imagined.`
      : p>=40 ? `You hear buried detail when it's not too deep. Detail claims are half-real for you — training moves this one.`
      : `Fine detail stays buried for you right now. "Endless micro-detail" reviews promise more than this chain + your ears deliver today.` },
    { term:'"black background"', tag:'Silence', line:(v,p)=>
      p>=70 ? `You resolve near-silence well — a truly quiet pair will read blacker to you than to most.`
      : `The last few dB of silence blur for you — "blackest background ever" claims will mostly read as identical.` },
    { term:'"imaging" · centre focus', tag:'Centre', line:(v,p)=>
      p>=70 ? `You lock a centre image tightly — channel matching is a spec that actually pays you. Hand-matched pairs earn their premium.`
      : `Small centre drift slips past you — perfect channel matching is a premium you may not need to pay.` },
    { term:'"soundstage" width', tag:'Stage', line:(v,p)=> v==null ? null
      : v<=12 ? `You place sounds within ±${Math.round(v)}° — soundstage descriptions are a real, resolvable dimension for you.`
      : `You place sounds within about ±${Math.round(v)}° — grand soundstage prose will read wider in the review than on your head.` },
    { term:'"tight" vs "boomy" bass', tag:'Grip', line:(v,p)=>
      p>=70 ? `You hear bass overhang early — "tight, controlled bass" is a difference you'll genuinely notice between pairs.`
      : `Bass bloom has to get big before you notice — "boomy" complaints in reviews may not bother you in practice.` },
    { term:'"micro-dynamics"', tag:'Shade', line:(v,p)=> v==null||!isFinite(v) ? null
      : v<=0.5 ? `You resolve level steps of ~${v.toFixed(1)} dB — micro-dynamic shading is real listening currency for you.`
      : `You resolve ~${v.toFixed(1)} dB steps — micro-dynamics talk finer than that is below your floor.` },
    { term:'"intelligibility" · voices in a crowd', tag:'Digits', line:(v,p)=> v==null ? null
      : v<=-9 ? `You follow speech down to ${Math.round(v)} dB SNR — crowded-room conversation is an ability you can bank on, and "vocal clarity" claims are testable by you.`
      : v<=-4 ? `Your speech-in-noise floor is ~${Math.round(v)} dB SNR. Pairs praised for "clear, forward vocals" will earn their keep in busy places.`
      : `Speech needs to stand ${v>0?'above':'near'} the noise for you (${Math.round(v)} dB SNR). If crowds are hard work, that's this number in daily life — worth a quiet-room retest, and worth knowing.` },
    { term:'"clarity" · hearing into a mix', tag:'Noise', line:(v,p)=>
      p>=70 ? `You pull a signal well out of the noise around it — the ability reviewers gesture at with "clarity" is genuinely strong in you.`
      : p>=40 ? `You need a signal to stand moderately clear of surrounding noise. Quiet rooms will flatter your listening more than new gear will.`
      : `Noise buries things quickly for you today — worth re-running somewhere quiet before reading anything into it.` },
    { term:'"congestion" · busy mixes', tag:'Crowd', line:(v,p)=>
      p>=70 ? `You keep voices apart in a crowd — congestion in a busy mix is something you'll actually hear a good pair fix.`
      : `Busy passages blur early for you — "never congested" claims will be hard to verify with your own ears.` },
    { term:'"decay" · room feel', tag:'Halls', line:(v,p)=>
      p>=70 ? `You size a space by its reverb tail — "you can hear the hall" reviews are literal for you.`
      : `Reverb tails read similar to you — room-size poetry is atmosphere, not information, on this chain.` },
    { term:'"slam" · attack', tag:'Snap', line:(v,p)=>
      p>=70 ? `You feel a softened attack immediately — "slam" and "speed" differences between pairs are real for you.`
      : `Attack edges have to soften a lot before you notice — "lightning transients" claims will mostly read alike.` },
  ];

  // ---- methods page: how it measures, what it refuses to claim, and the published work behind both.
  // Every number quoted here is from the cited study, describing THAT study — not a claim about
  // Stone Room's own accuracy, which has never been validated against a clinical audiometer.
  const METHODS = [
    { h:'What is actually being measured',
      p:['In most rooms, a threshold: the smallest difference, or the quietest sound, you can reliably detect. In the pointing rooms it is an angle — how far off your taps land; in Crowd, how many voices you can still hold apart. Whichever it is, the reading is of this recording, this phone, this connection, these headphones, these ears. That whole line is the instrument. No part of it is isolated, and the reading belongs to all of it at once.',
         'This is the opposite of a lab measurement, which isolates the headphone on a coupler and tells you nothing about the listener. Neither one substitutes for the other.'] },
    { h:'How a threshold is found',
      p:['Most rooms — the A/B comparison rooms, plus the hearing curve — run a Bayesian adaptive procedure. It holds a probability distribution over three things at once: your threshold, the steepness of your psychometric function, and your lapse rate (the chance you blink, sneeze or mis-tap on a trial you should have got). Each new trial is placed where it expects to learn the most, by minimising the expected entropy of the threshold distribution.',
         'Modelling lapses matters: without that third dimension a single careless answer drags a threshold estimate badly. With it, one slip costs very little.',
         'The general framework is QUEST+ (Watson, 2017, Journal of Vision), which unified this family; the marginalising variant used here follows Prins (2013) and the original psi method of Kontsevich & Tyler (1999).',
         'Six rooms are <b>not</b> threshold estimates and are scored differently: the five pointing rooms (Stage, Motion, Orbit, Depth, Separation) walk a fixed difficulty ladder and score the median angular error of your taps, stopping once those taps are consistent enough; Crowd scores the largest ensemble you counted correctly twice.'] },
    { h:'The hearing curve',
      p:['Per-ear, single-interval yes/no detection with pulsed tones — three short bursts rather than one steady tone, because a steady tone is easily confused with tinnitus, which tends to sit exactly where hearing is weakest.',
         'About one trial in five is silent. Those catch trials never touch the estimate; they measure how often you answer "I hear it" when nothing played, and a high false-alarm count suppresses the left/right warning rather than letting it fire on noise — on the results screen and everywhere that reading is shown afterwards.',
         'In per-ear mode a band of noise plays in the resting ear. With headphones, a loud tone crosses the skull to the other cochlea attenuated by roughly 40–50 dB, so without that masking noise a good ear quietly answers for a weak one and a real asymmetry reads far smaller than it is.',
         'Points are drawn through a Gaussian process over log-frequency, so wide-uncertainty points are pulled toward their neighbours and the shaded band widens where the data are thin. Continuous-frequency machine-learning audiometry (Song and colleagues; Cox & de Vries) is the published line this follows.'] },
    { h:'What stops you gaming it',
      p:['In the comparison rooms the overall level is randomised on every trial, and in many of them the base pitch as well, so no token can be memorised — only the difference under test carries information.',
         'The hearing curve is the deliberate exception: it holds a fixed reference level, because there the level <b>is</b> the measurement. The silent catch trials above do the anti-gaming work instead.',
         'Where a difference could be heard as "just louder", the alternatives are power-matched, so loudness cannot stand in for the quality being tested.',
         'Tones are switched on and off with raised-cosine ramps, so nobody can detect the click instead of the tone.'] },
    { h:'What this can NOT tell you',
      p:['<b>Not decibels of hearing loss.</b> A browser has no absolute sound-pressure reference: the app knows the digital level it requested, never the pressure that arrived at your eardrum. Uncalibrated remote testing has been reported to sit tens of decibels away from booth audiometry in absolute terms — one study of an uncalibrated remote setup reported about 27 dB of bias. Absolute numbers here are not audiometric values and must never be read as dB HL.',
         '<b>Not a diagnosis, and not a clinical instrument.</b> Stone Room has not been validated against a clinical audiometer. It is a screening-grade listening tool. Anything that worries you belongs with an audiologist.',
         '<b>Not a headphone spec.</b> Two people measuring the same headphones will get different numbers, because their ears are in the circuit. To compare gear, hold the listener constant: same person, same session, two pairs.',
         '<b>Not population-normed.</b> Proper norming needs a large validated reference dataset, which this app does not have. Priors are seeded from your own neighbouring frequencies instead — within-subject, never borrowed from a population we have not measured.'] },
    { h:'What it CAN stand behind',
      p:['<b>Shape.</b> The relative form of your curve — which bands need more level than your own 1 kHz — survives the missing calibration, because every point shares the same uncalibrated chain.',
         '<b>Differences.</b> Left versus right cancels the unknowns outright — same chain, same instant, so whatever the volume was, it was the same volume for both ears. Pair versus pair, and today versus last spring, hold the <b>listener</b> fixed instead of the chain: overall level is exactly what changes between runs, so those comparisons are only as good as the loudness match you set. Shape survives that better than absolute level does.',
         '<b>Ratios.</b> Where a room measures a signal against a masker in the <b>same frequency band</b>, played through the same transducer at the same moment — as "In the noise" does — output-level error, and most of the headphone\'s frequency response, cancel in the ratio. This is why speech-in-noise screens work on uncalibrated consumer headphones: a smartphone digits-in-noise test found speech reception thresholds consistent across five headphone types, including standard Android earphones (Potgieter et al., 2016). It is the principle the "In the noise" and digits-in-noise rooms are built on. (The digits use a synthetic voice — documented, and swappable for recordings later — so the SRT compares best against your own runs rather than published population norms.)',
         '<b>Repeatability.</b> The one claim an uncalibrated instrument can genuinely earn: does it give you the same answer twice? Measure any room again and the app shows you its own agreement, unedited.'] },
    { h:'How repeatable should a hearing test be?',
      p:['Benchmarks worth holding this app to, from published work on real listeners: unsupervised home audiometry on consumer earphones reported a mean absolute test-retest difference of 4.7 dB, with 74% of retests within 5 dB and an intraclass correlation of 0.85; automated audiometry in clinical conditions reported 3.3–3.6 dB average agreement with 91% within 5 dB; standard booth audiometry is generally taken as repeatable to 5–10 dB.',
         'For context on the field: a 2025 diagnostic-accuracy study found that neither of two well-known boothless screening apps achieved high test-retest reliability. Repeatability is not a solved problem in this category — which is exactly why this app measures and shows its own, instead of asserting it.'] },
    { h:'Sources',
      p:['Watson (2017), <i>QUEST+: a general multidimensional Bayesian adaptive psychometric method</i>, Journal of Vision · Kontsevich & Tyler (1999), <i>Bayesian adaptive estimation of psychometric slope and threshold</i>, Vision Research · Prins (2013), <i>The psi-marginal adaptive method</i>, Journal of Vision · Potgieter et al. (2016), <i>Development and validation of a smartphone digits-in-noise hearing test</i>, International Journal of Audiology · Swanepoel et al. (2010), automated versus manual pure-tone audiometry, and subsequent work on ambient-noise monitoring for boothless testing · Song et al. and Cox & de Vries, machine-learning / Gaussian-process audiometry · Jacoti home-audiometry test-retest analysis (Frontiers in Audiology &amp; Otology, 2024) · JAMA Network Open (2025), diagnostic accuracy and reliability of consumer hearing-screening apps.',
         'These are cited as precedent and as benchmarks to be measured against. None of them is a validation of this app.'] },
  ];

  window.SR_CONTENT = { GROUPS, INTRO, ROOM: C, DECODER, METHODS };
})();
