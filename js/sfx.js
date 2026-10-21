/* aasssMaster - sfx.js
 * Global `SFX`: fully synthesized Web Audio sound effects + a tiny chiptune sequencer.
 * No files, no network. Every call is a silent no-op until SFX.init() succeeds
 * (and forever if AudioContext is unavailable). Nothing here is allowed to throw.
 */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);

  // ------------------------------------------------------------------ state
  var ctx = null;            // AudioContext
  var master = null;         // master gain (mute lives here)
  var comp = null;           // master compressor / limiter
  var sfxBus = null;         // all sound effects
  var musicBus = null;       // all music
  var noiseBuf = null;       // 2s of white noise
  var muted = false;
  var wantTrack = null;      // track requested before init()/while suspended
  var voices = [];           // live SFX voices, oldest first
  var chargeHandle = null;   // currently active charge handle

  var MASTER_GAIN = 0.5;
  var MUSIC_GAIN = 0.35;     // relative to master; sfx bus is 1.0 so SFX are louder
  var MAX_VOICES = 16;

  function noop() {}

  // ------------------------------------------------------- safe param helpers
  function setV(p, v, t) { try { p.setValueAtTime(v, t); } catch (e) {} }
  function lin(p, v, t) { try { p.linearRampToValueAtTime(v, t); } catch (e) {} }
  function expo(p, v, t) { try { p.exponentialRampToValueAtTime(Math.max(v, 0.0001), t); } catch (e) {} }
  function target(p, v, t, tc) { try { p.setTargetAtTime(v, t, tc); } catch (e) { try { p.value = v; } catch (e2) {} } }
  function val(p, v) { try { p.value = v; } catch (e) {} }
  function cancel(p, t) { try { p.cancelScheduledValues(t); } catch (e) {} }
  function disc(n) { try { if (n) n.disconnect(); } catch (e) {} }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // ------------------------------------------------------------------- init
  function init() {
    try {
      if (!ctx) {
        var AC = root.AudioContext || root.webkitAudioContext ||
          (typeof AudioContext !== 'undefined' ? AudioContext : null) ||
          (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
        if (!AC) return;
        ctx = new AC();
        try {
          comp = ctx.createDynamicsCompressor();
          val(comp.threshold, -14); val(comp.knee, 10); val(comp.ratio, 10);
          val(comp.attack, 0.003); val(comp.release, 0.2);
          master = ctx.createGain();
          val(master.gain, muted ? 0 : MASTER_GAIN);
          sfxBus = ctx.createGain(); val(sfxBus.gain, 1);
          musicBus = ctx.createGain(); val(musicBus.gain, MUSIC_GAIN);
          sfxBus.connect(comp);
          musicBus.connect(comp);
          comp.connect(master);
          master.connect(ctx.destination);
          makeNoise();
        } catch (e) {
          ctx = null; master = null; comp = null; sfxBus = null; musicBus = null; noiseBuf = null;
          return;
        }
      }
      if (ctx.state && ctx.state !== 'running' && ctx.resume) {
        var r = ctx.resume();
        if (r && r.catch) r.catch(noop);
      }
      if (wantTrack && !M.track) startMusic(wantTrack);
    } catch (e) { /* never throw */ }
  }

  function makeNoise() {
    try {
      var sr = ctx.sampleRate || 44100;
      var n = Math.floor(sr * 2);
      var buf = ctx.createBuffer(1, n, sr);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf = buf;
    } catch (e) { noiseBuf = null; }
  }

  function running() { return ctx && (!ctx.state || ctx.state === 'running'); }

  // ------------------------------------------------------------ SFX voices
  // A voice = one play() call: an output gain + every source/node it created.
  // Everything is stopped + disconnected when the last source ends (or on kill).
  function Voice(vol, track) {
    this.srcs = [];
    this.nodes = [];
    this.pending = 0;
    this.dead = false;
    this.out = ctx.createGain();
    val(this.out.gain, vol);
    this.out.connect(sfxBus);
    this.nodes.push(this.out);
    if (track !== false) {
      if (voices.length >= MAX_VOICES) voices.shift().kill();
      voices.push(this);
    }
  }
  Voice.prototype.add = function (src, start, end, nodes, offset) {
    var self = this;
    this.srcs.push(src);
    for (var i = 0; i < nodes.length; i++) if (nodes[i]) this.nodes.push(nodes[i]);
    this.pending++;
    src.onended = function () {
      self.pending--;
      if (self.pending <= 0) self.dispose();
    };
    try { if (offset != null) src.start(start, offset); else src.start(start); } catch (e) {}
    if (end != null) { try { src.stop(end); } catch (e) {} }
  };
  Voice.prototype.stopAll = function (at) {
    for (var i = 0; i < this.srcs.length; i++) { try { this.srcs[i].stop(at); } catch (e) {} }
  };
  Voice.prototype.kill = function () {
    if (this.dead) return;
    var self = this;
    try {
      var now = ctx.currentTime;
      cancel(this.out.gain, now);
      target(this.out.gain, 0, now, 0.004);
      this.stopAll(now + 0.03);
    } catch (e) {}
    removeVoice(this);
    setTimeout(function () { self.dispose(); }, 150);
  };
  Voice.prototype.dispose = function () {
    if (this.dead) return;
    this.dead = true;
    for (var i = 0; i < this.nodes.length; i++) disc(this.nodes[i]);
    this.nodes.length = 0;
    this.srcs.length = 0;
    removeVoice(this);
  };
  function removeVoice(v) {
    var i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
  }

  // oscillator + envelope. o: type,f0,f1,t,dur,vol,a,hold,det,dest,sweep
  function tone(v, o) {
    var osc = ctx.createOscillator(), g = ctx.createGain();
    var t = o.t, d = o.dur, a = o.a || 0.004;
    osc.type = o.type || 'square';
    setV(osc.frequency, o.f0, t);
    if (o.f1 != null && o.f1 !== o.f0) expo(osc.frequency, o.f1, t + d * (o.sweep || 1));
    if (o.det) val(osc.detune, o.det);
    setV(g.gain, 0.0001, t);
    lin(g.gain, o.vol, t + a);
    if (o.hold) setV(g.gain, o.vol, t + d * o.hold);
    expo(g.gain, 0.0001, t + d);
    osc.connect(g);
    g.connect(o.dest || v.out);
    v.add(osc, t, t + d + 0.03, [osc, g]);
    return { osc: osc, gain: g };
  }

  // white noise + optional biquad + envelope. o: t,dur,vol,a,ftype,f0,f1,q,dest,noenv
  function noise(v, o) {
    if (!noiseBuf) return null;
    var s = ctx.createBufferSource(), g = ctx.createGain(), f = null;
    var t = o.t, d = o.dur;
    s.buffer = noiseBuf;
    s.loop = true;
    if (o.ftype) {
      f = ctx.createBiquadFilter();
      f.type = o.ftype;
      setV(f.frequency, o.f0, t);
      if (o.f1 != null) expo(f.frequency, o.f1, t + d);
      val(f.Q, o.q || 1);
      s.connect(f); f.connect(g);
    } else {
      s.connect(g);
    }
    if (!o.noenv) {
      setV(g.gain, 0.0001, t);
      lin(g.gain, o.vol, t + (o.a || 0.002));
      expo(g.gain, 0.0001, t + d);
    }
    g.connect(o.dest || v.out);
    v.add(s, t, t + d + 0.03, [s, f, g], Math.random() * 1.5);
    return { src: s, gain: g, filter: f };
  }

  // LFO: osc -> gain(depth) -> param
  function lfo(v, type, rate, depth, param, t, end) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    setV(o.frequency, rate, t);
    val(g.gain, depth);
    o.connect(g); g.connect(param);
    v.add(o, t, end, [o, g]);
    return { osc: o, gain: g };
  }

  // ------------------------------------------------------------ SFX recipes
  // signature: (voice, startTime, pitchMultiplier)
  var SND = {
    shoot: function (v, t, p) {
      tone(v, { type: 'square', f0: 980 * p, f1: 180 * p, t: t, dur: 0.11, vol: 0.26, a: 0.002 });
      tone(v, { type: 'square', f0: 1960 * p, f1: 360 * p, t: t, dur: 0.05, vol: 0.08, a: 0.001 });
    },

    shoot_charged: function (v, t, p) {
      tone(v, { type: 'sawtooth', f0: 520 * p, f1: 55 * p, t: t, dur: 0.55, vol: 0.30, a: 0.004 });
      tone(v, { type: 'sawtooth', f0: 530 * p, f1: 58 * p, t: t, dur: 0.50, vol: 0.18, a: 0.004, det: 18 });
      noise(v, { t: t, dur: 0.6, vol: 0.38, ftype: 'lowpass', f0: 5000, f1: 200, q: 1 });
      tone(v, { type: 'sine', f0: 110 * p, f1: 38 * p, t: t, dur: 0.7, vol: 0.65, a: 0.005 });
    },

    hit: function (v, t, p) {
      noise(v, { t: t, dur: 0.05, vol: 0.32, ftype: 'highpass', f0: 2000 });
      tone(v, { type: 'square', f0: 260 * p, f1: 120 * p, t: t, dur: 0.04, vol: 0.12, a: 0.001 });
    },

    enemy_die: function (v, t, p) {
      noise(v, { t: t, dur: 0.28, vol: 0.42, ftype: 'bandpass', f0: 3000, f1: 300, q: 1.2 });
      tone(v, { type: 'square', f0: 520 * p, f1: 50 * p, t: t, dur: 0.32, vol: 0.22, a: 0.002 });
    },

    enemy_die_big: function (v, t, p) {
      noise(v, { t: t, dur: 0.9, vol: 0.62, a: 0.005, ftype: 'lowpass', f0: 1800, f1: 90, q: 0.8 });
      noise(v, { t: t + 0.12, dur: 0.35, vol: 0.28, ftype: 'bandpass', f0: 2400, f1: 200, q: 1 });
      tone(v, { type: 'sawtooth', f0: 150 * p, f1: 30 * p, t: t, dur: 0.9, vol: 0.33 });
      tone(v, { type: 'sine', f0: 70 * p, f1: 28 * p, t: t, dur: 1.0, vol: 0.55 });
    },

    player_die: function (v, t, p) {
      tone(v, { type: 'sawtooth', f0: 700 * p, f1: 35 * p, t: t, dur: 1.3, vol: 0.28, a: 0.005 });
      tone(v, { type: 'sawtooth', f0: 712 * p, f1: 40 * p, t: t, dur: 1.25, vol: 0.18, a: 0.005, det: 20 });
      tone(v, { type: 'square', f0: 350 * p, f1: 25 * p, t: t, dur: 1.1, vol: 0.12 });
      noise(v, { t: t, dur: 0.35, vol: 0.4, ftype: 'lowpass', f0: 3000, f1: 300 });
      // crackle: gated noise with random on/off steps and a decaying level
      var n = noise(v, { t: t + 0.05, dur: 1.0, vol: 0, noenv: true, ftype: 'highpass', f0: 1200 });
      if (n) {
        var steps = 28;
        setV(n.gain.gain, 0, t);
        for (var i = 0; i < steps; i++) {
          var lvl = Math.random() < 0.55 ? rnd(0.1, 0.4) * (1 - i / steps) : 0;
          setV(n.gain.gain, lvl, t + 0.05 + i * 0.035);
        }
        setV(n.gain.gain, 0, t + 1.05);
      }
    },

    boss_hit: function (v, t, p) {
      tone(v, { type: 'square', f0: 440 * p, f1: 430 * p, t: t, dur: 0.38, vol: 0.18, a: 0.002 });
      tone(v, { type: 'square', f0: 466 * p, f1: 455 * p, t: t, dur: 0.34, vol: 0.16, a: 0.002 });
      tone(v, { type: 'square', f0: 1175 * p, t: t, dur: 0.22, vol: 0.08, a: 0.001 });
      tone(v, { type: 'square', f0: 1245 * p, t: t, dur: 0.2, vol: 0.07, a: 0.001 });
      noise(v, { t: t, dur: 0.12, vol: 0.28, ftype: 'bandpass', f0: 4000, q: 4 });
    },

    boss_die: function (v, t, p) {
      noise(v, { t: t, dur: 2.3, vol: 0.55, a: 0.05, ftype: 'lowpass', f0: 260, f1: 60, q: 0.7 });
      tone(v, { type: 'sine', f0: 60 * p, f1: 25 * p, t: t, dur: 2.3, vol: 0.55, a: 0.05 });
      var times = [0, 0.18, 0.42, 0.7, 1.0, 1.35, 1.75];
      for (var i = 0; i < times.length; i++) {
        var tt = t + times[i], last = (i === times.length - 1);
        noise(v, { t: tt, dur: last ? 0.9 : 0.3 + i * 0.03, vol: last ? 0.7 : 0.38 + i * 0.04,
                   ftype: 'lowpass', f0: 2400 - i * 150, f1: 120, q: 0.8 });
        tone(v, { type: 'sawtooth', f0: (220 - i * 14) * p, f1: 36 * p, t: tt, dur: last ? 0.8 : 0.4,
                  vol: last ? 0.4 : 0.25 });
      }
    },

    boss_roar: function (v, t, p) {
      var d = 1.0;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      setV(lp.frequency, 500, t); lin(lp.frequency, 900, t + 0.35); expo(lp.frequency, 250, t + d);
      val(lp.Q, 3);
      var amp = ctx.createGain();
      setV(amp.gain, 0.0001, t); lin(amp.gain, 0.5, t + 0.12);
      setV(amp.gain, 0.5, t + d * 0.7); expo(amp.gain, 0.0001, t + d);
      lp.connect(amp); amp.connect(v.out);
      v.nodes.push(lp, amp);
      var a = tone(v, { type: 'sawtooth', f0: 95 * p, f1: 55 * p, t: t, dur: d, vol: 0.5, a: 0.01, dest: lp });
      var b = tone(v, { type: 'sawtooth', f0: 98 * p, f1: 58 * p, t: t, dur: d, vol: 0.4, a: 0.01, dest: lp, det: 14 });
      lfo(v, 'sine', 6.5, 9 * p, a.osc.frequency, t, t + d + 0.03);   // vibrato
      lfo(v, 'sine', 6.5, 9 * p, b.osc.frequency, t, t + d + 0.03);
      var growl = lfo(v, 'square', 32, 0.35, amp.gain, t, t + d + 0.03); // growl AM
      noise(v, { t: t, dur: d, vol: 0.12, a: 0.1, ftype: 'lowpass', f0: 700, q: 1 });
      return growl;
    },

    swallow: function (v, t, p) {
      noise(v, { t: t, dur: 0.55, vol: 0.5, a: 0.02, ftype: 'lowpass', f0: 1800, f1: 200, q: 9 });
      tone(v, { type: 'sine', f0: 420 * p, f1: 130 * p, t: t + 0.02, dur: 0.2, vol: 0.45, a: 0.01 });
      tone(v, { type: 'sine', f0: 360 * p, f1: 110 * p, t: t + 0.27, dur: 0.24, vol: 0.45, a: 0.01 });
      noise(v, { t: t + 0.25, dur: 0.25, vol: 0.2, ftype: 'bandpass', f0: 900, f1: 250, q: 6 });
      tone(v, { type: 'sine', f0: 700 * p, f1: 300 * p, t: t + 0.5, dur: 0.07, vol: 0.2 });
    },

    powerup: function (v, t, p) {
      var f = [523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < f.length; i++) {
        tone(v, { type: 'square', f0: f[i] * p, t: t + i * 0.07, dur: i === 3 ? 0.22 : 0.1, vol: 0.2, a: 0.003 });
        tone(v, { type: 'triangle', f0: f[i] * 2 * p, t: t + i * 0.07, dur: i === 3 ? 0.22 : 0.1, vol: 0.12, a: 0.003 });
      }
    },

    shield_up: function (v, t, p) {
      var a = tone(v, { type: 'sine', f0: 400 * p, f1: 1600 * p, t: t, dur: 0.45, vol: 0.3, a: 0.03, hold: 0.6 });
      var b = tone(v, { type: 'sine', f0: 600 * p, f1: 2400 * p, t: t, dur: 0.45, vol: 0.14, a: 0.03, hold: 0.6 });
      lfo(v, 'sine', 14, 40 * p, a.osc.frequency, t, t + 0.48);
      lfo(v, 'sine', 17, 60 * p, b.osc.frequency, t, t + 0.48);
    },

    shield_break: function (v, t, p) {
      noise(v, { t: t, dur: 0.22, vol: 0.45, ftype: 'highpass', f0: 3000, q: 1 });
      noise(v, { t: t, dur: 0.1, vol: 0.3, ftype: 'bandpass', f0: 6000, q: 3 });
      for (var i = 0; i < 5; i++) {
        tone(v, { type: 'sine', f0: rnd(3200, 6500) * p, t: t + rnd(0, 0.18), dur: 0.05, vol: 0.12, a: 0.001 });
      }
    },

    option_get: function (v, t, p) {
      tone(v, { type: 'square', f0: 1318.5 * p, t: t, dur: 0.07, vol: 0.2, a: 0.002 });
      tone(v, { type: 'triangle', f0: 2637 * p, t: t, dur: 0.07, vol: 0.1, a: 0.002 });
      tone(v, { type: 'square', f0: 1975.5 * p, t: t + 0.07, dur: 0.14, vol: 0.2, a: 0.002 });
      tone(v, { type: 'triangle', f0: 3951 * p, t: t + 0.07, dur: 0.14, vol: 0.1, a: 0.002 });
    },

    wave_warning: function (v, t, p) {
      for (var i = 0; i < 6; i++) {
        tone(v, { type: 'square', f0: (i % 2 ? 660 : 880) * p, t: t + i * 0.19, dur: 0.17, vol: 0.22, a: 0.004, hold: 0.8 });
      }
    },

    menu_move: function (v, t, p) {
      tone(v, { type: 'square', f0: 660 * p, t: t, dur: 0.04, vol: 0.15, a: 0.002 });
    },

    menu_select: function (v, t, p) {
      tone(v, { type: 'square', f0: 660 * p, t: t, dur: 0.06, vol: 0.2, a: 0.002 });
      tone(v, { type: 'square', f0: 990 * p, t: t + 0.06, dur: 0.12, vol: 0.2, a: 0.002 });
    },

    pause: function (v, t, p) {
      tone(v, { type: 'square', f0: 600 * p, f1: 300 * p, t: t, dur: 0.1, vol: 0.18, a: 0.002 });
    },

    extra_life: function (v, t, p) {
      var f = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      for (var i = 0; i < f.length; i++) {
        var last = i === f.length - 1;
        tone(v, { type: 'square', f0: f[i] * p, t: t + i * 0.075, dur: last ? 0.4 : 0.09, vol: 0.2, a: 0.003, hold: last ? 0.5 : 0 });
        tone(v, { type: 'triangle', f0: f[i] * p * 2, t: t + i * 0.075, dur: last ? 0.4 : 0.09, vol: 0.12, a: 0.003 });
      }
    },

    fart: function (v, t, p) {
      var d = rnd(0.25, 0.5);
      var base = rnd(70, 150) * p;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      setV(lp.frequency, rnd(350, 550), t); expo(lp.frequency, 160, t + d);
      val(lp.Q, rnd(2, 6));
      var amp = ctx.createGain();
      setV(amp.gain, 0.0001, t); lin(amp.gain, 0.6, t + 0.015);
      // stuttering tail
      var n = Math.floor(d / 0.04);
      for (var k = 1; k < n; k++) {
        var env = 1 - k / n;
        setV(amp.gain, 0.6 * env * (Math.random() < 0.15 ? 0.4 : 1), t + k * 0.04);
      }
      expo(amp.gain, 0.0001, t + d);
      lp.connect(amp); amp.connect(v.out);
      v.nodes.push(lp, amp);
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      // randomized wobbling pitch that sags over time
      var steps = Math.floor(d / 0.025);
      for (var i = 0; i <= steps; i++) {
        var f = base * (1 - 0.3 * (i / steps)) * (1 + (Math.random() - 0.5) * 0.25);
        setV(o.frequency, f, t + i * 0.025);
      }
      o.connect(lp);
      v.add(o, t, t + d + 0.03, [o]);
      lfo(v, 'sine', rnd(20, 40), base * 0.18, o.frequency, t, t + d + 0.03);
      noise(v, { t: t, dur: d, vol: 0.25, ftype: 'lowpass', f0: 500, f1: 150, q: 1, a: 0.01, dest: lp });
    }
  };

  // ----------------------------------------------------------------- charge
  function startCharge(vol, p) {
    if (chargeHandle) chargeHandle.stop();
    var v = new Voice(vol, false);
    var t = ctx.currentTime + 0.005, rise = 1.5;
    var g1 = ctx.createGain(), g2 = ctx.createGain();
    var o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'triangle'; o2.type = 'square';
    setV(o1.frequency, 200 * p, t); expo(o1.frequency, 1100 * p, t + rise);
    setV(o2.frequency, 300 * p, t); expo(o2.frequency, 1650 * p, t + rise);
    setV(g1.gain, 0.02, t); lin(g1.gain, 0.24, t + rise);
    setV(g2.gain, 0.005, t); lin(g2.gain, 0.07, t + rise);
    o1.connect(g1); g1.connect(v.out);
    o2.connect(g2); g2.connect(v.out);
    v.add(o1, t, null, [o1, g1]);
    v.add(o2, t, null, [o2, g2]);
    var l = lfo(v, 'sine', 14, 10, o1.frequency, t, null);   // growing vibrato
    lin(l.gain.gain, 90, t + rise);
    var stopped = false, timer = null;
    var h = {
      stop: function () {
        if (stopped) return;
        stopped = true;
        if (timer) clearTimeout(timer);
        if (chargeHandle === h) chargeHandle = null;
        try {
          var now = ctx.currentTime;
          cancel(v.out.gain, now);
          target(v.out.gain, 0, now, 0.015);
          v.stopAll(now + 0.1);
        } catch (e) {}
        setTimeout(function () { v.dispose(); }, 250);
      }
    };
    timer = setTimeout(h.stop, 15000); // safety: never leave a drone running
    chargeHandle = h;
    return h;
  }

  // ------------------------------------------------------------------- play
  function play(name, opts) {
    var isCharge = (name === 'charge');
    try {
      if (!ctx || muted || !running()) return isCharge ? { stop: noop } : undefined;
      if (!isCharge && !SND.hasOwnProperty(name)) return undefined;
      var vol = (opts && typeof opts.volume === 'number') ? Math.max(0, Math.min(1.5, opts.volume)) : 1;
      var p = (opts && typeof opts.pitch === 'number' && opts.pitch > 0) ? opts.pitch : 1;
      if (isCharge) return startCharge(vol, p);
      var v = new Voice(vol);
      SND[name](v, ctx.currentTime + 0.005, p);
      return undefined;
    } catch (e) {
      return isCharge ? { stop: noop } : undefined;
    }
  }

  function setMuted(m) {
    muted = !!m;
    try {
      if (master) {
        var now = ctx.currentTime;
        cancel(master.gain, now);
        target(master.gain, muted ? 0 : MASTER_GAIN, now, 0.01);
      }
      if (muted) {
        if (chargeHandle) chargeHandle.stop();
        for (var i = voices.length - 1; i >= 0; i--) voices[i].kill();
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------ music
  // Notation. Chords: one name per bar ("Am", "F", "Bb", "Edim"). Lead: one string per bar of 8
  // eighth-note tokens: note name ("A4", "C#5"), "." rest, "-" sustain previous note.
  // Patterns are 16 sixteenth-step tokens: bass = semitone offset from chord root, arp = chord-tone
  // index (0-2 = chord tones, 3 = root + octave), "." = nothing. Drums: 16 chars, x/o hit, . none.
  var CH_Q = { '': [0, 4, 7], 'm': [0, 3, 7], 'dim': [0, 3, 6] };
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  var TRACKS = {
    title: {
      bpm: 76, loop: true,
      prog: 'Dm Bb Gm A Dm F Gm A',
      lead: [
        'A4 - - - F4 - A4 -', 'D5 - - - C5 - Bb4 -', 'Bb4 - - - D5 - G5 -', 'F5 - E5 - C#5 - E5 -',
        'D5 - F5 - A5 - - -', 'A5 - G5 - F5 - C5 -', 'Bb4 - D5 - G5 - F5 D5', 'E5 - C#5 - A4 - - .'
      ],
      bass: { wave: 'triangle', vol: 0.30, len: 7, shape: 'hold', pat: '0 . . . . . . . . . . . 0 . . .' },
      arp: { wave: 'triangle', vol: 0.10, len: 2.2, oct: 12, pat: '0 . 1 . 2 . 3 . 2 . 1 . 2 . 1 .' },
      pad: { wave: 'triangle', vol: 0.045 },
      leadv: { wave: 'square', vol: 0.07, shape: 'hold' },
      drums: { kick: 'x.......x.......', snare: '................', hat: '....o.......o...', kv: 0.6, hv: 0.5 }
    },

    stage: {
      bpm: 150, loop: true,
      prog: 'Am F C G Am F C E Dm Dm Am Am F G Am E',
      lead: [
        'A4 . C5 E5 A5 - G5 E5', 'F5 - E5 C5 A4 - C5 -', 'G4 . C5 E5 G5 - E5 C5', 'D5 - B4 G4 B4 D5 G5 -',
        'A4 . C5 E5 A5 - B5 C6', 'A5 - F5 - C5 - A4 -', 'G5 - E5 G5 C6 - B5 G5', 'E5 - G#5 - B5 - G#5 E5',
        'D5 - F5 - A5 - F5 D5', 'E5 - F5 A5 D6 - C6 A5', 'C6 - B5 A5 E5 - A5 -', 'A5 - C6 - E6 - C6 A5',
        'F5 - A5 - C6 - A5 F5', 'G5 - B5 - D6 - B5 G5', 'A5 C6 E6 C6 A5 E5 C5 E5', 'G#5 - B5 - E6 - D6 B5'
      ],
      bass: { wave: 'triangle', vol: 0.34, len: 1.6, shape: 'pluck', pat: '0 . 0 . 12 . 0 . 0 . 0 . 12 . 7 .' },
      arp: { wave: 'square', vol: 0.06, len: 1.3, oct: 12, pat: '0 1 2 3 2 1 2 1 0 1 2 3 2 1 2 3' },
      leadv: { wave: 'square', vol: 0.09, shape: 'hold' },
      drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', kv: 0.9, sv: 0.6, hv: 0.5,
               fill: '....x...x.x.xxxx' }
    },

    boss: {
      bpm: 165, loop: true,
      prog: 'Em Em F Em Em Em C B Em F Em F C D F B',
      lead: [
        'E5 E5 G5 E5 B5 - A5 G5', 'E5 E5 G5 E5 D6 - B5 -', 'F5 F5 A5 F5 C6 - A5 -', 'G5 B5 E6 - D6 B5 G5 E5',
        'E5 E5 G5 E5 B5 - A5 G5', 'B5 - A5 - G5 - F#5 -', 'E5 G5 C6 - B5 G5 E5 G5', 'D#5 F#5 B5 - A5 F#5 D#5 -',
        'E6 - D6 B5 G5 - B5 -', 'F6 - E6 C6 A5 - C6 -', 'E6 - B5 G5 B5 - E6 -', 'C6 A5 F5 A5 C6 F6 E6 C6',
        'G5 C6 E6 - D6 C6 G5 -', 'F#5 A5 D6 - C6 A5 F#5 A5', 'A5 C6 F6 - E6 C6 A5 C6', 'D#6 - B5 - F#5 - D#5 .'
      ],
      bass: { wave: 'sawtooth', vol: 0.22, len: 1.0, shape: 'pluck', pat: '0 0 12 0 0 0 12 0 0 0 12 0 0 7 0 12' },
      arp: { wave: 'square', vol: 0.055, len: 1.1, oct: 0, pat: '0 1 2 3 2 1 2 3 0 1 2 3 2 1 2 1' },
      leadv: { wave: 'sawtooth', vol: 0.09, shape: 'hold' },
      drums: { kick: 'x..xx..xx..xx.x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', kv: 0.95, sv: 0.65, hv: 0.4,
               fill: '....x..xx.x.xxxx' }
    },

    gameover: {
      bpm: 84, loop: false,
      prog: 'Am F Dm Am',
      lead: [
        'E5 - D5 - C5 - B4 -', 'C5 - A4 - G4 - F4 -', 'F4 - E4 - D4 - - -', 'E4 - - - A3 - - -'
      ],
      bass: { wave: 'triangle', vol: 0.3, len: 7, shape: 'hold', pat: '0 . . . . . . . . . . . . . . .' },
      pad: { wave: 'triangle', vol: 0.05 },
      leadv: { wave: 'square', vol: 0.09, shape: 'hold' },
      drums: { kick: 'x...............', snare: '................', hat: '................', kv: 0.5 }
    }
  };

  function parsePat(str) {
    var tk = str.split(/\s+/), out = [];
    for (var i = 0; i < 16; i++) out.push(tk[i] == null || tk[i] === '.' ? null : Number(tk[i]));
    return out;
  }
  function parseNote(s) {
    var m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
    if (!m) return null;
    var semi = PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 12 * (parseInt(m[3], 10) + 1) + semi;
  }
  function parseChord(s) {
    var m = /^([A-G])([#b]?)(m|dim|)$/.exec(s);
    var pc = PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    var iv = CH_Q[m[3]];
    return { root: 48 + ((pc + 12) % 12), ivs: iv, tones: [iv[0], iv[1], iv[2], iv[0] + 12] };
  }
  function compile(d) {
    d.chords = d.prog.split(/\s+/).map(parseChord);
    d.bars = d.chords.length;
    d.steps = d.bars * 16;
    d.sd = 60 / d.bpm / 4;
    d.leadEv = [];
    var last = null;
    for (var b = 0; b < d.bars; b++) {
      var tk = (d.lead[b] || '').split(/\s+/);
      for (var i = 0; i < 8; i++) {
        var tok = tk[i];
        if (tok === '-') { if (last) last.len += 2; continue; }
        last = null;
        if (!tok || tok === '.') continue;
        var m = parseNote(tok);
        if (m == null) continue;
        last = { midi: m, len: 2 };
        d.leadEv[b * 16 + i * 2] = last;
      }
    }
    if (d.bass) d.bass.p = parsePat(d.bass.pat);
    if (d.arp) d.arp.p = parsePat(d.arp.pat);
    return d;
  }
  for (var tn in TRACKS) if (TRACKS.hasOwnProperty(tn)) compile(TRACKS[tn]);

  var M = { track: null, def: null, step: 0, nextTime: 0, timer: null, intensity: 0.8, session: null, endAt: 0 };

  function startMusic(name) {
    try {
      if (!TRACKS.hasOwnProperty(name)) return;
      wantTrack = name;
      if (!ctx) return;                 // will start from init()
      if (M.track === name) return;     // same track: no-op
      stopMusicInternal();
      var bus = ctx.createGain(), lead = ctx.createGain();
      val(bus.gain, 1);
      val(lead.gain, M.intensity);
      lead.connect(bus); bus.connect(musicBus);
      M.session = { bus: bus, lead: lead, srcs: [] };
      M.track = name;
      M.def = TRACKS[name];
      M.step = 0;
      M.endAt = 0;
      M.nextTime = ctx.currentTime + 0.06;
      M.timer = setInterval(tick, 25);
      tick();
    } catch (e) {}
  }

  function stopMusicInternal() {
    if (M.timer) { clearInterval(M.timer); M.timer = null; }
    var S = M.session;
    M.session = null;
    M.track = null;
    M.def = null;
    if (S) {
      try {
        var now = ctx.currentTime;
        cancel(S.bus.gain, now);
        target(S.bus.gain, 0, now, 0.02);
        for (var i = 0; i < S.srcs.length; i++) { try { S.srcs[i].stop(now + 0.08); } catch (e) {} }
      } catch (e) {}
      setTimeout(function () { disc(S.lead); disc(S.bus); }, 400);
    }
  }

  function stopMusic() {
    wantTrack = null;
    try { stopMusicInternal(); } catch (e) {}
  }

  function setIntensity(x) {
    try {
      x = Math.max(0, Math.min(1, Number(x)));
      if (x !== x) return;
      M.intensity = x;
      if (M.session && ctx) target(M.session.lead.gain, x, ctx.currentTime, 0.05);
    } catch (e) {}
  }

  function tick() {
    try {
      if (!ctx || !M.def || !running()) return;
      var d = M.def;
      if (M.nextTime < ctx.currentTime - 0.25) M.nextTime = ctx.currentTime + 0.05; // tab was throttled: don't burst
      if (M.endAt) {                                   // non-looping track finished, waiting for the tail
        if (ctx.currentTime >= M.endAt) { wantTrack = null; stopMusicInternal(); }
        return;
      }
      while (M.nextTime < ctx.currentTime + 0.1) {
        if (M.step >= d.steps) {
          if (d.loop) { M.step = 0; }
          else { M.endAt = M.nextTime + 2.5; return; }
        }
        if (!muted) scheduleStep(d, M.step, M.nextTime);
        M.step++;
        M.nextTime += d.sd;
      }
    } catch (e) {}
  }

  function scheduleStep(d, s, t) {
    var bar = (s / 16) | 0, st = s % 16, ch = d.chords[bar], sd = d.sd, S = M.session, bus = S.bus;
    var b = d.bass, a = d.arp, i;
    if (b) {
      var off = b.p[st];
      if (off != null) mNote(b.wave, ch.root - 12 + off, t, sd * b.len, b.vol, bus, b.shape);
    }
    if (a) {
      var idx = a.p[st];
      if (idx != null) mNote(a.wave, ch.root + a.oct + ch.tones[idx], t, sd * a.len, a.vol, bus, 'pluck');
    }
    if (d.pad && st === 0) {
      for (i = 0; i < 3; i++) mNote(d.pad.wave, ch.root + ch.ivs[i], t, sd * 15.5, d.pad.vol, bus, 'hold', 0.25);
    }
    var ev = d.leadEv[s];
    if (ev && d.leadv) mNote(d.leadv.wave, ev.midi, t, sd * ev.len * 0.95, d.leadv.vol, S.lead, d.leadv.shape);
    var dr = d.drums;
    if (dr) {
      var fillBar = dr.fill && (bar % 8 === 7);
      if (dr.kick.charAt(st) === 'x') mKick(t, dr.kv || 0.8, bus);
      var sn = fillBar ? dr.fill : dr.snare;
      if (sn.charAt(st) === 'x') mSnare(t, dr.sv || 0.5, bus);
      var h = dr.hat.charAt(st);
      if (h === 'x') mHat(t, (dr.hv || 0.4) * 0.6, false, bus);
      else if (h === 'o') mHat(t, dr.hv || 0.4, true, bus);
    }
  }

  // one music note: osc -> env gain -> bus
  function mNote(type, midi, t, dur, vol, dest, shape, att) {
    var S = M.session;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    setV(o.frequency, mtof(midi), t);
    setV(g.gain, 0.0001, t);
    lin(g.gain, vol, t + (att || 0.006));
    if (shape === 'hold') setV(g.gain, vol, t + dur * 0.65);
    expo(g.gain, 0.0001, t + dur);
    o.connect(g); g.connect(dest);
    trackSrc(S, o, [o, g]);
    try { o.start(t); o.stop(t + dur + 0.03); } catch (e) {}
  }

  function trackSrc(S, src, nodes) {
    S.srcs.push(src);
    src.onended = function () {
      var i = S.srcs.indexOf(src);
      if (i >= 0) S.srcs.splice(i, 1);
      for (var k = 0; k < nodes.length; k++) disc(nodes[k]);
    };
  }

  function mNoise(t, dur, vol, ftype, f0, f1, q, dest) {
    if (!noiseBuf) return;
    var S = M.session;
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = ftype; setV(f.frequency, f0, t);
    if (f1) expo(f.frequency, f1, t + dur);
    val(f.Q, q || 1);
    setV(g.gain, 0.0001, t); lin(g.gain, vol, t + 0.002); expo(g.gain, 0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    trackSrc(S, s, [s, f, g]);
    try { s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.03); } catch (e) {}
  }

  function mKick(t, vol, dest) {
    var S = M.session;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    setV(o.frequency, 160, t); expo(o.frequency, 42, t + 0.13);
    setV(g.gain, vol, t); expo(g.gain, 0.0001, t + 0.2);
    o.connect(g); g.connect(dest);
    trackSrc(S, o, [o, g]);
    try { o.start(t); o.stop(t + 0.23); } catch (e) {}
  }

  function mSnare(t, vol, dest) {
    mNoise(t, 0.13, vol, 'bandpass', 1900, 1200, 0.8, dest);
    var S = M.session;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    setV(o.frequency, 230, t); expo(o.frequency, 120, t + 0.08);
    setV(g.gain, vol * 0.5, t); expo(g.gain, 0.0001, t + 0.09);
    o.connect(g); g.connect(dest);
    trackSrc(S, o, [o, g]);
    try { o.start(t); o.stop(t + 0.12); } catch (e) {}
  }

  function mHat(t, vol, open, dest) {
    mNoise(t, open ? 0.09 : 0.03, vol * 0.5, 'highpass', 7500, 0, 1, dest);
  }

  // -------------------------------------------------------------------- API
  var SFX = {
    init: init,
    play: play,
    setMuted: setMuted,
    music: {
      start: startMusic,
      stop: stopMusic,
      setIntensity: setIntensity
    },
    _tracks: TRACKS   // read-only introspection (tests / tooling)
  };
  Object.defineProperty(SFX, 'muted', {
    enumerable: true,
    get: function () { return muted; },
    set: function (m) { setMuted(m); }
  });

  root.SFX = SFX;
})();
