/* Popzy · moteur de sons ASMR (Web Audio, aucune dépendance)
   Chaque son est synthétisé. Si un fichier du même nom est listé dans sounds/sounds.json,
   il est utilisé à la place (ex. "crunch" -> sounds/crunch.mp3). */
(() => {
  let ctx = null, master = null, comp = null, noiseBuf = null, muted = false;
  const files = {};                 // nom -> AudioBuffer chargé depuis /sounds
  const rnd = (a, b) => a + Math.random() * (b - a);
  const vary = (v, pct) => v * rnd(1 - pct, 1 + pct);

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.12;
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.7;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      loadFiles();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  async function loadFiles() {
    if (location.protocol === 'file:') return;   // en local sans serveur : synthèse uniquement
    try {
      const r = await fetch('sounds/sounds.json', { cache: 'no-store' });
      if (!r.ok) return;
      const list = await r.json();
      for (const name of list) {
        try {
          const f = await fetch('sounds/' + name);
          if (!f.ok) continue;
          const buf = await ctx.decodeAudioData(await f.arrayBuffer());
          files[name.replace(/\.[a-z0-9]+$/i, '')] = buf;
        } catch (e) {}
      }
    } catch (e) {}
  }
  function playFile(name, rate = 1, vol = 1) {
    const b = files[name]; if (!b) return false;
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = b; s.playbackRate.value = vary(rate, 0.06); g.gain.value = vary(vol, 0.12);
    s.connect(g).connect(master); s.start();
    return true;
  }
  const ok = () => ctx && !muted;
  const now = () => ctx.currentTime;

  /* ---- briques ---- */
  function noise(t, dur, { type = 'bandpass', f = 2000, f2 = null, q = 1, vol = 0.3, a = 0.002, pan = 0 } = {}) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = rnd(0.9, 1.1);
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    s.connect(fl).connect(g); out.connect(master);
    s.start(t, rnd(0, 1.5)); s.stop(t + dur + 0.05);
    return { fl, g };
  }
  function tone(t, dur, { f = 440, f2 = null, type = 'sine', vol = 0.2, a = 0.004, pan = 0, curve = 'exp' } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) curve === 'exp' ? o.frequency.exponentialRampToValueAtTime(f2, t + dur) : o.frequency.linearRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    o.connect(g); out.connect(master); o.start(t); o.stop(t + dur + 0.05);
    return { o, g };
  }

  /* ---- sons de la séquence ---- */
  const S = {
    crack() {               // craquement net de la capsule
      if (!ok() || playFile('capsule-crack')) return;
      let t = now();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        noise(t, rnd(0.012, 0.03), { type: 'highpass', f: rnd(2500, 4500), q: 0.8, vol: vary(0.35, 0.3), a: 0.001, pan: rnd(-0.3, 0.3) });
        tone(t, 0.018, { f: rnd(2600, 3800), type: 'triangle', vol: 0.05 });
        t += rnd(0.03, 0.07);
      }
    },
    openPop() {             // pop d'ouverture bien rond + souffle sucré
      if (!ok()) return;
      if (!playFile('capsule-pop')) {
        const t = now();
        tone(t, 0.16, { f: vary(520, 0.08), f2: 110, vol: 0.45, a: 0.003 });
        tone(t, 0.08, { f: vary(1100, 0.08), f2: 300, vol: 0.12, a: 0.002 });
        noise(t, 0.09, { type: 'lowpass', f: 1800, f2: 400, vol: 0.18, a: 0.002 });
      }
      S.breath();
    },
    breath() {              // léger souffle sucré
      if (!ok() || playFile('sweet-breath')) return;
      const t = now() + 0.05;
      noise(t, 0.75, { type: 'bandpass', f: 700, f2: 2400, q: 0.7, vol: 0.06, a: 0.25 });
      noise(t + 0.1, 0.6, { type: 'highpass', f: 5000, vol: 0.02, a: 0.2 });
    },
    shimmer() {             // emballage qui scintille
      if (!ok() || playFile('shimmer')) return;
      const notes = [1568, 1760, 2093, 2349, 2637, 3136, 3520, 4186];
      let t = now();
      for (let i = 0; i < 7; i++) {
        const f = notes[Math.floor(Math.random() * notes.length)] * rnd(0.995, 1.005);
        tone(t, rnd(0.35, 0.6), { f, type: 'sine', vol: vary(0.045, 0.3), a: 0.003, pan: rnd(-0.7, 0.7) });
        t += rnd(0.025, 0.06);
      }
      noise(now(), 0.5, { type: 'highpass', f: 7000, vol: 0.025, a: 0.08 });
    },
    crunch(intensity = 1) { // croc net dans une dragée
      if (!ok() || playFile('crunch', 1, intensity)) return;
      let t = now();
      tone(t, 0.07, { f: vary(150, 0.1), f2: 60, vol: 0.28 * intensity, a: 0.002 });   // impact sourd
      const n = Math.round(rnd(6, 10) * intensity);
      for (let i = 0; i < n; i++) {
        noise(t, rnd(0.012, 0.04), { type: 'bandpass', f: rnd(1600, 5200), q: rnd(1, 3.5), vol: vary(0.5, 0.35) * intensity, a: 0.001, pan: rnd(-0.25, 0.25) });
        t += rnd(0.006, 0.022);
      }
    },
    squish(soft = 1) {      // squish humide et moelleux
      if (!ok() || playFile('squish', 1, soft)) return;
      const t = now() + 0.01;
      const { g } = noise(t, vary(0.24, 0.15), { type: 'lowpass', f: 1400, f2: 260, q: 4, vol: 0.32 * soft, a: 0.012 });
      // micro-bulles : modulation rapide du volume
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = rnd(28, 42); lg.gain.value = 0.18 * soft;
      lfo.connect(lg).connect(g.gain); lfo.start(t); lfo.stop(t + 0.3);
      tone(t + 0.02, 0.12, { f: vary(380, 0.12), f2: 140, vol: 0.12 * soft, a: 0.006 });   // "bloop"
      tone(t + 0.09, 0.09, { f: vary(300, 0.12), f2: 120, vol: 0.07 * soft, a: 0.006 });
    },
    crunchSquish() {        // étape 2 : croc + squish
      if (!ok() || playFile('crunch-squish')) return;
      S.crunch(0.6);
      setTimeout(() => S.squish(0.8), 45);
    },
    stretch() {             // étirement élastique + squish moelleux
      if (!ok()) return;
      if (!playFile('stretch')) {
        const t = now();
        const a = tone(t, 0.5, { f: vary(170, 0.08), f2: 430, type: 'triangle', vol: 0.06, a: 0.05, curve: 'lin' });
        const b = tone(t, 0.5, { f: vary(172, 0.08), f2: 445, type: 'sine', vol: 0.06, a: 0.05, curve: 'lin' });
        const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 9; vg.gain.value = 14;
        vib.connect(vg); vg.connect(a.o.frequency); vg.connect(b.o.frequency); vib.start(t); vib.stop(t + 0.55);
        noise(t, 0.5, { type: 'bandpass', f: 500, f2: 1600, q: 6, vol: 0.08, a: 0.08 });
        tone(t + 0.48, 0.18, { f: 420, f2: 160, type: 'sine', vol: 0.09, a: 0.004 });     // retour "snap"
      }
      setTimeout(() => S.squish(1), 480);
    },
    inflate(dur = 0.7) {    // gonflement doux
      if (!ok() || playFile('bubble-inflate')) return;
      const t = now();
      noise(t, dur, { type: 'bandpass', f: 280, f2: 1100, q: 2.5, vol: 0.1, a: dur * 0.8 });
      tone(t, dur, { f: 140, f2: 320, type: 'sine', vol: 0.05, a: dur * 0.8 });
    },
    bubblePop() {           // POP de bulle très satisfaisant
      if (!ok() || playFile('bubble-pop')) return;
      const t = now();
      noise(t, 0.012, { type: 'highpass', f: 1500, vol: 0.5, a: 0.0008 });
      tone(t, 0.09, { f: vary(1050, 0.1), f2: 140, vol: 0.5, a: 0.001 });
      tone(t, 0.06, { f: 90, f2: 50, vol: 0.25, a: 0.002 });
      noise(t + 0.01, 0.25, { type: 'highpass', f: 4000, vol: 0.04, a: 0.01 });
    },
    tap() {                 // petit son d'UI
      if (!ok()) return;
      tone(now(), 0.07, { f: vary(800, 0.1), f2: 300, vol: 0.12 });
    }
  };

  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
  function setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.7, ctx.currentTime, 0.02); }

  window.PopzySound = Object.assign({ unlock, vibrate, setMuted, get muted() { return muted; } }, S);
})();
