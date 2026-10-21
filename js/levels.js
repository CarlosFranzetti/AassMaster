/*
 * aasssMaster — level data.
 *
 * Pure data plus helpers. No DOM, no globals other than window.Levels.
 *
 * Wave spawn semantics (the game does the spawning):
 *   t        seconds into the stage when the wave starts
 *   count    enemies in the wave
 *   y        'rand' or 0..1 fraction of the playfield (0 = top, 1 = floor)
 *   spacing  seconds between consecutive enemies of the wave
 *   pattern  'line' | 'column' | 'v' | 'wave' | 'burst'
 *
 * Boss phases are ordered from first to last with descending hpAbove. The active
 * phase is the first entry whose hpAbove is below the boss's current hp fraction,
 * so phase 0 runs while hp > phases[0].hpAbove, the next one while it is above
 * phases[1].hpAbove, and so on. The last phase (hpAbove 0) covers the final stretch.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Enemy catalogue. w/h match the sprite sizes in CONTRACT.md.
  // ---------------------------------------------------------------------------
  var enemyTypes = {
    butt_small: {
      sprite: 'butt_small', hp: 1, speed: 90, score: 100, w: 16, h: 16,
      behavior: 'sine', hairy: true
    },
    butt_mid: {
      sprite: 'butt_mid', hp: 3, speed: 60, score: 300, w: 24, h: 24,
      behavior: 'bounce', hairy: true,
      fire: { rate: 0.5, type: 'enemy_bullet', spread: 1 }
    },
    butt_charger: {
      sprite: 'butt_charger', hp: 2, speed: 140, score: 250, w: 20, h: 16,
      behavior: 'charge', hairy: true
    },
    butt_spitter: {
      sprite: 'butt_spitter', hp: 4, speed: 50, score: 400, w: 24, h: 20,
      behavior: 'hover_spit', hairy: true,
      fire: { rate: 0.7, type: 'hair_ball', spread: 1 }
    },
    alien_eye: {
      sprite: 'alien_eye', hp: 2, speed: 75, score: 200, w: 16, h: 16,
      behavior: 'drift',
      fire: { rate: 0.8, type: 'enemy_bullet', spread: 1 }
    },
    alien_squid: {
      sprite: 'alien_squid', hp: 3, speed: 60, score: 350, w: 20, h: 24,
      behavior: 'swoop'
    },
    boss_butt: {
      sprite: 'boss_butt', hp: 240, speed: 40, score: 5000, w: 96, h: 80,
      behavior: 'boss', hairy: true
    }
  };

  // ---------------------------------------------------------------------------
  // Stages. Waves are sorted by t. Spawning stops ~8-10s before the boss.
  // ---------------------------------------------------------------------------
  var stages = [
    // ------------------------------------------------------------------
    // 1. HAIRY NEBULA — introduces the cast one type at a time.
    // ------------------------------------------------------------------
    {
      name: 'HAIRY NEBULA',
      length: 75,
      music: 'stage',
      bg: {
        speedFar: 8, speedMid: 22, speedNear: 45,
        palette: {
          sky: ['#2a0a3a', '#3d0f4f', '#5a1a5e', '#7a2a6a', '#9a3a70'],
          far: '#1a1040',
          fog: '#3a1a5a'
        }
      },
      waves: [
        // butt_small on its own
        { t: 1.5,  type: 'butt_small',   count: 3, y: 0.5,   spacing: 0.5,  pattern: 'line' },
        { t: 3.5,  type: 'butt_small',   count: 4, y: 0.3,   spacing: 0.35, pattern: 'wave' },
        { t: 5.5,  type: 'butt_small',   count: 5, y: 0.7,   spacing: 0.3,  pattern: 'column' },
        { t: 7.5,  type: 'butt_small',   count: 3, y: 'rand', spacing: 0.4,  pattern: 'v' },
        { t: 9.5,  type: 'butt_small',   count: 6, y: 0.5,   spacing: 0.25, pattern: 'wave' },
        { t: 12.0, type: 'butt_small',   count: 4, y: 'rand', spacing: 0.1,  pattern: 'burst' },
        // butt_charger arrives
        { t: 15.5, type: 'butt_charger', count: 2, y: 0.35,  spacing: 1.2,  pattern: 'line' },
        { t: 18.0, type: 'butt_charger', count: 3, y: 0.6,   spacing: 0.8,  pattern: 'line' },
        { t: 20.5, type: 'butt_small',   count: 4, y: 0.5,   spacing: 0.3,  pattern: 'v' },
        { t: 22.5, type: 'butt_charger', count: 4, y: 'rand', spacing: 0.6,  pattern: 'burst' },
        // butt_mid starts shooting
        { t: 25.5, type: 'butt_mid',     count: 2, y: 0.3,   spacing: 1.5,  pattern: 'column' },
        { t: 28.0, type: 'butt_mid',     count: 3, y: 0.5,   spacing: 1.0,  pattern: 'v' },
        { t: 30.5, type: 'butt_mid',     count: 3, y: 0.75,  spacing: 0.8,  pattern: 'line' },
        { t: 33.0, type: 'butt_mid',     count: 4, y: 'rand', spacing: 0.6,  pattern: 'wave' },
        // alien_eye floats in
        { t: 36.5, type: 'alien_eye',    count: 3, y: 0.25,  spacing: 0.7,  pattern: 'line' },
        { t: 39.0, type: 'alien_eye',    count: 4, y: 0.6,   spacing: 0.5,  pattern: 'wave' },
        { t: 41.5, type: 'alien_eye',    count: 5, y: 'rand', spacing: 0.4,  pattern: 'v' },
        // butt_spitter spits hairballs
        { t: 44.5, type: 'butt_spitter', count: 2, y: 0.35,  spacing: 1.8,  pattern: 'column' },
        { t: 47.0, type: 'butt_spitter', count: 3, y: 0.6,   spacing: 1.2,  pattern: 'v' },
        { t: 49.5, type: 'butt_spitter', count: 3, y: 'rand', spacing: 1.0,  pattern: 'line' },
        // alien_squid swoops
        { t: 52.5, type: 'alien_squid',  count: 3, y: 0.5,   spacing: 0.8,  pattern: 'wave' },
        { t: 55.0, type: 'alien_squid',  count: 4, y: 0.3,   spacing: 0.6,  pattern: 'column' },
        { t: 57.5, type: 'alien_squid',  count: 4, y: 0.7,   spacing: 0.5,  pattern: 'v' },
        // finale mix before the boss warning
        { t: 60.0, type: 'butt_charger', count: 3, y: 'rand', spacing: 0.5,  pattern: 'burst' },
        { t: 62.0, type: 'butt_mid',     count: 3, y: 0.4,   spacing: 0.7,  pattern: 'line' },
        { t: 64.0, type: 'alien_eye',    count: 4, y: 0.5,   spacing: 0.4,  pattern: 'wave' }
      ],
      boss: {
        type: 'boss_butt',
        hp: 240,
        phases: [
          { hpAbove: 0.6, attacks: ['spread'],                    interval: 2.2 },
          { hpAbove: 0.3, attacks: ['spread', 'spawn'],           interval: 1.8 },
          { hpAbove: 0,   attacks: ['spread', 'spawn', 'swallow'], interval: 1.3 }
        ]
      }
    },

    // ------------------------------------------------------------------
    // 2. THE CRACK OF DOOM — every type, mixed; busier and faster.
    // ------------------------------------------------------------------
    {
      name: 'THE CRACK OF DOOM',
      length: 90,
      music: 'stage',
      bg: {
        speedFar: 10, speedMid: 30, speedNear: 60,
        palette: {
          sky: ['#3a0a1a', '#5a0f22', '#7a1a2a', '#9a2a30', '#b84a38'],
          far: '#2a0a20',
          fog: '#5a1a30'
        }
      },
      waves: [
        // opening block
        { t: 1.0,  type: 'butt_small',   count: 4, y: 'rand', spacing: 0.3,  pattern: 'wave' },
        { t: 3.0,  type: 'alien_eye',    count: 3, y: 0.3,   spacing: 0.5,  pattern: 'line' },
        { t: 5.0,  type: 'butt_charger', count: 3, y: 0.6,   spacing: 0.6,  pattern: 'line' },
        { t: 7.0,  type: 'butt_small',   count: 5, y: 0.5,   spacing: 0.25, pattern: 'v' },
        { t: 9.5,  type: 'butt_mid',     count: 3, y: 'rand', spacing: 0.7,  pattern: 'column' },
        { t: 12.0, type: 'alien_squid',  count: 3, y: 0.4,   spacing: 0.7,  pattern: 'wave' },
        { t: 14.5, type: 'butt_spitter', count: 2, y: 0.6,   spacing: 1.5,  pattern: 'column' },
        { t: 17.0, type: 'butt_charger', count: 4, y: 'rand', spacing: 0.4,  pattern: 'burst' },
        { t: 19.5, type: 'alien_eye',    count: 4, y: 0.7,   spacing: 0.4,  pattern: 'v' },
        // second block
        { t: 23.5, type: 'butt_mid',     count: 4, y: 0.25,  spacing: 0.6,  pattern: 'wave' },
        { t: 25.5, type: 'butt_small',   count: 6, y: 'rand', spacing: 0.2,  pattern: 'burst' },
        { t: 28.0, type: 'alien_squid',  count: 4, y: 0.5,   spacing: 0.5,  pattern: 'column' },
        { t: 30.0, type: 'butt_spitter', count: 3, y: 0.35,  spacing: 1.0,  pattern: 'v' },
        { t: 32.5, type: 'butt_charger', count: 5, y: 0.5,   spacing: 0.35, pattern: 'line' },
        { t: 35.0, type: 'alien_eye',    count: 5, y: 'rand', spacing: 0.3,  pattern: 'wave' },
        { t: 37.5, type: 'butt_mid',     count: 4, y: 0.6,   spacing: 0.5,  pattern: 'line' },
        { t: 40.0, type: 'butt_small',   count: 6, y: 0.4,   spacing: 0.2,  pattern: 'v' },
        // third block
        { t: 42.5, type: 'alien_squid',  count: 4, y: 'rand', spacing: 0.45, pattern: 'v' },
        { t: 44.5, type: 'butt_charger', count: 4, y: 0.3,   spacing: 0.4,  pattern: 'burst' },
        { t: 46.5, type: 'butt_spitter', count: 3, y: 0.7,   spacing: 0.9,  pattern: 'wave' },
        { t: 49.0, type: 'butt_mid',     count: 4, y: 'rand', spacing: 0.4,  pattern: 'column' },
        { t: 51.5, type: 'alien_eye',    count: 6, y: 0.4,   spacing: 0.3,  pattern: 'line' },
        { t: 54.0, type: 'butt_small',   count: 7, y: 'rand', spacing: 0.2,  pattern: 'wave' },
        { t: 56.5, type: 'alien_squid',  count: 5, y: 0.6,   spacing: 0.35, pattern: 'column' },
        { t: 59.0, type: 'butt_charger', count: 6, y: 0.3,   spacing: 0.3,  pattern: 'v' },
        // dense final block
        { t: 61.5, type: 'butt_spitter', count: 3, y: 0.5,   spacing: 0.8,  pattern: 'line' },
        { t: 63.5, type: 'butt_mid',     count: 5, y: 'rand', spacing: 0.4,  pattern: 'wave' },
        { t: 66.0, type: 'alien_eye',    count: 5, y: 0.25,  spacing: 0.35, pattern: 'v' },
        { t: 68.0, type: 'butt_small',   count: 8, y: 0.5,   spacing: 0.15, pattern: 'burst' },
        { t: 70.5, type: 'alien_squid',  count: 5, y: 'rand', spacing: 0.3,  pattern: 'column' },
        { t: 72.5, type: 'butt_charger', count: 6, y: 0.4,   spacing: 0.25, pattern: 'line' },
        { t: 75.0, type: 'butt_spitter', count: 4, y: 0.6,   spacing: 0.6,  pattern: 'v' },
        { t: 77.5, type: 'butt_mid',     count: 4, y: 0.3,   spacing: 0.5,  pattern: 'wave' },
        { t: 79.0, type: 'butt_small',   count: 6, y: 'rand', spacing: 0.2,  pattern: 'v' }
      ],
      boss: {
        type: 'boss_butt',
        hp: 380,
        phases: [
          { hpAbove: 0.7, attacks: ['spread', 'spawn'],           interval: 2.0 },
          { hpAbove: 0.4, attacks: ['spread', 'spawn', 'swallow'], interval: 1.6 },
          { hpAbove: 0.15, attacks: ['spread', 'swallow'],        interval: 1.2 },
          { hpAbove: 0,   attacks: ['spread', 'spawn', 'swallow'], interval: 1.0 }
        ]
      }
    },

    // ------------------------------------------------------------------
    // 3. RECTUM OF THE GODS — dense, overlapping, relentless.
    // ------------------------------------------------------------------
    {
      name: 'RECTUM OF THE GODS',
      length: 105,
      music: 'stage',
      bg: {
        speedFar: 12, speedMid: 38, speedNear: 75,
        palette: {
          sky: ['#0f2a1a', '#1a3a2a', '#2a4a30', '#3a5a3a', '#4a6a40'],
          far: '#0a1a14',
          fog: '#1f3a2a'
        }
      },
      waves: [
        // early ramp
        { t: 1.0,  type: 'butt_small',   count: 5,  y: 'rand', spacing: 0.25, pattern: 'wave' },
        { t: 2.5,  type: 'alien_eye',    count: 4,  y: 0.3,   spacing: 0.4,  pattern: 'line' },
        { t: 4.0,  type: 'butt_charger', count: 4,  y: 0.6,   spacing: 0.4,  pattern: 'line' },
        { t: 5.5,  type: 'butt_mid',     count: 3,  y: 0.4,   spacing: 0.7,  pattern: 'v' },
        { t: 7.0,  type: 'alien_squid',  count: 4,  y: 0.5,   spacing: 0.5,  pattern: 'wave' },
        { t: 8.5,  type: 'butt_spitter', count: 3,  y: 0.25,  spacing: 0.9,  pattern: 'column' },
        { t: 10.0, type: 'butt_small',   count: 7,  y: 'rand', spacing: 0.18, pattern: 'burst' },
        { t: 12.0, type: 'butt_charger', count: 5,  y: 0.35,  spacing: 0.3,  pattern: 'v' },
        { t: 13.5, type: 'alien_eye',    count: 6,  y: 'rand', spacing: 0.3,  pattern: 'wave' },
        { t: 15.0, type: 'butt_mid',     count: 5,  y: 0.55,  spacing: 0.5,  pattern: 'line' },
        { t: 17.0, type: 'alien_squid',  count: 5,  y: 0.25,  spacing: 0.4,  pattern: 'column' },
        { t: 18.5, type: 'butt_spitter', count: 4,  y: 0.7,   spacing: 0.7,  pattern: 'v' },
        { t: 20.0, type: 'butt_small',   count: 8,  y: 0.5,   spacing: 0.15, pattern: 'wave' },
        { t: 22.0, type: 'butt_charger', count: 6,  y: 'rand', spacing: 0.25, pattern: 'burst' },
        { t: 24.0, type: 'alien_eye',    count: 5,  y: 0.6,   spacing: 0.25, pattern: 'v' },
        // mid stretch
        { t: 26.0, type: 'butt_mid',     count: 6,  y: 'rand', spacing: 0.35, pattern: 'wave' },
        { t: 28.0, type: 'alien_squid',  count: 6,  y: 0.3,   spacing: 0.3,  pattern: 'line' },
        { t: 29.5, type: 'butt_spitter', count: 4,  y: 0.5,   spacing: 0.6,  pattern: 'column' },
        { t: 31.0, type: 'butt_charger', count: 7,  y: 0.7,   spacing: 0.2,  pattern: 'line' },
        { t: 33.0, type: 'butt_small',   count: 9,  y: 'rand', spacing: 0.12, pattern: 'burst' },
        { t: 35.0, type: 'alien_eye',    count: 6,  y: 0.4,   spacing: 0.3,  pattern: 'wave' },
        { t: 36.5, type: 'butt_mid',     count: 5,  y: 0.2,   spacing: 0.5,  pattern: 'v' },
        { t: 38.5, type: 'alien_squid',  count: 7,  y: 0.6,   spacing: 0.25, pattern: 'column' },
        { t: 40.0, type: 'butt_spitter', count: 5,  y: 'rand', spacing: 0.5,  pattern: 'line' },
        { t: 42.0, type: 'butt_charger', count: 8,  y: 0.4,   spacing: 0.2,  pattern: 'v' },
        { t: 44.0, type: 'butt_small',   count: 8,  y: 0.7,   spacing: 0.15, pattern: 'wave' },
        { t: 46.0, type: 'alien_eye',    count: 7,  y: 'rand', spacing: 0.25, pattern: 'burst' },
        { t: 47.5, type: 'butt_mid',     count: 6,  y: 0.5,   spacing: 0.35, pattern: 'line' },
        { t: 49.5, type: 'alien_squid',  count: 6,  y: 0.3,   spacing: 0.3,  pattern: 'wave' },
        { t: 51.0, type: 'butt_spitter', count: 5,  y: 0.65,  spacing: 0.5,  pattern: 'v' },
        { t: 53.0, type: 'butt_charger', count: 8,  y: 'rand', spacing: 0.2,  pattern: 'column' },
        { t: 55.0, type: 'butt_small',   count: 10, y: 0.5,   spacing: 0.12, pattern: 'burst' },
        // late stretch
        { t: 57.0, type: 'alien_eye',    count: 7,  y: 0.3,   spacing: 0.3,  pattern: 'wave' },
        { t: 58.5, type: 'butt_mid',     count: 6,  y: 'rand', spacing: 0.4,  pattern: 'v' },
        { t: 60.5, type: 'butt_spitter', count: 6,  y: 0.6,   spacing: 0.45, pattern: 'column' },
        { t: 62.0, type: 'alien_squid',  count: 7,  y: 0.4,   spacing: 0.25, pattern: 'line' },
        { t: 64.0, type: 'butt_charger', count: 9,  y: 'rand', spacing: 0.18, pattern: 'wave' },
        { t: 66.0, type: 'butt_small',   count: 9,  y: 0.25,  spacing: 0.12, pattern: 'v' },
        { t: 67.5, type: 'alien_eye',    count: 8,  y: 0.7,   spacing: 0.2,  pattern: 'burst' },
        { t: 69.5, type: 'butt_mid',     count: 7,  y: 0.45,  spacing: 0.3,  pattern: 'column' },
        { t: 71.0, type: 'butt_spitter', count: 6,  y: 'rand', spacing: 0.4,  pattern: 'line' },
        { t: 73.0, type: 'alien_squid',  count: 8,  y: 0.55,  spacing: 0.2,  pattern: 'wave' },
        { t: 75.0, type: 'butt_charger', count: 10, y: 0.3,   spacing: 0.15, pattern: 'burst' },
        { t: 77.0, type: 'butt_small',   count: 10, y: 'rand', spacing: 0.12, pattern: 'wave' },
        { t: 78.5, type: 'alien_eye',    count: 8,  y: 0.5,   spacing: 0.2,  pattern: 'v' },
        { t: 80.5, type: 'butt_mid',     count: 7,  y: 0.3,   spacing: 0.3,  pattern: 'line' },
        { t: 82.0, type: 'butt_spitter', count: 7,  y: 'rand', spacing: 0.4,  pattern: 'column' },
        { t: 84.0, type: 'alien_squid',  count: 9,  y: 0.6,   spacing: 0.18, pattern: 'v' },
        { t: 85.5, type: 'butt_charger', count: 10, y: 0.4,   spacing: 0.12, pattern: 'line' },
        { t: 87.0, type: 'butt_small',   count: 12, y: 'rand', spacing: 0.1,  pattern: 'burst' },
        { t: 89.0, type: 'butt_mid',     count: 8,  y: 0.5,   spacing: 0.25, pattern: 'wave' },
        { t: 90.5, type: 'alien_eye',    count: 9,  y: 0.25,  spacing: 0.15, pattern: 'v' },
        { t: 92.0, type: 'butt_spitter', count: 7,  y: 0.7,   spacing: 0.35, pattern: 'column' },
        { t: 93.5, type: 'alien_squid',  count: 9,  y: 'rand', spacing: 0.2,  pattern: 'line' },
        { t: 95.0, type: 'butt_charger', count: 10, y: 0.5,   spacing: 0.1,  pattern: 'burst' }
      ],
      boss: {
        type: 'boss_butt',
        hp: 520,
        phases: [
          { hpAbove: 0.75, attacks: ['spread', 'spawn'],            interval: 1.8 },
          { hpAbove: 0.5,  attacks: ['spread', 'spawn', 'swallow'],  interval: 1.5 },
          { hpAbove: 0.25, attacks: ['spread', 'swallow'],           interval: 1.2 },
          { hpAbove: 0.1,  attacks: ['spread', 'spawn', 'swallow'],  interval: 1.0 },
          { hpAbove: 0,    attacks: ['spread', 'swallow'],           interval: 0.8 }
        ]
      }
    }
  ];

  var stageCount = stages.length;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function wrapIndex(i) {
    return ((i % stageCount) + stageCount) % stageCount;
  }

  // Waves of stage `stageIndex` (wraps) with fromT <= t < toT. Returns shallow copies.
  function getWaves(stageIndex, fromT, toT) {
    var stage = stages[wrapIndex(stageIndex)];
    var out = [];
    for (var i = 0; i < stage.waves.length; i++) {
      var w = stage.waves[i];
      if (w.t >= fromT && w.t < toT) out.push(Object.assign({}, w));
    }
    return out;
  }

  // Stage `i` (wraps). On each full loop through the stage list the boss gets
  // 50% more hp. Returns a shallow copy so the original data is never mutated.
  function getStage(i) {
    var idx = wrapIndex(i);
    var loop = Math.floor(i / stageCount);
    var src = stages[idx];
    var boss = Object.assign({}, src.boss, {
      hp: Math.round(src.boss.hp * (1 + 0.5 * loop))
    });
    return Object.assign({}, src, { boss: boss, loop: loop });
  }

  // Powerup roll for a destroyed enemy. rng returns [0,1). Boss never drops here
  // (the game handles boss rewards).
  var DROP_CHANCE = { butt_mid: 0.25, butt_spitter: 0.3, alien_squid: 0.3 };
  var DEFAULT_DROP_CHANCE = 0.08;
  var DROP_WEIGHTS = [
    { id: 'pu_power',  weight: 0.40 },
    { id: 'pu_speed',  weight: 0.25 },
    { id: 'pu_shield', weight: 0.20 },
    { id: 'pu_option', weight: 0.15 }
  ];

  function powerupDrop(enemyType, rng) {
    if (enemyType === 'boss_butt') return null;
    var roll = typeof rng === 'function' ? rng : Math.random;
    var chance = DROP_CHANCE.hasOwnProperty(enemyType) ? DROP_CHANCE[enemyType] : DEFAULT_DROP_CHANCE;
    if (roll() >= chance) return null;
    var r = roll();
    var acc = 0;
    for (var i = 0; i < DROP_WEIGHTS.length; i++) {
      acc += DROP_WEIGHTS[i].weight;
      if (r < acc) return DROP_WEIGHTS[i].id;
    }
    return DROP_WEIGHTS[DROP_WEIGHTS.length - 1].id;
  }

  window.Levels = {
    enemyTypes: enemyTypes,
    stages: stages,
    stageCount: stageCount,
    getWaves: getWaves,
    getStage: getStage,
    powerupDrop: powerupDrop
  };
})();
