/* aasssMaster studio - song.js
 * Global `Song`: a Guidance-style electro track (126 BPM, B) written for the studio sequencer.
 * The numbers come from an analysis of the reference mix (see docs/superpowers/specs/2026-10-21-guidance-studio-design.md):
 * four-on-the-floor kick with a long sub, a syncopated mid bass on B1, off-beat open hats, claps on 2 and 4,
 * short wide chord stabs, a pentatonic 8th-note lead in the breakdown.
 *
 *   Song.build(seq)              adds sends, tracks and the arrangement to a Sequencer
 *   Song.GUIDANCE                the plain data (edit patterns / sections here)
 */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);

  var LEAD_BREAK = [
    'F#4 .   C#5 G#4 C#5 G#4 C#5 C#5',
    'C#5 -   C#5 -   G#4 -   C#5 -',
    'F#4 C#5 -   -   C#5 -   D#5 G#4',
    'F#4 .   G#4 C#5 G#4 F#4 C#5 -',
    'G#4 -   G#4 F#4 G#4 -   C#5 -',
    'F#4 C#5 -   -   G#4 F#4 G#4 -',
    'G#4 C#5 G#4 C#5 .   C#5 G#4 -',
    'G#4 D#5 G#4 C#5 G#4 -   C#5 -'
  ];
  var LEAD_HOOK = [
    'F#4 .   C#5 G#4 C#5 .   .   .',
    '.   .   .   .   .   .   .   .',
    'F#4 .   C#5 .   D#5 -   G#4 .',
    '.   .   .   .   .   .   .   .'
  ];

  var GUIDANCE = {
    name: 'Guidance-style', bpm: 126, swing: 0.06, key: 'B',
    progression: ['Bmaj9', 'Bmaj9', 'G#m7', 'Emaj7'],
    sends: {
      delay: { type: 'delay', division: '3/16', feedback: 0.42, mix: 1, tone: 2800, hp: 300, pingpong: true },
      reverb: { type: 'reverb', size: 2.4, decay: 0.55, damp: 4500, predelay: 0.015, mix: 1, hp: 220 }
    },
    tracks: [
      { name: 'kick', inst: 'kick', gain: 1.0, params: { tune: 44, punch: 190, sweep: 0.07, decay: 0.3, click: 0.12, drive: 0.45 },
        duck: ['bass', 'stab', 'pad', 'lead'],
        patterns: { A: 'x...x...x...x...', F: 'x...x...x...x.xx', H: 'x.......x.......' } },
      { name: 'sub', inst: 'sub', note: 'B1', gain: 0.55, params: { decay: 0.4, harmonic: 0.15 }, gate: 8, sidechain: { depth: 0 },
        patterns: { A: 'x...x...x...x...', B: 'x...x.x.x...x.x.', O: 'x.............x.' } },
      { name: 'bass', inst: 'bass', note: 'B2', gain: 0.9, gate: 0.8, params: { cutoff: 220, env: 300, res: 3, decay: 0.15, drive: 0.15, sub: 0 },
        chain: [{ type: 'eq3', name: 'eq', low: 2, lowFreq: 200, mid: 0, midFreq: 250, midQ: 1.2, high: -8, highFreq: 1500 }], sidechain: { depth: 0.5, release: 0.2 },
        patterns: { A: '...x...x..x...x.', B: '..x...x.x...x.x.', C: '...x......x...x.' } },
      { name: 'stab', inst: 'stab', chords: true, octave: 4, gain: 0.4, gate: 0.55, pan: 0,
        params: { cutoff: 1500, env: 2400, decay: 0.17, release: 0.09, detune: 11, spread: 0.5, hp: 180 },
        chain: [{ type: 'widener', name: 'width', width: 1.1 }], sends: { delay: 0.15, reverb: 0.1 }, sidechain: { depth: 0.5, release: 0.2 },
        patterns: { A: '..x...xx..x...xx', B: '..x...x...x...x.', C: '..x.......x.....' } },
      { name: 'clap', inst: 'clap', gain: 0.7, params: { tone: 1900, decay: 0.16, tail: 0.3 }, sends: { reverb: 0.25 },
        patterns: { A: '....x.......x...', F: '....x.......x.xx', R: '....x...x.x.xxxx' } },
      { name: 'hat_open', inst: 'hat_open', gain: 0.45, pan: 0.08, params: { decay: 0.26, tone: 7000, ring: 1500, metal: 0.5 }, sends: { reverb: 0.06 },
        patterns: { A: '..x...x...x...x.' } },
      { name: 'hat_closed', inst: 'hat_closed', gain: 0.4, pan: -0.08, params: { decay: 0.055, tone: 7500, metal: 0.4 },
        patterns: { A: '.......x.......x', B: '...x...x...x...x', C: 'x.x..xx...xx..x.', D: 'XxXxXxXxXxXxXxXx', E: 'x.x.x.x.x.x.x.x.' } },
      { name: 'shaker', inst: 'shaker', gain: 0.3, pan: 0.3, params: { tone: 6500, decay: 0.07 },
        patterns: { A: 'XoxoXoxoXoxoXoxo' } },
      { name: 'perc', inst: 'perc', gain: 0.4, pan: -0.3, params: { pitch: 380, drop: 0.5, decay: 0.12 }, sends: { delay: 0.3 },
        patterns: { A: 'x.x..xx.x.xx.xx.', B: 'x.x..x..x.x..x..' } },
      { name: 'lead', inst: 'lead', gain: 0.35, params: { cutoff: 1300, env: 2600, res: 3, decay: 0.22, release: 0.14, detune: 9, glide: 0.035 },
        sends: { delay: 0.35, reverb: 0.18 }, sidechain: { depth: 0.3, release: 0.2 },
        melody: { A: LEAD_BREAK, B: LEAD_HOOK } },
      { name: 'pad', inst: 'pad', chords: true, octave: 3, gain: 0.25, gate: 16, params: { attack: 0.6, release: 1.2, cutoff: 1000, detune: 12 },
        sends: { reverb: 0.4 }, sidechain: { depth: 0.45, release: 0.25 },
        patterns: { A: 'x...............' } },
      { name: 'riser', inst: 'riser', gain: 0.5, params: { from: 300, to: 7000, tone: 0.25 }, sends: { reverb: 0.3 }, patterns: {} },
      { name: 'impact', inst: 'impact', gain: 0.8, params: { tune: 38, decay: 1.4, wash: 0.5 }, sends: { reverb: 0.3 }, patterns: {} }
    ],
    // 200 bars = 6:20 at 126 BPM
    sections: [
      { name: 'intro', bars: 16, play: { kick: 'A', sub: 'A', bass: 'A' },
        set: { 'stab.cutoff': 500, 'kick.level': 1, 'master.hp.cutoff': 24, 'master.lp.cutoff': 20000 } },
      { name: 'intro2', bars: 8, play: { kick: 'A', sub: 'A', bass: 'A', stab: 'C', hat_closed: 'A' },
        ramp: [{ param: 'stab.cutoff', from: 400, to: 900, curve: 'expo' }] },
      { name: 'build', bars: 16, play: { kick: 'A', sub: 'A', bass: 'A', stab: 'B', hat_open: 'A', hat_closed: 'B', clap: 'A' },
        set: { 'clap.level': 0.7 },
        ramp: [{ param: 'stab.cutoff', from: 900, to: 2400, curve: 'expo' }, { param: 'master.hp.cutoff', from: 24, to: 180, bars: [8, 16], curve: 'expo' }],
        fx: [{ bar: 12, track: 'riser', bars: 4 }] },
      { name: 'mainA', bars: 32, play: { kick: 'A', sub: 'A', bass: 'A', stab: 'A', clap: 'A', hat_open: 'A', hat_closed: 'A' },
        set: { 'stab.cutoff': 1500, 'master.hp.cutoff': 24, 'clap.level': 1 },
        fx: [{ bar: 0, track: 'impact' }] },
      { name: 'mainA2', bars: 32, play: { kick: 'A', sub: 'A', bass: 'B', stab: 'A', clap: 'A', hat_open: 'A', hat_closed: 'C', lead: 'B' },
        fx: [{ bar: 28, track: 'riser', bars: 4 }] },
      { name: 'break', bars: 24, play: { kick: 'A', sub: 'A', bass: 'C', stab: 'B', clap: 'A', shaker: 'A', perc: 'A', pad: 'A', lead: 'A' },
        set: { 'kick.level': 0.6, 'stab.cutoff': 900, 'clap.level': 0.6 } },
      { name: 'breakEnd', bars: 8, play: { kick: 'A', sub: 'A', bass: 'C', stab: 'B', clap: 'R', shaker: 'A', perc: 'B', pad: 'A', lead: 'A', hat_closed: 'D' },
        ramp: [{ param: 'master.hp.cutoff', from: 24, to: 500, curve: 'expo' }, { param: 'stab.cutoff', from: 900, to: 3000, curve: 'expo' }],
        fx: [{ bar: 0, track: 'riser', bars: 8 }] },
      { name: 'mainB', bars: 48, play: { kick: 'A', sub: 'A', bass: 'B', stab: 'A', clap: 'A', hat_open: 'A', hat_closed: 'C', lead: 'B' },
        set: { 'kick.level': 1, 'stab.cutoff': 1500, 'master.hp.cutoff': 24, 'clap.level': 1 },
        fx: [{ bar: 0, track: 'impact' }, { bar: 44, track: 'riser', bars: 4 }] },
      { name: 'outro', bars: 16, play: { kick: 'A', sub: 'A', bass: 'A', clap: 'A', stab: 'C' },
        ramp: [{ param: 'stab.cutoff', from: 1500, to: 300, curve: 'expo' }, { param: 'master.lp.cutoff', from: 20000, to: 1200, bars: [8, 16], curve: 'expo' }] }
    ]
  };

  function build(seq, def) {
    def = def || GUIDANCE;
    seq.bpm = def.bpm;
    seq.swing = def.swing || 0;
    seq.progression = def.progression.slice();
    var k, i;
    for (k in def.sends) if (def.sends.hasOwnProperty(k)) seq.addSend(k, def.sends[k]);
    for (i = 0; i < def.tracks.length; i++) seq.addTrack(def.tracks[i].name, def.tracks[i]);
    seq.setArrangement(def.sections);
    return seq;
  }

  root.Song = { GUIDANCE: GUIDANCE, build: build, LEAD_BREAK: LEAD_BREAK, LEAD_HOOK: LEAD_HOOK };
})();
