#!/usr/bin/env node
/* aasssMaster studio - selfcheck.js
 * Smoke test with a fake AudioContext (CONTRACT.md C8 style). Run: node studio/selfcheck.js
 * Checks: every module loads without a window, instruments and processors build on a fake context and on no
 * context, the song builds, all 200 bars schedule with every track playing, ducking fires, params clamp,
 * chord / melody / pattern parsing, section math, WAV encoding.
 */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log('  FAIL ' + msg); } }

// ------------------------------------------------------------------ fake Web Audio
function Param(v) { this.value = v; this.calls = []; }
['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues'].forEach(function (m) {
  Param.prototype[m] = function (v, t) { this.calls.push([m, v, t]); if (m === 'setValueAtTime') this.value = v; if (m === 'exponentialRampToValueAtTime' && !(v > 0)) throw new Error('expo ramp to <= 0'); };
});
var stats = { nodes: 0, started: 0, byType: {} };
function Node(ctx, type) {
  this.ctx = ctx; this.type_ = type; this.connections = []; this.numberOfInputs = 1; this.numberOfOutputs = 1;
  stats.nodes++; stats.byType[type] = (stats.byType[type] || 0) + 1;
}
Node.prototype.connect = function (dest) { if (!dest) throw new Error('connect to undefined from ' + this.type_); this.connections.push(dest); return dest; };
Node.prototype.disconnect = function () { this.connections.length = 0; };
function Src(ctx, type) { Node.call(this, ctx, type); this.onended = null; this._started = false; }
Src.prototype = Object.create(Node.prototype);
Src.prototype.start = function (t) { if (this._started) throw new Error('start twice'); this._started = true; stats.started++; this.ctx._srcs.push(this); if (t != null && !(t >= 0)) throw new Error('bad start time ' + t); };
Src.prototype.stop = function (t) { if (t != null && !(t >= 0)) throw new Error('bad stop time ' + t); this._stopped = true; };
function FakeContext(sr) {
  this.sampleRate = sr || 44100; this.currentTime = 0; this.state = 'running'; this._srcs = [];
  this.destination = new Node(this, 'destination');
}
FakeContext.prototype.resume = function () { this.state = 'running'; return Promise.resolve(); };
FakeContext.prototype.createGain = function () { var n = new Node(this, 'gain'); n.gain = new Param(1); return n; };
FakeContext.prototype.createOscillator = function () { var n = new Src(this, 'osc'); n.frequency = new Param(440); n.detune = new Param(0); n.type = 'sine'; return n; };
FakeContext.prototype.createBufferSource = function () { var n = new Src(this, 'bufsrc'); n.buffer = null; n.loop = false; return n; };
FakeContext.prototype.createConstantSource = function () { var n = new Src(this, 'const'); n.offset = new Param(1); return n; };
FakeContext.prototype.createBuffer = function (ch, len, sr) {
  var data = []; for (var i = 0; i < ch; i++) data.push(new Float32Array(len));
  return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: function (c) { return data[c]; } };
};
FakeContext.prototype.createBiquadFilter = function () { var n = new Node(this, 'biquad'); n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); n.detune = new Param(0); n.type = 'lowpass'; return n; };
FakeContext.prototype.createWaveShaper = function () { var n = new Node(this, 'shaper'); n.curve = null; n.oversample = 'none'; return n; };
FakeContext.prototype.createDelay = function (max) { var n = new Node(this, 'delay'); n.delayTime = new Param(0); n.max = max; return n; };
FakeContext.prototype.createConvolver = function () { var n = new Node(this, 'convolver'); n.buffer = null; return n; };
FakeContext.prototype.createDynamicsCompressor = function () { var n = new Node(this, 'comp'); ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach(function (k) { n[k] = new Param(0); }); return n; };
FakeContext.prototype.createStereoPanner = function () { var n = new Node(this, 'panner'); n.pan = new Param(0); return n; };
FakeContext.prototype.createChannelSplitter = function (c) { var n = new Node(this, 'splitter'); n.numberOfOutputs = c; return n; };
FakeContext.prototype.createChannelMerger = function (c) { var n = new Node(this, 'merger'); n.numberOfInputs = c; return n; };
FakeContext.prototype.createAnalyser = function () { var n = new Node(this, 'analyser'); n.fftSize = 2048; n.getByteTimeDomainData = function () {}; return n; };
// "play" the fake clock: fire onended for sources whose stop time passed is not tracked, so just fire all
FakeContext.prototype.flush = function () { var s = this._srcs.splice(0); for (var i = 0; i < s.length; i++) if (s[i].onended) s[i].onended(); };

function load(sandbox) {
  ['core', 'synths', 'processors', 'sequencer', 'song'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
  });
}
function sandbox() {
  var sb = { console: console, setInterval: setInterval, clearInterval: clearInterval, setTimeout: setTimeout, Promise: Promise, Float32Array: Float32Array, Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer, DataView: DataView, WeakMap: WeakMap };
  sb.window = sb; sb.globalThis = sb;
  return vm.createContext(sb);
}

// ------------------------------------------------------------------ 1. no AudioContext at all
console.log('1. modules without any AudioContext');
(function () {
  var sb = sandbox(); load(sb);
  ok(sb.Kit && sb.Synths && sb.Processors && sb.Sequencer && sb.Song, 'globals defined');
  sb.Synths.types().forEach(function (t) { var i = sb.Synths.create(null, t); i.trigger(0, { midi: 60 }); i.set('level', 0.5); i.panic(); i.dispose(); ok(i.params.level === 0.5, t + ' params without ctx'); });
  sb.Processors.types().forEach(function (t) { var p = sb.Processors.create(null, t); p.set('mix', 0.1); p.trigger(0); p.bypass(true); p.dispose(); ok(p.type === t, t + ' builds without ctx'); });
  var seq = sb.Sequencer.create(null); sb.Song.build(seq);
  ok(seq.totalBars === 200, 'song is 200 bars (' + seq.totalBars + ')');
  ok(Math.abs(seq.totalBars * seq.barSec() - 380.95) < 0.1, 'song length 6:21 (' + (seq.totalBars * seq.barSec()).toFixed(1) + ' s)');
  ok(seq.play() === false && !seq.playing, 'play() is a no-op without ctx');
  var n = seq.scheduleAll(0, null, 0);
  ok(n === 3200, 'scheduled 3200 steps dry (' + n + ')');
  var h = seq.hits();
  seq.order.forEach(function (t) { ok(h[t] > 0, 'track ' + t + ' plays (' + h[t] + ' hits)'); });
  ok(h.kick === 800, 'kick: 4 per bar for 200 bars (' + h.kick + ')');
  ok(h.clap === 392, 'clap on 2 and 4 where present (' + h.clap + ')');
})();

// ------------------------------------------------------------------ 2. parsing
console.log('2. parsing');
(function () {
  var sb = sandbox(); load(sb);
  var K = sb.Kit, S = sb.Sequencer;
  ok(K.ntom('B1') === 35 && K.ntom('C#5') === 73 && K.ntom('Bb1') === 34 && K.ntom('nope') === null, 'note names');
  ok(Math.abs(K.mtof(35) - 61.735) < 0.01, 'B1 = 61.7 Hz');
  var c = K.chordNotes('Bmaj9', 4); ok(c.join() === '71,75,78,82,85', 'Bmaj9 voicing ' + c.map(K.mton).join(' '));
  ok(K.chordNotes('G#m7', 3).map(K.mton).join(' ') === 'G#3 B3 D#4 F#4', 'G#m7 voicing');
  ok(K.chordNotes('Xyz', 4).length === 0 && K.chordNotes('Cq', 4).length === 0, 'bad chords -> no notes');
  var p = S.parsePattern('x.Xo'); ok(p.length === 1 && p[0].length === 16 && p[0][0] === 0.85 && p[0][1] === null && p[0][2] === 1 && p[0][3] === 0.5 && p[0][15] === null, 'pattern velocities, padded to 16');
  ok(S.parsePattern(['x...', '..x.']).length === 2, 'multi-bar patterns');
  var m = S.parseMelody(['C4 - D4 . E4! - - -', 'G4 . . . . . . . . . . . . . . .']);
  ok(m.bars === 2 && m.ev[0].midi === 60 && m.ev[0].len === 4 && m.ev[4].midi === 62 && m.ev[4].len === 2 && m.ev[8].vel === 1 && m.ev[8].len === 8 && m.ev[16].midi === 67 && m.ev[16].len === 1, 'melody 8-token and 16-token bars');
  ok(Math.abs(sb.Processors.divSeconds('3/16', 126) - 0.35714) < 0.001 && Math.abs(sb.Processors.divSeconds('1/8d', 120) - 0.375) < 1e-9 && sb.Processors.divSeconds('x', 120) === null, 'delay divisions');
  var inst = sb.Synths.create(null, 'bass');
  ok(inst.set('cutoff', 99999) && inst.params.cutoff === 8000 && inst.set('nope', 1) === false && inst.set('cutoff', 'abc') === false && inst.params.cutoff === 8000, 'param clamping and rejection');
  ok(sb.Synths.create(null, 'bogus').type === 'unknown' && sb.Processors.create(null, 'bogus').type === 'unknown', 'unknown types warn and no-op');
})();

// ------------------------------------------------------------------ 3. fake context: graphs and scheduling
console.log('3. fake AudioContext graph');
(function () {
  var sb = sandbox(); load(sb);
  var ctx = new FakeContext(44100);
  stats.nodes = 0; stats.started = 0; stats.byType = {};
  sb.Synths.types().forEach(function (t) {
    var i = sb.Synths.create(ctx, t);
    ok(i.out && i.pre, t + ' has out');
    var before = stats.started;
    i.trigger(1, { midi: 47, notes: [63, 66, 70], vel: 0.9, dur: 0.2 });
    ok(stats.started > before, t + ' trigger starts sources (' + (stats.started - before) + ')');
    i.trigger(null, {});
    ok(i._live.length >= 1, t + ' tracks live voices');
    i.panic();
    ctx.flush();
    ok(i._live.length === 0, t + ' voices released on end');
    i.set('level', 0.3); ok(i.out.gain.calls.length > 0, t + ' level drives the out gain');
    i.dispose();
  });
  sb.Processors.types().forEach(function (t) {
    var p = sb.Processors.create(ctx, t, {});
    ok(p.input && p.output, t + ' has input/output');
    ok(p.input.connections.length > 0, t + ' input is wired');
    for (var k in p.spec) if (p.spec.hasOwnProperty(k) && typeof p.spec[k].value === 'number') { p.set(k, p.spec[k].max); p.set(k, p.spec[k].min, { at: 2, ramp: 1 }); }
    p.bypass(true); p.bypass(false); p.trigger(1); p.trigger(1.1); p.dispose();
  });
  var sc = sb.Processors.create(ctx, 'sidechain', { depth: 0.6 });
  sc.trigger(1); var g = sc.node.gain.calls;
  ok(g.some(function (c) { return c[0] === 'linearRampToValueAtTime' && Math.abs(c[1] - 0.4) < 1e-9; }), 'sidechain dips to 1 - depth');
  var ch = sb.Processors.chain(ctx, ['filter', { type: 'delay', name: 'echo', mix: 0.3 }, ['reverb', { size: 1 }]]);
  ok(ch.procs.length === 3 && ch.get('echo').params.mix === 0.3 && ch.set('echo.mix', 0.5) && ch.get('echo').params.mix === 0.5 && ch.set('cutoff', 500), 'chain building and paths');
  var m = sb.Processors.master(ctx); ok(m.procs.length === 6 && m.get('hp').params.mode === 'highpass', 'master chain');

  // the song on the fake context
  var seq = sb.Sequencer.create(ctx, { bpm: 126, swing: 0.06 });
  sb.Song.build(seq);
  ok(seq.master && seq.out && seq.out.connections[0] === ctx.destination || seq.out.connections.indexOf(ctx.destination) >= 0, 'master reaches destination');
  ok(seq.tracks.stab.chain.procs.length === 1 && seq.tracks.stab.sendGains.delay && seq.tracks.stab.sendGains.reverb, 'stab inserts and sends wired');
  ok(Math.abs(seq.sends.delay.params.time - 0.357) < 0.01 || seq.sends.delay.params.division === '3/16', 'delay synced to 3/16');
  var before = stats.started;
  var n = seq.scheduleAll(0, 2, 0);                   // intro: kick, sub, bass only
  ok(n === 32 && stats.started > before, 'scheduled 2 bars on the fake graph');
  var duckCalls = seq.tracks.bass.sc.node.gain.calls.length;
  ok(duckCalls >= 8, 'kick ducks the bass (' + duckCalls + ' automation calls)');
  ok(!seq.tracks.sub.sc.node.gain.calls.some(function (c) { return c[0] === 'linearRampToValueAtTime'; }), 'the sub is not ducked (kick and sub are one event)');
  var bassTimes = []; var origTrig = seq.tracks.bass.inst.trigger;
  seq.tracks.bass.inst.trigger = function (t, e) { bassTimes.push(t); return origTrig(t, e); };
  seq.swing = 0; seq.scheduleAll(0, 1, 10);
  var sd = 60 / 126 / 4;
  ok(bassTimes.length === 4 && Math.abs(bassTimes[0] - (10 + 3 * sd)) < 1e-9 && Math.abs(bassTimes[1] - (10 + 7 * sd)) < 1e-9, 'bass hits land on steps 3 and 7 at 126 BPM');
  seq.swing = 0.5; bassTimes.length = 0; seq.scheduleAll(0, 1, 20);
  ok(bassTimes[0] > 20 + 3 * sd && bassTimes[0] < 20 + 3.4 * sd, 'swing delays odd 16ths');
  // section automation: breakEnd ramps master.hp.cutoff 24 -> 500
  var hp = seq.master.get('hp'); var calls0 = hp.nodes.length;
  seq.scheduleAll(128, 136, 30);
  ok(hp.params.cutoff > 400, 'breakEnd ramp drives master.hp.cutoff (' + hp.params.cutoff.toFixed(0) + ' Hz)');
  seq.scheduleAll(136, 137, 40);
  ok(hp.params.cutoff === 24, 'mainB resets master.hp.cutoff');
  ok(seq.setParam('kick.decay', 0.5) && seq.getParam('kick.decay') === 0.5 && seq.setParam('stab.width.width', 1.2) && seq.getParam('stab.width.width') === 1.2 && seq.setParam('send.reverb.mix', 0.7) && seq.setParam('master.glue.ratio', 4) && seq.setParam('bass.gain', 0.3) && seq.setParam('nope.x', 1) === false, 'parameter paths');
  seq.mute('kick', true); ok(seq.tracks.kick.channel.params.mute === true, 'mute');
  seq.solo('sub', true); ok(seq.tracks.bass.channel.params.mute === true && seq.tracks.sub.channel.params.mute === false, 'solo mutes the others');
  seq.solo('sub', false); seq.mute('kick', false); ok(seq.tracks.bass.channel.params.mute === false, 'solo off restores');
  // transport on the fake clock
  var stepEvents = 0; seq.on('step', function () { stepEvents++; });
  ok(seq.play() === true && seq.playing, 'play starts');
  ok(seq.jump('mainA') && seq.pos().bar === 40, 'jump to mainA (bar ' + seq.pos().bar + ')');
  seq.loop('mainA'); ok(seq.loopSection === 'mainA', 'loop section');
  seq.stop(); ok(!seq.playing && seq.pos().bar === 40, 'stop returns to the section start');
  seq.dispose();
  var buf = ctx.createBuffer(2, 100, 44100); buf.getChannelData(0)[0] = 1; buf.getChannelData(1)[1] = -1;
  var w = sb.Sequencer.wav(buf); var dv = new DataView(w);
  ok(w.byteLength === 44 + 400 && dv.getUint32(0, false) === 0x52494646 && dv.getInt16(44, true) === 32767 && dv.getInt16(50, true) === -32768, 'WAV encoding');
  console.log('   fake graph: ' + stats.nodes + ' nodes, ' + stats.started + ' sources');
})();

console.log(fails ? 'FAILED: ' + fails + ' of ' + checks + ' checks' : 'OK: ' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
