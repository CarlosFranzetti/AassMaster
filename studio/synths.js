/* aasssMaster studio - synths.js
 * Global `Synths`: one Web Audio instrument per element of a Guidance-style electro track.
 *
 *   var inst = Synths.create(ctx, 'kick', {level: 0.9});
 *   inst.out.connect(ctx.destination);
 *   inst.trigger(ctx.currentTime, {vel: 1});                 // drums
 *   inst.trigger(t, {midi: 35, vel: 0.9, dur: 0.12});        // bass / lead
 *   inst.trigger(t, {notes: [63, 66, 70, 73], dur: 0.2});     // stab / pad chords
 *   inst.set('cutoff', 800); inst.params / inst.spec           // live parameters
 *
 * Types: kick, sub, bass, stab, clap, hat_closed, hat_open, shaker, perc, lead, pad, riser, impact.
 * Every voice is a few nodes created per trigger and disconnected when its last source ends.
 * Nothing throws: a missing AudioContext gives a silent instrument with the same API.
 */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  var K = root.Kit;
  var setV = K.setV, lin = K.lin, expo = K.expo, val = K.val, disc = K.disc, mtof = K.mtof, clamp = K.clamp;

  // ------------------------------------------------------------ voice: node bag with auto cleanup
  function voice(ctx, inst) {
    var v = { ctx: ctx, nodes: [], pending: 0, done: false, srcs: [] };
    if (inst && inst._live) inst._live.push(v);
    v.track = function (n) { if (n) v.nodes.push(n); return n; };
    v.src = function (src, t0, t1, offset) {
      v.pending++;
      src.onended = function () { v.pending--; if (v.pending <= 0) v.dispose(); };
      v.nodes.push(src); v.srcs.push(src);
      try { if (offset != null) src.start(t0, offset); else src.start(t0); } catch (e) {}
      if (t1 != null) { try { src.stop(t1); } catch (e) {} }
      return src;
    };
    v.osc = function (type, f, t0, t1, det) {
      var o = ctx.createOscillator();
      try { o.type = type; } catch (e) {}
      setV(o.frequency, f, t0);
      if (det) val(o.detune, det);
      return v.src(o, t0, t1);
    };
    v.noise = function (t0, t1) {
      var buf = K.noise(ctx);
      if (!buf) return null;
      var s = ctx.createBufferSource();
      s.buffer = buf; s.loop = true;
      return v.src(s, t0, t1, Math.random() * 1.5);
    };
    v.gain = function (g0) { var g = ctx.createGain(); val(g.gain, g0 == null ? 1 : g0); return v.track(g); };
    v.filter = function (type, f, q) {
      var b = ctx.createBiquadFilter();
      try { b.type = type; } catch (e) {}
      val(b.frequency, f); val(b.Q, q == null ? 1 : q);
      return v.track(b);
    };
    v.pan = function (p) {
      if (typeof ctx.createStereoPanner !== 'function') return null;
      try { var pn = ctx.createStereoPanner(); val(pn.pan, clamp(p, -1, 1)); return v.track(pn); } catch (e) { return null; }
    };
    v.cut = function (t) { for (var i = 0; i < v.srcs.length; i++) { try { v.srcs[i].stop(t); } catch (e) {} } };
    v.dispose = function () {
      if (v.done) return;
      v.done = true;
      for (var i = 0; i < v.nodes.length; i++) disc(v.nodes[i]);
      v.nodes.length = 0;
      if (inst && inst._live) { var j = inst._live.indexOf(v); if (j >= 0) inst._live.splice(j, 1); }
    };
    return v;
  }

  // attack-hold-release amplitude envelope on a gain param. hold = seconds the note is held (gate)
  function envAHR(g, t, vel, a, hold, rel) {
    setV(g, 0.0001, t);
    lin(g, vel, t + a);
    if (hold > 0) setV(g, vel, t + a + hold);
    expo(g, 0.0001, t + a + hold + rel);
    return t + a + hold + rel + 0.03;   // stop time
  }
  // pluck envelope: instant attack, exponential decay
  function envDecay(g, t, vel, a, dec) {
    setV(g, 0.0001, t);
    lin(g, vel, t + a);
    expo(g, 0.0001, t + a + dec);
    return t + a + dec + 0.03;
  }
  // chain nodes in series, return last
  function series(nodes) {
    var last = null;
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i]) continue;
      if (last) { try { last.connect(nodes[i]); } catch (e) {} }
      last = nodes[i];
    }
    return last;
  }

  // ------------------------------------------------------------ instrument base
  // spec = parameter spec (see Kit.defineParams); build(inst) adds nodes between inst.pre and inst.out
  function makeInst(ctx, type, spec, opts, build) {
    var inst = { type: type, ctx: ctx, out: null, pre: null, _shaper: null, _lastF: 0, _live: [] };
    K.defineParams(inst, spec, function (name, v) {
      if (!ctx) return;
      if (name === 'level' && inst.out) K.target(inst.out.gain, v, ctx.currentTime, 0.01);
      if (name === 'drive' && inst._shaper) { try { inst._shaper.curve = K.shaperCurve(v); } catch (e) {} }
      if (inst.onParam) inst.onParam(name, v);
    });
    if (opts) for (var k in opts) if (opts.hasOwnProperty(k) && spec.hasOwnProperty(k)) inst.set(k, opts[k]);
    inst.trigger = function () {};
    // stop every sounding voice (transport stop / jump). Fades the output for 20 ms first to avoid clicks.
    inst.panic = function () {
      try {
        if (!ctx || !inst.out) return;
        var now = ctx.currentTime, lv = inst.params.level == null ? 1 : inst.params.level;
        K.cancel(inst.out.gain, now); setV(inst.out.gain, lv, now); lin(inst.out.gain, 0.0001, now + 0.02); setV(inst.out.gain, lv, now + 0.05);
        var live = inst._live.slice();
        for (var i = 0; i < live.length; i++) live[i].cut(now + 0.03);
        inst._lastF = 0;
      } catch (e) {}
    };
    inst.dispose = function () { inst.panic(); disc(inst.pre); disc(inst.out); disc(inst._shaper); };
    if (!ctx) return inst;
    try {
      inst.out = ctx.createGain();
      val(inst.out.gain, inst.params.level == null ? 1 : inst.params.level);
      inst.pre = ctx.createGain();           // voices connect here
      if (spec.drive) {                      // pre -> shaper -> out
        inst._shaper = ctx.createWaveShaper();
        try { inst._shaper.oversample = '2x'; } catch (e) {}
        try { inst._shaper.curve = K.shaperCurve(inst.params.drive); } catch (e) {}
        inst.pre.connect(inst._shaper);
        inst._shaper.connect(inst.out);
      } else {
        inst.pre.connect(inst.out);
      }
      build(inst);
    } catch (e) {
      inst.out = inst.out || null;
    }
    var raw = inst.trigger;
    inst.trigger = function (t, ev) {
      try { if (!inst.out) return; raw(t == null ? ctx.currentTime : t, ev || {}); } catch (e) {}
    };
    return inst;
  }

  function vel(ev) { var v = ev && typeof ev.vel === 'number' ? ev.vel : 0.8; return clamp(v * (ev && ev.accent ? 1.2 : 1), 0, 1.5); }
  function notesOf(ev, def) {
    if (ev && ev.notes && ev.notes.length) return ev.notes;
    if (ev && typeof ev.midi === 'number') return [ev.midi];
    return [def];
  }

  // ------------------------------------------------------------ the instruments
  var BUILD = {};

  // KICK: sine body with a fast pitch sweep (punch -> tune), a noise click and a short knock, soft-clipped.
  BUILD.kick = {
    spec: { tune: { min: 30, max: 90, value: 45, unit: 'Hz' }, punch: { min: 80, max: 400, value: 170, unit: 'Hz' },
            sweep: { min: 0.01, max: 0.3, value: 0.06, unit: 's' }, decay: { min: 0.05, max: 1.2, value: 0.34, unit: 's' },
            click: { min: 0, max: 1, value: 0.4 }, drive: { min: 0, max: 1, value: 0.35 }, level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst);
        var body = v.osc('sine', P.punch, t, t + P.decay + 0.1);
        expo(body.frequency, P.tune, t + P.sweep);
        var bg = v.gain(0); envDecay(bg.gain, t, g, 0.0015, P.decay);
        body.connect(bg); bg.connect(inst.pre);
        if (P.click > 0) {
          var n = v.noise(t, t + 0.03);
          if (n) {
            var hp = v.filter('highpass', 1800, 0.7), ng = v.gain(0);
            envDecay(ng.gain, t, g * P.click * 0.5, 0.0005, 0.012);
            series([n, hp, ng, inst.pre]);
          }
          var kn = v.osc('triangle', 520, t, t + 0.04), kg = v.gain(0);
          expo(kn.frequency, 90, t + 0.018);
          envDecay(kg.gain, t, g * P.click * 0.45, 0.0005, 0.022);
          kn.connect(kg); kg.connect(inst.pre);
        }
      };
    }
  };

  // SUB: pure sine on the root, plucked on every beat, optional 2nd harmonic for small speakers.
  BUILD.sub = {
    spec: { decay: { min: 0.05, max: 2, value: 0.4, unit: 's' }, attack: { min: 0.001, max: 0.1, value: 0.005, unit: 's' },
            harmonic: { min: 0, max: 1, value: 0.12 }, glide: { min: 0, max: 0.3, value: 0, unit: 's' },
            level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst), f = mtof(notesOf(ev, 35)[0]);
        var cut = (ev.dur && ev.dur < P.decay) ? ev.dur : 0;       // a short gate cuts the pluck early
        var end = t + P.attack + (cut || P.decay) + 0.08;
        var o = v.osc('sine', (P.glide > 0 && inst._lastF) ? inst._lastF : f, t, end);
        if (P.glide > 0 && inst._lastF) expo(o.frequency, f, t + P.glide);
        inst._lastF = f;
        var og = v.gain(0);
        if (cut) {
          setV(og.gain, 0.0001, t); lin(og.gain, g, t + P.attack);
          expo(og.gain, g * Math.pow(0.0001 / g, cut / P.decay), t + P.attack + cut);
          expo(og.gain, 0.0001, t + P.attack + cut + 0.05);
        } else envDecay(og.gain, t, g, P.attack, P.decay);
        o.connect(og); og.connect(inst.pre);
        if (P.harmonic > 0) {
          var h = v.osc('sine', f * 2, t, end), hg = v.gain(0);
          envDecay(hg.gain, t, g * P.harmonic, P.attack, P.decay * 0.6);
          h.connect(hg); hg.connect(inst.pre);
        }
      };
    }
  };

  // BASS: two detuned saws + a square an octave down through a resonant lowpass with a filter envelope.
  BUILD.bass = {
    spec: { cutoff: { min: 60, max: 8000, value: 420, unit: 'Hz' }, env: { min: 0, max: 8000, value: 1400, unit: 'Hz' },
            res: { min: 0.1, max: 20, value: 4 }, attack: { min: 0.001, max: 0.2, value: 0.003, unit: 's' },
            decay: { min: 0.02, max: 1, value: 0.16, unit: 's' }, release: { min: 0.01, max: 1, value: 0.06, unit: 's' },
            detune: { min: 0, max: 50, value: 7, unit: 'ct' }, sub: { min: 0, max: 1, value: 0.35 },
            glide: { min: 0, max: 0.3, value: 0, unit: 's' }, drive: { min: 0, max: 1, value: 0.25 },
            wave: { value: 'sawtooth' }, level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst), f = mtof(notesOf(ev, 35)[0]);
        var hold = ev.dur || 0.12, end = t + P.attack + hold + P.release + 0.05;
        var f0 = (P.glide > 0 && inst._lastF) ? inst._lastF : f;
        var a = v.osc(P.wave, f0, t, end, P.detune), b = v.osc(P.wave, f0, t, end, -P.detune), s = v.osc('square', f0 / 2, t, end);
        if (f0 !== f) { expo(a.frequency, f, t + P.glide); expo(b.frequency, f, t + P.glide); expo(s.frequency, f / 2, t + P.glide); }
        inst._lastF = f;
        var sg = v.gain(P.sub * 0.6), lp = v.filter('lowpass', P.cutoff, P.res), og = v.gain(0);
        setV(lp.frequency, clamp(P.cutoff + P.env * g, 20, 18000), t);
        expo(lp.frequency, P.cutoff, t + P.decay);
        a.connect(lp); b.connect(lp); s.connect(sg); sg.connect(lp);
        envAHR(og.gain, t, g * 0.5, P.attack, hold, P.release);
        lp.connect(og); og.connect(inst.pre);
      };
    }
  };

  // STAB: chord of detuned saw pairs, each pair panned left/right, shared lowpass with envelope, highpassed.
  BUILD.stab = {
    spec: { cutoff: { min: 100, max: 12000, value: 1600, unit: 'Hz' }, env: { min: 0, max: 8000, value: 2200, unit: 'Hz' },
            res: { min: 0.1, max: 12, value: 2 }, attack: { min: 0.001, max: 0.5, value: 0.002, unit: 's' },
            decay: { min: 0.02, max: 1.5, value: 0.18, unit: 's' }, release: { min: 0.01, max: 2, value: 0.08, unit: 's' },
            detune: { min: 0, max: 50, value: 10, unit: 'ct' }, spread: { min: 0, max: 1, value: 0.7 },
            hp: { min: 20, max: 2000, value: 160, unit: 'Hz' }, drive: { min: 0, max: 1, value: 0.1 },
            level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; val(hp.frequency, P.hp); val(hp.Q, 0.7);
      inst._hp = hp;
      // voices -> hp -> pre
      hp.connect(inst.pre);
      inst.onParam = function (n, x) { if (n === 'hp') K.target(hp.frequency, x, ctx.currentTime, 0.02); };
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst), notes = notesOf(ev, 63), i;
        var hold = ev.dur || 0.1, end = t + P.attack + hold + P.release + 0.05;
        var lp = v.filter('lowpass', P.cutoff, P.res), og = v.gain(0);
        setV(lp.frequency, clamp(P.cutoff + P.env * g, 20, 18000), t);
        expo(lp.frequency, P.cutoff, t + P.decay);
        for (i = 0; i < notes.length; i++) {
          var f = mtof(notes[i]), side = (i % 2 ? -1 : 1) * P.spread;
          var a = v.osc('sawtooth', f, t, end, P.detune), b = v.osc('sawtooth', f, t, end, -P.detune);
          var pa = v.pan(side), pb = v.pan(-side);
          var ga = v.gain(0.25 / Math.sqrt(notes.length)), gb = v.gain(0.25 / Math.sqrt(notes.length));
          series([a, ga, pa || lp]); if (pa) pa.connect(lp);
          series([b, gb, pb || lp]); if (pb) pb.connect(lp);
        }
        envAHR(og.gain, t, g, P.attack, hold, P.release);
        lp.connect(og); og.connect(hp);
      };
    }
  };

  // CLAP: three flams of bandpassed noise, a body burst and a darker reverb-like tail.
  BUILD.clap = {
    spec: { tone: { min: 400, max: 6000, value: 1900, unit: 'Hz' }, q: { min: 0.2, max: 6, value: 0.8 },
            decay: { min: 0.03, max: 0.6, value: 0.16, unit: 's' }, flam: { min: 0.004, max: 0.03, value: 0.011, unit: 's' },
            flams: { min: 0, max: 6, value: 3 }, tail: { min: 0, max: 1, value: 0.3 }, tailDecay: { min: 0.05, max: 1.5, value: 0.35, unit: 's' },
            level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst), nf = Math.round(P.flams), i;
        var tb = t + nf * P.flam, n = v.noise(t, tb + P.decay + 0.05);
        if (!n) return;
        var bp = v.filter('bandpass', P.tone, P.q), ng = v.gain(0);
        setV(ng.gain, 0.0001, t);
        for (i = 0; i < nf; i++) { setV(ng.gain, g * 0.7, t + i * P.flam); expo(ng.gain, g * 0.12, t + (i + 1) * P.flam - 0.001); }
        setV(ng.gain, g, tb); expo(ng.gain, 0.0001, tb + P.decay);
        series([n, bp, ng, inst.pre]);
        if (P.tail > 0) {
          var n2 = v.noise(tb, tb + P.tailDecay + 0.05), lp = v.filter('lowpass', 4500, 0.7), tg = v.gain(0);
          if (n2) { envDecay(tg.gain, tb, g * P.tail * 0.5, 0.01, P.tailDecay); series([n2, lp, tg, inst.pre]); }
        }
      };
    }
  };

  // HATS: highpassed noise plus a bank of six square waves through a bandpass (the metallic ring).
  function hatBuild(openHat) {
    return {
      spec: { decay: { min: 0.01, max: 1.5, value: openHat ? 0.26 : 0.055, unit: 's' }, tone: { min: 2000, max: 12000, value: 7200, unit: 'Hz' },
              ring: { min: 400, max: 6000, value: 1500, unit: 'Hz' }, metal: { min: 0, max: 1, value: 0.5 },
              level: { min: 0, max: 1.5, value: 1 } },
      build: function (inst) {
        var ctx = inst.ctx, P = inst.params, R = [0.62, 0.78, 1.0, 1.21, 1.47, 1.73];
        inst.trigger = function (t, ev) {
          var g = vel(ev), v = voice(ctx, inst), end = t + P.decay + 0.05, n = v.noise(t, end), i;
          if (n) {
            var hp = v.filter('highpass', P.tone, 0.7), ng = v.gain(0);
            if (openHat) { setV(ng.gain, 0.0001, t); lin(ng.gain, g * 0.6, t + 0.001); expo(ng.gain, g * 0.2, t + 0.05); expo(ng.gain, 0.0001, t + P.decay); }
            else envDecay(ng.gain, t, g * 0.6, 0.001, P.decay);
            series([n, hp, ng, inst.pre]);
          }
          if (P.metal > 0) {
            var bp = v.filter('bandpass', P.ring, 4), hp2 = v.filter('highpass', P.tone * 0.5, 0.7), mg = v.gain(0);
            for (i = 0; i < R.length; i++) v.osc('square', P.ring * R[i], t, end).connect(bp);
            envDecay(mg.gain, t, g * P.metal * 0.12, 0.001, P.decay * (openHat ? 1 : 0.8));
            series([bp, hp2, mg, inst.pre]);
          }
        };
      }
    };
  }
  BUILD.hat_closed = hatBuild(false);
  BUILD.hat_open = hatBuild(true);

  // SHAKER: short bandpassed noise with a soft attack.
  BUILD.shaker = {
    spec: { tone: { min: 1000, max: 12000, value: 6500, unit: 'Hz' }, q: { min: 0.2, max: 6, value: 1.2 },
            attack: { min: 0.001, max: 0.05, value: 0.006, unit: 's' }, decay: { min: 0.01, max: 0.5, value: 0.07, unit: 's' },
            level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst), n = v.noise(t, t + P.attack + P.decay + 0.05);
        if (!n) return;
        var bp = v.filter('bandpass', P.tone, P.q), ng = v.gain(0);
        envDecay(ng.gain, t, g * 0.5, P.attack, P.decay);
        series([n, bp, ng, inst.pre]);
      };
    }
  };

  // PERC: a tuned blip (pitch drop) with a noise tick, for the breakdown percussion line.
  BUILD.perc = {
    spec: { pitch: { min: 80, max: 2000, value: 380, unit: 'Hz' }, drop: { min: 0.1, max: 1, value: 0.5 },
            decay: { min: 0.02, max: 0.8, value: 0.12, unit: 's' }, noise: { min: 0, max: 1, value: 0.5 },
            level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst);
        var o = v.osc('sine', P.pitch, t, t + P.decay + 0.05), og = v.gain(0);
        expo(o.frequency, P.pitch * P.drop, t + 0.04);
        envDecay(og.gain, t, g * 0.7, 0.001, P.decay);
        o.connect(og); og.connect(inst.pre);
        if (P.noise > 0) {
          var n = v.noise(t, t + 0.06);
          if (n) { var bp = v.filter('bandpass', 2500, 1), ng = v.gain(0); envDecay(ng.gain, t, g * P.noise * 0.4, 0.001, 0.025); series([n, bp, ng, inst.pre]); }
        }
      };
    }
  };

  // LEAD: mono-style detuned saw pair + sub square, resonant lowpass with envelope, portamento between notes.
  BUILD.lead = {
    spec: { cutoff: { min: 100, max: 12000, value: 1400, unit: 'Hz' }, env: { min: 0, max: 8000, value: 2600, unit: 'Hz' },
            res: { min: 0.1, max: 16, value: 3 }, attack: { min: 0.001, max: 0.5, value: 0.012, unit: 's' },
            decay: { min: 0.02, max: 1.5, value: 0.22, unit: 's' }, release: { min: 0.01, max: 2, value: 0.14, unit: 's' },
            detune: { min: 0, max: 50, value: 9, unit: 'ct' }, sub: { min: 0, max: 1, value: 0.25 },
            glide: { min: 0, max: 0.3, value: 0.035, unit: 's' }, drive: { min: 0, max: 1, value: 0.15 },
            wave: { value: 'sawtooth' }, level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst), f = mtof(notesOf(ev, 73)[0]);
        var hold = ev.dur || 0.2, end = t + P.attack + hold + P.release + 0.05;
        var f0 = (P.glide > 0 && inst._lastF) ? inst._lastF : f;
        var a = v.osc(P.wave, f0, t, end, P.detune), b = v.osc(P.wave, f0, t, end, -P.detune), s = v.osc('square', f0 / 2, t, end);
        if (f0 !== f) { expo(a.frequency, f, t + P.glide); expo(b.frequency, f, t + P.glide); expo(s.frequency, f / 2, t + P.glide); }
        inst._lastF = f;
        var sg = v.gain(P.sub * 0.5), lp = v.filter('lowpass', P.cutoff, P.res), og = v.gain(0);
        setV(lp.frequency, clamp(P.cutoff + P.env * g, 20, 18000), t);
        expo(lp.frequency, P.cutoff, t + P.decay);
        a.connect(lp); b.connect(lp); s.connect(sg); sg.connect(lp);
        envAHR(og.gain, t, g * 0.35, P.attack, hold, P.release);
        lp.connect(og); og.connect(inst.pre);
      };
    }
  };

  // PAD: slow detuned saw chords with a gentle pitch LFO, lowpassed.
  BUILD.pad = {
    spec: { attack: { min: 0.01, max: 4, value: 0.5, unit: 's' }, release: { min: 0.05, max: 6, value: 1.0, unit: 's' },
            cutoff: { min: 100, max: 12000, value: 1100, unit: 'Hz' }, detune: { min: 0, max: 50, value: 12, unit: 'ct' },
            lfo: { min: 0, max: 8, value: 0.3, unit: 'Hz' }, depth: { min: 0, max: 50, value: 6, unit: 'ct' },
            level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst), notes = notesOf(ev, 51), i;
        var hold = ev.dur || 1.5, end = t + P.attack + hold + P.release + 0.05;
        var lp = v.filter('lowpass', P.cutoff, 0.8), og = v.gain(0), lfo = null, lg = null;
        if (P.lfo > 0 && P.depth > 0) { lfo = v.osc('sine', P.lfo, t, end); lg = v.gain(P.depth); lfo.connect(lg); }
        for (i = 0; i < notes.length; i++) {
          var f = mtof(notes[i]);
          var a = v.osc('sawtooth', f, t, end, P.detune), b = v.osc('sawtooth', f, t, end, -P.detune);
          var ga = v.gain(0.12 / Math.sqrt(notes.length)), gb = v.gain(0.12 / Math.sqrt(notes.length));
          var pa = v.pan(i % 2 ? -0.5 : 0.5), pb = v.pan(i % 2 ? 0.5 : -0.5);
          if (lg) { try { lg.connect(a.detune); lg.connect(b.detune); } catch (e) {} }
          series([a, ga, pa || lp]); if (pa) pa.connect(lp);
          series([b, gb, pb || lp]); if (pb) pb.connect(lp);
        }
        setV(og.gain, 0.0001, t); lin(og.gain, g, t + P.attack); setV(og.gain, g, t + P.attack + hold); lin(og.gain, 0.0001, t + P.attack + hold + P.release);
        lp.connect(og); og.connect(inst.pre);
      };
    }
  };

  // RISER: noise with a rising bandpass and level over ev.dur seconds, plus a rising saw drone.
  BUILD.riser = {
    spec: { from: { min: 50, max: 5000, value: 300, unit: 'Hz' }, to: { min: 500, max: 16000, value: 7000, unit: 'Hz' },
            q: { min: 0.2, max: 8, value: 1.5 }, tone: { min: 0, max: 1, value: 0.25 }, level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst), d = ev.dur || 4, n = v.noise(t, t + d + 0.1);
        if (n) {
          var bp = v.filter('bandpass', P.from, P.q), ng = v.gain(0);
          expo(bp.frequency, P.to, t + d);
          setV(ng.gain, 0.0001, t); expo(ng.gain, g * 0.6, t + d); setV(ng.gain, g * 0.6, t + d); lin(ng.gain, 0.0001, t + d + 0.03);
          series([n, bp, ng, inst.pre]);
        }
        if (P.tone > 0) {
          var o = v.osc('sawtooth', 55, t, t + d + 0.1), lp = v.filter('lowpass', 200, 2), og = v.gain(0);
          expo(o.frequency, 110, t + d); expo(lp.frequency, 3000, t + d);
          setV(og.gain, 0.0001, t); expo(og.gain, g * P.tone * 0.4, t + d); lin(og.gain, 0.0001, t + d + 0.03);
          series([o, lp, og, inst.pre]);
        }
      };
    }
  };

  // IMPACT: a long sub boom with a dark noise wash for drop downbeats.
  BUILD.impact = {
    spec: { tune: { min: 20, max: 80, value: 38, unit: 'Hz' }, decay: { min: 0.2, max: 4, value: 1.4, unit: 's' },
            wash: { min: 0, max: 1, value: 0.5 }, level: { min: 0, max: 1.5, value: 1 } },
    build: function (inst) {
      var ctx = inst.ctx, P = inst.params;
      inst.trigger = function (t, ev) {
        var g = vel(ev), v = voice(ctx, inst);
        var o = v.osc('sine', 95, t, t + P.decay + 0.1), og = v.gain(0);
        expo(o.frequency, P.tune, t + 0.12);
        envDecay(og.gain, t, g, 0.002, P.decay);
        o.connect(og); og.connect(inst.pre);
        if (P.wash > 0) {
          var n = v.noise(t, t + 0.7);
          if (n) { var lp = v.filter('lowpass', 900, 1), ng = v.gain(0); expo(lp.frequency, 150, t + 0.6); envDecay(ng.gain, t, g * P.wash * 0.5, 0.005, 0.6); series([n, lp, ng, inst.pre]); }
        }
      };
    }
  };

  // ------------------------------------------------------------ API
  var TYPES = [];
  for (var k in BUILD) if (BUILD.hasOwnProperty(k)) TYPES.push(k);

  function create(ctx, type, opts) {
    var def = BUILD[type];
    if (!def) {
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[Synths] unknown instrument "' + type + '"'); } catch (e) {}
      def = { spec: { level: { min: 0, max: 1.5, value: 1 } }, build: function () {} };
      type = 'unknown';
    }
    // deep-copy the spec so instruments never share value objects
    var spec = {};
    for (var p in def.spec) if (def.spec.hasOwnProperty(p)) {
      spec[p] = {};
      for (var q in def.spec[p]) if (def.spec[p].hasOwnProperty(q)) spec[p][q] = def.spec[p][q];
    }
    return makeInst(ctx || null, type, spec, opts, def.build);
  }

  root.Synths = { create: create, types: function () { return TYPES.slice(); }, spec: function (t) { return BUILD[t] ? BUILD[t].spec : null; } };
})();
