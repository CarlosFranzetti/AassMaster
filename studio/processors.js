/* aasssMaster studio - processors.js
 * Global `Processors`: Web Audio effect units with a uniform shape.
 *
 *   var d = Processors.create(ctx, 'delay', {division: '3/16', bpm: 126, feedback: 0.45, mix: 0.2});
 *   src.connect(d.input); d.output.connect(ctx.destination);
 *   d.set('mix', 0.3); d.set('mix', 0, {at: t, ramp: 4});   // ramps are scheduled on the AudioParam
 *   d.bypass(true); d.dispose();
 *
 * Types: filter, saturator, delay (stereo ping-pong, tempo-synced), reverb (generated impulse),
 *        eq3, compressor, limiter, sidechain (ducker: proc.trigger(t)), widener (mid/side), chorus.
 * Helpers: Processors.chain(ctx, specs), Processors.channel(ctx), Processors.master(ctx).
 * Nothing throws: without an AudioContext every unit is an inert object with the same API.
 */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  var K = root.Kit;
  var setV = K.setV, lin = K.lin, expo = K.expo, val = K.val, disc = K.disc, target = K.target, cancel = K.cancel, clamp = K.clamp;

  // schedule a parameter change: immediate (smoothed), or a ramp {at, ramp, from, curve:'lin'|'expo'}
  function auto(ctx, p, v, o) {
    if (!p) return;
    var at = (o && typeof o.at === 'number') ? o.at : ctx.currentTime;
    if (o && o.ramp > 0) {
      cancel(p, at);
      var from = (o.from != null) ? o.from : p.value;
      setV(p, from, at);
      if (o.curve === 'lin' || v <= 0 || from <= 0) lin(p, v, at + o.ramp); else expo(p, v, at + o.ramp);
    } else if (o && typeof o.at === 'number') {
      target(p, v, at, o.tc || 0.03);
    } else {
      target(p, v, at, 0.015);
    }
  }

  // division string '3/16' or '1/8' -> seconds at bpm
  function divSeconds(div, bpm) {
    var m = /^(\d+)\/(\d+)(d|t)?$/.exec(String(div || '').trim());
    if (!m) return null;
    var whole = 4 * 60 / bpm, s = whole * parseInt(m[1], 10) / parseInt(m[2], 10);
    if (m[3] === 'd') s *= 1.5; else if (m[3] === 't') s *= 2 / 3;
    return s;
  }

  // ------------------------------------------------------------ base
  function makeProc(ctx, type, spec, opts, build) {
    var proc = { type: type, ctx: ctx, input: null, output: null, nodes: [], _bypassed: false };
    proc.track = function (n) { if (n) proc.nodes.push(n); return n; };
    K.defineParams(proc, spec, function (name, v, o) { if (ctx && proc.onParam) { try { proc.onParam(name, v, o); } catch (e) {} } });
    proc.bypass = function (b) {
      proc._bypassed = !!b;
      if (!ctx || !proc._wet || !proc._dryBypass) return;
      target(proc._wet.gain, b ? 0 : 1, ctx.currentTime, 0.01);
      target(proc._dryBypass.gain, b ? 1 : 0, ctx.currentTime, 0.01);
    };
    proc.dispose = function () { for (var i = 0; i < proc.nodes.length; i++) disc(proc.nodes[i]); proc.nodes.length = 0; };
    if (!ctx) {
      if (opts) for (var k in opts) if (opts.hasOwnProperty(k)) proc.set(k, opts[k]);
      proc.trigger = function () {};
      return proc;
    }
    try {
      proc.input = proc.track(ctx.createGain());
      proc.output = proc.track(ctx.createGain());
      proc._wet = proc.track(ctx.createGain());         // processed path -> output
      proc._dryBypass = proc.track(ctx.createGain());   // bypass path
      val(proc._dryBypass.gain, 0);
      proc.input.connect(proc._dryBypass); proc._dryBypass.connect(proc.output);
      proc._wet.connect(proc.output);
      build(proc);                                      // must connect proc.input ... -> proc._wet
      if (opts) for (var k2 in opts) if (opts.hasOwnProperty(k2)) proc.set(k2, opts[k2]);
    } catch (e) {
      proc.input = proc.input || null; proc.output = proc.output || null;
    }
    if (!proc.trigger) proc.trigger = function () {};
    return proc;
  }

  var BUILD = {};

  BUILD.filter = {
    spec: { mode: { value: 'lowpass' }, cutoff: { min: 20, max: 20000, value: 20000, unit: 'Hz' }, q: { min: 0.05, max: 20, value: 0.7 },
            gain: { min: -24, max: 24, value: 0, unit: 'dB' } },
    build: function (p) {
      var ctx = p.ctx, f = p.track(ctx.createBiquadFilter());
      f.type = p.params.mode; val(f.frequency, p.params.cutoff); val(f.Q, p.params.q); val(f.gain, p.params.gain);
      p.input.connect(f); f.connect(p._wet);
      p.onParam = function (n, v, o) {
        if (n === 'mode') { try { f.type = v; } catch (e) {} }
        else if (n === 'cutoff') auto(ctx, f.frequency, v, o);
        else if (n === 'q') auto(ctx, f.Q, v, o);
        else if (n === 'gain') auto(ctx, f.gain, v, o);
      };
    }
  };

  BUILD.saturator = {
    spec: { drive: { min: 0, max: 1, value: 0.3 }, mix: { min: 0, max: 1, value: 1 }, tone: { min: 500, max: 20000, value: 12000, unit: 'Hz' },
            trim: { min: 0, max: 2, value: 1 } },
    build: function (p) {
      var ctx = p.ctx, sh = p.track(ctx.createWaveShaper()), lp = p.track(ctx.createBiquadFilter());
      var wet = p.track(ctx.createGain()), dry = p.track(ctx.createGain()), trim = p.track(ctx.createGain());
      try { sh.oversample = '2x'; } catch (e) {}
      sh.curve = K.shaperCurve(p.params.drive);
      lp.type = 'lowpass'; val(lp.frequency, p.params.tone); val(lp.Q, 0.5);
      val(wet.gain, p.params.mix); val(dry.gain, 1 - p.params.mix); val(trim.gain, p.params.trim);
      p.input.connect(sh); sh.connect(lp); lp.connect(wet); wet.connect(trim);
      p.input.connect(dry); dry.connect(trim); trim.connect(p._wet);
      p.onParam = function (n, v, o) {
        if (n === 'drive') { try { sh.curve = K.shaperCurve(v); } catch (e) {} }
        else if (n === 'mix') { auto(ctx, wet.gain, v, o); auto(ctx, dry.gain, 1 - v, o); }
        else if (n === 'tone') auto(ctx, lp.frequency, v, o);
        else if (n === 'trim') auto(ctx, trim.gain, v, o);
      };
    }
  };

  BUILD.delay = {
    spec: { time: { min: 0.01, max: 2, value: 0.357, unit: 's' }, division: { value: '' }, bpm: { min: 40, max: 300, value: 126 },
            feedback: { min: 0, max: 0.95, value: 0.4 }, mix: { min: 0, max: 1, value: 0.25 }, tone: { min: 300, max: 20000, value: 3500, unit: 'Hz' },
            pingpong: { value: true }, hp: { min: 20, max: 5000, value: 200, unit: 'Hz' } },
    build: function (p) {
      var ctx = p.ctx, P = p.params;
      var dL = p.track(ctx.createDelay(2.1)), dR = p.track(ctx.createDelay(2.1));
      var fbL = p.track(ctx.createGain()), fbR = p.track(ctx.createGain());
      var lp = p.track(ctx.createBiquadFilter()), hp = p.track(ctx.createBiquadFilter());
      var wet = p.track(ctx.createGain()), dry = p.track(ctx.createGain()), inR = p.track(ctx.createGain());
      var merger = p.track(ctx.createChannelMerger(2));
      lp.type = 'lowpass'; val(lp.frequency, P.tone); val(lp.Q, 0.5);
      hp.type = 'highpass'; val(hp.frequency, P.hp); val(hp.Q, 0.5);
      val(dL.delayTime, P.time); val(dR.delayTime, P.time);
      val(fbL.gain, P.feedback); val(fbR.gain, P.feedback); val(wet.gain, P.mix); val(dry.gain, 1 - P.mix);
      val(inR.gain, P.pingpong ? 0 : 1);
      // input -> hp -> lp -> dL ; input -> inR -> dR (only when not ping-pong)
      p.input.connect(hp); hp.connect(lp); lp.connect(dL); lp.connect(inR); inR.connect(dR);
      dL.connect(fbL); dR.connect(fbR);
      fbL.connect(P.pingpong ? dR : dL); fbR.connect(P.pingpong ? dL : dR);
      dL.connect(merger, 0, 0); dR.connect(merger, 0, 1);
      merger.connect(wet); wet.connect(p._wet);
      p.input.connect(dry); dry.connect(p._wet);
      function rewire() {
        disc(fbL); disc(fbR);
        fbL.connect(P.pingpong ? dR : dL); fbR.connect(P.pingpong ? dL : dR);
        val(inR.gain, P.pingpong ? 0 : 1);
      }
      function retime(o) {
        var s = P.division ? divSeconds(P.division, P.bpm) : null;
        if (s == null) s = P.time;
        s = clamp(s, 0.01, 2);
        auto(ctx, dL.delayTime, s, o); auto(ctx, dR.delayTime, s, o);
      }
      p.onParam = function (n, v, o) {
        if (n === 'time' || n === 'division' || n === 'bpm') retime(o);
        else if (n === 'feedback') { auto(ctx, fbL.gain, v, o); auto(ctx, fbR.gain, v, o); }
        else if (n === 'mix') { auto(ctx, wet.gain, v, o); auto(ctx, dry.gain, 1 - v, o); }
        else if (n === 'tone') auto(ctx, lp.frequency, v, o);
        else if (n === 'hp') auto(ctx, hp.frequency, v, o);
        else if (n === 'pingpong') rewire();
      };
    }
  };

  BUILD.reverb = {
    spec: { size: { min: 0.2, max: 8, value: 2.2, unit: 's' }, decay: { min: 0, max: 1, value: 0.6 }, damp: { min: 500, max: 20000, value: 5000, unit: 'Hz' },
            predelay: { min: 0, max: 0.2, value: 0.012, unit: 's' }, mix: { min: 0, max: 1, value: 0.25 }, hp: { min: 20, max: 2000, value: 160, unit: 'Hz' } },
    build: function (p) {
      var ctx = p.ctx, P = p.params;
      var pre = p.track(ctx.createDelay(0.25)), conv = p.track(ctx.createConvolver()), lp = p.track(ctx.createBiquadFilter());
      var wet = p.track(ctx.createGain()), dry = p.track(ctx.createGain());
      lp.type = 'lowpass'; val(lp.frequency, P.damp); val(lp.Q, 0.5);
      val(pre.delayTime, P.predelay); val(wet.gain, P.mix); val(dry.gain, 1 - P.mix);
      function regen() { var ir = K.impulse(ctx, P.size, P.decay, P.hp); if (ir) { try { conv.buffer = ir; } catch (e) {} } }
      regen();
      p.input.connect(pre); pre.connect(conv); conv.connect(lp); lp.connect(wet); wet.connect(p._wet);
      p.input.connect(dry); dry.connect(p._wet);
      p.onParam = function (n, v, o) {
        if (n === 'size' || n === 'decay' || n === 'hp') regen();
        else if (n === 'damp') auto(ctx, lp.frequency, v, o);
        else if (n === 'predelay') auto(ctx, pre.delayTime, v, o);
        else if (n === 'mix') { auto(ctx, wet.gain, v, o); auto(ctx, dry.gain, 1 - v, o); }
      };
    }
  };

  BUILD.eq3 = {
    spec: { low: { min: -24, max: 24, value: 0, unit: 'dB' }, lowFreq: { min: 30, max: 1000, value: 120, unit: 'Hz' },
            mid: { min: -24, max: 24, value: 0, unit: 'dB' }, midFreq: { min: 100, max: 10000, value: 1000, unit: 'Hz' }, midQ: { min: 0.1, max: 10, value: 1 },
            high: { min: -24, max: 24, value: 0, unit: 'dB' }, highFreq: { min: 1000, max: 16000, value: 6000, unit: 'Hz' } },
    build: function (p) {
      var ctx = p.ctx, P = p.params;
      var lo = p.track(ctx.createBiquadFilter()), mid = p.track(ctx.createBiquadFilter()), hi = p.track(ctx.createBiquadFilter());
      lo.type = 'lowshelf'; val(lo.frequency, P.lowFreq); val(lo.gain, P.low);
      mid.type = 'peaking'; val(mid.frequency, P.midFreq); val(mid.Q, P.midQ); val(mid.gain, P.mid);
      hi.type = 'highshelf'; val(hi.frequency, P.highFreq); val(hi.gain, P.high);
      p.input.connect(lo); lo.connect(mid); mid.connect(hi); hi.connect(p._wet);
      p.onParam = function (n, v, o) {
        var map = { low: lo.gain, lowFreq: lo.frequency, mid: mid.gain, midFreq: mid.frequency, midQ: mid.Q, high: hi.gain, highFreq: hi.frequency };
        if (map[n]) auto(ctx, map[n], v, o);
      };
    }
  };

  BUILD.compressor = {
    spec: { threshold: { min: -60, max: 0, value: -18, unit: 'dB' }, ratio: { min: 1, max: 20, value: 3 }, attack: { min: 0, max: 1, value: 0.01, unit: 's' },
            release: { min: 0.01, max: 1, value: 0.2, unit: 's' }, knee: { min: 0, max: 40, value: 6, unit: 'dB' }, makeup: { min: -12, max: 24, value: 0, unit: 'dB' } },
    build: function (p) {
      var ctx = p.ctx, P = p.params, c = p.track(ctx.createDynamicsCompressor()), mk = p.track(ctx.createGain());
      val(c.threshold, P.threshold); val(c.ratio, P.ratio); val(c.attack, P.attack); val(c.release, P.release); val(c.knee, P.knee);
      val(mk.gain, K.dbToGain(P.makeup));
      p.input.connect(c); c.connect(mk); mk.connect(p._wet);
      p.node = c;
      p.onParam = function (n, v, o) {
        if (n === 'makeup') auto(ctx, mk.gain, K.dbToGain(v), o);
        else if (c[n]) auto(ctx, c[n], v, o);
      };
    }
  };

  BUILD.limiter = {
    spec: { threshold: { min: -30, max: 0, value: -3, unit: 'dB' }, release: { min: 0.01, max: 1, value: 0.08, unit: 's' }, ceiling: { min: -12, max: 0, value: -0.5, unit: 'dB' } },
    build: function (p) {
      var ctx = p.ctx, P = p.params, c = p.track(ctx.createDynamicsCompressor()), out = p.track(ctx.createGain());
      val(c.threshold, P.threshold); val(c.ratio, 20); val(c.attack, 0.001); val(c.release, P.release); val(c.knee, 1);
      val(out.gain, K.dbToGain(P.ceiling));
      p.input.connect(c); c.connect(out); out.connect(p._wet);
      p.node = c;
      p.onParam = function (n, v, o) {
        if (n === 'threshold') auto(ctx, c.threshold, v, o);
        else if (n === 'release') auto(ctx, c.release, v, o);
        else if (n === 'ceiling') auto(ctx, out.gain, K.dbToGain(v), o);
      };
    }
  };

  // sidechain ducker: a gain that dips on trigger(t) (the kick calls it), Web Audio has no key input
  BUILD.sidechain = {
    spec: { depth: { min: 0, max: 1, value: 0.6 }, attack: { min: 0.001, max: 0.1, value: 0.004, unit: 's' }, hold: { min: 0, max: 0.5, value: 0.02, unit: 's' },
            release: { min: 0.01, max: 2, value: 0.22, unit: 's' } },
    build: function (p) {
      var ctx = p.ctx, P = p.params, g = p.track(ctx.createGain()), last = -1;
      p.node = g;
      p.input.connect(g); g.connect(p._wet);
      p.trigger = function (t) {
        if (P.depth <= 0) return;
        var len = P.attack + P.hold + P.release;
        cancel(g.gain, t);
        setV(g.gain, (t - last) >= len ? 1 : 1 - P.depth, t);
        lin(g.gain, 1 - P.depth, t + P.attack);
        setV(g.gain, 1 - P.depth, t + P.attack + P.hold);
        lin(g.gain, 1, t + len);
        last = t;
      };
      p.onParam = function (n, v) { if (n === 'depth' && v <= 0) { cancel(g.gain, ctx.currentTime); target(g.gain, 1, ctx.currentTime, 0.02); } };
    }
  };

  // mid/side width: 0 = mono, 1 = as is, 2 = twice the side signal
  BUILD.widener = {
    spec: { width: { min: 0, max: 3, value: 1 } },
    build: function (p) {
      var ctx = p.ctx, P = p.params;
      var sp = p.track(ctx.createChannelSplitter(2)), mg = p.track(ctx.createChannelMerger(2));
      var lHalf = p.track(ctx.createGain()), rHalf = p.track(ctx.createGain()), lHalf2 = p.track(ctx.createGain()), rNeg = p.track(ctx.createGain());
      var mid = p.track(ctx.createGain()), side = p.track(ctx.createGain()), sW = p.track(ctx.createGain()), sWn = p.track(ctx.createGain());
      val(lHalf.gain, 0.5); val(rHalf.gain, 0.5); val(lHalf2.gain, 0.5); val(rNeg.gain, -0.5);
      val(sW.gain, P.width); val(sWn.gain, -P.width);
      p.input.connect(sp);
      sp.connect(lHalf, 0); sp.connect(rHalf, 1); lHalf.connect(mid); rHalf.connect(mid);
      sp.connect(lHalf2, 0); sp.connect(rNeg, 1); lHalf2.connect(side); rNeg.connect(side);
      side.connect(sW); side.connect(sWn);
      mid.connect(mg, 0, 0); mid.connect(mg, 0, 1); sW.connect(mg, 0, 0); sWn.connect(mg, 0, 1);
      mg.connect(p._wet);
      p.onParam = function (n, v, o) { if (n === 'width') { auto(ctx, sW.gain, v, o); auto(ctx, sWn.gain, -v, o); } };
    }
  };

  BUILD.chorus = {
    spec: { rate: { min: 0.05, max: 10, value: 0.8, unit: 'Hz' }, depth: { min: 0, max: 0.01, value: 0.003, unit: 's' }, mix: { min: 0, max: 1, value: 0.4 } },
    build: function (p) {
      var ctx = p.ctx, P = p.params;
      var d1 = p.track(ctx.createDelay(0.1)), d2 = p.track(ctx.createDelay(0.1)), lfo = p.track(ctx.createOscillator());
      var g1 = p.track(ctx.createGain()), g2 = p.track(ctx.createGain()), wet = p.track(ctx.createGain()), dry = p.track(ctx.createGain());
      var mg = p.track(ctx.createChannelMerger(2));
      val(d1.delayTime, 0.014); val(d2.delayTime, 0.021); val(g1.gain, P.depth); val(g2.gain, -P.depth);
      lfo.type = 'sine'; val(lfo.frequency, P.rate);
      lfo.connect(g1); lfo.connect(g2); try { g1.connect(d1.delayTime); g2.connect(d2.delayTime); } catch (e) {}
      try { lfo.start(); } catch (e) {}
      val(wet.gain, P.mix); val(dry.gain, 1 - P.mix);
      p.input.connect(d1); p.input.connect(d2); d1.connect(mg, 0, 0); d2.connect(mg, 0, 1); mg.connect(wet); wet.connect(p._wet);
      p.input.connect(dry); dry.connect(p._wet);
      p.onParam = function (n, v, o) {
        if (n === 'rate') auto(ctx, lfo.frequency, v, o);
        else if (n === 'depth') { auto(ctx, g1.gain, v, o); auto(ctx, g2.gain, -v, o); }
        else if (n === 'mix') { auto(ctx, wet.gain, v, o); auto(ctx, dry.gain, 1 - v, o); }
      };
      var d0 = p.dispose; p.dispose = function () { try { lfo.stop(); } catch (e) {} d0(); };
    }
  };

  // ------------------------------------------------------------ API
  var TYPES = [];
  for (var k in BUILD) if (BUILD.hasOwnProperty(k)) TYPES.push(k);

  function copySpec(spec) {
    var out = {};
    for (var p in spec) if (spec.hasOwnProperty(p)) { out[p] = {}; for (var q in spec[p]) if (spec[p].hasOwnProperty(q)) out[p][q] = spec[p][q]; }
    return out;
  }

  function create(ctx, type, opts) {
    var def = BUILD[type];
    if (!def) {
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[Processors] unknown processor "' + type + '"'); } catch (e) {}
      def = { spec: {}, build: function (p) { p.input.connect(p._wet); } };
      type = 'unknown';
    }
    return makeProc(ctx || null, type, copySpec(def.spec), opts, def.build);
  }

  // specs: [procObject | 'type' | {type, name, ...params} | ['type', {params}]] -> chain in series
  function chain(ctx, specs) {
    var ch = { ctx: ctx, procs: [], byName: {}, input: null, output: null };
    var i, s, p, name;
    for (i = 0; i < (specs || []).length; i++) {
      s = specs[i];
      if (s && s.input !== undefined && s.set) { p = s; name = s.name || s.type; }
      else if (typeof s === 'string') { p = create(ctx, s); name = s; }
      else if (Object.prototype.toString.call(s) === '[object Array]') { p = create(ctx, s[0], s[1]); name = (s[1] && s[1].name) || s[0]; }
      else if (s && s.type) {
        var o = {}; for (var q in s) if (s.hasOwnProperty(q) && q !== 'type' && q !== 'name') o[q] = s[q];
        p = create(ctx, s.type, o); name = s.name || s.type;
      } else continue;
      p.name = name;
      ch.procs.push(p);
      if (!ch.byName[name]) ch.byName[name] = p;
    }
    if (ctx) {
      try {
        ch.input = ctx.createGain(); ch.output = ctx.createGain();
        var last = ch.input;
        for (i = 0; i < ch.procs.length; i++) { if (!ch.procs[i].input) continue; last.connect(ch.procs[i].input); last = ch.procs[i].output; }
        last.connect(ch.output);
      } catch (e) {}
    }
    ch.get = function (name) { return ch.byName[name] || null; };
    // set('reverb.mix', 0.3, opts) or set('mix', v) on the first proc that has it
    ch.set = function (path, v, o) {
      var parts = String(path).split('.'), ok = false;
      if (parts.length >= 2) { var pr = ch.byName[parts[0]]; return pr ? pr.set(parts[1], v, o) : false; }
      for (i = 0; i < ch.procs.length; i++) if (ch.procs[i].spec && ch.procs[i].spec.hasOwnProperty(path)) { ok = ch.procs[i].set(path, v, o) || ok; }
      return ok;
    };
    ch.dispose = function () { for (i = 0; i < ch.procs.length; i++) ch.procs[i].dispose(); disc(ch.input); disc(ch.output); };
    return ch;
  }

  // channel strip: gain + pan + mute
  function channel(ctx, opts) {
    var c = { ctx: ctx, input: null, output: null, type: 'channel' };
    var g = null, pn = null, mute = null;
    K.defineParams(c, { gain: { min: 0, max: 2, value: 1 }, pan: { min: -1, max: 1, value: 0 }, mute: { value: false } }, function (n, v, o) {
      if (!ctx) return;
      if (n === 'gain' && g) auto(ctx, g.gain, v, o);
      else if (n === 'pan' && pn) auto(ctx, pn.pan, v, o);
      else if (n === 'mute' && mute) target(mute.gain, v ? 0 : 1, ctx.currentTime, 0.01);
    });
    if (ctx) {
      try {
        c.input = ctx.createGain(); g = ctx.createGain(); mute = ctx.createGain(); c.output = ctx.createGain();
        c.input.connect(g); g.connect(mute);
        if (typeof ctx.createStereoPanner === 'function') { try { pn = ctx.createStereoPanner(); } catch (e) { pn = null; } }
        if (pn) { mute.connect(pn); pn.connect(c.output); } else mute.connect(c.output);
      } catch (e) {}
    }
    if (opts) for (var k in opts) if (opts.hasOwnProperty(k)) c.set(k, opts[k]);
    c.dispose = function () { disc(c.input); disc(g); disc(mute); disc(pn); disc(c.output); };
    return c;
  }

  // master chain: eq -> hp -> lp -> glue compressor -> saturator -> limiter
  function master(ctx, opts) {
    var ch = chain(ctx, [
      { type: 'eq3', name: 'eq', low: 1.5, lowFreq: 90, mid: -1, midFreq: 400, midQ: 0.8, high: 1, highFreq: 8000 },
      { type: 'filter', name: 'hp', mode: 'highpass', cutoff: 24, q: 0.7 },
      { type: 'filter', name: 'lp', cutoff: 20000, q: 0.7 },
      { type: 'compressor', name: 'glue', threshold: -14, ratio: 2.5, attack: 0.02, release: 0.25, knee: 8, makeup: 0.5 },
      { type: 'saturator', name: 'sat', drive: 0.12, mix: 0.5, tone: 16000 },
      { type: 'limiter', name: 'limiter', threshold: -2, release: 0.08, ceiling: -0.6 }
    ]);
    if (opts) for (var k in opts) if (opts.hasOwnProperty(k)) ch.set(k, opts[k]);
    return ch;
  }

  root.Processors = { create: create, chain: chain, channel: channel, master: master, divSeconds: divSeconds,
    types: function () { return TYPES.slice(); }, spec: function (t) { return BUILD[t] ? BUILD[t].spec : null; } };
})();
