/* aasssMaster v2 - sfx.js
 * Global `SFX`: fully synthesized Web Audio sound effects + a layered chiptune sequencer.
 * No files, no network. Every call is a silent no-op until SFX.init() succeeds
 * (and forever if AudioContext is unavailable). Nothing here is allowed to throw.
 *
 * API (see team/round3-SOUND.md):
 *   SFX.init()  SFX.play(name, {volume, pitch, x, variant}) -> handle (charge/laser/gas_loop) | undefined
 *   SFX.setMuted(b) SFX.muted  SFX.stopLoops()  SFX.setVolume({master,music,sfx})  SFX.hasTrack(n)  SFX.tracks()
 *   SFX.music.{start,stop,pause,resume,setIntensity,setPhase,setDanger,stinger,duck,setRate}
 *   handle = {stop(fadeSec), setLevel(n), setVolume(v), setX(x)}  (never null; no-op object when silent)
 */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);

  // ------------------------------------------------------------------ state
  var ctx = null;            // AudioContext
  var master = null;         // master gain (mute lives here)
  var comp = null;           // master compressor / limiter
  var sfxBus = null;         // all sound effects
  var musicBus = null;       // all music (static level)
  var musicLP = null;        // music lowpass (danger / pause / slow-mo)
  var duckGain = null;       // music ducking
  var noiseBuf = null;       // 2s of white noise
  var muted = false;
  var wantTrack = null;      // track requested before init()/while suspended
  var voices = [];           // live tracked SFX voices, oldest first
  var loops = [];            // live loop handles (charge / laser / gas_loop)
  var visBound = false;
  var warned = {};
  var vol = { master: 1, music: 1, sfx: 1 };

  var MASTER_GAIN = 0.5;
  var MUSIC_GAIN = 0.35;     // relative to master; sfx bus is 1.0 so SFX are louder
  var MAX_VOICES = 20;

  function noop() {}
  function noopHandle() { return { stop: noop, setLevel: noop, setVolume: noop, setX: noop }; }
  function warnOnce(kind, name) {
    var k = kind + ':' + name;
    if (warned[k]) return;
    warned[k] = true;
    try { if (typeof console !== 'undefined' && console.warn) console.warn('[SFX] unknown ' + kind + ' "' + name + '"'); } catch (e) {}
  }

  // ------------------------------------------------------- safe param helpers
  function setV(p, v, t) { try { p.setValueAtTime(v, t); } catch (e) {} }
  function lin(p, v, t) { try { p.linearRampToValueAtTime(v, t); } catch (e) {} }
  function expo(p, v, t) { try { p.exponentialRampToValueAtTime(Math.max(v, 0.0001), t); } catch (e) {} }
  function target(p, v, t, tc) { try { p.setTargetAtTime(v, t, tc); } catch (e) { try { p.value = v; } catch (e2) {} } }
  function val(p, v) { try { p.value = v; } catch (e) {} }
  function cancel(p, t) { try { p.cancelScheduledValues(t); } catch (e) {} }
  function disc(n) { try { if (n) n.disconnect(); } catch (e) {} }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function panFromX(x) { return clamp((x - 192) / 220, -0.8, 0.8); }

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
          val(master.gain, muted ? 0 : MASTER_GAIN * vol.master);
          sfxBus = ctx.createGain(); val(sfxBus.gain, vol.sfx);
          musicBus = ctx.createGain(); val(musicBus.gain, MUSIC_GAIN * vol.music);
          musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; val(musicLP.frequency, 20000); val(musicLP.Q, 0.7);
          duckGain = ctx.createGain(); val(duckGain.gain, 1);
          duckGain.connect(musicLP);
          musicLP.connect(musicBus);
          sfxBus.connect(comp);
          musicBus.connect(comp);
          comp.connect(master);
          master.connect(ctx.destination);
          makeNoise();
        } catch (e) {
          ctx = null; master = null; comp = null; sfxBus = null; musicBus = null; musicLP = null; duckGain = null; noiseBuf = null;
          return;
        }
      }
      resumeCtx();
      bindVisibility();
      if (wantTrack && !M.track) startMusic(wantTrack);
    } catch (e) { /* never throw */ }
  }

  function resumeCtx() {
    try {
      if (ctx && ctx.state && ctx.state !== 'running' && ctx.resume) {
        var r = ctx.resume();
        if (r && r.catch) r.catch(noop);
      }
    } catch (e) {}
  }

  function bindVisibility() {
    if (visBound) return;
    try {
      if (typeof document !== 'undefined' && document && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
          try { if (!document.hidden) resumeCtx(); } catch (e) {}
        });
        visBound = true;
      }
    } catch (e) {}
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
  // A voice = one play() call: an output gain (+ optional stereo panner) + every source/node it created.
  // Everything is stopped + disconnected when the last source ends (or on kill).
  function Voice(vol0, x) {
    this.srcs = [];
    this.nodes = [];
    this.pending = 0;
    this.dead = false;
    this.name = '';
    this.prio = 4;
    this.pan = null;
    this.out = ctx.createGain();
    val(this.out.gain, vol0);
    this.nodes.push(this.out);
    var dest = sfxBus;
    if (typeof x === 'number' && x === x && typeof ctx.createStereoPanner === 'function') {
      try {
        var pn = ctx.createStereoPanner();
        val(pn.pan, panFromX(x));
        this.out.connect(pn);
        pn.connect(sfxBus);
        this.pan = pn;
        this.nodes.push(pn);
        dest = null;
      } catch (e) { this.pan = null; dest = sfxBus; }
    }
    if (dest) this.out.connect(dest);
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

  // priority + per-name caps ----------------------------------------------
  var PRIO = {
    boss_die: 9, player_die: 9, swallow: 9, stinger: 9,
    boss_roar: 8, boss_phase: 8, swallow_tele: 8, bomb: 8,
    extra_life: 7, hiscore: 7, checkpoint: 7, continue_ok: 7, stage_intro: 7, respawn: 7, midboss_warn: 7, wave_warning: 7,
    enemy_die_big: 6, powerup: 6, shield_up: 6, shield_break: 6, spit_out: 6, force_attach: 6, option_get: 6,
    enemy_die: 5, boss_hit: 5, chain_up: 5, chain_break: 5, shoot_charged: 5,
    shoot: 2, shoot_spread: 2, shoot_wave: 2, hit: 2, graze: 1, struggle: 3, hb: 3
  };
  var CAPS = { shoot: 3, shoot_spread: 2, shoot_wave: 2, hit: 3, enemy_die: 4, enemy_die_big: 3, fart: 2, struggle: 2, graze: 2 };

  function allocVoice(name, vol0, x) {
    var prio = PRIO[name] || 4, cap = CAPS[name], i, n = 0, oldest = null;
    if (cap) {
      for (i = 0; i < voices.length; i++) if (voices[i].name === name) { n++; if (!oldest) oldest = voices[i]; }
      if (n >= cap && oldest) oldest.kill();
    }
    if (voices.length >= MAX_VOICES) {
      var victim = null;
      for (i = 0; i < voices.length; i++) {
        if (voices[i].prio <= prio && (!victim || voices[i].prio < victim.prio)) victim = voices[i];
      }
      if (!victim) return null;
      victim.kill();
    }
    var v = new Voice(vol0, x);
    v.name = name; v.prio = prio;
    voices.push(v);
    return v;
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

  // white noise + optional biquad + envelope. o: t,dur,vol,a,ftype,f0,f1,q,dest,noenv,endless
  function noise(v, o) {
    if (!noiseBuf) return null;
    var s = ctx.createBufferSource(), g = ctx.createGain(), f = null;
    var t = o.t, d = o.dur || 0;
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
    v.add(s, t, o.endless ? null : t + d + 0.03, [s, f, g], Math.random() * 1.5);
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

  function lowpass(v, f, q, dest) {
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    val(lp.frequency, f); val(lp.Q, q || 1);
    lp.connect(dest || v.out);
    v.nodes.push(lp);
    return lp;
  }

  // gated noise: random on/off steps with a decaying level
  function gatedNoise(v, t, dur, vol0, ftype, f0, q, steps) {
    var n = noise(v, { t: t, dur: dur, vol: 0, noenv: true, ftype: ftype, f0: f0, q: q });
    if (!n) return;
    setV(n.gain.gain, 0, t);
    var sd = dur / steps;
    for (var i = 0; i < steps; i++) {
      var lvl = Math.random() < 0.65 ? rnd(0.4, 1) * vol0 * (1 - i / steps) : 0;
      setV(n.gain.gain, lvl, t + i * sd);
    }
    setV(n.gain.gain, 0, t + dur);
  }

  // formant vowel: sawtooth through three bandpass filters. A,B = [F1,F2,F3] start/end
  function vowel(v, t, dur, f0a, f0b, A, B, vol0) {
    var osc = ctx.createOscillator(), env = ctx.createGain(), nodes = [osc, env], i;
    osc.type = 'sawtooth';
    setV(osc.frequency, f0a, t); expo(osc.frequency, f0b, t + dur);
    setV(env.gain, 0.0001, t); lin(env.gain, vol0, t + 0.03);
    setV(env.gain, vol0, t + dur * 0.75); expo(env.gain, 0.0001, t + dur);
    var qs = [6, 8, 10], gs = [1, 0.6, 0.35];
    for (i = 0; i < 3; i++) {
      var f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass';
      setV(f.frequency, A[i], t); expo(f.frequency, B[i], t + dur);
      val(f.Q, qs[i]); val(g.gain, gs[i]);
      osc.connect(f); f.connect(g); g.connect(env);
      nodes.push(f, g);
    }
    env.connect(v.out);
    v.add(osc, t, t + dur + 0.03, nodes);
  }

  // ----------------------------------------------------------- enemy timbres
  function enemyKind(vr) {
    if (!vr) return '';
    switch (vr) {
      case 'butt_small': case 'small': return 'small';
      case 'butt_mid': case 'mid': return 'mid';
      case 'butt_charger': case 'charger': return 'charger';
      case 'butt_spitter': case 'spitter': return 'spitter';
      case 'alien_eye': case 'eye': return 'eye';
      case 'alien_squid': case 'squid': return 'squid';
      case 'butt_armored': case 'armored': return 'armored';
      case 'gas_cloud': case 'gas': return 'gas';
      case 'tooth_mine': case 'mine': return 'mine';
      case 'butt_turret': case 'turret': return 'turret';
      case 'midboss_butt': case 'midboss': return 'midboss';
    }
    if (vr.indexOf('butt_') === 0) return 'mid';
    return '';
  }

  var DIE = {
    small: function (v, t, p, g) {
      tone(v, { type: 'sine', f0: 700 * p, f1: 1600 * p, t: t, dur: 0.06, vol: 0.18 * g, a: 0.002 });
      noise(v, { t: t, dur: 0.15, vol: 0.25 * g, ftype: 'bandpass', f0: 3500, f1: 800, q: 1 });
      tone(v, { type: 'square', f0: 480 * p, f1: 80 * p, t: t, dur: 0.22, vol: 0.16 * g, a: 0.002 });
    },
    mid: function (v, t, p, g) {
      noise(v, { t: t, dur: 0.3, vol: 0.4 * g, ftype: 'lowpass', f0: 2000, f1: 200, q: 1 });
      tone(v, { type: 'sine', f0: 170 * p, f1: 48 * p, t: t, dur: 0.28, vol: 0.45 * g, a: 0.003 });
      tone(v, { type: 'square', f0: 300 * p, f1: 60 * p, t: t, dur: 0.18, vol: 0.14 * g, a: 0.002 });
    },
    charger: function (v, t, p, g) {
      noise(v, { t: t, dur: 0.38, vol: 0.35 * g, ftype: 'highpass', f0: 5000, f1: 400, q: 1 });
      tone(v, { type: 'square', f0: 280 * p, f1: 40 * p, t: t, dur: 0.3, vol: 0.2 * g, a: 0.002 });
      noise(v, { t: t + 0.1, dur: 0.25, vol: 0.3 * g, ftype: 'lowpass', f0: 1500, f1: 100, q: 1 });
    },
    spitter: function (v, t, p, g) {
      gatedNoise(v, t, 0.32, 0.4 * g, 'bandpass', 1300, 4, 9);
      tone(v, { type: 'sine', f0: 220 * p, f1: 70 * p, t: t, dur: 0.25, vol: 0.3 * g, a: 0.003 });
    },
    eye: function (v, t, p, g) {
      tone(v, { type: 'sine', f0: 2200 * p, t: t, dur: 0.12, vol: 0.12 * g, a: 0.001 });
      tone(v, { type: 'sine', f0: 3310 * p, t: t, dur: 0.09, vol: 0.08 * g, a: 0.001 });
      tone(v, { type: 'sine', f0: 1480 * p, t: t, dur: 0.15, vol: 0.1 * g, a: 0.001 });
      noise(v, { t: t, dur: 0.2, vol: 0.2 * g, ftype: 'highpass', f0: 3000, f1: 8000, q: 1 });
    },
    squid: function (v, t, p, g) {
      tone(v, { type: 'sine', f0: 260 * p, f1: 1100 * p, t: t, dur: 0.1, vol: 0.2 * g, a: 0.003 });
      tone(v, { type: 'sine', f0: 1100 * p, f1: 200 * p, t: t + 0.1, dur: 0.2, vol: 0.2 * g, a: 0.003 });
      noise(v, { t: t, dur: 0.2, vol: 0.2 * g, ftype: 'bandpass', f0: 700, q: 5 });
    },
    armored: function (v, t, p, g) {
      tone(v, { type: 'square', f0: 160 * p, f1: 50 * p, t: t, dur: 0.3, vol: 0.2 * g, a: 0.002 });
      tone(v, { type: 'sine', f0: 1230 * p, t: t, dur: 0.25, vol: 0.1 * g, a: 0.001 });
      tone(v, { type: 'sine', f0: 2210 * p, t: t, dur: 0.18, vol: 0.08 * g, a: 0.001 });
      tone(v, { type: 'sine', f0: 3330 * p, t: t, dur: 0.1, vol: 0.05 * g, a: 0.001 });
      noise(v, { t: t, dur: 0.2, vol: 0.3 * g, ftype: 'bandpass', f0: 3000, f1: 1000, q: 2 });
    },
    gas: function (v, t, p, g) {
      noise(v, { t: t, dur: 0.45, vol: 0.3 * g, a: 0.03, ftype: 'lowpass', f0: 700, f1: 150, q: 1 });
      tone(v, { type: 'sawtooth', f0: 95 * p, f1: 55 * p, t: t, dur: 0.4, vol: 0.12 * g, a: 0.02 });
    },
    mine: function (v, t, p, g) {
      for (var i = 0; i < 3; i++) noise(v, { t: t + i * 0.07, dur: 0.12, vol: 0.3 * g, ftype: 'bandpass', f0: 1800, f1: 300, q: 1.5 });
      tone(v, { type: 'sawtooth', f0: 320 * p, f1: 60 * p, t: t, dur: 0.3, vol: 0.2 * g, a: 0.002 });
    },
    turret: function (v, t, p, g) {
      tone(v, { type: 'square', f0: 420 * p, f1: 70 * p, t: t, dur: 0.25, vol: 0.2 * g, a: 0.002 });
      noise(v, { t: t, dur: 0.12, vol: 0.3 * g, ftype: 'highpass', f0: 2500, q: 1 });
      tone(v, { type: 'sine', f0: 1500 * p, f1: 400 * p, t: t, dur: 0.1, vol: 0.1 * g, a: 0.001 });
      tone(v, { type: 'sine', f0: 90 * p, f1: 40 * p, t: t, dur: 0.3, vol: 0.4 * g, a: 0.003 });
    },
    midboss: function (v, t, p, g) {
      tone(v, { type: 'sine', f0: 90 * p, f1: 28 * p, t: t, dur: 0.8, vol: 0.5 * g, a: 0.003 });
      noise(v, { t: t, dur: 0.7, vol: 0.5 * g, ftype: 'lowpass', f0: 1500, f1: 80, q: 0.8 });
      tone(v, { type: 'sawtooth', f0: 200 * p, f1: 35 * p, t: t, dur: 0.6, vol: 0.25 * g, a: 0.003 });
    }
  };

  // ------------------------------------------------------------ SFX recipes
  // signature: (voice, startTime, pitchMultiplier, variantString)
  var SND = {
    shoot: function (v, t, p, vr) {
      switch (vr) {
        case 'opt':
          tone(v, { type: 'triangle', f0: 1500 * p, f1: 700 * p, t: t, dur: 0.06, vol: 0.12, a: 0.001 });
          tone(v, { type: 'square', f0: 2400 * p, f1: 1200 * p, t: t, dur: 0.03, vol: 0.04, a: 0.001 });
          break;
        case 'force':
          tone(v, { type: 'square', f0: 520 * p, f1: 120 * p, t: t, dur: 0.09, vol: 0.2, a: 0.002 });
          tone(v, { type: 'triangle', f0: 260 * p, f1: 70 * p, t: t, dur: 0.12, vol: 0.25, a: 0.002 });
          noise(v, { t: t, dur: 0.03, vol: 0.1, ftype: 'highpass', f0: 2500 });
          break;
        case 'wheeze':
          var lp = lowpass(v, 900, 2);
          tone(v, { type: 'sawtooth', f0: 700 * p, f1: 200 * p, t: t, dur: 0.09, vol: 0.15, a: 0.002, dest: lp });
          tone(v, { type: 'sawtooth', f0: 350 * p, f1: 100 * p, t: t, dur: 0.1, vol: 0.1, a: 0.002, dest: lp });
          break;
        default:
          tone(v, { type: 'square', f0: 980 * p, f1: 180 * p, t: t, dur: 0.11, vol: 0.22, a: 0.002 });
          tone(v, { type: 'square', f0: 1960 * p, f1: 360 * p, t: t, dur: 0.05, vol: 0.07, a: 0.001 });
      }
    },

    shoot_spread: function (v, t, p) {
      for (var i = 0; i < 3; i++) {
        tone(v, { type: 'square', f0: (1200 - i * 180) * p, f1: 300 * p, t: t + i * 0.012, dur: 0.07, vol: 0.13, a: 0.001 });
      }
    },

    shoot_wave: function (v, t, p) {
      var a = tone(v, { type: 'sine', f0: 420 * p, f1: 760 * p, t: t, dur: 0.14, vol: 0.22, a: 0.003 });
      lfo(v, 'sine', 45, 90 * p, a.osc.frequency, t, t + 0.17);
      tone(v, { type: 'triangle', f0: 840 * p, f1: 1500 * p, t: t, dur: 0.1, vol: 0.08, a: 0.002 });
    },

    shoot_charged: function (v, t, p, vr) {
      var k = vr === 't3' ? 3 : (vr === 't2' ? 2 : 1);
      var d = [0.35, 0.55, 0.9][k - 1], s = [0.75, 1, 1.2][k - 1];
      tone(v, { type: 'sawtooth', f0: 520 * p, f1: 55 * p, t: t, dur: d, vol: 0.30 * s, a: 0.004 });
      tone(v, { type: 'sawtooth', f0: 530 * p, f1: 58 * p, t: t, dur: d * 0.9, vol: 0.18 * s, a: 0.004, det: 18 });
      noise(v, { t: t, dur: d + 0.05, vol: 0.38 * s, ftype: 'lowpass', f0: 5000, f1: 200, q: 1 });
      tone(v, { type: 'sine', f0: 110 * p, f1: 38 * p, t: t, dur: d + 0.15, vol: 0.65 * s, a: 0.005 });
      if (k === 3) {
        tone(v, { type: 'square', f0: 1800 * p, f1: 300 * p, t: t, dur: 0.5, vol: 0.12, a: 0.003 });
        tone(v, { type: 'sine', f0: 60 * p, f1: 28 * p, t: t + 0.03, dur: 0.9, vol: 0.7, a: 0.01 });
      }
    },

    hit: function (v, t, p, vr) {
      var k = enemyKind(vr);
      switch (k) {
        case 'armored': case 'turret':
          tone(v, { type: 'sine', f0: 2400 * p, f1: 1800 * p, t: t, dur: 0.06, vol: 0.14, a: 0.001 });
          tone(v, { type: 'sine', f0: 3700 * p, t: t, dur: 0.04, vol: 0.07, a: 0.001 });
          noise(v, { t: t, dur: 0.03, vol: 0.2, ftype: 'bandpass', f0: 3500, q: 3 });
          break;
        case 'gas':
          noise(v, { t: t, dur: 0.09, vol: 0.22, ftype: 'lowpass', f0: 900, f1: 300, q: 1 });
          tone(v, { type: 'sine', f0: 140 * p, f1: 90 * p, t: t, dur: 0.06, vol: 0.12, a: 0.002 });
          break;
        case 'eye':
          tone(v, { type: 'sine', f0: 3000 * p, f1: 2000 * p, t: t, dur: 0.05, vol: 0.12, a: 0.001 });
          noise(v, { t: t, dur: 0.03, vol: 0.16, ftype: 'highpass', f0: 4000 });
          break;
        case 'squid':
          tone(v, { type: 'sine', f0: 600 * p, f1: 300 * p, t: t, dur: 0.07, vol: 0.15, a: 0.002 });
          noise(v, { t: t, dur: 0.05, vol: 0.2, ftype: 'bandpass', f0: 900, q: 4 });
          break;
        case 'mid': case 'spitter': case 'mine': case 'midboss':
          noise(v, { t: t, dur: 0.06, vol: 0.3, ftype: 'bandpass', f0: 1200, q: 1.2 });
          tone(v, { type: 'square', f0: 190 * p, f1: 80 * p, t: t, dur: 0.05, vol: 0.14, a: 0.001 });
          break;
        default:
          noise(v, { t: t, dur: 0.05, vol: 0.32, ftype: 'highpass', f0: 2000 });
          tone(v, { type: 'square', f0: 260 * p, f1: 120 * p, t: t, dur: 0.04, vol: 0.12, a: 0.001 });
      }
    },

    enemy_die: function (v, t, p, vr) {
      var k = enemyKind(vr);
      if (k && DIE[k]) { DIE[k](v, t, p, 1); return; }
      noise(v, { t: t, dur: 0.28, vol: 0.42, ftype: 'bandpass', f0: 3000, f1: 300, q: 1.2 });
      tone(v, { type: 'square', f0: 520 * p, f1: 50 * p, t: t, dur: 0.32, vol: 0.22, a: 0.002 });
    },

    enemy_die_big: function (v, t, p, vr) {
      noise(v, { t: t, dur: 0.9, vol: 0.62, a: 0.005, ftype: 'lowpass', f0: 1800, f1: 90, q: 0.8 });
      noise(v, { t: t + 0.12, dur: 0.35, vol: 0.28, ftype: 'bandpass', f0: 2400, f1: 200, q: 1 });
      tone(v, { type: 'sawtooth', f0: 150 * p, f1: 30 * p, t: t, dur: 0.9, vol: 0.33 });
      tone(v, { type: 'sine', f0: 70 * p, f1: 28 * p, t: t, dur: 1.0, vol: 0.55 });
      var k = enemyKind(vr);
      if (k && DIE[k]) DIE[k](v, t, p, 0.7);
    },

    player_die: function (v, t, p) {
      // boom front-loaded into the first 0.5s (matches the 6x5-tick explosion), crackle tail to ~1.3s
      tone(v, { type: 'sine', f0: 85 * p, f1: 32 * p, t: t, dur: 0.55, vol: 0.65, a: 0.003 });
      noise(v, { t: t, dur: 0.5, vol: 0.55, a: 0.003, ftype: 'lowpass', f0: 3500, f1: 200 });
      tone(v, { type: 'sawtooth', f0: 700 * p, f1: 35 * p, t: t, dur: 1.3, vol: 0.28, a: 0.005 });
      tone(v, { type: 'sawtooth', f0: 712 * p, f1: 40 * p, t: t, dur: 1.25, vol: 0.18, a: 0.005, det: 20 });
      tone(v, { type: 'square', f0: 350 * p, f1: 25 * p, t: t, dur: 1.1, vol: 0.12 });
      gatedNoise(v, t + 0.05, 1.0, 0.4, 'highpass', 1200, 1, 28);
    },

    boss_hit: function (v, t, p, vr) {
      if (vr === 'body') {
        noise(v, { t: t, dur: 0.1, vol: 0.28, ftype: 'lowpass', f0: 900, f1: 250, q: 1 });
        tone(v, { type: 'sine', f0: 130 * p, f1: 80 * p, t: t, dur: 0.12, vol: 0.4, a: 0.002 });
        tone(v, { type: 'square', f0: 220 * p, t: t, dur: 0.06, vol: 0.08, a: 0.002 });
        return;
      }
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
      lfo(v, 'square', 32, 0.35, amp.gain, t, t + d + 0.03);            // growl AM
      noise(v, { t: t, dur: d, vol: 0.12, a: 0.1, ftype: 'lowpass', f0: 700, q: 1 });
    },

    boss_phase: function (v, t, p) {
      var f = [880, 698.5, 523.25];
      for (var i = 0; i < f.length; i++) {
        tone(v, { type: 'sawtooth', f0: f[i] * p, t: t + i * 0.22, dur: 0.2, vol: 0.2, a: 0.004, hold: 0.8 });
        tone(v, { type: 'square', f0: f[i] * 0.5 * p, t: t + i * 0.22, dur: 0.2, vol: 0.1, a: 0.004, hold: 0.8 });
      }
      SND.boss_roar(v, t + 0.7, p);
    },

    swallow: function (v, t, p) {
      noise(v, { t: t, dur: 0.55, vol: 0.5, a: 0.02, ftype: 'lowpass', f0: 1800, f1: 200, q: 9 });
      tone(v, { type: 'sine', f0: 420 * p, f1: 130 * p, t: t + 0.02, dur: 0.2, vol: 0.45, a: 0.01 });
      tone(v, { type: 'sine', f0: 360 * p, f1: 110 * p, t: t + 0.27, dur: 0.24, vol: 0.45, a: 0.01 });
      noise(v, { t: t + 0.25, dur: 0.25, vol: 0.2, ftype: 'bandpass', f0: 900, f1: 250, q: 6 });
      tone(v, { type: 'sine', f0: 700 * p, f1: 300 * p, t: t + 0.5, dur: 0.07, vol: 0.2 });
    },

    swallow_tele: function (v, t, p) {
      var d = 0.8;
      noise(v, { t: t, dur: d, vol: 0.4, a: 0.1, ftype: 'lowpass', f0: 200, f1: 900, q: 9 });
      tone(v, { type: 'sine', f0: 45 * p, f1: 38 * p, t: t, dur: d + 0.05, vol: 0.55, a: 0.1 });
      var a = tone(v, { type: 'sine', f0: 250 * p, f1: 620 * p, t: t, dur: d, vol: 0.15, a: 0.05 });
      lfo(v, 'sine', 12, 60 * p, a.osc.frequency, t, t + d + 0.03);
      noise(v, { t: t, dur: d, vol: 0.15, a: 0.1, ftype: 'bandpass', f0: 600, q: 6 });
    },

    struggle: function (v, t, p) {
      tone(v, { type: 'sine', f0: 400 * p, f1: 210 * p, t: t, dur: 0.08, vol: 0.3, a: 0.003 });
      noise(v, { t: t, dur: 0.06, vol: 0.25, ftype: 'bandpass', f0: 700, f1: 400, q: 4 });
    },

    spit_out: function (v, t, p) {
      var lp = lowpass(v, 600, 3);
      tone(v, { type: 'sawtooth', f0: 190 * p, f1: 65 * p, t: t, dur: 0.3, vol: 0.35, a: 0.005, dest: lp });
      gatedNoise(v, t, 0.3, 0.3, 'bandpass', 1600, 3, 8);
      tone(v, { type: 'sine', f0: 520 * p, f1: 180 * p, t: t + 0.28, dur: 0.12, vol: 0.3, a: 0.003 });
    },

    midboss_warn: function (v, t, p) {
      for (var i = 0; i < 6; i++) {
        tone(v, { type: 'square', f0: (i % 2 ? 520 : 740) * p, t: t + i * 0.12, dur: 0.11, vol: 0.2, a: 0.003, hold: 0.8 });
      }
      tone(v, { type: 'sine', f0: 70 * p, f1: 50 * p, t: t, dur: 0.5, vol: 0.45, a: 0.01 });
    },

    respawn: function (v, t, p) {
      tone(v, { type: 'sine', f0: 200 * p, f1: 1600 * p, t: t, dur: 0.45, vol: 0.22, a: 0.02 });
      tone(v, { type: 'triangle', f0: 400 * p, f1: 3200 * p, t: t, dur: 0.45, vol: 0.1, a: 0.02 });
      tone(v, { type: 'sine', f0: 2637 * p, t: t + 0.4, dur: 0.18, vol: 0.15, a: 0.002 });
      noise(v, { t: t, dur: 0.2, vol: 0.1, ftype: 'highpass', f0: 3000 });
    },

    powerup: function (v, t, p, vr) {
      var i;
      switch (vr) {
        case 'speed':
          tone(v, { type: 'sawtooth', f0: 300 * p, f1: 1800 * p, t: t, dur: 0.28, vol: 0.2, a: 0.01 });
          tone(v, { type: 'square', f0: 1318.5 * p, t: t + 0.28, dur: 0.08, vol: 0.18, a: 0.002 });
          tone(v, { type: 'square', f0: 1760 * p, t: t + 0.35, dur: 0.12, vol: 0.18, a: 0.002 });
          break;
        case 'shield':
          SND.shield_up(v, t, p);
          break;
        case 'force':
          tone(v, { type: 'square', f0: 220 * p, f1: 440 * p, t: t, dur: 0.2, vol: 0.22, a: 0.003 });
          noise(v, { t: t + 0.05, dur: 0.06, vol: 0.25, ftype: 'bandpass', f0: 1800, q: 4 });
          tone(v, { type: 'square', f0: 659.25 * p, t: t + 0.12, dur: 0.1, vol: 0.2, a: 0.002 });
          tone(v, { type: 'square', f0: 880 * p, t: t + 0.2, dur: 0.15, vol: 0.2, a: 0.002 });
          break;
        case 'spread':
          var fs = [784, 988, 1319];
          for (i = 0; i < 3; i++) {
            tone(v, { type: 'square', f0: fs[i] * p, f1: fs[i] * 1.5 * p, t: t + i * 0.07, dur: 0.08, vol: 0.2, a: 0.002 });
            tone(v, { type: 'triangle', f0: fs[i] * 2 * p, t: t + i * 0.07, dur: 0.08, vol: 0.1, a: 0.002 });
          }
          break;
        case 'laser':
          tone(v, { type: 'sawtooth', f0: 1800 * p, f1: 500 * p, t: t, dur: 0.18, vol: 0.2, a: 0.002 });
          tone(v, { type: 'sine', f0: 2600 * p, t: t + 0.15, dur: 0.05, vol: 0.1, a: 0.001 });
          tone(v, { type: 'square', f0: 1318.5 * p, t: t + 0.2, dur: 0.12, vol: 0.18, a: 0.002 });
          break;
        case 'wave':
          var a = tone(v, { type: 'sine', f0: 500 * p, f1: 1000 * p, t: t, dur: 0.3, vol: 0.25, a: 0.01 });
          lfo(v, 'sine', 28, 120 * p, a.osc.frequency, t, t + 0.33);
          tone(v, { type: 'triangle', f0: 1000 * p, f1: 2000 * p, t: t, dur: 0.25, vol: 0.08, a: 0.01 });
          break;
        case 'life':
          SND.extra_life(v, t, p);
          break;
        case 'power':
          tone(v, { type: 'sawtooth', f0: 130 * p, f1: 260 * p, t: t, dur: 0.3, vol: 0.2, a: 0.01 });
          arpUp(v, t, p);
          break;
        default:
          arpUp(v, t, p);
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

    force_throw: function (v, t, p) {
      noise(v, { t: t, dur: 0.28, vol: 0.35, a: 0.02, ftype: 'bandpass', f0: 300, f1: 2800, q: 1.5 });
      tone(v, { type: 'square', f0: 180 * p, f1: 520 * p, t: t, dur: 0.25, vol: 0.15, a: 0.005 });
    },

    force_recall: function (v, t, p) {
      noise(v, { t: t, dur: 0.3, vol: 0.3, a: 0.02, ftype: 'bandpass', f0: 2800, f1: 300, q: 1.5 });
      tone(v, { type: 'sine', f0: 700 * p, f1: 220 * p, t: t, dur: 0.3, vol: 0.2, a: 0.005 });
      tone(v, { type: 'square', f0: 440 * p, t: t + 0.28, dur: 0.05, vol: 0.12, a: 0.002 });
    },

    force_attach: function (v, t, p) {
      tone(v, { type: 'sine', f0: 130 * p, f1: 55 * p, t: t, dur: 0.14, vol: 0.55, a: 0.002 });
      noise(v, { t: t, dur: 0.03, vol: 0.35, ftype: 'highpass', f0: 2500 });
      tone(v, { type: 'square', f0: 330 * p, f1: 280 * p, t: t + 0.01, dur: 0.06, vol: 0.15, a: 0.001 });
      tone(v, { type: 'sine', f0: 1760 * p, t: t + 0.02, dur: 0.15, vol: 0.08, a: 0.001 });
    },

    graze: function (v, t, p) {
      tone(v, { type: 'sine', f0: 2600 * p, t: t, dur: 0.03, vol: 0.12, a: 0.001 });
      tone(v, { type: 'sine', f0: 3500 * p, t: t + 0.012, dur: 0.025, vol: 0.08, a: 0.001 });
    },

    chain_up: function (v, t, p, vr) {
      var m = clamp(Math.round(Number(vr)) || 2, 2, 8);
      var n = m <= 2 ? 2 : (m <= 4 ? 3 : (m <= 6 ? 4 : 5));
      var base = 72 + (m - 2), offs = [0, 4, 7, 12, 16], i;
      for (i = 0; i < n; i++) {
        var f = mtof(base + offs[i]) * p, last = (i === n - 1);
        tone(v, { type: 'square', f0: f, t: t + i * 0.055, dur: last ? 0.16 : 0.07, vol: 0.17, a: 0.002 });
        tone(v, { type: 'triangle', f0: f * 2, t: t + i * 0.055, dur: last ? 0.16 : 0.07, vol: 0.08, a: 0.002 });
      }
      if (m >= 8) {
        for (i = 0; i < 4; i++) {
          tone(v, { type: 'sine', f0: rnd(3000, 6500) * p, t: t + 0.28 + i * 0.04, dur: 0.05, vol: 0.1, a: 0.001 });
        }
      }
    },

    chain_break: function (v, t, p) {
      tone(v, { type: 'triangle', f0: 659 * p, f1: 330 * p, t: t, dur: 0.22, vol: 0.22, a: 0.003 });
      tone(v, { type: 'sine', f0: 500 * p, f1: 130 * p, t: t, dur: 0.3, vol: 0.25, a: 0.003 });
      noise(v, { t: t, dur: 0.12, vol: 0.2, ftype: 'lowpass', f0: 2500, f1: 300 });
    },

    turret_fire: function (v, t, p) {
      tone(v, { type: 'square', f0: 760 * p, f1: 180 * p, t: t, dur: 0.09, vol: 0.2, a: 0.002 });
      noise(v, { t: t, dur: 0.04, vol: 0.2, ftype: 'highpass', f0: 2500 });
      tone(v, { type: 'sine', f0: 100 * p, f1: 55 * p, t: t, dur: 0.12, vol: 0.3, a: 0.002 });
    },

    spit_windup: function (v, t, p) {
      var a = tone(v, { type: 'sine', f0: 150 * p, f1: 330 * p, t: t, dur: 0.33, vol: 0.3, a: 0.03 });
      lfo(v, 'sine', 18, 40 * p, a.osc.frequency, t, t + 0.36);
      noise(v, { t: t, dur: 0.33, vol: 0.22, a: 0.1, ftype: 'lowpass', f0: 500, f1: 900, q: 1 });
    },

    wave_warning: function (v, t, p) {
      for (var i = 0; i < 6; i++) {
        tone(v, { type: 'square', f0: (i % 2 ? 660 : 880) * p, t: t + i * 0.19, dur: 0.17, vol: 0.22, a: 0.004, hold: 0.8 });
      }
    },

    stage_intro: function (v, t, p) {
      var f = [440, 523.25, 659.25, 880];
      for (var i = 0; i < f.length; i++) {
        var last = (i === f.length - 1);
        tone(v, { type: 'square', f0: f[i] * p, t: t + i * 0.07, dur: last ? 0.3 : 0.12, vol: 0.17, a: 0.003 });
        tone(v, { type: 'triangle', f0: f[i] * 2 * p, t: t + i * 0.07, dur: last ? 0.3 : 0.12, vol: 0.09, a: 0.003 });
      }
      noise(v, { t: t, dur: 0.4, vol: 0.18, a: 0.15, ftype: 'highpass', f0: 1500, f1: 6000, q: 1 });
      tone(v, { type: 'sine', f0: 120 * p, f1: 45 * p, t: t, dur: 0.35, vol: 0.4, a: 0.003 });
    },

    checkpoint: function (v, t, p) {
      tone(v, { type: 'sine', f0: 1046.5 * p, t: t, dur: 0.4, vol: 0.2, a: 0.002 });
      tone(v, { type: 'triangle', f0: 2093 * p, t: t, dur: 0.3, vol: 0.1, a: 0.002 });
      tone(v, { type: 'sine', f0: 1568 * p, t: t + 0.1, dur: 0.5, vol: 0.2, a: 0.002 });
      tone(v, { type: 'triangle', f0: 3136 * p, t: t + 0.1, dur: 0.35, vol: 0.1, a: 0.002 });
    },

    continue_ok: function (v, t, p) {
      var f = [523.25, 523.25, 659.25, 783.99], at = [0, 0.1, 0.2, 0.3];
      for (var i = 0; i < 4; i++) {
        var last = (i === 3);
        tone(v, { type: 'square', f0: f[i] * p, t: t + at[i], dur: last ? 0.45 : 0.09, vol: 0.2, a: 0.003, hold: last ? 0.5 : 0 });
        tone(v, { type: 'triangle', f0: f[i] * 2 * p, t: t + at[i], dur: last ? 0.45 : 0.09, vol: 0.1, a: 0.003 });
      }
      tone(v, { type: 'triangle', f0: 130.8 * p, t: t + 0.3, dur: 0.45, vol: 0.3, a: 0.005 });
    },

    hiscore: function (v, t, p) {
      var f = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093], i;
      for (i = 0; i < f.length; i++) {
        tone(v, { type: 'square', f0: f[i] * p, t: t + i * 0.075, dur: 0.1, vol: 0.18, a: 0.003 });
        tone(v, { type: 'triangle', f0: f[i] * 2 * p, t: t + i * 0.075, dur: 0.1, vol: 0.09, a: 0.003 });
      }
      var c = [1046.5, 1318.5, 1568];
      for (i = 0; i < c.length; i++) {
        tone(v, { type: 'square', f0: c[i] * p, t: t + 0.55, dur: 0.6, vol: 0.14, a: 0.004, hold: 0.5 });
        tone(v, { type: 'triangle', f0: c[i] * p, t: t + 0.55, dur: 0.6, vol: 0.1, a: 0.004, det: 8 });
      }
    },

    extra_life: function (v, t, p) {
      var f = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      for (var i = 0; i < f.length; i++) {
        var last = i === f.length - 1;
        tone(v, { type: 'square', f0: f[i] * p, t: t + i * 0.075, dur: last ? 0.4 : 0.09, vol: 0.2, a: 0.003, hold: last ? 0.5 : 0 });
        tone(v, { type: 'triangle', f0: f[i] * p * 2, t: t + i * 0.075, dur: last ? 0.4 : 0.09, vol: 0.12, a: 0.003 });
      }
    },

    pu_appear: function (v, t, p) {
      tone(v, { type: 'sine', f0: 1568 * p, f1: 2093 * p, t: t, dur: 0.18, vol: 0.1, a: 0.01 });
      tone(v, { type: 'triangle', f0: 3136 * p, t: t, dur: 0.12, vol: 0.04, a: 0.01 });
    },

    bomb: function (v, t, p) {
      noise(v, { t: t, dur: 1.2, vol: 0.7, a: 0.005, ftype: 'lowpass', f0: 3000, f1: 80, q: 1 });
      tone(v, { type: 'sine', f0: 95 * p, f1: 28 * p, t: t, dur: 1.2, vol: 0.6, a: 0.005 });
      tone(v, { type: 'sawtooth', f0: 170 * p, f1: 40 * p, t: t, dur: 0.9, vol: 0.25, a: 0.005 });
      for (var i = 0; i < 6; i++) {
        noise(v, { t: t + 0.1 + i * 0.13, dur: rnd(0.08, 0.14), vol: 0.25, ftype: 'bandpass', f0: rnd(700, 1800), f1: 300, q: 2 });
      }
    },

    bomb_ready: function (v, t, p) {
      tone(v, { type: 'triangle', f0: 523.25 * p, t: t, dur: 0.1, vol: 0.22, a: 0.003 });
      tone(v, { type: 'triangle', f0: 659.25 * p, t: t + 0.1, dur: 0.1, vol: 0.22, a: 0.003 });
      tone(v, { type: 'triangle', f0: 783.99 * p, t: t + 0.2, dur: 0.3, vol: 0.22, a: 0.003 });
      tone(v, { type: 'sine', f0: 2093 * p, t: t + 0.2, dur: 0.5, vol: 0.1, a: 0.003 });
    },

    hitstop_thud: function (v, t, p) {
      tone(v, { type: 'sine', f0: 85 * p, f1: 45 * p, t: t, dur: 0.07, vol: 0.5, a: 0.002 });
      noise(v, { t: t, dur: 0.03, vol: 0.3, ftype: 'lowpass', f0: 1200 });
    },

    logo_wink: function (v, t, p) {
      tone(v, { type: 'triangle', f0: 880 * p, f1: 1760 * p, t: t, dur: 0.05, vol: 0.14, a: 0.002 });
      tone(v, { type: 'sawtooth', f0: 210 * p, f1: 130 * p, t: t + 0.04, dur: 0.09, vol: 0.1, a: 0.003 });
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

  function arpUp(v, t, p) {
    var f = [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < f.length; i++) {
      tone(v, { type: 'square', f0: f[i] * p, t: t + i * 0.07, dur: i === 3 ? 0.22 : 0.1, vol: 0.2, a: 0.003 });
      tone(v, { type: 'triangle', f0: f[i] * 2 * p, t: t + i * 0.07, dur: i === 3 ? 0.22 : 0.1, vol: 0.12, a: 0.003 });
    }
  }

  // ------------------------------------------------- aliases / jitter / ducks
  var ALIAS = { combo_up: 1, stage_clear: 1, title_sting: 1 };
  var JITTER = { shoot: 0.06, shoot_spread: 0.04, shoot_wave: 0.04, hit: 0.10, enemy_die: 0.08, enemy_die_big: 0.05, turret_fire: 0.05, struggle: 0.03 };
  var DUCK = {                                   // name: [ms, depth]
    boss_die: [2200, 0.35], boss_roar: [900, 0.5], boss_phase: [1500, 0.5], swallow: [700, 0.45],
    player_die: [900, 0.4], enemy_die_big: [250, 0.7], shield_break: [200, 0.75], bomb: [1200, 0.3]
  };
  var LOOPS = { charge: 1, laser: 1, gas_loop: 1 };
  var lastGraze = 0;

  // ------------------------------------------------------------ loop handles
  function makeHandle(v, o) {
    var stopped = false, timer = null, lvl = 0;
    var h = {
      stop: function (fade) {
        if (stopped) return;
        stopped = true;
        if (timer) { clearTimeout(timer); timer = null; }
        var i = loops.indexOf(h);
        if (i >= 0) loops.splice(i, 1);
        var f = (typeof fade === 'number' && fade >= 0 && fade === fade) ? Math.min(fade, 3) : 0.05;
        try {
          var now = ctx.currentTime;
          cancel(v.out.gain, now);
          target(v.out.gain, 0, now, Math.max(0.005, f / 3));
          v.stopAll(now + f + 0.08);
        } catch (e) {}
        setTimeout(function () { v.dispose(); }, Math.round((f + 0.35) * 1000));
      },
      setLevel: function (n) {
        if (stopped) return;
        n = Math.round(Number(n));
        if (n !== n) return;
        n = clamp(n, 0, 3);
        if (n === lvl) return;
        var prev = lvl;
        lvl = n;
        try { if (o.onLevel) o.onLevel(n, prev); } catch (e) {}
      },
      setVolume: function (x) {
        if (stopped) return;
        x = Number(x);
        if (x !== x) return;
        try { target(v.out.gain, clamp(x, 0, 1.5), ctx.currentTime, 0.02); } catch (e) {}
      },
      setX: function (x) {
        if (stopped || !v.pan) return;
        x = Number(x);
        if (x !== x) return;
        try { target(v.pan.pan, panFromX(x), ctx.currentTime, 0.02); } catch (e) {}
      }
    };
    timer = setTimeout(function () { h.stop(); }, o.maxMs);
    loops.push(h);
    return h;
  }

  function stopLoops() {
    var c = loops.slice();
    for (var i = 0; i < c.length; i++) { try { c[i].stop(0.03); } catch (e) {} }
    loops.length = 0;
  }

  function stopKind(kind) {
    for (var i = loops.length - 1; i >= 0; i--) if (loops[i].kind === kind) { try { loops[i].stop(0.03); } catch (e) {} }
  }

  function startCharge(vol0, p, x) {
    stopKind('charge');
    var v = new Voice(vol0, x);
    var t = ctx.currentTime + 0.005;
    var g1 = ctx.createGain(), g2 = ctx.createGain();
    var o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'triangle'; o2.type = 'square';
    // glide with breakpoints at the tier arrival times (+0.15 / +0.65 / +1.25 s after creation)
    setV(o1.frequency, 200 * p, t); expo(o1.frequency, 300 * p, t + 0.15); expo(o1.frequency, 500 * p, t + 0.65); expo(o1.frequency, 820 * p, t + 1.25);
    setV(o2.frequency, 300 * p, t); expo(o2.frequency, 450 * p, t + 0.15); expo(o2.frequency, 750 * p, t + 0.65); expo(o2.frequency, 1230 * p, t + 1.25);
    setV(g1.gain, 0.02, t); lin(g1.gain, 0.24, t + 1.25);
    setV(g2.gain, 0.005, t); lin(g2.gain, 0.07, t + 1.25);
    o1.connect(g1); g1.connect(v.out);
    o2.connect(g2); g2.connect(v.out);
    v.add(o1, t, null, [o1, g1]);
    v.add(o2, t, null, [o2, g2]);
    var l = lfo(v, 'sine', 14, 10 * p, o1.frequency, t, null);   // growing vibrato
    lin(l.gain.gain, 90 * p, t + 1.25);
    var shim = null;
    var h = makeHandle(v, {
      maxMs: 15000,
      onLevel: function (n, prev) {
        var now = ctx.currentTime + 0.002, bump = [0, 80, 160, 260][n];
        target(o1.detune, bump, now, 0.02); target(o2.detune, bump, now, 0.02);
        if (n <= prev) return;
        if (n === 1) {
          tone(v, { type: 'square', f0: 659.25 * p, t: now, dur: 0.09, vol: 0.22, a: 0.002 });
          tone(v, { type: 'triangle', f0: 1318.5 * p, t: now, dur: 0.09, vol: 0.12, a: 0.002 });
        } else if (n === 2) {
          tone(v, { type: 'square', f0: 880 * p, t: now, dur: 0.1, vol: 0.22, a: 0.002 });
          tone(v, { type: 'square', f0: 1108.7 * p, t: now + 0.05, dur: 0.1, vol: 0.18, a: 0.002 });
          tone(v, { type: 'triangle', f0: 1760 * p, t: now, dur: 0.1, vol: 0.12, a: 0.002 });
        } else {
          var ch = [659.25, 880, 1108.7, 1318.5];
          for (var i = 0; i < ch.length; i++) {
            tone(v, { type: 'square', f0: ch[i] * p, t: now, dur: 0.35, vol: 0.14, a: 0.003, hold: 0.4 });
            tone(v, { type: 'triangle', f0: ch[i] * 2 * p, t: now, dur: 0.35, vol: 0.07, a: 0.003 });
          }
          if (!shim) shim = lfo(v, 'sine', 14, 0.05, g1.gain, now, null);   // shimmer hold
        }
      }
    });
    h.kind = 'charge';
    return h;
  }

  function startLaser(vol0, p, x) {
    stopKind('laser');
    var v = new Voice(vol0, x);
    var t = ctx.currentTime + 0.005;
    var amp = ctx.createGain();
    val(amp.gain, 0.5);
    amp.connect(v.out);
    v.nodes.push(amp);
    var oscs = [], bases = [180, 90.7, 360], types = ['sawtooth', 'square', 'sine'], vols = [0.14, 0.08, 0.07], i;
    for (i = 0; i < 3; i++) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = types[i];
      setV(o.frequency, bases[i] * p, t);
      val(g.gain, vols[i]);
      o.connect(g); g.connect(amp);
      v.add(o, t, null, [o, g]);
      oscs.push(o);
    }
    lfo(v, 'sine', 30, 0.18, amp.gain, t, null);   // AM buzz
    var nz = noise(v, { t: t, dur: 1, vol: 0.07, noenv: true, endless: true, ftype: 'bandpass', f0: 2400, q: 2, dest: amp });
    if (nz) val(nz.gain.gain, 0.07);
    var mult = [1, 1, 1.19, 1.5];
    var h = makeHandle(v, {
      maxMs: 120000,
      onLevel: function (n) {
        var now = ctx.currentTime;
        for (var k = 0; k < oscs.length; k++) target(oscs[k].frequency, bases[k] * p * mult[n], now, 0.03);
        if (nz && nz.filter) target(nz.filter.frequency, 2400 + n * 900, now, 0.05);
      }
    });
    h.kind = 'laser';
    return h;
  }

  function startGas(vol0, p, x) {
    stopKind('gas_loop');
    var v = new Voice(vol0, x);
    var t = ctx.currentTime + 0.005;
    var amp = ctx.createGain();
    val(amp.gain, 0.5);
    amp.connect(v.out);
    v.nodes.push(amp);
    var nz = noise(v, { t: t, dur: 1, vol: 0.3, noenv: true, endless: true, ftype: 'lowpass', f0: 420, q: 3, dest: amp });
    if (nz) {
      val(nz.gain.gain, 0.3);
      if (nz.filter) lfo(v, 'sine', 0.7, 160, nz.filter.frequency, t, null);   // slow bubbling sweep
    }
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    setV(o.frequency, 52 * p, t);
    val(g.gain, 0.05);
    o.connect(g); g.connect(amp);
    v.add(o, t, null, [o, g]);
    lfo(v, 'sine', 5, 0.03, g.gain, t, null);
    var h = makeHandle(v, { maxMs: 60000 });
    h.kind = 'gas_loop';
    return h;
  }

  // ------------------------------------------------------------------- play
  function play(name, opts) {
    var isLoop = LOOPS.hasOwnProperty(name);
    try {
      if (typeof name !== 'string') return undefined;
      if (!isLoop && !SND.hasOwnProperty(name) && !ALIAS.hasOwnProperty(name)) { warnOnce('sound', name); return undefined; }
      if (ctx && ctx.state === 'suspended') resumeCtx();
      if (!ctx || muted || !running()) return isLoop ? noopHandle() : undefined;
      var vl = (opts && typeof opts.volume === 'number' && opts.volume === opts.volume) ? clamp(opts.volume, 0, 1.5) : 1;
      var p = (opts && typeof opts.pitch === 'number' && opts.pitch > 0) ? clamp(opts.pitch, 0.25, 4) : 1;
      var x = (opts && typeof opts.x === 'number' && opts.x === opts.x) ? opts.x : null;
      var vr = (opts && opts.variant != null) ? String(opts.variant) : '';
      if (ALIAS.hasOwnProperty(name)) {
        if (name === 'combo_up') { play('chain_up', { volume: vl, pitch: p, x: x, variant: [2, 4, 8][clamp(Math.round(Number(vr)) || 1, 1, 3) - 1] }); }
        else if (name === 'stage_clear') stinger('clear');
        else stinger('title');
        return undefined;
      }
      if (isLoop) {
        if (name === 'charge') return startCharge(vl, p, x);
        if (name === 'laser') return startLaser(vl, p, x);
        return startGas(vl, p, x);
      }
      if (name === 'graze') {                     // internal 60 ms gap so a graze burst is a tick, not a buzz
        var nowG = ctx.currentTime;
        if (nowG - lastGraze < 0.06) return undefined;
        lastGraze = nowG;
      }
      var j = JITTER[name];
      if (j) p *= 1 + rnd(-j, j);
      var v = allocVoice(name, vl, x);
      if (!v) return undefined;
      SND[name](v, ctx.currentTime + 0.005, p, vr);
      var dk = DUCK[name];
      if (dk) duck(dk[0], dk[1]);
      return undefined;
    } catch (e) {
      return isLoop ? noopHandle() : undefined;
    }
  }

  function setMuted(m) {
    muted = !!m;
    try {
      if (master) {
        var now = ctx.currentTime;
        cancel(master.gain, now);
        target(master.gain, muted ? 0 : MASTER_GAIN * vol.master, now, 0.01);
      }
      if (muted) {
        stopLoops();
        for (var i = voices.length - 1; i >= 0; i--) voices[i].kill();
      }
    } catch (e) {}
  }

  function setVolume(o) {
    try {
      if (!o || typeof o !== 'object') return;
      if (typeof o.master === 'number' && o.master === o.master) vol.master = clamp(o.master, 0, 1);
      if (typeof o.music === 'number' && o.music === o.music) vol.music = clamp(o.music, 0, 1);
      if (typeof o.sfx === 'number' && o.sfx === o.sfx) vol.sfx = clamp(o.sfx, 0, 1);
      if (ctx) {
        var now = ctx.currentTime;
        if (master && !muted) target(master.gain, MASTER_GAIN * vol.master, now, 0.02);
        if (musicBus) target(musicBus.gain, MUSIC_GAIN * vol.music, now, 0.02);
        if (sfxBus) target(sfxBus.gain, vol.sfx, now, 0.02);
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------ music
  // Notation. Chords: one name per bar ("Am", "F", "Bb", "Edim"). Lead: one string per bar of 8
  // eighth-note tokens: note name ("A4", "C#5"), "." rest, "-" sustain previous note.
  // Patterns are 16 sixteenth-step tokens: bass = semitone offset from chord root, arp = chord-tone
  // index (0-2 = chord tones, 3 = root + octave), "." = nothing. Drums: 16 chars, x/o hit, . none.
  // Pattern sets: pats {A:..,B:..} + seq 'A A A B' (cycled per bar).
  var CH_Q = { '': [0, 4, 7], 'm': [0, 3, 7], 'dim': [0, 3, 6], '7': [0, 4, 7], 'm7': [0, 3, 7], 'sus4': [0, 5, 7] };
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var LAYERS = { arp: 0.3, lead: 0.5, lead2: 0.75, hat2: 0.75, fill: 0.9, bassOct: 0.9 };
  var FAST_ARP = '0 1 2 3 2 1 2 3 0 1 2 3 2 1 2 3';

  var TRACKS = {
    title: {
      bpm: 76, loop: true, fixed: true,
      prog: 'Dm Bb Gm A Dm F Gm A',
      lead: [
        'A4 - - - F4 - A4 -', 'D5 - - - C5 - Bb4 -', 'Bb4 - - - D5 - G5 -', 'F5 - E5 - C#5 - E5 -',
        'D5 - F5 - A5 - - -', 'A5 - G5 - F5 - C5 -', 'Bb4 - D5 - G5 - F5 D5', 'E5 - C#5 - A4 - - .'
      ],
      bass: { wave: 'triangle', vol: 0.30, len: 7, shape: 'hold', pats: { A: '0 . . . . . . . . . . . 0 . . .' } },
      arp: { wave: 'triangle', vol: 0.10, len: 2.2, oct: 12, pats: { A: '0 . 1 . 2 . 3 . 2 . 1 . 2 . 1 .' } },
      pad: { wave: 'triangle', vol: 0.045 },
      leadv: { wave: 'square', vol: 0.07, shape: 'hold' },
      drums: { pats: { A: { kick: 'x.......x.......', snare: '................', hat: '....o.......o...' } }, kv: 0.6, hv: 0.5 }
    },

    // stage 1: HAIRY NEBULA, 150 bpm A minor, 16 bars (v1 theme, now with variation + countermelody)
    stage1: {
      bpm: 150, loop: true, l2rhy: 'half',
      prog: 'Am F C G Am F C E Dm Dm Am Am F G Am E',
      lead: [
        'A4 . C5 E5 A5 - G5 E5', 'F5 - E5 C5 A4 - C5 -', 'G4 . C5 E5 G5 - E5 C5', 'D5 - B4 G4 B4 D5 G5 -',
        'A4 . C5 E5 A5 - B5 C6', 'A5 - F5 - C5 - A4 -', 'G5 - E5 G5 C6 - B5 G5', 'E5 - G#5 - B5 - G#5 E5',
        'D5 - F5 - A5 - F5 D5', 'E5 - F5 A5 D6 - C6 A5', 'C6 - B5 A5 E5 - A5 -', 'A5 - C6 - E6 - C6 A5',
        'F5 - A5 - C6 - A5 F5', 'G5 - B5 - D6 - B5 G5', 'A5 C6 E6 C6 A5 E5 C5 E5', 'G#5 - B5 - E6 - D6 B5'
      ],
      bass: { wave: 'triangle', vol: 0.34, len: 1.6, shape: 'pluck',
              pats: { A: '0 . 0 . 12 . 0 . 0 . 0 . 12 . 7 .', B: '0 . 0 12 . 0 . 7 0 . 0 12 . 7 . 5' }, seq: 'A A A B A A B B' },
      arp: { wave: 'square', vol: 0.06, len: 1.3, oct: 12,
             pats: { A: '0 1 2 3 2 1 2 1 0 1 2 3 2 1 2 3', B: '0 . 2 . 1 . 3 . 0 . 2 . 1 . 3 .' }, seq: 'A A A A A A B A' },
      leadv: { wave: 'square', vol: 0.09, shape: 'hold' },
      lead2v: { wave: 'triangle', vol: 0.07, shape: 'hold' },
      drums: { pats: { A: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
                       B: { kick: 'x..xx...x..xx.x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xo' } },
               seq: 'A A A A B B B B', kv: 0.9, sv: 0.6, hv: 0.5, fill: '....x...x.x.xxxx' }
    },

    // stage 2: THE CRACK OF DOOM, 138 bpm D minor / phrygian-tinged, bass drive, 16 bars
    stage2: {
      bpm: 138, loop: true, l2rhy: 'quad',
      prog: 'Dm Dm Bb C Dm Dm Gm A Dm Bb C Dm F Gm Eb A',
      lead: [
        'D5 . D5 F5 A5 . G5 F5', 'E5 - D5 . A4 - D5 F5', 'D5 . D5 F5 Bb5 - A5 F5', 'E5 . G5 E5 C5 - E5 G5',
        'A5 - F5 D5 F5 - A5 -', 'D6 - C6 A5 F5 - E5 D5', 'G5 . Bb5 D6 Bb5 - G5 -', 'A5 . C#6 E6 C#6 - A5 G5',
        'D5 F5 A5 D6 - C6 A5 F5', 'D6 - Bb5 F5 D5 - F5 Bb5', 'C6 - G5 E5 G5 - C6 E6', 'D6 - A5 F5 A5 D6 F6 -',
        'F5 A5 C6 F6 - E6 C6 A5', 'G5 Bb5 D6 G6 - F6 D6 Bb5', 'G5 Bb5 Eb6 - D6 Bb5 G5 -', 'E6 - C#6 - A5 - G5 E5'
      ],
      bass: { wave: 'sawtooth', vol: 0.2, len: 1.2, shape: 'pluck',
              pats: { A: '0 0 . 0 0 . 0 12 0 0 . 0 0 . 7 5', B: '0 . 12 0 . 12 0 . 0 . 12 0 . 7 10 12' }, seq: 'A A A B' },
      arp: { wave: 'square', vol: 0.055, len: 1.2, oct: 12,
             pats: { A: '0 1 2 3 0 1 2 3 2 1 0 1 2 3 2 1', B: '0 . 1 . 2 . 3 . 2 . 1 . 0 . 1 .' }, seq: 'A A B A' },
      leadv: { wave: 'sawtooth', vol: 0.075, shape: 'hold' },
      lead2v: { wave: 'square', vol: 0.045, shape: 'hold' },
      drums: { pats: { A: { kick: 'x..x..x...x..x..', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
                       B: { kick: 'x..x..x.x.x..x.x', snare: '....x.......x..x', hat: 'x.x.x.xxx.x.x.xx' } },
               seq: 'A A A B', kv: 0.9, sv: 0.62, hv: 0.5, fill: '....x..xx.x.xxxx' }
    },

    // stage 3: RECTUM OF THE GODS, 126 bpm C minor, dark and claustrophobic: sparse arp, pad, big bass, 16 bars
    stage3: {
      bpm: 126, loop: true, l2rhy: 'half',
      prog: 'Cm Cm Ab Ab Fm Fm G G Cm Cm Ab Eb Fm Db G G',
      lead: [
        'G4 - - - Eb5 - D5 -', 'C5 - - - G4 - . .', 'Eb5 - - - C5 - Eb5 -', 'Ab5 - - - G5 - Eb5 -',
        'F5 - - - Ab5 - C6 -', 'Ab5 - G5 - F5 - . .', 'D5 - - - B4 - D5 G5', 'B5 - - - D6 - . .',
        'G5 . G5 Eb5 C5 - Eb5 -', 'D5 - Eb5 - G5 - C6 -', 'C6 - Eb6 - C6 - Ab5 -', 'Bb5 - G5 - Eb5 - G5 Bb5',
        'C6 - Ab5 - F5 - Ab5 C6', 'Db6 - C6 - Ab5 - F5 -', 'B5 - D6 - F6 - D6 B5', 'D6 - B5 - G5 - B4 .'
      ],
      bass: { wave: 'sawtooth', vol: 0.2, len: 3, shape: 'hold',
              pats: { A: '0 . . . 0 . . 0 . . 0 . . . 7 .', B: '0 . . 0 . . 0 . 12 . . 0 . . 7 .' }, seq: 'A A A B' },
      arp: { wave: 'triangle', vol: 0.06, len: 2.2, oct: 12,
             pats: { A: '0 . . . 2 . . . 1 . . . 3 . 2 .', B: '0 . 1 . . . 2 . 3 . . . 2 . 1 .' }, seq: 'A B' },
      pad: { wave: 'triangle', vol: 0.045 },
      leadv: { wave: 'square', vol: 0.07, shape: 'hold' },
      lead2v: { wave: 'triangle', vol: 0.06, shape: 'hold' },
      drums: { pats: { A: { kick: 'x.....x...x.....', snare: '........x.......', hat: '..x...x...x...x.' },
                       B: { kick: 'x.....x...x...x.', snare: '........x.....x.', hat: 'x.x.x.x.x.x.x.x.' } },
               seq: 'A A A B', kv: 0.95, sv: 0.65, hv: 0.4, fill: '........x...xxxx' }
    },

    // stage 4 (bonus): THE GREAT STINKHOLE, 134 bpm G minor, wobbly detuned lead, 16 bars
    stage4: {
      bpm: 134, loop: true, l2rhy: 'sync',
      prog: 'Gm Gm Eb Eb Cm Cm D D Gm Bb F C Eb Cm D D',
      lead: [
        'D5 . G5 . Bb5 - A5 G5', 'D6 - Bb5 - G5 - F5 D5', 'G5 . Bb5 . Eb6 - D6 Bb5', 'G5 - Bb5 - Eb6 - Bb5 G5',
        'C6 - Eb6 - G6 - Eb6 C6', 'G5 - C6 - Eb6 - D6 C6', 'A5 . D6 . F#6 - E6 D6', 'F#6 - A6 - F#6 - D6 -',
        'G5 Bb5 D6 G6 - F6 D6 Bb5', 'Bb5 D6 F6 Bb6 - A6 F6 D6', 'C6 - A5 - F5 - A5 C6', 'E6 - G6 - E6 - C6 G5',
        'Eb6 - D6 - Bb5 - G5 Bb5', 'C6 - Eb6 G6 - Eb6 C6 G5', 'F#5 A5 D6 F#6 - E6 C6 A5', 'D6 - C6 - A5 - F#5 -'
      ],
      bass: { wave: 'sawtooth', vol: 0.2, len: 1.4, shape: 'pluck',
              pats: { A: '0 . 0 0 . 12 . 0 0 . 0 0 . 7 . 12', B: '0 0 . 12 . 0 0 . 5 . 7 . 0 . 12 .' }, seq: 'A A B A' },
      arp: { wave: 'square', vol: 0.05, len: 1.4, oct: 12,
             pats: { A: '0 . 1 . 2 . 3 . 2 . 1 . 0 . 2 .', B: '0 2 1 3 0 2 1 3 0 2 1 3 0 2 1 3' }, seq: 'A A B' },
      leadv: { wave: 'sawtooth', vol: 0.07, shape: 'hold', det: 14 },
      lead2v: { wave: 'square', vol: 0.045, shape: 'hold' },
      drums: { pats: { A: { kick: 'x..x..x..x..x...', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx' },
                       B: { kick: 'x..x..x.x...x.x.', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.' } },
               seq: 'A A B A', kv: 0.9, sv: 0.62, hv: 0.45, fill: '....x..xx.xxxxxx' }
    },

    // mid-boss: 160 bpm B minor, 8-bar loop, relentless
    midboss: {
      bpm: 160, loop: true, minInt: 0.85, l2rhy: 'quad',
      prog: 'Bm Bm G Em Bm G A A',
      lead: [
        'B5 B5 D6 B5 F#6 - E6 D6', 'B5 B5 D6 B5 A6 - F#6 -', 'G5 G5 B5 G5 D6 - B5 G5', 'E5 G5 B5 E6 - D6 B5 G5',
        'B5 B5 D6 B5 F#6 - E6 D6', 'D6 - B5 - G5 - B5 D6', 'A5 C#6 E6 A6 - G6 E6 C#6', 'E6 - C#6 - A5 - C#6 E6'
      ],
      bass: { wave: 'sawtooth', vol: 0.22, len: 1.0, shape: 'pluck',
              pats: { A: '0 0 12 0 0 12 0 0 0 0 12 0 0 7 0 12', B: '0 12 0 12 0 12 0 12 0 12 0 12 0 7 5 7' }, seq: 'A A A B' },
      arp: { wave: 'square', vol: 0.05, len: 1.1, oct: 0,
             pats: { A: '0 1 2 3 2 1 2 3 0 1 2 3 2 1 2 1' }, seq: 'A' },
      leadv: { wave: 'square', vol: 0.085, shape: 'hold' },
      lead2v: { wave: 'sawtooth', vol: 0.04, shape: 'hold' },
      drums: { pats: { A: { kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
                       B: { kick: 'x..xx.x.x..xx.x.', snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx' } },
               seq: 'A A A B', kv: 0.95, sv: 0.65, hv: 0.4, fill: '....x..xx.x.xxxx' }
    },

    // boss: 165 bpm E minor, 16 bars (v1 theme + layers; phases add fast arp / detuned lead / +2 semitones)
    boss: {
      bpm: 165, loop: true, minInt: 1, l2rhy: 'quad',
      prog: 'Em Em F Em Em Em C B Em F Em F C D F B',
      lead: [
        'E5 E5 G5 E5 B5 - A5 G5', 'E5 E5 G5 E5 D6 - B5 -', 'F5 F5 A5 F5 C6 - A5 -', 'G5 B5 E6 - D6 B5 G5 E5',
        'E5 E5 G5 E5 B5 - A5 G5', 'B5 - A5 - G5 - F#5 -', 'E5 G5 C6 - B5 G5 E5 G5', 'D#5 F#5 B5 - A5 F#5 D#5 -',
        'E6 - D6 B5 G5 - B5 -', 'F6 - E6 C6 A5 - C6 -', 'E6 - B5 G5 B5 - E6 -', 'C6 A5 F5 A5 C6 F6 E6 C6',
        'G5 C6 E6 - D6 C6 G5 -', 'F#5 A5 D6 - C6 A5 F#5 A5', 'A5 C6 F6 - E6 C6 A5 C6', 'D#6 - B5 - F#5 - D#5 .'
      ],
      bass: { wave: 'sawtooth', vol: 0.22, len: 1.0, shape: 'pluck',
              pats: { A: '0 0 12 0 0 0 12 0 0 0 12 0 0 7 0 12', B: '0 12 0 12 0 12 0 12 0 0 12 0 12 7 5 7' }, seq: 'A A A A A A A B' },
      arp: { wave: 'square', vol: 0.055, len: 1.1, oct: 0, pats: { A: '0 1 2 3 2 1 2 3 0 1 2 3 2 1 2 1' }, seq: 'A' },
      leadv: { wave: 'sawtooth', vol: 0.09, shape: 'hold' },
      lead2v: { wave: 'square', vol: 0.045, shape: 'hold' },
      drums: { pats: { A: { kick: 'x..xx..xx..xx.x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
                       B: { kick: 'x..xx..xx.x.x.xx', snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx' } },
               seq: 'A A A B', kv: 0.95, sv: 0.65, hv: 0.4, fill: '....x..xx.x.xxxx' }
    },

    gameover: {
      bpm: 84, loop: false, fixed: true,
      prog: 'Am F Dm Am',
      lead: [
        'E5 - D5 - C5 - B4 -', 'C5 - A4 - G4 - F4 -', 'F4 - E4 - D4 - - -', 'E4 - - - A3 - - -'
      ],
      bass: { wave: 'triangle', vol: 0.3, len: 7, shape: 'hold', pats: { A: '0 . . . . . . . . . . . . . . .' } },
      pad: { wave: 'triangle', vol: 0.05 },
      leadv: { wave: 'square', vol: 0.09, shape: 'hold' },
      drums: { pats: { A: { kick: 'x...............', snare: '................', hat: '................' } }, kv: 0.5 }
    }
  };
  var TRACK_NAMES = ['title', 'stage1', 'stage2', 'stage3', 'stage4', 'midboss', 'boss', 'gameover'];

  function parsePat(str) {
    var tk = String(str).split(/\s+/), out = [];
    for (var i = 0; i < 16; i++) out.push(tk[i] == null || tk[i] === '.' ? null : Number(tk[i]));
    return out;
  }
  function parsePats(set) {
    var out = {};
    for (var k in set) if (set.hasOwnProperty(k)) out[k] = parsePat(set[k]);
    return out;
  }
  function parseNote(s) {
    var m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
    if (!m) return null;
    var semi = PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 12 * (parseInt(m[3], 10) + 1) + semi;
  }
  function parseChord(s) {
    var m = /^([A-G])([#b]?)(m7|m|dim|sus4|7|)$/.exec(s);
    if (!m) m = /^(C)()()$/.exec('C');
    var pc = PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    var iv = CH_Q[m[3]];
    return { root: 48 + ((pc + 12) % 12), ivs: iv, tones: [iv[0], iv[1], iv[2], iv[0] + 12] };
  }
  function midiName(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  // parse 8-eighth-token bars into a step-indexed event table
  function parseLine(lines, bars, out) {
    var last = null;
    for (var b = 0; b < bars; b++) {
      var tk = (lines[b] || '').split(/\s+/);
      for (var i = 0; i < 8; i++) {
        var tok = tk[i];
        if (tok === '-') { if (last) last.len += 2; continue; }
        last = null;
        if (!tok || tok === '.') continue;
        var m = parseNote(tok);
        if (m == null) continue;
        last = { midi: m, len: 2 };
        out[b * 16 + i * 2] = last;
      }
    }
  }

  // countermelody built from chord tones only (always consonant with the harmony)
  function autoHarm(d) {
    var out = [];
    for (var b = 0; b < d.bars; b++) {
      var ch = d.chords[b], cands = [], o, i;
      for (o = 3; o <= 7; o++) for (i = 0; i < 3; i++) cands.push((o + 1) * 12 + (ch.root % 12) + ch.ivs[i]);
      var best = function (aim, skipPc) {
        var r = null;
        for (var k = 0; k < cands.length; k++) {
          if (skipPc != null && cands[k] % 12 === skipPc) continue;
          if (r == null || Math.abs(cands[k] - aim) < Math.abs(r - aim)) r = cands[k];
        }
        return r;
      };
      var n1 = best(76), n2 = best(72, n1 % 12);
      var a = midiName(n1), c = midiName(n2), rh = d.l2rhy || 'half';
      if (rh === 'quad') out.push([a, '-', c, '-', a, '-', c, '-'].join(' '));
      else if (rh === 'sync') out.push([a, '-', '-', c, '-', a, '-', '.'].join(' '));
      else out.push([a, '-', '-', '-', c, '-', '-', '-'].join(' '));
    }
    return out;
  }

  function compile(d) {
    d.chords = d.prog.split(/\s+/).map(parseChord);
    d.bars = d.chords.length;
    d.steps = d.bars * 16;
    d.sd = 60 / d.bpm / 4;
    d.leadEv = [];
    d.lead2Ev = [];
    parseLine(d.lead, d.bars, d.leadEv);
    if (d.lead2v) parseLine(d.lead2 || autoHarm(d), d.bars, d.lead2Ev);
    var parts = ['bass', 'arp'];
    for (var i = 0; i < parts.length; i++) {
      var p = d[parts[i]];
      if (!p) continue;
      p.sets = parsePats(p.pats);
      p.seqA = (p.seq || 'A').split(/\s+/);
    }
    var dr = d.drums;
    if (dr) { dr.seqA = (dr.seq || 'A').split(/\s+/); }
    d.fastArp = parsePat(FAST_ARP);
    d.th = d.th || LAYERS;
    return d;
  }
  for (var ti = 0; ti < TRACK_NAMES.length; ti++) compile(TRACKS[TRACK_NAMES[ti]]);
  TRACKS.stage = TRACKS.stage1;   // v1 alias

  var M = {
    track: null, def: null, step: 0, nextTime: 0, timer: null, intensity: 0.8, session: null, endAt: 0,
    paused: false, phase: 1, danger: false, rate: 1, transpose: 0, active: {}, duckUntil: 0, duckDepth: 1, nextBeat: 0
  };

  function canonTrack(name) {
    if (typeof name !== 'string') return null;
    if (name === 'stage') return 'stage1';
    return TRACKS.hasOwnProperty(name) ? name : null;
  }

  function startMusic(name, opts) {
    try {
      var c = canonTrack(name);
      if (!c) { warnOnce('track', String(name)); c = 'stage1'; }
      wantTrack = c;
      if (!ctx) return;                                   // will start from init()
      var restart = !!(opts && opts.restart);
      if (M.track === c && !restart) return;              // same track: no-op
      var fade = (opts && typeof opts.fade === 'number' && opts.fade >= 0) ? Math.min(opts.fade, 5) : 0.05;
      stopMusicInternal(fade);
      var bus = ctx.createGain(), g = {}, n, names = ['arp', 'lead', 'lead2'];
      var now = ctx.currentTime;
      if (fade > 0.06) { setV(bus.gain, 0.0001, now); lin(bus.gain, 1, now + fade); } else val(bus.gain, 1);
      bus.connect(duckGain);
      for (n = 0; n < names.length; n++) { g[names[n]] = ctx.createGain(); val(g[names[n]].gain, 1); g[names[n]].connect(bus); }
      M.session = { bus: bus, g: g, srcs: [] };
      M.track = c;
      M.def = TRACKS[c];
      M.step = 0;
      M.endAt = 0;
      M.phase = 1;
      M.transpose = 0;
      M.paused = false;
      M.active = {};
      M.nextTime = now + 0.06;
      updateFilter();
      M.timer = setInterval(tick, 25);
      tick();
    } catch (e) {}
  }

  function stopMusicInternal(fade) {
    if (M.timer) { clearInterval(M.timer); M.timer = null; }
    var S = M.session;
    M.session = null;
    M.track = null;
    M.def = null;
    M.paused = false;
    if (S) {
      try {
        var now = ctx.currentTime, f = (typeof fade === 'number' && fade >= 0) ? fade : 0.1;
        cancel(S.bus.gain, now);
        target(S.bus.gain, 0, now, Math.max(0.01, f / 3));
        for (var i = 0; i < S.srcs.length; i++) { try { S.srcs[i].stop(now + f + 0.08); } catch (e) {} }
      } catch (e) {}
      var lead = S.g;
      setTimeout(function () {
        for (var k in lead) if (lead.hasOwnProperty(k)) disc(lead[k]);
        disc(S.bus);
      }, Math.round(((typeof fade === 'number' ? fade : 0.1) + 0.5) * 1000));
    }
  }

  function stopMusic(opts) {
    wantTrack = null;
    try { stopMusicInternal((opts && typeof opts.fade === 'number' && opts.fade >= 0) ? Math.min(opts.fade, 5) : 0.1); } catch (e) {}
  }

  function setIntensity(x) {
    try {
      x = Number(x);
      if (x !== x) return;
      M.intensity = clamp(x, 0, 1);       // layers follow at the next bar line
    } catch (e) {}
  }

  function setPhase(n) {
    try {
      n = Math.round(Number(n));
      if (n !== n) return;
      M.phase = clamp(n, 1, 3);
    } catch (e) {}
  }

  function setDanger(b) {
    try {
      b = !!b;
      if (b && !M.danger && ctx) M.nextBeat = ctx.currentTime + 0.03;
      M.danger = b;
      updateFilter();
    } catch (e) {}
  }

  function setRate(r) {
    try {
      r = Number(r);
      if (r !== r) return;
      M.rate = clamp(r, 0.5, 1);
      updateFilter();
    } catch (e) {}
  }

  function updateFilter() {
    try {
      if (!ctx || !musicLP) return;
      var f = 20000;
      if (M.danger) f = Math.min(f, 1800);
      if (M.rate < 1) f = Math.min(f, 5000 + (M.rate - 0.5) / 0.5 * 15000);
      if (M.paused) f = Math.min(f, 600);
      target(musicLP.frequency, f, ctx.currentTime, 0.08);
    } catch (e) {}
  }

  function pauseMusic() {
    try {
      if (!M.track || M.paused) return;
      M.paused = true;
      stopLoops();
      updateFilter();
      if (M.session) target(M.session.bus.gain, 0.4, ctx.currentTime, 0.05);
    } catch (e) {}
  }

  function resumeMusic() {
    try {
      if (!M.track || !M.paused) return;
      M.paused = false;
      M.nextTime = ctx.currentTime + 0.06;
      updateFilter();
      if (M.session) { cancel(M.session.bus.gain, ctx.currentTime); target(M.session.bus.gain, 1, ctx.currentTime, 0.05); }
    } catch (e) {}
  }

  function duck(ms, depth) {
    try {
      if (!ctx || !duckGain) return;
      ms = (typeof ms === 'number' && ms === ms) ? clamp(ms, 20, 10000) : 300;
      depth = (typeof depth === 'number' && depth === depth) ? clamp(depth, 0.05, 1) : 0.45;
      var now = ctx.currentTime;
      if (now < M.duckUntil && M.duckDepth < depth) depth = M.duckDepth;   // keep the deeper duck
      var until = Math.max(now + ms / 1000, M.duckUntil);
      M.duckDepth = depth; M.duckUntil = until;
      cancel(duckGain.gain, now);
      target(duckGain.gain, depth, now, 0.015);
      target(duckGain.gain, 1, until, 0.17);
    } catch (e) {}
  }

  // ---- stingers: one-shot, routed through the SFX bus so they cut through the music
  var STING = {
    warning: function (v, t) {
      var i;
      for (i = 0; i < 8; i++) {
        tone(v, { type: 'square', f0: (i % 2 ? 660 : 880) * (1 + i * 0.03), t: t + i * 0.34, dur: 0.32, vol: 0.22, a: 0.004, hold: 0.8 });
      }
      var n = noise(v, { t: t, dur: 2.7, vol: 0.2, noenv: true, ftype: 'highpass', f0: 500, f1: 7000, q: 1 });
      if (n) { setV(n.gain.gain, 0.0001, t); lin(n.gain.gain, 0.25, t + 2.6); setV(n.gain.gain, 0, t + 2.8); }
      tone(v, { type: 'sine', f0: 55, f1: 110, t: t, dur: 2.7, vol: 0.4, a: 0.2, hold: 0.9 });
      tone(v, { type: 'sawtooth', f0: 220, t: t + 2.5, dur: 0.3, vol: 0.18, a: 0.004 });
    },
    clear: function (v, t) {
      var seq = [[523.25, 659.25, 783.99, 1046.5], [698.5, 880, 1046.5, 1396.9], [783.99, 987.8, 1174.7, 1568]], i, j;
      for (i = 0; i < seq.length; i++) {
        for (j = 0; j < 4; j++) {
          var at = t + i * 0.5 + j * 0.09;
          tone(v, { type: 'square', f0: seq[i][j], t: at, dur: 0.12, vol: 0.18, a: 0.003 });
          tone(v, { type: 'triangle', f0: seq[i][j] * 2, t: at, dur: 0.12, vol: 0.09, a: 0.003 });
        }
      }
      var fin = [1046.5, 1318.5, 1568, 2093];
      for (i = 0; i < fin.length; i++) {
        tone(v, { type: 'square', f0: fin[i], t: t + 1.6, dur: 2.2, vol: 0.12, a: 0.005, hold: 0.5 });
        tone(v, { type: 'triangle', f0: fin[i], t: t + 1.6, dur: 2.2, vol: 0.1, a: 0.005, det: 7 });
      }
      tone(v, { type: 'triangle', f0: 130.8, t: t + 1.6, dur: 2.2, vol: 0.3, a: 0.01, hold: 0.6 });
      tone(v, { type: 'sine', f0: 140, f1: 45, t: t + 1.6, dur: 0.3, vol: 0.5, a: 0.002 });
      noise(v, { t: t + 1.6, dur: 0.5, vol: 0.2, ftype: 'highpass', f0: 5000 });
    },
    midboss_clear: function (v, t) {
      var f = [783.99, 1046.5, 1318.5, 1568], i;
      for (i = 0; i < 4; i++) {
        tone(v, { type: 'square', f0: f[i], t: t + i * 0.08, dur: 0.1, vol: 0.18, a: 0.003 });
        tone(v, { type: 'triangle', f0: f[i] * 2, t: t + i * 0.08, dur: 0.1, vol: 0.09, a: 0.003 });
      }
      var c = [1046.5, 1318.5, 1568];
      for (i = 0; i < 3; i++) tone(v, { type: 'square', f0: c[i], t: t + 0.4, dur: 1.0, vol: 0.13, a: 0.004, hold: 0.5 });
      tone(v, { type: 'sine', f0: 130, f1: 50, t: t + 0.4, dur: 0.25, vol: 0.5, a: 0.002 });
    },
    title: function (v, t) {
      var A = [800, 1150, 2800];
      vowel(v, t, 0.5, 105, 118, [700, 1050, 2700], A, 0.5);                                         // "aaa"
      noise(v, { t: t + 0.48, dur: 0.4, vol: 0.28, a: 0.03, ftype: 'highpass', f0: 5500, f1: 7500, q: 1 }); // "sss"
      vowel(v, t + 0.92, 0.18, 120, 110, [400, 1000, 2500], A, 0.5);                                 // "ma"
      noise(v, { t: t + 1.1, dur: 0.1, vol: 0.25, ftype: 'highpass', f0: 6500, q: 1 });              // "s"
      noise(v, { t: t + 1.2, dur: 0.02, vol: 0.3, ftype: 'bandpass', f0: 3000, q: 2 });              // "t"
      vowel(v, t + 1.22, 0.24, 110, 90, [550, 1800, 2500], [500, 1350, 1700], 0.5);                  // "er"
      var ch = [220, 261.63, 329.63, 440], i;
      for (i = 0; i < ch.length; i++) {
        tone(v, { type: 'square', f0: ch[i], t: t + 1.25, dur: 0.5, vol: 0.12, a: 0.004 });
        tone(v, { type: 'sawtooth', f0: ch[i] * 2, t: t + 1.25, dur: 0.5, vol: 0.05, a: 0.004 });
      }
    }
  };
  var STING_DUCK = { warning: [2800, 0.4], clear: [4000, 0.3], midboss_clear: [1000, 0.4], title: [1700, 0.35] };

  function stinger(name) {
    try {
      if (typeof name !== 'string' || !STING.hasOwnProperty(name)) { warnOnce('stinger', String(name)); return; }
      if (ctx && ctx.state === 'suspended') resumeCtx();
      if (!ctx || muted || !running()) return;
      if (name === 'clear' && M.track) { wantTrack = null; stopMusicInternal(0.3); }
      var v = allocVoice('stinger', 1, null);
      if (!v) return;
      STING[name](v, ctx.currentTime + 0.005);
      var dk = STING_DUCK[name];
      duck(dk[0], dk[1]);
    } catch (e) {}
  }

  // ---- sequencer
  function tick() {
    try {
      if (!ctx || !M.def || !running()) return;
      var d = M.def;
      if (M.paused) return;
      if (M.danger && !muted) heartbeat();
      if (M.nextTime < ctx.currentTime - 0.25) M.nextTime = ctx.currentTime + 0.05; // tab was throttled: don't burst
      if (M.endAt) {                                   // non-looping track finished, waiting for the tail
        if (ctx.currentTime >= M.endAt) { wantTrack = null; stopMusicInternal(0.1); }
        return;
      }
      var sd = d.sd / M.rate;
      while (M.nextTime < ctx.currentTime + 0.1) {
        if (M.step >= d.steps) {
          if (d.loop) { M.step = 0; }
          else { M.endAt = M.nextTime + 2.5; return; }
        }
        if (M.step === 0) M.transpose = M.phase >= 3 ? 2 : 0;
        if (!muted) scheduleStep(d, M.step, M.nextTime, sd);
        M.step++;
        M.nextTime += sd;
      }
    } catch (e) {}
  }

  // lub-dub heartbeat, period 36 frames (0.6 s), dub 10 frames after lub
  function heartbeat() {
    var now = ctx.currentTime;
    if (!M.nextBeat || M.nextBeat < now - 1) M.nextBeat = now + 0.03;
    while (M.nextBeat < now + 0.1) {
      var t = M.nextBeat;
      var v = allocVoice('hb', 1, null);
      if (v) {
        tone(v, { type: 'sine', f0: 62, f1: 38, t: t, dur: 0.16, vol: 0.55, a: 0.004 });
        tone(v, { type: 'sine', f0: 54, f1: 34, t: t + 10 / 60, dur: 0.14, vol: 0.38, a: 0.004 });
      }
      M.nextBeat += 36 / 60;
    }
  }

  function updateLayers(t, d) {
    var S = M.session, eff = Math.max(M.intensity, d.minInt || 0), k;
    for (k in LAYERS) {
      if (!LAYERS.hasOwnProperty(k)) continue;
      var want = d.fixed ? true : eff >= d.th[k];
      if (M.phase >= 2 && (k === 'arp' || k === 'hat2')) want = true;
      if (M.phase >= 3 && k === 'lead2') want = true;
      if (want !== M.active[k]) {
        M.active[k] = want;
        if (S.g[k]) target(S.g[k].gain, want ? 1 : 0, t, 0.06);
      }
    }
  }

  function pick(p, bar) { return p.sets[p.seqA[bar % p.seqA.length]] || p.sets.A; }

  function scheduleStep(d, s, t, sd) {
    var bar = (s / 16) | 0, st = s % 16, ch = d.chords[bar], S = M.session, bus = S.bus, tr = M.transpose;
    var b = d.bass, a = d.arp, i, A;
    if (st === 0) updateLayers(t, d);
    A = M.active;
    var base = ch.root + tr;
    if (b) {
      var off = pick(b, bar)[st];
      if (off != null) {
        mNote(b.wave, base - 12 + off, t, sd * b.len, b.vol, bus, b.shape);
        if (A.bassOct) mNote('triangle', base + off, t, sd * 0.9, b.vol * 0.45, bus, 'pluck');
      }
    }
    if (a && A.arp) {
      var idx = (M.phase >= 2 ? d.fastArp : pick(a, bar))[st];
      if (idx != null) mNote(a.wave, base + a.oct + ch.tones[idx], t, sd * a.len, a.vol, S.g.arp, 'pluck');
    }
    if (d.pad && st === 0) {
      for (i = 0; i < 3; i++) mNote(d.pad.wave, base + ch.ivs[i], t, sd * 15.5, d.pad.vol, bus, 'hold', 0.25);
    }
    var ev = d.leadEv[s];
    if (ev && d.leadv && A.lead) {
      mNote(d.leadv.wave, ev.midi + tr, t, sd * ev.len * 0.95, d.leadv.vol, S.g.lead, d.leadv.shape, null, d.leadv.det);
      if (M.phase >= 3) mNote('sawtooth', ev.midi + tr, t, sd * ev.len * 0.95, d.leadv.vol * 0.5, S.g.lead2, 'hold', null, 14);
    }
    var ev2 = d.lead2Ev[s];
    if (ev2 && d.lead2v && A.lead2) mNote(d.lead2v.wave, ev2.midi + tr, t, sd * ev2.len * 0.95, d.lead2v.vol, S.g.lead2, d.lead2v.shape);
    var dr = d.drums;
    if (dr) {
      var dp = dr.pats[dr.seqA[bar % dr.seqA.length]] || dr.pats.A;
      var fillBar = dr.fill && A.fill && ((bar % 8 === 7) || (M.phase >= 3 && bar % 4 === 3));
      if (dp.kick.charAt(st) === 'x') mKick(t, dr.kv || 0.8, bus);
      var sn = fillBar ? dr.fill : dp.snare;
      if (sn.charAt(st) === 'x') mSnare(t, dr.sv || 0.5, bus);
      var h = dp.hat.charAt(st);
      if (h === 'x') mHat(t, (dr.hv || 0.4) * 0.6, false, bus);
      else if (h === 'o') mHat(t, dr.hv || 0.4, true, bus);
      else if (A.hat2 && st % 2 === 1) mHat(t, (dr.hv || 0.4) * 0.35, false, bus);
    }
  }

  // one music note: osc -> env gain -> bus (optional detuned twin for a wobbly chorus)
  function mNote(type, midi, t, dur, vol0, dest, shape, att, det) {
    var S = M.session;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    setV(o.frequency, mtof(midi), t);
    setV(g.gain, 0.0001, t);
    lin(g.gain, vol0, t + (att || 0.006));
    if (shape === 'hold') setV(g.gain, vol0, t + dur * 0.65);
    expo(g.gain, 0.0001, t + dur);
    o.connect(g); g.connect(dest);
    var nodes = [o, g];
    if (det) {
      var o2 = ctx.createOscillator();
      o2.type = type;
      setV(o2.frequency, mtof(midi), t);
      val(o2.detune, det);
      o2.connect(g);
      nodes.push(o2);
      trackSrc(S, o2, [o2]);
      try { o2.start(t); o2.stop(t + dur + 0.03); } catch (e) {}
    }
    trackSrc(S, o, nodes);
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

  function mNoise(t, dur, vol0, ftype, f0, f1, q, dest) {
    if (!noiseBuf) return;
    var S = M.session;
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = ftype; setV(f.frequency, f0, t);
    if (f1) expo(f.frequency, f1, t + dur);
    val(f.Q, q || 1);
    setV(g.gain, 0.0001, t); lin(g.gain, vol0, t + 0.002); expo(g.gain, 0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    trackSrc(S, s, [s, f, g]);
    try { s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.03); } catch (e) {}
  }

  function mKick(t, vol0, dest) {
    var S = M.session;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    setV(o.frequency, 160, t); expo(o.frequency, 42, t + 0.13);
    setV(g.gain, vol0, t); expo(g.gain, 0.0001, t + 0.2);
    o.connect(g); g.connect(dest);
    trackSrc(S, o, [o, g]);
    try { o.start(t); o.stop(t + 0.23); } catch (e) {}
  }

  function mSnare(t, vol0, dest) {
    mNoise(t, 0.13, vol0, 'bandpass', 1900, 1200, 0.8, dest);
    var S = M.session;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    setV(o.frequency, 230, t); expo(o.frequency, 120, t + 0.08);
    setV(g.gain, vol0 * 0.5, t); expo(g.gain, 0.0001, t + 0.09);
    o.connect(g); g.connect(dest);
    trackSrc(S, o, [o, g]);
    try { o.start(t); o.stop(t + 0.12); } catch (e) {}
  }

  function mHat(t, vol0, open, dest) {
    mNoise(t, open ? 0.09 : 0.03, vol0 * 0.5, 'highpass', 7500, 0, 1, dest);
  }

  // -------------------------------------------------------------------- API
  var SFX = {
    init: init,
    play: play,
    setMuted: setMuted,
    setVolume: setVolume,
    stopLoops: stopLoops,
    hasTrack: function (n) { try { return canonTrack(n) != null; } catch (e) { return false; } },
    tracks: function () { return TRACK_NAMES.slice(); },
    music: {
      start: startMusic,
      stop: stopMusic,
      pause: pauseMusic,
      resume: resumeMusic,
      setIntensity: setIntensity,
      setPhase: setPhase,
      setDanger: setDanger,
      stinger: stinger,
      duck: duck,
      setRate: setRate
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
