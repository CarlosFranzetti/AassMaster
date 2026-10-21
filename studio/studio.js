/* aasssMaster studio - studio.js
 * Page logic only: builds the UI from the sequencer and song data, no audio code of its own.
 * Exposes window.Studio = {seq, ctx, start} for tests and the console.
 */
(function () {
  'use strict';

  var ctx = null, seq = null, ui = { strips: {}, sectionBtns: [], loopBox: null }, meterTimer = null;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmt(v, unit) {
    if (typeof v !== 'number') return String(v);
    var s = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return s + (unit ? ' ' + unit : '');
  }
  function status(msg) { $('status').textContent = msg; }

  // ---------------------------------------------------------------- engine
  function start() {
    if (seq) return seq;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { status('Web Audio is not available in this browser'); return null; }
    ctx = new AC();
    seq = Sequencer.create(ctx, { bpm: Song.GUIDANCE.bpm, swing: Song.GUIDANCE.swing });
    Song.build(seq);
    seq.on('step', onStep);
    seq.on('section', function (e) { markSection(e.section); });
    seq.on('stop', function () { $('play').textContent = '▶ Play'; $('play').classList.remove('on'); });
    seq.on('play', function () { $('play').textContent = '❚❚ Pause'; $('play').classList.add('on'); });
    buildTracks();
    buildRack();
    if (!meterTimer) meterTimer = setInterval(meter, 60);
    window.Studio.seq = seq; window.Studio.ctx = ctx;
    status('engine ready · ' + seq.totalBars + ' bars · ' + Math.round(seq.totalBars * seq.barSec()) + ' s');
    return seq;
  }

  // ---------------------------------------------------------------- transport + sections
  function buildSections() {
    var box = $('sections'), i;
    Song.GUIDANCE.sections.forEach(function (s, idx) {
      var b = el('button', 'sm', s.name + ' (' + s.bars + ')');
      b.onclick = function () { if (!start()) return; seq.jump(idx); markSection(idx); if (ui.loopBox.checked) seq.loop(idx); if (!seq.playing) seq.play(); };
      box.appendChild(b); ui.sectionBtns.push(b);
    });
    var lab = el('label'); ui.loopBox = el('input'); ui.loopBox.type = 'checkbox';
    lab.appendChild(ui.loopBox); lab.appendChild(document.createTextNode(' loop section'));
    ui.loopBox.onchange = function () { if (!seq) return; seq.loop(ui.loopBox.checked ? seq.pos().section : null); };
    box.appendChild(lab);
    for (i = 0; i < ui.sectionBtns.length; i++) ui.sectionBtns[i].classList.toggle('cur', i === 0);
  }
  function markSection(idx) {
    for (var i = 0; i < ui.sectionBtns.length; i++) ui.sectionBtns[i].classList.toggle('cur', i === idx);
    $('sec').textContent = seq.sections[idx] ? seq.sections[idx].name : '';
    refreshPatterns(idx);
  }
  function onStep(e) {
    $('bar').textContent = e.bar + 1;
    $('step').textContent = e.step + 1;
    for (var n in ui.strips) if (ui.strips.hasOwnProperty(n)) {
      var cells = ui.strips[n].cells;
      for (var i = 0; i < 16; i++) cells[i].classList.toggle('now', i === e.step);
    }
  }
  function meter() {
    if (!seq || !seq.analyser) return;
    try {
      var a = seq.analyser, buf = new Uint8Array(a.fftSize), i, peak = 0;
      a.getByteTimeDomainData(buf);
      for (i = 0; i < buf.length; i++) { var x = Math.abs(buf[i] - 128) / 128; if (x > peak) peak = x; }
      $('meter').firstChild.style.width = Math.round(peak * 100) + '%';
    } catch (e) {}
  }

  // ---------------------------------------------------------------- track strips
  function slider(parent, label, min, max, step, value, unit, onChange) {
    var row = el('div', 'row'), lab = el('label', null, label), inp = el('input'), v = el('span', 'v', fmt(value, unit));
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    inp.oninput = function () { var x = Number(inp.value); v.textContent = fmt(x, unit); onChange(x); };
    row.appendChild(lab); row.appendChild(inp); row.appendChild(v); parent.appendChild(row);
    return { input: inp, value: v, refresh: function (x) { inp.value = x; v.textContent = fmt(x, unit); } };
  }
  function paramSliders(parent, spec, params, setter, skip) {
    var out = {};
    for (var k in spec) if (spec.hasOwnProperty(k)) {
      if (skip && skip[k]) continue;
      var s = spec[k];
      if (typeof s.value !== 'number') continue;
      var range = s.max - s.min, stepv = range > 1000 ? 1 : range > 50 ? 0.5 : range > 5 ? 0.05 : 0.001;
      var isLog = s.min > 0 && s.max / s.min > 50;
      out[k] = slider(parent, k, isLog ? Math.log(s.min) : s.min, isLog ? Math.log(s.max) : s.max, isLog ? 0.01 : stepv,
        isLog ? Math.log(params[k]) : params[k], s.unit, (function (name, log) { return function (x) { setter(name, log ? Math.exp(x) : x); }; })(k, isLog));
      if (isLog) { out[k].value.textContent = fmt(params[k], s.unit); out[k].log = true; }
    }
    return out;
  }
  function buildTracks() {
    var main = $('tracks');
    main.innerHTML = '';
    seq.order.forEach(function (name) {
      var tr = seq.tracks[name], def = tr.def, strip = el('div', 'strip'), h = el('h2');
      h.appendChild(el('span', null, name)); h.appendChild(el('span', 'type', tr.inst.type)); h.appendChild(el('span', 'sp'));
      var mute = el('button', 'sm', 'M'), solo = el('button', 'sm solo', 'S');
      mute.onclick = function () { mute.classList.toggle('on', seq.mute(name)); strip.classList.toggle('muted', tr.muted); };
      solo.onclick = function () { solo.classList.toggle('on', seq.solo(name)); };
      h.appendChild(mute); h.appendChild(solo); strip.appendChild(h);
      var steps = el('div', 'steps'), cells = [];
      for (var i = 0; i < 16; i++) { var c = el('i'); steps.appendChild(c); cells.push(c); }
      strip.appendChild(steps);
      slider(strip, 'level', 0, 1.5, 0.01, tr.channel.get('gain'), '', function (x) { tr.channel.set('gain', x); });
      slider(strip, 'pan', -1, 1, 0.01, tr.channel.get('pan'), '', function (x) { tr.channel.set('pan', x); });
      var sends = seq.sendOrder;
      for (var si = 0; si < sends.length; si++) (function (sn) {
        slider(strip, 'send ' + sn, 0, 1, 0.01, seq.sendLevel(name, sn), '', function (x) { seq.setSend(name, sn, x); });
      })(sends[si]);
      slider(strip, 'duck depth', 0, 1, 0.01, tr.sc.get('depth'), '', function (x) { tr.sc.set('depth', x); });
      var det = el('details'), sum = el('summary', null, 'synth parameters'), box = el('div', 'params');
      det.appendChild(sum); det.appendChild(box); strip.appendChild(det);
      var ps = paramSliders(box, tr.inst.spec || {}, tr.inst.params, function (k, v) { tr.inst.set(k, v); }, { level: 1 });
      if (tr.chain.procs.length) {
        var det2 = el('details'), sum2 = el('summary', null, 'inserts: ' + tr.chain.procs.map(function (p) { return p.name; }).join(', ')), box2 = el('div', 'params');
        det2.appendChild(sum2); det2.appendChild(box2); strip.appendChild(det2);
        tr.chain.procs.forEach(function (p) { paramSliders(box2, p.spec, p.params, function (k, v) { p.set(k, v); }); });
      }
      main.appendChild(strip);
      ui.strips[name] = { strip: strip, cells: cells, params: ps, mute: mute };
    });
    refreshPatterns(0);
  }
  // show the pattern each track plays in a section
  function refreshPatterns(idx) {
    var sec = seq.sections[idx]; if (!sec) return;
    for (var n in ui.strips) if (ui.strips.hasOwnProperty(n)) {
      var tr = seq.tracks[n], v = sec.play[n], cells = ui.strips[n].cells, row = null, i;
      if (v === true) v = 'A';
      if (v && tr.kind === 'melody') { var m = tr.melodies[v] || tr.melodies.A; row = []; for (i = 0; i < 16; i++) row.push(m && m.ev[i] ? m.ev[i].vel : null); }
      else if (v) { var p = tr.patterns[v] || tr.patterns.A; row = p ? p[0] : null; }
      for (i = 0; i < 16; i++) { var x = row ? row[i] : null; cells[i].classList.toggle('hit', x != null && x < 1); cells[i].classList.toggle('acc', x != null && x >= 1); }
      ui.strips[n].strip.style.borderColor = v ? '#3a3a55' : '';
    }
    // reflect section-level parameter sets (filter cutoffs etc.) in the sliders
    for (var path in sec.set) if (sec.set.hasOwnProperty(path)) {
      var parts = path.split('.'), s = ui.strips[parts[0]];
      if (s && s.params[parts[1]]) s.params[parts[1]].refresh(s.params[parts[1]].log ? Math.log(sec.set[path]) : sec.set[path]);
      if (s && s.params[parts[1]] && s.params[parts[1]].log) s.params[parts[1]].value.textContent = fmt(sec.set[path], (seq.tracks[parts[0]].inst.spec[parts[1]] || {}).unit);
    }
  }

  // ---------------------------------------------------------------- master + send rack
  function buildRack() {
    var main = $('tracks'), rack = el('div', 'strip rack'), h = el('h2'); h.appendChild(el('span', null, 'processors: sends and master'));
    rack.appendChild(h);
    var units = el('div', 'units');
    seq.sendOrder.forEach(function (sn) {
      var p = seq.sends[sn], u = el('div', 'unit'); u.appendChild(el('h3', null, 'send ' + sn + ' (' + p.type + ')'));
      paramSliders(u, p.spec, p.params, function (k, v) { p.set(k, v); }, { bpm: 1 });
      units.appendChild(u);
    });
    seq.master.procs.forEach(function (p) {
      var u = el('div', 'unit'); u.appendChild(el('h3', null, 'master ' + p.name + ' (' + p.type + ')'));
      var byp = el('button', 'sm', 'bypass'); byp.onclick = function () { p.bypass(!p._bypassed); byp.classList.toggle('on', p._bypassed); }; u.appendChild(byp);
      paramSliders(u, p.spec, p.params, function (k, v) { p.set(k, v); });
      units.appendChild(u);
    });
    rack.appendChild(units);
    main.appendChild(rack);
  }

  // ---------------------------------------------------------------- export
  function download(buffer, name) {
    var blob = new Blob([Sequencer.wav(buffer)], { type: 'audio/wav' }), url = URL.createObjectURL(blob), a = el('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
  }
  function exportRange(from, to, name) {
    status('rendering ' + name + ' (' + (to - from) + ' bars)...');
    var t0 = Date.now();
    Sequencer.render(function (s) { Song.build(s); }, { from: from, to: to, sampleRate: 44100 }).then(function (buf) {
      status('rendered ' + name + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
      download(buf, name + '.wav');
    }, function (err) { status('render failed: ' + (err && err.message || err)); });
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    buildSections();
    $('play').onclick = function () { if (!start()) return; seq.toggle(); };
    $('stop').onclick = function () { if (!seq) return; seq.stop(); markSection(seq.pos().section); };
    $('bpm').onchange = function () { if (seq) seq.bpm = Number($('bpm').value); };
    $('swing').oninput = function () { $('swingv').textContent = $('swing').value; if (seq) seq.swing = Number($('swing').value); };
    $('export-section').onclick = function () {
      var idx = seq ? seq.pos().section : 0, s = Song.GUIDANCE.sections[idx], start = 0;
      for (var i = 0; i < idx; i++) start += Song.GUIDANCE.sections[i].bars;
      exportRange(start, start + s.bars, 'guidance-style-' + s.name);
    };
    $('export-song').onclick = function () {
      var total = 0; Song.GUIDANCE.sections.forEach(function (s) { total += s.bars; });
      exportRange(0, total, 'guidance-style-full');
    };
    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); $('play').click(); }
    });
  }
  window.Studio = { start: start, seq: null, ctx: null, exportRange: exportRange };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
