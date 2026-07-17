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
    hook: "Test your headphones. Train your ears.",
    line: "Twenty-four rooms. Each proves one thing the reviews claim — then measures it on your pair, in real Hz and dB.",
    what: "Each room plays a sound and asks one simple question. Answer, and it hunts your exact limit — telling you, in real numbers, where your headphones and your hearing actually land. You learn what the words mean by hearing them.",
    gap: "Other free tools do half the job: they train your ears with no number for your gear, or they publish lab readings of a unit that isn't on your head. This one measures your pair, through your ears, and saves it — so you can set one headphone against another.",
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
      benchmark: "You judge near versus far mostly by the direct-to-reverberant ratio, not loudness — a soft close sound still reads close.",
      science: "Layering depends on resolving how much dry sound arrives against its reflected tail. Low distortion and quick decay keep the near and far strata distinct; a smeary, resonant driver folds the back row into the front.",
      models: "The HD 800 S and HiFiMan Susvara render clear front-to-back layers.",
      hit: ["Right row.", "You read the depth.", "Front and back — got it."],
      miss: ["Spreading the rows.", "A clearer gap.", "Pulling them apart."],
      tiers: { reference: "Reference depth — every row sits at its own distance.", strong: "Strong; near and far separate cleanly.", fair: "You get near from far, but middle rows merge.", weak: "The rows flatten into one plane." }
    },
    Flyby: {
      benchmark: "Inside about 1 m the level gap between your ears grows fast — a strong closeness cue speakers can't give.",
      science: "Closeness rides on that near-field level difference plus the Doppler pitch-shift as something passes. Clean, matched drivers preserve both; distortion or channel imbalance flattens the pass into a vague swell.",
      models: "The Focal Utopia and HD 800 S render a convincing near pass.",
      hit: ["Closest one — got it.", "You felt it pass.", "Right up close."],
      miss: ["Widening the gap.", "A clearer pass.", "Easing them apart."],
      tiers: { reference: "Reference — you feel exactly how near it swept.", strong: "Strong; the closer pass is obvious.", fair: "You sense closeness, but near ties fool you.", weak: "Both passes feel the same distance." }
    },
    Echo: {
      benchmark: "A reflection under ~10 ms after a click fuses into one sound; past that it splits off as a distinct echo.",
      science: "Your ears fuse a quick reflection with its source — the precedence effect — and only hear a separate echo as the gap grows. A longer gap means a farther wall; revealing drivers keep the two clicks distinct instead of blurring them.",
      models: "Open-backs like the HD 800 S and Beyerdynamic DT 1990 Pro expose reflections clearly.",
      hit: ["Farther wall — got it.", "You heard the gap.", "Right room."],
      miss: ["Stretching the gap.", "A clearer echo.", "Easing them apart."],
      tiers: { reference: "Reference — you read the wall from the gap alone.", strong: "Strong; you separate close reflections cleanly.", fair: "Big gaps are clear; short ones fuse on you.", weak: "Source and echo blur into one." }
    },
    Duet: {
      benchmark: "Headphones give near-total left/right isolation, so width rides purely on how decorrelated the two channels are.",
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
      benchmark: "0 dB SPL is the reference threshold of hearing near 3–4 kHz — below that a hiss simply isn't there.",
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
      benchmark: "One cycle of a 40 Hz note lasts 25 ms; a controlled driver settles in a few, so the note ends before the next begins.",
      science: "Grip is how fast the diaphragm stops after it's pushed. Lighter, well-damped drivers — planars, or dynamics with strong motor control — follow the signal and halt on command; heavier cones and resonant enclosures keep ringing, adding bloom the recording never had. A leaky seal loosens the whole bass envelope.",
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
      benchmark: "A drum's leading edge rises in well under a millisecond, and the ear resolves timing down to ~10 microseconds.",
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
      science: "Shade is the small swells and dips — 1 or 2 dB — that give a phrase its breathing life. A resolving, low-distortion driver preserves those gradations; a compressed or ringing one flattens loud and soft toward the same middle. Clean amplification with headroom keeps the quietest shadings from vanishing.",
      models: "Stax electrostatics, the Focal Utopia, and the Sennheiser HD 800S are prized for reading the faintest level shadings.",
      hit: ["You caught the swell.", "Heard the shading.", "Louder — and you knew."],
      miss: ["Widened the gap.", "Made the step bigger.", "Easier to hear."],
      tiers: { reference: "The faintest 1 dB swell reads clearly — fully alive.", strong: "Reads most shadings; the subtlest slip past.", fair: "Big moves land, small ones blur.", weak: "Loud and soft flatten together — no shading." }
    },
    Hearing: {
      benchmark: "Young ears span ~20 Hz–20 kHz; the top end falls with age, and every headphone rolls off somewhere of its own.",
      science: "A browser has no absolute SPL reference, so the loudness isn't calibrated — but the SHAPE is real: the combined response of these headphones and your own ears, the same idea behind Samsung's Adapt Sound. Dips are bands this chain renders quieter; the high end also shows your own hearing's ceiling.",
      models: "Any pair — the curve is specific to this headphone on your ears, not a lab reading of the model."
    }
  };

  window.SR_CONTENT = { GROUPS, INTRO, ROOM: C };
})();
