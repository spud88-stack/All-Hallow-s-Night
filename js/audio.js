'use strict';
// ---------------------------------------------------------------------------
// Fully procedural audio (Web Audio API): adaptive music, ambience, SFX.
// Nothing is sampled; every sound is synthesized at runtime.
// ---------------------------------------------------------------------------
const Sound = (() => {
  let ctx = null;
  const S = {};
  const vol = { master: 0.8, music: 0.7, sfx: 0.9 };
  const st = {
    intensity: 0, theme: 'shape', amb: 'suburb', heart: 0, fear: 0, muffle: 0, hp: 1,
    step: 0, nextT: 0, nextHeart: 0, nextAmbEvent: 0, nextSparse: 0, running: false,
  };
  const listener = { x: 0, y: 0 };
  const layers = {};
  const loops = {};
  let drone = null, wind = null, ambNodes = [];

  // ---------- graph ----------
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
    S.master = ctx.createGain(); S.master.gain.value = vol.master;
    S.lp = ctx.createBiquadFilter(); S.lp.type = 'lowpass'; S.lp.frequency.value = 20000; S.lp.Q.value = 0.6;
    S.lp.connect(comp); comp.connect(S.master); S.master.connect(ctx.destination);

    const conv = ctx.createConvolver(); conv.buffer = impulse(3.4, 2.4);
    S.verbIn = ctx.createGain(); S.verbIn.connect(conv);
    const vo = ctx.createGain(); vo.gain.value = 0.6; conv.connect(vo); vo.connect(S.lp);

    S.music = bus(vol.music * 0.55, 0.5);
    S.sfx = bus(vol.sfx, 0.16);
    S.amb = bus(0.65, 0.3);
    S.noiseBuf = makeNoise(2.5);

    ['keys', 'bass', 'pad', 'perc', 'high'].forEach((n) => {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(S.music); layers[n] = g;
    });
    // delay used for whispers / echoes
    S.echo = ctx.createDelay(1.0); S.echo.delayTime.value = 0.33;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    S.echo.connect(fb); fb.connect(S.echo); S.echo.connect(S.sfx);

    setInterval(tick, 40);
  }
  function bus(v, verb) {
    const g = ctx.createGain(); g.gain.value = v; g.connect(S.lp);
    const s = ctx.createGain(); s.gain.value = verb; g.connect(s); s.connect(S.verbIn);
    return g;
  }
  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  function makeNoise(sec) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // ---------- primitives ----------
  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, dur));
  }
  function osc(type, f, t, dur, dest, o = {}) {
    const n = ctx.createOscillator(); n.type = type;
    n.frequency.setValueAtTime(f, t);
    if (o.f1) n.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.slide || dur));
    if (o.detune) n.detune.value = o.detune;
    const g = ctx.createGain(); env(g, t, o.a || 0.005, o.vol == null ? 1 : o.vol, dur);
    let last = n;
    if (o.lp) { const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; n.connect(f2); last = f2; }
    last.connect(g); g.connect(dest);
    if (o.vib) {
      const l = ctx.createOscillator(); l.frequency.value = o.vib; const lg = ctx.createGain(); lg.gain.value = o.vibAmt || f * 0.02;
      l.connect(lg); lg.connect(n.frequency); l.start(t); l.stop(t + dur + 0.1);
    }
    n.start(t); n.stop(t + dur + 0.1);
    return n;
  }
  function nz(t, dur, dest, o = {}) {
    const s = ctx.createBufferSource(); s.buffer = S.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    f.Q.value = o.q || 1;
    const g = ctx.createGain(); env(g, t, o.a || 0.004, o.vol == null ? 1 : o.vol, dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 2); s.stop(t + dur + 0.1);
    return g;
  }
  function out(v, pan) {
    const g = ctx.createGain(); g.gain.value = v;
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(S.sfx); }
    else g.connect(S.sfx);
    return g;
  }
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- instruments ----------
  function piano(m, t, v, dest) {
    const f = midi(m);
    osc('triangle', f, t, 2.2, dest, { vol: v * 0.55, a: 0.004 });
    osc('sine', f * 2, t, 1.2, dest, { vol: v * 0.22, a: 0.003 });
    osc('sine', f * 3.01, t, 0.5, dest, { vol: v * 0.08, a: 0.002 });
    osc('sine', f * 0.5, t, 1.6, dest, { vol: v * 0.12, a: 0.006 });
  }
  function musicbox(m, t, v, dest) {
    const f = midi(m);
    osc('sine', f, t, 1.4, dest, { vol: v * 0.45, a: 0.002 });
    osc('sine', f * 4.02, t, 0.35, dest, { vol: v * 0.12, a: 0.001 });
  }
  function bass(m, t, v, dur, dest) {
    const f = midi(m);
    osc('sawtooth', f, t, dur, dest, { vol: v * 0.3, a: 0.01, lp: 280 });
    osc('sine', f / 2, t, dur, dest, { vol: v * 0.5, a: 0.01 });
  }
  function strings(ms, t, dur, v, dest, bright) {
    ms.forEach((m) => {
      const f = midi(m);
      [-9, 7].forEach((dt) => {
        const n = ctx.createOscillator(); n.type = 'sawtooth'; n.frequency.value = f; n.detune.value = dt;
        const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = bright ? 2400 : 1100;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.05, t + dur * 0.35);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        const l = ctx.createOscillator(); l.frequency.value = 5 + Math.random(); const lg = ctx.createGain(); lg.gain.value = f * 0.006;
        l.connect(lg); lg.connect(n.frequency);
        n.connect(fl); fl.connect(g); g.connect(dest);
        n.start(t); n.stop(t + dur + 0.05); l.start(t); l.stop(t + dur + 0.05);
      });
    });
  }
  function hitDrum(t, v, dest) {
    osc('sine', 110, t, 0.45, dest, { vol: v * 0.9, f1: 38, slide: 0.3 });
    nz(t, 0.18, dest, { vol: v * 0.35, type: 'lowpass', f: 900 });
  }
  function screech(t, dur, v, dest) {
    const f = midi(U.ri(84, 90));
    osc('sawtooth', f, t, dur, dest, { vol: v * 0.08, a: 0.04, f1: f * 1.06, vib: 7, vibAmt: f * 0.015, lp: 4000 });
  }

  // ---------- adaptive music ----------
  const THEMES = {
    // Original 5/4 ostinato (10 eighth notes per bar) with chromatic descending harmony.
    shape: { bpm: 158, steps: 10, root: 62, mel: [12, 7, 7, 12, 7, 15, 7, 12, 7, 8], prog: [0, 0, -1, -1, -5, -5, -3, -1],
      bassSteps: [0, 6], inst: 'piano', chord: [0, 3, 7] },
    camp: { bpm: 104, steps: 8, root: 50, mel: [12, null, 13, null, 12, null, 18, null], prog: [0, 0, 1, 0, 0, 0, -2, 1],
      bassSteps: [0, 2, 4, 6], inst: 'piano', chord: [0, 1, 6] },
    ghost: { bpm: 126, steps: 12, root: 57, mel: [12, 15, 19, 15, 14, 15, 12, 15, 19, 22, 20, 19], prog: [0, 0, -4, -2, 0, 0, 1, -1],
      bassSteps: [0, 6], inst: 'musicbox', chord: [0, 3, 7, 10] },
  };
  const LAYER_GAINS = {
    keys: [0, 0.45, 0.75, 0.95], bass: [0, 0, 0.6, 1], pad: [0.18, 0.32, 0.55, 0.8], perc: [0, 0, 0.15, 0.85], high: [0, 0, 0.35, 0.9],
  };

  function tick() {
    if (!ctx || !st.running) return;
    const now = ctx.currentTime;
    const th = THEMES[st.theme] || THEMES.shape;
    const I = st.intensity;
    const tempo = th.bpm * (I >= 3 ? 1.14 : I >= 2 ? 1.05 : 1);
    const stepDur = 60 / tempo / 2;
    if (st.nextT < now) st.nextT = now + 0.05;
    while (st.nextT < now + 0.12) {
      const t = st.nextT;
      const i = st.step % th.steps;
      const bar = Math.floor(st.step / th.steps);
      const chordShift = th.prog[bar % th.prog.length];
      const root = th.root + chordShift;
      const m = th.mel[i];
      if (m != null) {
        if (th.inst === 'musicbox') musicbox(root + m, t, 0.55, layers.keys);
        else piano(root + m, t, 0.5 + (i === 0 ? 0.2 : 0), layers.keys);
      }
      if (th.bassSteps.includes(i)) bass(root - 24, t, 0.8, stepDur * 2.5, layers.bass);
      if (i === 0) {
        const ch = th.chord.map((c) => root - 12 + c);
        if (I >= 3) ch.push(root - 11);
        strings(ch, t, stepDur * th.steps * 1.05, 1, layers.pad, I >= 2);
        if (bar % 2 === 0) screech(t + stepDur * 2, stepDur * th.steps * 1.6, 1, layers.high);
      }
      if (i % 2 === 0) hitDrum(t, i === 0 ? 1 : 0.55, layers.perc);
      st.nextT += stepDur;
      st.step++;
    }
    // layer gains
    for (const k in layers) {
      const target = LAYER_GAINS[k][I] * (k === 'pad' ? 0.6 + st.fear * 0.6 : 1);
      layers[k].gain.setTargetAtTime(target, now, 0.8);
    }
    // calm: sparse random notes
    if (I === 0 && now > st.nextSparse) {
      st.nextSparse = now + U.rf(5, 11);
      const m = th.root + U.pick([12, 15, 19, 24, 13, 18]);
      if (th.inst === 'musicbox') musicbox(m, now + 0.05, 0.3, S.music); else piano(m, now + 0.05, 0.22, S.music);
    }
    // heartbeat
    if (st.heart > 0.05 && now > st.nextHeart) {
      const bpm = 58 + st.heart * 100;
      const v = Math.min(1, 0.25 + st.heart * 0.9);
      const g = out(v * 0.9);
      osc('sine', 62, now + 0.02, 0.18, g, { vol: 1, f1: 40 });
      osc('sine', 55, now + 0.24, 0.16, g, { vol: 0.7, f1: 36 });
      st.nextHeart = now + 60 / bpm;
    }
    // drone follows fear
    if (drone) {
      drone.g.gain.setTargetAtTime(0.025 + st.fear * 0.12 + (I >= 2 ? 0.04 : 0), now, 1.2);
      drone.f.frequency.setTargetAtTime(160 + st.fear * 700, now, 1.5);
      drone.diss.gain.setTargetAtTime(st.fear > 0.5 ? (st.fear - 0.5) * 0.25 : 0, now, 1.5);
    }
    // global muffle (hiding, low hp)
    const cut = 20000 * (1 - st.muffle * 0.93) * (0.35 + 0.65 * Math.min(1, st.hp * 1.6));
    S.lp.frequency.setTargetAtTime(Math.max(380, cut), now, 0.3);
    // ambient one-shots
    if (now > st.nextAmbEvent) { st.nextAmbEvent = now + U.rf(6, 16); ambientEvent(); }
  }

  // ---------- ambience ----------
  function startAmbience(kind) {
    stopAmbience();
    st.amb = kind;
    // wind
    const s = ctx.createBufferSource(); s.buffer = S.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = kind === 'camp' ? 0.05 : 0.09;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 240;
    lfo.connect(lg); lg.connect(f.frequency);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = ctx.createGain(); lg2.gain.value = 0.04;
    lfo2.connect(lg2); lg2.connect(g.gain);
    s.connect(f); f.connect(g); g.connect(S.amb); s.start(); lfo.start(); lfo2.start();
    wind = { s, lfo, lfo2 };
    ambNodes.push(s, lfo, lfo2);
    // drone
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 43.65;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 65.4; o2.detune.value = 6;
    const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 46.25;
    const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 200; df.Q.value = 2;
    const dg = ctx.createGain(); dg.gain.value = 0.02;
    const diss = ctx.createGain(); diss.gain.value = 0;
    o1.connect(df); o2.connect(df); o3.connect(diss); diss.connect(df); df.connect(dg); dg.connect(S.amb);
    o1.start(); o2.start(); o3.start();
    drone = { g: dg, f: df, diss };
    ambNodes.push(o1, o2, o3);
    // crickets (camp + woodsboro)
    if (kind !== 'suburb') {
      const c = ctx.createOscillator(); c.frequency.value = 4400;
      const cg = ctx.createGain(); cg.gain.value = 0;
      const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 22;
      const amg = ctx.createGain(); amg.gain.value = 0.006;
      const am2 = ctx.createOscillator(); am2.frequency.value = 0.9; const am2g = ctx.createGain(); am2g.gain.value = 0.006;
      am.connect(amg); amg.connect(cg.gain); am2.connect(am2g); am2g.connect(cg.gain);
      c.connect(cg); cg.connect(S.amb); c.start(); am.start(); am2.start();
      ambNodes.push(c, am, am2);
    }
    if (kind === 'camp') {
      // water lapping
      const w = ctx.createBufferSource(); w.buffer = S.noiseBuf; w.loop = true;
      const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 350;
      const wg = ctx.createGain(); wg.gain.value = 0.03;
      const wl = ctx.createOscillator(); wl.frequency.value = 0.35; const wlg = ctx.createGain(); wlg.gain.value = 0.025;
      wl.connect(wlg); wlg.connect(wg.gain);
      w.connect(wf); wf.connect(wg); wg.connect(S.amb); w.start(); wl.start();
      ambNodes.push(w, wl);
    }
  }
  function stopAmbience() {
    ambNodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } });
    ambNodes = []; drone = null; wind = null;
  }
  function ambientEvent() {
    const t = ctx.currentTime + 0.05;
    const pan = U.rf(-0.8, 0.8);
    const g = out(0.35, pan);
    const r = Math.random();
    if (st.amb === 'camp') {
      if (r < 0.4) { // owl
        osc('sine', 410, t, 0.35, g, { vol: 0.35, f1: 370, a: 0.06 });
        osc('sine', 400, t + 0.5, 0.5, g, { vol: 0.3, f1: 350, a: 0.08 });
      } else if (r < 0.7) { // frog
        for (let i = 0; i < 3; i++) osc('square', 140, t + i * 0.18, 0.09, g, { vol: 0.08, lp: 500, f1: 110 });
      } else { nz(t, 2.5, g, { vol: 0.3, type: 'lowpass', f: 300, a: 0.8 }); } // branches/wind
    } else {
      if (r < 0.3) { // distant dog
        for (let i = 0; i < U.ri(2, 4); i++) {
          const tt = t + i * 0.42;
          osc('sawtooth', 380, tt, 0.16, g, { vol: 0.08, f1: 240, lp: 1100 });
        }
      } else if (r < 0.6) { // wind chimes
        const notes = [79, 82, 84, 86, 89, 91];
        for (let i = 0; i < U.ri(3, 6); i++) osc('sine', midi(U.pick(notes)), t + i * U.rf(0.15, 0.5), 2.5, g, { vol: 0.07 });
      } else if (r < 0.8) { nz(t, 3, g, { vol: 0.25, type: 'bandpass', f: 2500, q: 0.5, a: 1 }); } // leaves gust
      else { osc('sine', 120, t, 3, g, { vol: 0.05, vib: 0.3, vibAmt: 8, a: 1 }); } // distant hum
    }
  }

  // ---------- SFX ----------
  function spatial(o) {
    if (o == null || o.x == null) return { v: 1, pan: 0 };
    const d = Math.hypot(o.x - listener.x, o.y - listener.y);
    const maxD = o.maxD || 700;
    if (d >= maxD) return { v: 0, pan: 0 };
    const v = Math.pow(1 - d / maxD, 1.6);
    return { v, pan: U.clamp((o.x - listener.x) / 450, -0.9, 0.9) };
  }

  const SFX = {
    step(t, g, o) { nz(t, 0.06, g, { vol: 0.25, f: o.surface === 'grass' ? 1800 : 700, q: 1.2 }); },
    heavyStep(t, g) { osc('sine', 70, t, 0.18, g, { vol: 0.6, f1: 40 }); nz(t, 0.09, g, { vol: 0.25, type: 'lowpass', f: 380 }); },
    doorOpen(t, g) {
      osc('sawtooth', 160, t, 0.7, g, { vol: 0.08, f1: 290, lp: 1400, vib: 14, vibAmt: 18 });
      nz(t, 0.06, g, { vol: 0.25, f: 2200 });
    },
    doorClose(t, g) { osc('sine', 95, t, 0.2, g, { vol: 0.7, f1: 50 }); nz(t, 0.1, g, { vol: 0.35, type: 'lowpass', f: 700 }); },
    lock(t, g) { nz(t, 0.03, g, { vol: 0.5, type: 'highpass', f: 3000 }); nz(t + 0.09, 0.04, g, { vol: 0.5, type: 'highpass', f: 2400 }); },
    bang(t, g) {
      osc('sine', 75, t, 0.35, g, { vol: 1, f1: 32 }); nz(t, 0.22, g, { vol: 0.7, type: 'lowpass', f: 500 });
      nz(t, 0.05, g, { vol: 0.4, f: 1600 });
    },
    doorBreak(t, g) {
      SFX.bang(t, g); nz(t + 0.05, 0.7, g, { vol: 0.6, type: 'bandpass', f: 900, f1: 300, q: 0.8 });
      for (let i = 0; i < 6; i++) nz(t + 0.05 + Math.random() * 0.4, 0.05, g, { vol: 0.3, f: U.rf(1200, 3000), q: 4 });
    },
    glass(t, g) {
      nz(t, 0.5, g, { vol: 0.6, type: 'highpass', f: 2800, f1: 5000 });
      for (let i = 0; i < 14; i++) osc('sine', U.rf(2400, 7000), t + Math.random() * 0.5, 0.25, g, { vol: 0.12 });
    },
    stab(t, g) { nz(t, 0.08, g, { vol: 0.7, f: 1500, q: 2 }); nz(t + 0.03, 0.25, g, { vol: 0.5, type: 'lowpass', f: 420 }); osc('sine', 90, t, 0.15, g, { vol: 0.5, f1: 55 }); },
    hit(t, g) { osc('sine', 130, t, 0.18, g, { vol: 0.9, f1: 60 }); nz(t, 0.08, g, { vol: 0.6, type: 'lowpass', f: 1200 }); },
    swing(t, g) { nz(t, 0.16, g, { vol: 0.35, f: 400, f1: 1800, q: 2 }); },
    scream(t, g, o) {
      const p = o.pitch || 1;
      const s = ctx.createOscillator(); s.type = 'sawtooth';
      const f0 = 520 * p;
      s.frequency.setValueAtTime(f0 * 0.8, t); s.frequency.linearRampToValueAtTime(f0 * 1.15, t + 0.3); s.frequency.linearRampToValueAtTime(f0 * 0.7, t + 1.3);
      const l = ctx.createOscillator(); l.frequency.value = 6.5; const lg = ctx.createGain(); lg.gain.value = 22 * p; l.connect(lg); lg.connect(s.frequency);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 900 * p; f1.Q.value = 3;
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2600 * p; f2.Q.value = 4;
      const sg = ctx.createGain(); env(sg, t, 0.05, 0.6, 1.4);
      s.connect(f1); s.connect(f2); f1.connect(sg); f2.connect(sg); sg.connect(g);
      s.start(t); s.stop(t + 1.5); l.start(t); l.stop(t + 1.5);
      nz(t, 1.3, g, { vol: 0.12, f: 3000, q: 1, a: 0.05 });
    },
    gun(t, g) {
      nz(t, 0.35, g, { vol: 1.2, type: 'lowpass', f: 5000, f1: 300 });
      osc('sine', 120, t, 0.3, g, { vol: 1, f1: 35 });
      nz(t + 0.3, 1.2, g, { vol: 0.15, type: 'lowpass', f: 500, a: 0.05 });
    },
    powerDown(t, g) {
      osc('sawtooth', 120, t, 1.4, g, { vol: 0.2, f1: 25, lp: 600 });
      osc('sine', 60, t, 1.6, g, { vol: 0.4, f1: 20 });
      nz(t, 0.05, g, { vol: 0.6, type: 'highpass', f: 2000 });
    },
    powerUp(t, g) { osc('sawtooth', 30, t, 0.9, g, { vol: 0.15, f1: 120, lp: 800 }); nz(t, 0.05, g, { vol: 0.4, type: 'highpass', f: 2000 }); },
    pickup(t, g) { osc('sine', 660, t, 0.12, g, { vol: 0.25, f1: 990 }); osc('sine', 990, t + 0.06, 0.15, g, { vol: 0.15 }); },
    search(t, g) { for (let i = 0; i < 4; i++) nz(t + i * 0.12, 0.07, g, { vol: 0.2, f: U.rf(900, 2400), q: 2 }); },
    click(t, g) { nz(t, 0.02, g, { vol: 0.5, type: 'highpass', f: 3000 }); },
    stinger(t, g, o) {
      const base = U.rf(300, 380);
      [1, 1.06, 1.414, 1.5, 2.12, 2.83].forEach((m, i) => {
        osc('sawtooth', base * m, t, 2.6, g, { vol: 0.07, a: 0.01, lp: 3500, vib: 9 + i, vibAmt: base * m * 0.01 });
      });
      nz(t, 1.6, g, { vol: 0.25, f: 2000, f1: 500, q: 0.6, a: 0.02 });
      osc('sine', 55, t, 2.5, g, { vol: 0.9, f1: 30 });
      if (o.big) { screech(t, 1.8, 3, g); nz(t, 0.25, g, { vol: 0.8, type: 'lowpass', f: 900 }); }
    },
    thunder(t, g) {
      nz(t, 4, g, { vol: 0.8, type: 'lowpass', f: 260, f1: 80, a: 0.05 });
      nz(t, 0.4, g, { vol: 0.5, type: 'lowpass', f: 1200, a: 0.01 });
    },
    carStart(t, g) {
      nz(t, 1.2, g, { vol: 0.5, type: 'bandpass', f: 300, q: 2 });
      osc('sawtooth', 45, t + 1, 2.5, g, { vol: 0.3, f1: 90, lp: 600, slide: 1 });
    },
    carFail(t, g) { for (let i = 0; i < 6; i++) nz(t + i * 0.16, 0.12, g, { vol: 0.45, type: 'bandpass', f: 350, q: 3 }); },
    engine(t, g) { osc('sawtooth', 55, t, 3, g, { vol: 0.25, f1: 110, lp: 700, slide: 2 }); },
    whisper(t, g) {
      const e = ctx.createGain(); e.gain.value = 0.8; e.connect(S.echo); e.connect(g);
      for (let i = 0; i < 3; i++) nz(t + i * 0.22, 0.12, e, { vol: 0.5, type: 'bandpass', f: 3800, q: 3 });
      for (let i = 0; i < 3; i++) nz(t + 0.8 + i * 0.3, 0.2, e, { vol: 0.35, type: 'bandpass', f: 1100, q: 5 });
    },
    static(t, g) { nz(t, 0.6, g, { vol: 0.3, type: 'highpass', f: 1500 }); for (let i = 0; i < 8; i++) nz(t + Math.random() * 0.6, 0.02, g, { vol: 0.5, type: 'highpass', f: 4000 }); },
    breath(t, g) { nz(t, 0.9, g, { vol: 0.25, f: 700, q: 1.5, a: 0.4 }); nz(t + 1.0, 1.1, g, { vol: 0.2, f: 500, q: 1.5, a: 0.2 }); },
    dial(t, g) { osc('sine', 350, t, 1.2, g, { vol: 0.15 }); osc('sine', 440, t, 1.2, g, { vol: 0.15 }); },
    dead(t, g) { nz(t, 0.03, g, { vol: 0.5, type: 'highpass', f: 2500 }); osc('sine', 60, t, 1.0, g, { vol: 0.08 }); },
    flare(t, g) { nz(t, 0.5, g, { vol: 0.6, type: 'highpass', f: 1500, a: 0.01 }); nz(t + 0.4, 3, g, { vol: 0.15, f: 2500, q: 0.4 }); },
    levelUp(t, g) {
      osc('sine', 41, t, 3, g, { vol: 1, f1: 30 });
      [0, 1, 6, 7].forEach((s, i) => osc('sawtooth', midi(38 + s), t + i * 0.05, 3, g, { vol: 0.08, lp: 900, a: 0.4 }));
    },
    teleport(t, g) { nz(t, 1.5, g, { vol: 0.5, f: 300, f1: 2400, q: 1, a: 0.3 }); osc('sine', 80, t, 1.5, g, { vol: 0.5, f1: 30 }); SFX.whisper(t + 0.2, g); },
    ring(t, g) {
      for (let k = 0; k < 2; k++) {
        const tt = t + k * 0.45;
        const a = ctx.createOscillator(); a.frequency.value = 440; const b = ctx.createOscillator(); b.frequency.value = 480;
        const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 20; const amg = ctx.createGain(); amg.gain.value = 0.5;
        const rg = ctx.createGain(); env(rg, tt, 0.01, 0.18, 0.4);
        am.connect(amg); amg.connect(rg.gain);
        a.connect(rg); b.connect(rg); rg.connect(g);
        [a, b, am].forEach((n) => { n.start(tt); n.stop(tt + 0.42); });
      }
    },
    ui(t, g) { osc('sine', 520, t, 0.08, g, { vol: 0.12 }); },
  };

  function play(name, o = {}) {
    if (!ctx || !SFX[name]) return;
    const sp = spatial(o);
    const v = (o.vol == null ? 1 : o.vol) * sp.v;
    if (v < 0.01) return;
    const g = out(v, sp.pan);
    SFX[name](ctx.currentTime + 0.01, g, o);
  }

  // persistent loops whose volume the game sets every frame (siren, phone ring)
  function loop(name, v, pan = 0) {
    if (!ctx) return;
    let L = loops[name];
    if (!L) {
      if (v <= 0.001) return;
      L = loops[name] = { g: ctx.createGain(), p: ctx.createStereoPanner(), nodes: [] };
      L.g.gain.value = 0; L.g.connect(L.p); L.p.connect(S.sfx);
      if (name === 'siren') {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 700;
        const l = ctx.createOscillator(); l.frequency.value = 0.35; const lg = ctx.createGain(); lg.gain.value = 260;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
        const og = ctx.createGain(); og.gain.value = 0.08;
        l.connect(lg); lg.connect(o.frequency); o.connect(f); f.connect(og); og.connect(L.g); o.start(); l.start();
        L.nodes.push(o, l);
      } else if (name === 'tv') {
        const s = ctx.createBufferSource(); s.buffer = S.noiseBuf; s.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 0.8;
        const og = ctx.createGain(); og.gain.value = 0.06;
        s.connect(f); f.connect(og); og.connect(L.g); s.start(); L.nodes.push(s);
      }
    }
    L.g.gain.setTargetAtTime(v, ctx.currentTime, 0.15);
    L.p.pan.setTargetAtTime(pan, ctx.currentTime, 0.15);
  }

  return {
    init,
    get ready() { return !!ctx; },
    listener,
    play,
    loop,
    setVolumes(v) {
      Object.assign(vol, v);
      if (!ctx) return;
      S.master.gain.value = vol.master; S.music.gain.value = vol.music * 0.55; S.sfx.gain.value = vol.sfx;
    },
    start(theme, amb) {
      if (!ctx) return;
      st.theme = theme; st.step = 0; st.nextT = ctx.currentTime + 0.3; st.running = true;
      startAmbience(amb);
    },
    stop() {
      st.running = false; stopAmbience();
      for (const k in layers) layers[k].gain.value = 0;
      for (const k in loops) loops[k].g.gain.value = 0;
      st.heart = 0;
    },
    set(p) { Object.assign(st, p); },
    get state() { return st; },
    // menu music: slow version of the chosen theme
    menu(theme) {
      if (!ctx) return;
      st.theme = theme; st.intensity = 1; st.fear = 0.2; st.running = true; st.heart = 0; st.muffle = 0; st.hp = 1;
      if (!drone) startAmbience(KILLERS[Object.keys(KILLERS).find((k) => KILLERS[k].music === theme)].ambience);
    },
  };
})();
