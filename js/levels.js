/*
 * aasssMaster v2 — level data.
 *
 * Pure data plus helpers. No DOM, no globals other than window.Levels.
 * Speeds are px/s (pxps). Intervals are seconds. Spawn times t are seconds into a stage.
 *
 * Wave:   { t, type, count, y: 'rand'|0..1, spacing (s; 0 = whole wave on one tick), pattern,
 *           from?: 'right'|'left'|'top'|'bottom', drop?: 'pu_force'|'weapon'|'random', sfx? }
 *           top/bottom: y is the horizontal position (0 left .. 1 right).
 *           quiet is computed here at load (true when another wave started within 3 s before).
 * Phase:  { hpAbove, attacks: [ id | {id, ...overrides} ], interval }
 *           phase k runs while hp fraction is at/below phase k-1's hpAbove and above its own.
 *           The last phase has hpAbove 0.
 * Stage:  { name, intro, length, music, bg, checkpoints, drops, boss, midboss, waves }
 * Boss:   { type, hp, phases }      Midboss: { t, type, hp, flee, drop, music?, phases }
 * LoopMod: { hp, boss, count, speed, fire } applied by getStage(raw).mods; mutators fold into it.
 *
 * API: Levels.enemyTypes, Levels.stages, Levels.loopMods, Levels.mutators, Levels.relief,
 *      Levels.getStage(raw), Levels.getWaves(raw, fromT, toT), Levels.powerupDrop(type, rng, ctx),
 *      Levels.validate() -> {errors, warnings}
 */
(function () {
  'use strict';

  var BEHAVIORS = { sine: 1, straight: 1, charge: 1, hover_spit: 1, bounce: 1, swoop: 1, drift: 1,
                    armored: 1, mine: 1, turret: 1, boss: 1 };
  var PATTERNS = { line: 1, column: 1, v: 1, wave: 1, burst: 1, stagger: 1, ring: 1 };
  var FROMS = { right: 1, left: 1, top: 1, bottom: 1 };
  var DROPS = { pu_force: 1, weapon: 1, random: 1 };
  var FIRE_TYPES = { enemy_bullet: 1, hair_ball: 1 };
  var AIMS = { player: 1, fixed: 1 };
  var ATTACK_IDS = { fan: 1, spiral: 1, lunge: 1, spawn: 1, rain: 1 };
  var MUSIC = { stage1: 1, stage2: 1, stage3: 1, stage4: 1, midboss: 1, boss: 1 };
  var DEFAULT_DROP = 0.08;
  // Spawn budgets: most enemies per 10 s of stage 0/1/2+ (the engine pool is 64).
  var BUDGET = [12, 22, 30];

  // ---------------------------------------------------------------------------
  // Enemy catalogue. Keys == sprite names. Boss hp lives in stage.boss / stage.midboss.
  // ---------------------------------------------------------------------------
  var enemyTypes = {
    butt_small:   { sprite: 'butt_small',   w: 16, h: 16, hp: 1, pxps: 90,  behavior: 'sine',       hairy: true, score: 100 },
    butt_mid:     { sprite: 'butt_mid',     w: 24, h: 24, hp: 3, pxps: 60,  behavior: 'bounce',     hairy: true, drop: 0.25, score: 300,
                    fire: { rate: 0.5, type: 'enemy_bullet', spread: 1, speed: 110, aim: 'player' } },
    butt_charger: { sprite: 'butt_charger', w: 20, h: 16, hp: 2, pxps: 140, behavior: 'charge',     hairy: true, score: 250 },
    butt_spitter: { sprite: 'butt_spitter', w: 24, h: 20, hp: 4, pxps: 50,  behavior: 'hover_spit', hairy: true, drop: 0.3, score: 400,
                    fire: { rate: 0.7, type: 'hair_ball', spread: 1, speed: 80, aim: 'player' } },
    alien_eye:    { sprite: 'alien_eye',    w: 16, h: 16, hp: 2, pxps: 75,  behavior: 'drift',      score: 200,
                    fire: { rate: 0.8, type: 'enemy_bullet', spread: 1, speed: 100, aim: 'player' } },
    alien_squid:  { sprite: 'alien_squid',  w: 20, h: 24, hp: 3, pxps: 60,  behavior: 'swoop',      drop: 0.3, score: 350 },
    butt_armored: { sprite: 'butt_armored', w: 24, h: 24, hp: 6, pxps: 45,  behavior: 'armored',    armor: true, hairy: true, drop: 0.4, score: 500 },
    gas_cloud:    { sprite: 'gas_cloud',    w: 20, h: 16, hp: 2, pxps: 40,  behavior: 'drift',      drop: 0.15, score: 150 },
    tooth_mine:   { sprite: 'tooth_mine',   w: 14, h: 14, hp: 2, pxps: 50,  behavior: 'mine',       drop: 0.2, score: 200,
                    fire: { rate: 0.3, type: 'hair_ball', spread: 4, speed: 90, aim: 'player' } },
    butt_turret:  { sprite: 'butt_turret',  w: 16, h: 16, hp: 3, pxps: 0,   behavior: 'turret',     drop: 0.35, score: 250,
                    fire: { rate: 0.6, type: 'enemy_bullet', spread: 1, burst: 3, speed: 120, aim: 'player' } },
    midboss_butt: { sprite: 'midboss_butt', w: 56, h: 48, hp: 60,   pxps: 0, behavior: 'boss', score: 2000 },
    boss_butt:    { sprite: 'boss_butt',    w: 96, h: 80, hp: null, pxps: 0, behavior: 'boss', score: 5000 },
    boss_crack:   { sprite: 'boss_crack',   w: 96, h: 80, hp: null, pxps: 0, behavior: 'boss', score: 5000 },
    boss_god:     { sprite: 'boss_god',     w: 96, h: 80, hp: null, pxps: 0, behavior: 'boss', score: 5000 }
  };

  // ---------------------------------------------------------------------------
  // Loop modifiers and mutators (loop = floor(raw / stages.length)). Last row repeats.
  // ---------------------------------------------------------------------------
  var loopMods = [
    { hp: 1,    boss: 1,   count: 1,    speed: 1,   fire: 1 },
    { hp: 1.35, boss: 1.5, count: 1.25, speed: 1.1, fire: 1.1 },
    { hp: 1.7,  boss: 2,   count: 1.5,  speed: 1.2, fire: 1.2 }
  ];
  var mutators = { swarm: { count: 1.5 }, fast: { speed: 1.3 } };
  var MUTATOR_ORDER = ['swarm', 'fast'];
  var relief = { after: 2, count: 0.85 };

  // ---------------------------------------------------------------------------
  // Stages. Waves are listed in time order; the loader sorts them and sets quiet.
  // ---------------------------------------------------------------------------
  var stages = [
    // ------------------------------------------------------------------
    // 1. HAIRY NEBULA — teaches the cast; only butt_small for the first 20 s.
    // ------------------------------------------------------------------
    {
      name: 'HAIRY NEBULA', intro: 'BEWARE THE HAIR', length: 60, music: 'stage1',
      bg: { theme: 0, speedFar: 8, speedMid: 22, speedNear: 45,
            palette: { sky: ['#2a0a3a', '#3d0f4f', '#5a1a5e', '#7a2a6a', '#9a3a70'] },
            raster: { heatAmp: 1, heatPeriod: 90, copper: 0.6, scan: 0.18 } },
      checkpoints: [0],
      drops: { mult: 1.2 },
      waves: [
        { t: 1.5,  type: 'butt_small',   count: 3, y: 0.5,    spacing: 0.5,  pattern: 'line' },
        { t: 4,    type: 'butt_small',   count: 3, y: 0.3,    spacing: 0,    pattern: 'wave' },
        { t: 7,    type: 'butt_small',   count: 3, y: 'rand', spacing: 0,    pattern: 'v' },
        { t: 10,   type: 'butt_small',   count: 3, y: 0.6,    spacing: 0.3,  pattern: 'column' },
        { t: 12,   type: 'butt_small',   count: 3, y: 0.5,    spacing: 0,    pattern: 'v', drop: 'pu_force' },
        { t: 15,   type: 'butt_small',   count: 3, y: 'rand', spacing: 0.1,  pattern: 'burst' },
        { t: 18,   type: 'butt_small',   count: 3, y: 0.5,    spacing: 0.4,  pattern: 'line' },
        { t: 20.5, type: 'butt_charger', count: 2, y: 0.35,   spacing: 1.2,  pattern: 'line' },
        { t: 24,   type: 'butt_mid',     count: 2, y: 0.3,    spacing: 1.5,  pattern: 'column' },
        { t: 27,   type: 'alien_eye',    count: 3, y: 0.25,   spacing: 0.7,  pattern: 'line' },
        { t: 30,   type: 'butt_mid',     count: 2, y: 0.5,    spacing: 0,    pattern: 'column', drop: 'weapon' },
        { t: 34,   type: 'butt_spitter', count: 2, y: 0.35,   spacing: 1.8,  pattern: 'column' },
        { t: 38,   type: 'alien_squid',  count: 3, y: 0.5,    spacing: 0,    pattern: 'wave' },
        { t: 42,   type: 'alien_eye',    count: 4, y: 0.6,    spacing: 0,    pattern: 'v' },
        { t: 46,   type: 'butt_charger', count: 4, y: 'rand', spacing: 0.6,  pattern: 'burst' },
        { t: 50,   type: 'alien_squid',  count: 4, y: 0.3,    spacing: 0.6,  pattern: 'column' },
        { t: 53,   type: 'butt_small',   count: 4, y: 'rand', spacing: 0.2,  pattern: 'burst' }
      ],
      boss: {
        type: 'boss_butt', hp: 240,
        phases: [
          { hpAbove: 0.6, attacks: ['fan'], interval: 2.2 },
          { hpAbove: 0.3, attacks: ['fan', { id: 'spawn', type: 'butt_small', n: 3 }], interval: 1.8 },
          { hpAbove: 0,   attacks: ['fan', { id: 'spawn', type: 'butt_small', n: 3 }, 'fan'], interval: 1.3 }
        ]
      },
      midboss: null
    },

    // ------------------------------------------------------------------
    // 2. THE CRACK OF DOOM — armored, turrets, gas, a storm from the top, midboss at 40 s.
    // ------------------------------------------------------------------
    {
      name: 'THE CRACK OF DOOM', intro: 'SMELLS LIKE TROUBLE', length: 70, music: 'stage2',
      bg: { theme: 1, speedFar: 10, speedMid: 30, speedNear: 60,
            palette: { sky: ['#3a0a1a', '#5a0f22', '#7a1a2a', '#9a2a30', '#b84a38'] },
            raster: { heatAmp: 2, heatPeriod: 60, copper: 0.8, scan: 0.18 } },
      checkpoints: [0, 35],
      drops: { mult: 1.0 },
      waves: [
        { t: 8,  type: 'butt_armored', count: 2,  y: 0.5,    spacing: 0.8,  pattern: 'line' },
        { t: 12, type: 'butt_small',   count: 8,  y: 0.5,    spacing: 0,    pattern: 'ring' },
        { t: 16, type: 'gas_cloud',    count: 3,  y: 0.4,    spacing: 0.7,  pattern: 'wave' },
        { t: 21, type: 'butt_charger', count: 3,  y: 0.6,    spacing: 0.6,  pattern: 'line', from: 'left' },
        { t: 25, type: 'butt_small',   count: 14, y: 0.5,    spacing: 0.08, pattern: 'burst', from: 'top', sfx: 'wave_warning' },
        { t: 30, type: 'butt_turret',  count: 2,  y: 0.6,    spacing: 0.5,  pattern: 'column' },
        { t: 34, type: 'butt_spitter', count: 2,  y: 0.35,   spacing: 1.5,  pattern: 'column' },
        { t: 37, type: 'alien_eye',    count: 3,  y: 0.5,    spacing: 0,    pattern: 'v' },
        { t: 44, type: 'alien_squid',  count: 3,  y: 0.5,    spacing: 0,    pattern: 'wave' },
        { t: 48, type: 'butt_armored', count: 3,  y: 0.4,    spacing: 0.8,  pattern: 'line' },
        { t: 52, type: 'butt_mid',     count: 3,  y: 0.5,    spacing: 0,    pattern: 'v' },
        { t: 56, type: 'butt_charger', count: 4,  y: 'rand', spacing: 0.15, pattern: 'burst' },
        { t: 60, type: 'gas_cloud',    count: 4,  y: 0.5,    spacing: 0,    pattern: 'wave' },
        { t: 64, type: 'butt_small',   count: 5,  y: 0.5,    spacing: 0,    pattern: 'v' },
        { t: 67, type: 'butt_turret',  count: 2,  y: 0.4,    spacing: 0.5,  pattern: 'column' }
      ],
      boss: {
        type: 'boss_crack', hp: 360,
        phases: [
          { hpAbove: 0.7,  attacks: ['fan', { id: 'spawn', type: 'butt_charger', n: 3 }], interval: 2.0 },
          { hpAbove: 0.4,  attacks: ['fan', { id: 'spiral', arms: 2, dur: 3 }], interval: 1.6 },
          { hpAbove: 0.15, attacks: [{ id: 'spiral', arms: 2, dur: 3 }, { id: 'spawn', type: 'butt_charger', n: 3 }], interval: 1.3 },
          { hpAbove: 0,    attacks: ['fan', { id: 'spiral', arms: 2, dur: 3 }, { id: 'spawn', type: 'butt_charger', n: 3 }], interval: 1.0 }
        ]
      },
      midboss: {
        t: 40, type: 'midboss_butt', hp: 60, flee: 25, drop: 'weapon', music: 'midboss',
        phases: [
          { hpAbove: 0.5, attacks: ['fan'], interval: 2.0 },
          { hpAbove: 0,   attacks: ['fan', { id: 'spawn', type: 'butt_charger', n: 3 }], interval: 1.5 }
        ]
      }
    },

    // ------------------------------------------------------------------
    // 3. RECTUM OF THE GODS — flat; pincer waves from top and bottom; midboss at 45 s.
    // ------------------------------------------------------------------
    {
      name: 'RECTUM OF THE GODS', intro: 'NO EXIT', length: 80, music: 'stage3',
      bg: { theme: 2, speedFar: 12, speedMid: 38, speedNear: 75,
            palette: { sky: ['#0f2a1a', '#1a3a2a', '#2a4a30', '#3a5a3a', '#4a6a40'] },
            raster: { heatAmp: 1, heatPeriod: 120, copper: 0.5, scan: 0.25 } },
      checkpoints: [0, 40],
      drops: { mult: 0.9 },
      waves: [
        { t: 3,  type: 'butt_small',   count: 6, y: 0.3,    spacing: 0,    pattern: 'column', from: 'top' },
        { t: 6,  type: 'butt_small',   count: 6, y: 0.7,    spacing: 0,    pattern: 'column', from: 'bottom' },
        { t: 9,  type: 'tooth_mine',   count: 3, y: 'rand', spacing: 0.6,  pattern: 'burst' },
        { t: 12, type: 'butt_charger', count: 3, y: 0.5,    spacing: 0.6,  pattern: 'line', from: 'left' },
        { t: 15, type: 'butt_armored', count: 3, y: 0.5,    spacing: 0,    pattern: 'v' },
        { t: 18, type: 'butt_turret',  count: 2, y: 0.5,    spacing: 0.5,  pattern: 'column' },
        { t: 22, type: 'gas_cloud',    count: 4, y: 0.4,    spacing: 0,    pattern: 'wave' },
        { t: 26, type: 'tooth_mine',   count: 4, y: 0.5,    spacing: 0,    pattern: 'stagger' },
        { t: 30, type: 'alien_eye',    count: 4, y: 0.5,    spacing: 0,    pattern: 'wave' },
        { t: 34, type: 'butt_spitter', count: 3, y: 0.4,    spacing: 1.2,  pattern: 'column' },
        { t: 38, type: 'butt_charger', count: 4, y: 'rand', spacing: 0.15, pattern: 'burst' },
        { t: 42, type: 'butt_armored', count: 3, y: 0.5,    spacing: 0.8,  pattern: 'line' },
        { t: 50, type: 'butt_armored', count: 4, y: 0.3,    spacing: 0,    pattern: 'column', from: 'top' },
        { t: 54, type: 'tooth_mine',   count: 4, y: 0.5,    spacing: 0,    pattern: 'v' },
        { t: 58, type: 'alien_squid',  count: 4, y: 0.5,    spacing: 0,    pattern: 'wave' },
        { t: 62, type: 'butt_charger', count: 5, y: 'rand', spacing: 0.12, pattern: 'burst', from: 'left' },
        { t: 66, type: 'butt_turret',  count: 3, y: 0.5,    spacing: 0.4,  pattern: 'column' },
        { t: 70, type: 'alien_eye',    count: 5, y: 0.5,    spacing: 0.2,  pattern: 'burst' },
        { t: 74, type: 'tooth_mine',   count: 5, y: 0.5,    spacing: 0,    pattern: 'stagger' },
        { t: 77, type: 'butt_small',   count: 8, y: 'rand', spacing: 0.12, pattern: 'burst' }
      ],
      boss: {
        type: 'boss_god', hp: 440,
        phases: [
          { hpAbove: 0.75, attacks: ['fan', { id: 'spawn', type: 'tooth_mine', n: 3 }], interval: 1.8 },
          { hpAbove: 0.5,  attacks: ['fan', { id: 'spiral', arms: 2, dur: 3 }, 'lunge'], interval: 1.5 },
          { hpAbove: 0.25, attacks: [{ id: 'spiral', arms: 2, dur: 3 }, 'lunge'], interval: 1.2 },
          { hpAbove: 0.1,  attacks: ['fan', { id: 'spawn', type: 'tooth_mine', n: 3 }, 'lunge'], interval: 1.0 },
          { hpAbove: 0,    attacks: ['fan', { id: 'spiral', arms: 2, dur: 3 }, 'lunge'], interval: 0.8 }
        ]
      },
      midboss: {
        t: 45, type: 'midboss_butt', hp: 60, flee: 25, drop: 'weapon', music: 'midboss',
        phases: [
          { hpAbove: 0.5, attacks: ['fan'], interval: 1.8 },
          { hpAbove: 0,   attacks: ['fan', { id: 'spiral', arms: 2, dur: 3 }], interval: 1.4 }
        ]
      }
    }
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function wrapIndex(i) {
    var n = stages.length;
    return ((i % n) + n) % n;
  }
  function loopOf(i) {
    return i < 0 ? 0 : Math.floor(i / stages.length);
  }
  function mutatorFor(loop) {
    return loop < 1 ? null : MUTATOR_ORDER[(loop - 1) % MUTATOR_ORDER.length];
  }
  function scaledBoss(b, k) {
    return Object.assign({}, b, { hp: Math.round(b.hp * k) });
  }
  function relLum(hex) {
    var c = [0, 2, 4].map(function (o) {
      var v = parseInt(hex.substr(1 + o, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // Sort waves and set quiet at load so getWaves returns final copies.
  stages.forEach(function (s) {
    s.waves.sort(function (a, b) { return a.t - b.t; });
    s.waves.forEach(function (w, i) {
      w.quiet = i > 0 && w.t - s.waves[i - 1].t < 3;
    });
  });

  // ---------------------------------------------------------------------------
  // getStage(raw): stage with loop, mutator, mods, and loop-scaled boss/midboss hp.
  // ---------------------------------------------------------------------------
  function getStage(rawIdx) {
    var idx = wrapIndex(rawIdx), loop = loopOf(rawIdx), src = stages[idx];
    var row = loopMods[Math.min(loop, loopMods.length - 1)];
    var mut = mutatorFor(loop), m = mut ? mutators[mut] : {};
    var mods = {
      hp: row.hp, boss: row.boss,
      count: row.count * (m.count || 1),
      speed: row.speed * (m.speed || 1),
      fire: row.fire
    };
    var out = Object.assign({}, src, { index: idx, loop: loop, mutator: mut, mods: mods });
    delete out.waves;
    out.boss = scaledBoss(src.boss, mods.boss);
    out.midboss = src.midboss ? scaledBoss(src.midboss, mods.boss) : null;
    return out;
  }

  // Waves of stage rawIdx (wraps) with fromT <= t < toT. Returns shallow copies, counts raw.
  function getWaves(rawIdx, fromT, toT) {
    var list = stages[wrapIndex(rawIdx)].waves, out = [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.t >= fromT && w.t < toT) out.push(Object.assign({}, w));
    }
    return out;
  }

  // Powerup roll for a destroyed enemy. rng returns [0,1).
  // ctx: {power, speed, shield, weapon, hasForce, forceLv, lives, rank, stage?}
  //   stage (raw index) selects stage.drops.mult; rank < 0.3 doubles power and shield weights.
  // Never returns a maxed capsule (power/speed at 3, shield held, force at level 3).
  // pu_bomb, pu_life and pu_option are never returned. Bosses drop nothing here.
  function powerupDrop(type, rng, ctx) {
    var d = enemyTypes[type];
    if (!d || d.behavior === 'boss') return null;
    ctx = ctx || {};
    var roll = typeof rng === 'function' ? rng : Math.random;
    var mult = typeof ctx.stage === 'number' ? stages[wrapIndex(ctx.stage)].drops.mult : 1;
    var base = typeof d.drop === 'number' ? d.drop : DEFAULT_DROP;
    if (roll() >= base * mult) return null;
    var low = typeof ctx.rank === 'number' && ctx.rank < 0.3 ? 2 : 1;
    var pool = [];
    if ((ctx.power | 0) < 3) pool.push({ id: 'pu_power', w: 0.35 * low });
    pool.push({ id: 'weapon', w: 0.25 });
    if ((ctx.speed | 0) < 3) pool.push({ id: 'pu_speed', w: 0.10 });
    if (!ctx.shield) pool.push({ id: 'pu_shield', w: 0.10 * low });
    if (!ctx.hasForce || (ctx.forceLv | 0) < 3) pool.push({ id: 'pu_force', w: 0.15 });
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += pool[i].w;
    var r = roll() * total, pick = pool[pool.length - 1].id;
    for (i = 0; i < pool.length; i++) {
      if (r < pool[i].w) { pick = pool[i].id; break; }
      r -= pool[i].w;
    }
    if (pick === 'weapon') {
      var weps = ['pu_spread', 'pu_laser', 'pu_wave'];
      return weps[Math.min(2, Math.floor(roll() * 3))];
    }
    return pick;
  }

  // ---------------------------------------------------------------------------
  // validate(): returns {errors, warnings}. Never throws; the engine never reads it.
  // ---------------------------------------------------------------------------
  function validatePhases(phases, where, errors, warnings) {
    if (!phases || !phases.length) { errors.push(where + ': no phases'); return; }
    for (var k = 0; k < phases.length; k++) {
      var p = phases[k];
      if (typeof p.interval !== 'number' || p.interval <= 0) errors.push(where + ' phase ' + k + ': bad interval');
      else if (p.interval > 12) errors.push(where + ' phase ' + k + ': interval ' + p.interval + ' looks like frames');
      if (!p.attacks || !p.attacks.length) errors.push(where + ' phase ' + k + ': no attacks');
      else p.attacks.forEach(function (a) {
        var id = typeof a === 'string' ? a : a && a.id;
        if (!ATTACK_IDS[id]) errors.push(where + ' phase ' + k + ': unknown attack ' + id);
        if (id === 'spawn' && !(a.type in enemyTypes && enemyTypes[a.type].behavior !== 'boss')) {
          errors.push(where + ' phase ' + k + ': spawn type ' + (a.type) + ' not a regular enemy');
        }
      });
      if (k > 0 && !(p.hpAbove < phases[k - 1].hpAbove)) errors.push(where + ': hpAbove not strictly decreasing at phase ' + k);
    }
    if (phases[phases.length - 1].hpAbove !== 0) errors.push(where + ': last phase hpAbove must be 0');
  }

  function validate() {
    var errors = [], warnings = [], key, i, s;
    for (key in enemyTypes) {
      if (!enemyTypes.hasOwnProperty(key)) continue;
      var d = enemyTypes[key];
      if (d.sprite !== key) errors.push(key + ': sprite must equal the key');
      if (!BEHAVIORS[d.behavior]) errors.push(key + ': unknown behavior ' + d.behavior);
      if (typeof d.pxps !== 'number') errors.push(key + ': pxps missing');
      if (d.fire) {
        if (!FIRE_TYPES[d.fire.type]) errors.push(key + ': unknown fire.type ' + d.fire.type);
        if (d.fire.aim && !AIMS[d.fire.aim]) errors.push(key + ': unknown aim ' + d.fire.aim);
      }
      if (window.Sprites && typeof window.Sprites.size === 'function') {
        var sz = window.Sprites.size(d.sprite);
        if (sz && (sz.w !== d.w || sz.h !== d.h)) errors.push(key + ': size ' + d.w + 'x' + d.h + ' != sprite ' + sz.w + 'x' + sz.h);
      }
      if (window.Sprites && typeof window.Sprites.has === 'function' && !window.Sprites.has(d.sprite)) {
        errors.push(key + ': sprite ' + d.sprite + ' not found');
      }
    }
    if (!stages.length) errors.push('no stages');
    for (i = 0; i < stages.length; i++) {
      s = stages[i];
      var where = 'stage ' + i + ' (' + s.name + ')';
      if (!(s.length > 0)) errors.push(where + ': length');
      if (!MUSIC[s.music]) errors.push(where + ': unknown music ' + s.music);
      if (window.SFX && typeof window.SFX.hasTrack === 'function' && !window.SFX.hasTrack(s.music)) {
        errors.push(where + ': SFX has no track ' + s.music);
      }
      if (!(s.bg.theme >= 0 && s.bg.theme <= 3)) errors.push(where + ': bg.theme out of 0..3');
      s.bg.palette.sky.forEach(function (c) {
        if (relLum(c) > 0.45) errors.push(where + ': sky stop ' + c + ' too light');
      });
      var cp = s.checkpoints;
      if (!cp || cp[0] !== 0) errors.push(where + ': checkpoints must start at 0');
      for (var c = 1; cp && c < cp.length; c++) if (!(cp[c] > cp[c - 1])) errors.push(where + ': checkpoints not ascending');
      if (cp && cp.some(function (x) { return x >= s.length; })) errors.push(where + ': checkpoint past length');
      if (!enemyTypes[s.boss.type] || enemyTypes[s.boss.type].behavior !== 'boss') errors.push(where + ': boss type');
      if (!(s.boss.hp > 0)) errors.push(where + ': boss hp');
      validatePhases(s.boss.phases, where + ' boss', errors, warnings);
      if (s.midboss) {
        if (i === 0) errors.push(where + ': stage 1 has no midboss');
        if (!(s.midboss.t >= 0 && s.midboss.t < s.length)) errors.push(where + ': midboss t outside stage');
        if (s.midboss.type !== 'midboss_butt') errors.push(where + ': midboss type must be midboss_butt');
        if (!(s.midboss.hp > 0)) errors.push(where + ': midboss hp');
        validatePhases(s.midboss.phases, where + ' midboss', errors, warnings);
      }
      var lastT = -1;
      s.waves.forEach(function (w) {
        var wh = where + ' wave t=' + w.t;
        if (!(w.t >= 0 && w.t < s.length)) errors.push(wh + ': t outside stage');
        if (!enemyTypes[w.type] || enemyTypes[w.type].behavior === 'boss') errors.push(wh + ': bad type ' + w.type);
        if (!(w.count >= 1 && w.count <= 20)) errors.push(wh + ': count must be 1..20');
        else if (w.count > 10 && !(w.pattern === 'burst' && w.spacing <= 0.1)) warnings.push(wh + ': count ' + w.count + ' > 10 (not a storm)');
        if (!PATTERNS[w.pattern]) errors.push(wh + ': unknown pattern ' + w.pattern);
        if (w.from && !FROMS[w.from]) errors.push(wh + ': unknown from ' + w.from);
        if (!(w.y === 'rand' || (w.y >= 0 && w.y <= 1))) errors.push(wh + ': y');
        if (!(w.spacing >= 0)) errors.push(wh + ': spacing');
        if (w.drop && !DROPS[w.drop]) errors.push(wh + ': unknown drop ' + w.drop);
        if (w.t < lastT) errors.push(wh + ': waves not sorted');
        lastT = w.t;
        if (i === 0 && w.t < 20 && w.type !== 'butt_small') errors.push(wh + ': stage 1 first 20 s must be butt_small');
      });
      if (i === 0) {
        var hasForce = s.waves.some(function (w) { return w.drop === 'pu_force' && w.t <= 12; });
        var hasWeapon = s.waves.some(function (w) { return w.drop === 'weapon' && w.t <= 30; });
        if (!hasForce) errors.push(where + ': no pu_force carrier by t=12');
        if (!hasWeapon) errors.push(where + ': no weapon carrier by t=30');
      }
      // Spawn density: max enemies in any 10 s window, sampled every 0.5 s.
      var peak = 0, peakAt = 0;
      for (var st = 0; st <= s.length; st += 0.5) {
        var n = 0;
        s.waves.forEach(function (w) { if (w.t >= st && w.t < st + 10) n += w.count; });
        if (n > peak) { peak = n; peakAt = st; }
      }
      var budget = BUDGET[Math.min(i, BUDGET.length - 1)];
      if (peak > budget) warnings.push(where + ': ' + peak + ' spawns per 10 s at t=' + peakAt + ' over budget ' + budget);
      for (var g = 1; g < s.waves.length; g++) {
        if (s.waves[g].t - s.waves[g - 1].t > 20) warnings.push(where + ': quiet gap over 20 s before t=' + s.waves[g].t);
      }
    }
    if (!(loopMods.length >= 1)) errors.push('loopMods empty');
    loopMods.forEach(function (r, k) {
      if (!(r.hp > 0 && r.boss > 0 && r.count > 0 && r.speed > 0 && r.fire > 0)) errors.push('loopMods[' + k + '] incomplete');
    });
    MUTATOR_ORDER.forEach(function (name) { if (!mutators[name]) errors.push('missing mutator ' + name); });
    if (!(relief.after >= 1 && relief.count > 0 && relief.count <= 1)) errors.push('relief invalid');
    // Loop 1 (swarm) count clamp: warn where a wave exceeds the engine cap of 20 after mods.
    var loop1 = getStage(stages.length);
    stages.forEach(function (st2, idx) {
      st2.waves.forEach(function (w) {
        var c = Math.floor(w.count * loop1.mods.count);
        if (c > 20) warnings.push('loop 1 stage ' + idx + ' wave t=' + w.t + ': count ' + c + ' clamps to 20');
      });
    });
    return { errors: errors, warnings: warnings };
  }

  var report = validate();
  if (typeof console !== 'undefined') {
    report.errors.forEach(function (m) { console.warn('Levels error: ' + m); });
    report.warnings.forEach(function (m) { console.warn('Levels warning: ' + m); });
  }

  window.Levels = {
    enemyTypes: enemyTypes,
    stages: stages,
    loopMods: loopMods,
    mutators: mutators,
    relief: relief,
    getStage: getStage,
    getWaves: getWaves,
    powerupDrop: powerupDrop,
    validate: validate
  };
})();
