/* aasssMaster studio - core.js
 * Global `Kit`: small helpers shared by synths.js / processors.js / sequencer.js.
 * Plain browser JS, no build step. Nothing here throws on a missing or broken AudioContext.
 */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);

  // ------------------------------------------------------------ AudioParam helpers (never throw)
  function setV(p, v, t) { try { p.setValueAtTime(v, t); } catch (e) {} }
  function lin(p, v, t) { try { p.linearRampToValueAtTime(v, t); } catch (e) {} }
  function expo(p, v, t) { try { p.exponentialRampToValueAtTime(Math.max(v, 0.0001), t); } catch (e) {} }
  function target(p, v, t, tc) { try { p.setTargetAtTime(v, t, tc); } catch (e) { try { p.value = v; } catch (e2) {} } }
  function val(p, v) { try { p.value = v; } catch (e) {} }
  function cancel(p, t) { try { p.cancelScheduledValues(t); } catch (e) {} }
  function disc(n) { try { if (n) n.disconnect(); } catch (e) {} }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function dbToGain(db) { return Math.pow(10, db / 20); }

  // ------------------------------------------------------------ notes and chords
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // chord quality -> semitone intervals from the root
  var CHORDS = {
    '': [0, 4, 7], 'maj': [0, 4, 7], 'm': [0, 3, 7], 'min': [0, 3, 7], 'dim': [0, 3, 6], 'aug': [0, 4, 8],
    '5': [0, 7], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10],
    'maj7': [0, 4, 7, 11], 'm9': [0, 3, 7, 10, 14], '9': [0, 4, 7, 10, 14], 'maj9': [0, 4, 7, 11, 14],
    'add9': [0, 4, 7, 14], 'madd9': [0, 3, 7, 14], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7], '7sus4': [0, 5, 7, 10],
    'm11': [0, 3, 7, 10, 17], 'm7b5': [0, 3, 6, 10]
  };

  // 'C#5' -> 73, 'Bb1' -> 34. Returns null when the string is not a note.
  function ntom(s) {
    if (typeof s === 'number') return s;
    var m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(s || '').trim());
    if (!m) return null;
    var semi = PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 12 * (parseInt(m[3], 10) + 1) + semi;
  }
  function mton(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  // 'G#m7' -> {root: pitch class 8, name:'G#', quality:'m7', ivs:[0,3,7,10]}
  function parseChord(s) {
    var m = /^([A-Ga-g])([#b]?)(.*)$/.exec(String(s || '').trim());
    if (!m) return null;
    var pc = (PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
    var q = m[3];
    var ivs = CHORDS.hasOwnProperty(q) ? CHORDS[q] : null;
    if (!ivs) return null;
    return { root: pc, name: m[1].toUpperCase() + m[2], quality: q, ivs: ivs.slice() };
  }

  // chord name + octave -> midi notes in a close voicing starting at octave `oct` (C4 = 60).
  // opts: {top: midi ceiling, inversion}
  function chordNotes(name, oct, opts) {
    var c = typeof name === 'string' ? parseChord(name) : name;
    if (!c) return [];
    var base = 12 * (oct + 1) + c.root, out = [], i;
    for (i = 0; i < c.ivs.length; i++) out.push(base + c.ivs[i]);
    var inv = (opts && opts.inversion) | 0;
    while (inv-- > 0 && out.length) out.push(out.shift() + 12);
    if (opts && typeof opts.top === 'number') {
      for (i = 0; i < out.length; i++) while (out[i] > opts.top) out[i] -= 12;
      out.sort(function (a, b) { return a - b; });
    }
    return out;
  }

  // ------------------------------------------------------------ buffers and curves
  var noiseCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function noise(ctx) {
    try {
      if (noiseCache && noiseCache.has(ctx)) return noiseCache.get(ctx);
      var sr = ctx.sampleRate || 44100, n = Math.floor(sr * 2);
      var buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      if (noiseCache) noiseCache.set(ctx, buf);
      return buf;
    } catch (e) { return null; }
  }

  // stereo exponentially decaying noise = a reverb impulse response. seconds, decay 0..1 (longer tail), hp Hz
  function impulse(ctx, seconds, decay, hp) {
    try {
      var sr = ctx.sampleRate || 44100, n = Math.max(1, Math.floor(sr * seconds));
      var buf = ctx.createBuffer(2, n, sr), ch, i, d, k = 2.5 + 6 * (1 - clamp(decay, 0, 1));
      var a = hp ? Math.exp(-2 * Math.PI * hp / sr) : 0;
      for (ch = 0; ch < 2; ch++) {
        d = buf.getChannelData(ch);
        var px = 0, py = 0;
        for (i = 0; i < n; i++) {
          var x = (Math.random() * 2 - 1) * Math.pow(1 - i / n, k);
          if (hp) { py = a * (py + x - px); px = x; d[i] = py; } else d[i] = x;
        }
      }
      return buf;
    } catch (e) { return null; }
  }

  // waveshaper curve: soft tanh-style clip. drive 0..1
  function shaperCurve(drive, n) {
    n = n || 1024;
    var c = new Float32Array(n), k = 1 + drive * 40;
    for (var i = 0; i < n; i++) {
      var x = i * 2 / (n - 1) - 1;
      c[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    return c;
  }

  // ------------------------------------------------------------ parameter specs
  // spec: {name: {min, max, value, unit?, label?}} -> obj.params (live values), obj.set/get
  // onSet(name, value, opts) is called after the value is stored, opts = {at, ramp} optional.
  function defineParams(obj, spec, onSet) {
    obj.params = {};
    obj.spec = spec;
    var k;
    for (k in spec) if (spec.hasOwnProperty(k)) obj.params[k] = spec[k].value;
    obj.set = function (name, value, opts) {
      try {
        if (!spec.hasOwnProperty(name)) return false;
        var s = spec[name];
        if (typeof s.value === 'string') obj.params[name] = String(value);
        else if (typeof s.value === 'boolean') obj.params[name] = !!value;
        else {
          var v = Number(value);
          if (v !== v) return false;
          obj.params[name] = clamp(v, s.min, s.max);
        }
        if (onSet) onSet(name, obj.params[name], opts || {});
        return true;
      } catch (e) { return false; }
    };
    obj.get = function (name) { return obj.params[name]; };
    return obj;
  }

  root.Kit = {
    setV: setV, lin: lin, expo: expo, target: target, val: val, cancel: cancel, disc: disc,
    clamp: clamp, rnd: rnd, mtof: mtof, ntom: ntom, mton: mton, dbToGain: dbToGain,
    parseChord: parseChord, chordNotes: chordNotes, CHORDS: CHORDS, NAMES: NAMES,
    noise: noise, impulse: impulse, shaperCurve: shaperCurve, defineParams: defineParams
  };
})();
