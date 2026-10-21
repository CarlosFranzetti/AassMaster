/* ======================================================================
 * aasssMaster v2 - js/game.js  (global `Game`)
 * Simulation: loop, input, player/Force/weapons/charge, enemies, waves,
 * boss + mid-boss, scoring, flow (checkpoints/continues).  All drawing is
 * in js/render.js (GameRender).  Coded against CONTRACT.md v2 +
 * team/DIRECTOR-RULINGS.md + the round-3 files.
 * ====================================================================== */
(function () {
'use strict';

/* ======================================================================
 * 1. CONSTANTS, RNG, UTILS, POOLS
 * ====================================================================== */
var W = 384, H = 216, FLOOR = 196, CEIL = 20, TAU = Math.PI * 2, PI = Math.PI;
var STEP = 1000 / 60;
var HI_KEY = 'aasssMaster.hi', HAP_KEY = 'aasssMaster.haptics';

/* every tuning number lives here (debug hook: Game.debug.CFG) */
var CFG = {
  chargeStart: 21, tier1: 30, tier2: 60, tier3: 96,       // frames after the PRESS (R6 / C2)
  beamDmg: [0, 4, 7, 12], beamW: [0, 24, 40, 64], beamH: [0, 10, 16, 24], beamSpeed: 9, beamTick: 6,
  wheezeCd: 12,                                            // autofire cooldown once tier 1 is reached
  chainWin: 90, chainMax: 150, grazeDist: 7, grazeScore: 50, grazeAdd: 18,
  bossBodyMult: 0.25, struggleNeed: 10, gulpFrames: 70, struggleGap: 4,
  lungeCooldown: 380, continues: 3, continueFrames: 540,
  forceDmg: 2, forceTick: 6, throwSpeed: 7, throwDist: 110, recallSpeed: 6,
  bombNeed: 6000, bombEnemyDmg: 10, bombBossDmg: 15
};

var canvas = null, ctx = null, wrap = null, inited = false;
var scale = 1, cssW = W, cssH = H;
var tick = 0;

var seed = ((Date.now() & 0x7fffffff) ^ 0x5bd1e995) >>> 0;
function rng() { // sim RNG (mulberry32): deterministic, never touched by render/fx
  seed = (seed + 0x6D2B79F5) | 0;
  var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rr(a, b) { return a + (b - a) * rng(); }
function ri(a, b) { return Math.floor(a + (b - a + 1) * rng()); }
var rf = function () { return Math.random(); };           // fx RNG, replaced by GameRender.rf in init
function rfr(a, b) { return a + (b - a) * rf(); }
function rfi(a, b) { return Math.floor(a + (b - a + 1) * rf()); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function ov(ax, ay, aw, ah, bx, by, bw, bh) { return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by; }
function pad(n, len) { var s = String(n); while (s.length < len) s = '0' + s; return s; }
function makePool(n, ctor) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = ctor(); return a; }
function alloc(pool) { for (var i = 0; i < pool.length; i++) if (!pool[i].on) return pool[i]; return null; }
var allocFails = 0;
function allocE() { var e = alloc(enemies); if (!e) allocFails++; return e; }
var warned = {};
function warnOnce(key, msg) { if (!warned[key]) { warned[key] = true; try { console.warn('Game: ' + msg); } catch (e) { /* ignore */ } } }

function loadHi() { try { var v = parseInt(window.localStorage.getItem(HI_KEY), 10); return isNaN(v) ? 0 : v; } catch (e) { return 0; } }
function saveHi(v) { try { window.localStorage.setItem(HI_KEY, String(v)); } catch (e) { /* ignore */ } }
function loadHaptics() { try { return window.localStorage.getItem(HAP_KEY) !== '0'; } catch (e) { return true; } }
function saveHaptics(v) { try { window.localStorage.setItem(HAP_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ } }

/* ======================================================================
 * 2. ADAPTERS: sprites meta / sfx / music / Levels (all guarded, no v1 heuristics)
 * ====================================================================== */
var R = window.GameRender;            // render.js loads first
var spr = R.spr;
var hitCache = {};
/* hit rect of a sprite frame in unflipped sprite px; fallback = inset box */
function hitOf(name, frame) {
  var k = name + '#' + (frame | 0), h = hitCache[k];
  if (h) return h;
  var m = spr.meta(name, frame | 0);
  if (m && m.hit) h = m.hit;
  else { var z = spr.size(name), ins = z.w <= 12 ? 1 : 2; h = { x: ins, y: ins, w: Math.max(1, z.w - ins * 2), h: Math.max(1, z.h - ins * 2) }; }
  hitCache[k] = h;
  return h;
}
function muzzleOf(name, frame, dx, dy) {
  var m = spr.meta(name, frame | 0);
  return (m && m.muzzle) ? m.muzzle : { x: dx, y: dy };
}

var sfxLast = {};
var sfxGap = { shoot: 5, fart: 12, graze: 4, struggle: 4, boss_hit: 5, hit: 2 };
function sfx(name, opts) {
  var g = sfxGap[name];
  if (g) { if (tick - (sfxLast[name] || -999) < g) return null; sfxLast[name] = tick; }
  try { if (window.SFX && typeof window.SFX.play === 'function') return window.SFX.play(name, opts) || null; } catch (e) { /* silent */ }
  return null;
}
var curTrack = null;
function music(track, opts) {
  curTrack = track;
  try { if (window.SFX && window.SFX.music && window.SFX.music.start) window.SFX.music.start(track, opts); } catch (e) { /* silent */ }
}
function musicStop(opts) { try { if (window.SFX && window.SFX.music && window.SFX.music.stop) window.SFX.music.stop(opts); } catch (e) { /* silent */ } }
function musicCall(fn, a) { try { var M = window.SFX && window.SFX.music; if (M && typeof M[fn] === 'function') M[fn](a); } catch (e) { /* silent */ } }
function stinger(n) { musicCall('stinger', n); }
function stopLoops() { try { if (window.SFX && typeof window.SFX.stopLoops === 'function') window.SFX.stopLoops(); } catch (e) { /* silent */ } }
function sfxInit() { try { if (window.SFX && window.SFX.init) window.SFX.init(); } catch (e) { /* silent */ } }

/* ---------------------------------------------------------------- Levels */
var DEF_MODS = { hp: 1, boss: 1, count: 1, speed: 1, fire: 1 };
var DEF_STAGE = {
  name: 'UNKNOWN SECTOR', intro: '', length: 30, music: 'stage1', bg: { theme: 0 }, checkpoints: [0], drops: { mult: 1 },
  boss: { type: 'boss_butt', hp: 100, phases: [{ hpAbove: 0, attacks: ['fan'], interval: 2 }] }, midboss: null, waves: [],
  loop: 0, mutator: null, mods: DEF_MODS
};
var DEF_TYPE = { sprite: 'butt_small', hp: 1, pxps: 60, score: 100, w: 16, h: 16, behavior: 'straight' };
function LV() { return window.Levels || null; }
function getStageData(raw) {
  var L = LV();
  try { if (L && typeof L.getStage === 'function') { var s = L.getStage(raw); if (s) return s; } } catch (e) { warnOnce('gs', 'Levels.getStage failed: ' + e.message); }
  warnOnce('nolv', 'Levels.getStage missing, using an empty stage');
  return DEF_STAGE;
}
function etype(name) {
  var L = LV(), d = null;
  try { if (L && L.enemyTypes) d = L.enemyTypes[name]; } catch (e) { d = null; }
  if (!d) { warnOnce('et' + name, 'unknown enemy type ' + name); return DEF_TYPE; }
  return d;
}
function getWaves(raw, from, to) {
  var L = LV();
  try { if (L && typeof L.getWaves === 'function') { var r = L.getWaves(raw, from, to); if (r && r.length !== undefined) return r; } } catch (e) { warnOnce('gw', 'Levels.getWaves failed: ' + e.message); }
  return [];
}
var dropCtx = { power: 0, weapon: 'main', speed: 0, shield: false, hasForce: false, forceLv: 0, lives: 3, rank: 0.5, stage: 0, loop: 0 };
function powerupDrop(name) {
  var L = LV();
  if (!L || typeof L.powerupDrop !== 'function') return null;
  dropCtx.power = P.powerLv; dropCtx.weapon = P.weapon; dropCtx.speed = P.speedLv; dropCtx.shield = P.shield;
  dropCtx.hasForce = F.lv > 0; dropCtx.forceLv = F.lv; dropCtx.lives = lives; dropCtx.rank = rank; dropCtx.stage = stageIdx; dropCtx.loop = loopN;
  try { var r = L.powerupDrop(name, rng, dropCtx); return normCapsule(r); } catch (e) { warnOnce('pd', 'powerupDrop failed: ' + e.message); return null; }
}
var CAPSULES = { pu_power: 1, pu_speed: 1, pu_shield: 1, pu_force: 1, pu_spread: 1, pu_laser: 1, pu_wave: 1, pu_life: 1 };
function normCapsule(r) {
  if (typeof r !== 'string') return null;
  if (r === 'pu_option') r = 'pu_force';
  if (!CAPSULES[r]) return null;
  if (!spr.has(r)) return r === 'pu_life' ? 'pu_shield' : (spr.has('pu_power') ? 'pu_power' : null);
  return r;
}

/* ======================================================================
 * 3. GAME STATE + POOLS
 * ====================================================================== */
var mode = 'title';        // title | playing | gameover | continue
var phase = 'intro';       // intro | stage | warn | boss | clear
var paused = false;
var phaseT = 0, titleT = 0, gameoverT = 0, bannerT = 0, bannerStr = '', bannerCol = '#ff3a3a', contT = 0;
var score = 0, hiScore = 0, lives = 3, continues = 0, nextExtra = 50000, scoreStr = '0000000', hiStr = '0000000';
var stageIdx = 0, loopN = 0, stageT = 0, lastWaveT = 0, stage = DEF_STAGE, mods = DEF_MODS, newHi = false, storedHi = 0;
var stageName = '', stageIntro = '', stageMutator = '';
var midState = 0;          // 0 not yet, 1 active, 2 done
var lastCp = 0, deathsAtCp = 0, diedBoss = false, diedMid = false, cpIdx = 0;
var chain = 0, chainT = 0, mult = 1, rank = 0.5;
var shakeAmt = 0, shakeX = 0, shakeY = 0, flashWhite = 0, clearBonus = 0;
var haptics = true, lastVib = -999, dangerOn = false, dangerT = -1, lastIntensity = -999;
var slowT = 0, slowHalf = false, freezeT = 0, slowOn = false;   // hit-stop + slow-mo
var bombMeter = 0, bombReady = false;
var recovQ = [];           // scheduled recovery capsules [{at, name}], tiny, allocated on death only

var bullets  = makePool(96,  function () { return { on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, w: 8, h: 3, dmg: 1, t: 0, tier: 0, life: 0, pierce: 0, ph: 0, amp: 0, y0: 0, last: null }; });
var ebul     = makePool(160, function () { return { on: false, x: 0, y: 0, vx: 0, vy: 0, kind: 0, w: 6, h: 6, t: 0, grazed: false }; });
var parts    = makePool(320, function () { return { on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: '#fff', s: 1, spr: '', nf: 1, grav: 0, drag: 1 }; });
var enemies  = makePool(64,  function () { return { on: false, spr: '', sw: 16, sh: 16, beh: 'straight', t: 0, flash: 0, spit: 0, windup: 0, burstN: 0, state: 0, carrier: '', flipX: false, x: 0, y: 0, hp: 1, maxhp: 1 }; });
var powerups = makePool(12,  function () { return { on: false, x: 0, y: 0, name: 'pu_power', t: 0 }; });
var popups   = makePool(20,  function () { return { on: false, x: 0, y: 0, str: '', life: 0, c: '#fff' }; });
var spawnQ   = makePool(90,  function () { return { on: false, at: 0, name: '', from: 'right', pat: 'line', i: 0, n: 1, fy: 0.5, rigid: false, ph: 0, amp: 0, vy: 0, stopX: 0, offs: null, carry: '', side: '', path: null }; });
var critters = [];

var P = {
  x: 40, y: 100, tx: 40, ty: 100, w: 24, h: 16, alive: false, respawn: 0, inv: 0, flash: 0, vy: 0, bank: 0,
  powerLv: 0, speedLv: 0, weapon: 'main', shield: false, fireCd: 0, swallowed: false, taps: 0, lastTap: -99, volley: 0
};
var F = { on: false, lv: 0, mode: 'none', x: 0, y: 0, vx: 0, holdX: 0, flashT: 0 };
function mkBoss(kind) {
  return {
    on: false, kind: kind, name: 'boss_butt', x: W + 20, y: 62, w: 96, h: 80, hp: 1, maxhp: 1, mode: 'dead', t: 0, sub: 0, subMax: 0, subT: 0,
    flash: 0, flinch: 0, atkT: 0, homeX: 266, phaseI: 0, phases: null, seqI: 0, lastLunge: -9999, jx: 0, fr: 0, deadT: 0, score: 5000,
    drop: '', lungeSpd: 0, beamCd: 0, cur: null, spiralA: 0, blastT: 0, hitT: 0, aliveT: 0, flee: 25, laneY: 0, tele: 48, volleyI: 0, lunged: false
  };
}
var B = mkBoss('boss'), M = mkBoss('mid');

/* input state */
var keys = { left: false, right: false, up: false, down: false };
var keyFire = false, touchFire = 0, firing = false, fireQueued = false, xHold = false, chargeT = 0, chargeH = null, laserH = null;
var dragX = 0, dragY = 0, ptrs = {}, fsTries = 0, stickA = 0;
var stick = { on: false, ox: 0, oy: 0, cx: 0, cy: 0, a: 0 };
var laser = { on: false, x: 0, y: 0, len: 0 };
var lane = { on: false, y: 0, h: 0 };
var beamTier = 0;

/* ======================================================================
 * 4. FX HELPERS
 * ====================================================================== */
function spawnP(kind, x, y, vx, vy, life, c, s) {
  var p = alloc(parts); if (!p) return null;
  p.on = true; p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life;
  p.c = c || '#fff'; p.s = s || 1; p.grav = 0; p.drag = 1; p.spr = ''; p.nf = 1;
  return p;
}
var SPARK_COLS = ['#ffe14a', '#ff8a2a', '#ff3a3a', '#ffffff', '#ff5fa2'];
function sparks(x, y, n, spd, cols) {
  cols = cols || SPARK_COLS;
  for (var i = 0; i < n; i++) {
    var a = rf() * TAU, v = rfr(0.4, spd);
    var p = spawnP(0, x, y, Math.cos(a) * v, Math.sin(a) * v, rfi(14, 28), cols[rfi(0, cols.length - 1)], rf() < 0.3 ? 2 : 1);
    if (p) { p.grav = 0.03; p.drag = 0.97; }
  }
}
/* animated sprite particle centred on (cx,cy), frames spread over `life` ticks */
function anim(name, cx, cy, life) {
  var z = spr.size(name);
  var p = spawnP(1, cx - z.w / 2, cy - z.h / 2, 0, 0, life, '#fff', 1);
  if (p) { p.spr = name; p.nf = spr.frames(name); }
  return p;
}
function explode(cx, cy, big) {
  anim(big ? 'explosion' : 'explosion_small', cx, cy, big ? 20 : 13);
  if (big) { for (var k = 0; k < 2; k++) anim('explosion_small', cx + rfr(-12, 12), cy + rfr(-12, 12), 14); }
  sparks(cx, cy, big ? 7 : 3, big ? 3 : 2.2);
}
function tufts(cx, cy, n) {
  for (var i = 0; i < n; i++) {
    var p = spawnP(2, cx - 4, cy - 4, rfr(-1.4, 0.6), rfr(-1.6, 0.2), rfi(30, 50), '#fff', 1);
    if (p) { p.spr = 'hair_tuft'; p.nf = spr.frames('hair_tuft'); p.grav = 0.02; p.drag = 0.98; }
  }
}
function popup(x, y, str, c) {
  var p = alloc(popups); if (!p) return;
  p.on = true; p.x = clamp(x, 2, W - 40); p.y = y; p.str = str; p.life = 50; p.c = c || '#fff';
}
function shake(v) { if (v > shakeAmt) shakeAmt = v; }
function banner(str, t, col) { bannerStr = str; bannerT = t; bannerCol = col || '#ff3a3a'; }
function vib(p) {
  if (!haptics || tick - lastVib < 4) return;
  try { if (navigator.vibrate && !document.hidden) { navigator.vibrate(p); lastVib = tick; } } catch (e) { /* ignore */ }
}
function addScore(n) {
  score += n;
  scoreStr = pad(score, 7);
  if (score > hiScore) { hiScore = score; hiStr = pad(hiScore, 7); }
  while (score >= nextExtra) {
    nextExtra += 50000;
    if (lives < 9) lives++;
    sfx('extra_life');
    popup(P.x, P.y - 10, '1UP', '#7dff7d');
  }
}

/* ======================================================================
 * 5. PLAYER: weapons, charge, Force pod, hurt / die / respawn
 * ====================================================================== */
var mzx = 0, mzy = 0;
function pFrame() { return P.bank > 0 ? 1 : (P.bank < 0 ? 2 : 0); }
function calcMuzzle() { var m = muzzleOf('player', pFrame(), 23, 8); mzx = P.x + m.x; mzy = P.y + m.y; }
function addBullet(kind, x, y, vx, vy, w, h, dmg, life, pierce) {
  var b = alloc(bullets); if (!b) return null;
  b.on = true; b.kind = kind; b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.w = w; b.h = h; b.dmg = dmg; b.t = 0; b.tier = 0;
  b.life = life || 0; b.pierce = pierce || 0; b.last = null; b.ph = 0; b.amp = 0; b.y0 = y;
  return b;
}
function chargeTier() { return chargeT >= CFG.tier3 ? 3 : (chargeT >= CFG.tier2 ? 2 : (chargeT >= CFG.tier1 ? 1 : 0)); }
function forceShots() {
  if (!F.on) return;
  var d = 0.8 * (1 + 0.25 * F.lv), fx, fy;
  if (F.mode === 'rear') {
    fx = F.x - 4; fy = F.y + 7;
    addBullet(1, fx, fy, -8, 0, 6, 3, d);
    if (F.lv >= 2) { addBullet(1, fx, fy, -7.5, -1.2, 6, 3, d); addBullet(1, fx, fy, -7.5, 1.2, 6, 3, d); }
  } else {
    fx = F.x + 14; fy = F.y + 7;
    addBullet(1, fx, fy, 8, 0, 6, 3, d);
    if (F.lv >= 2) { addBullet(1, fx, fy, 7.5, -1.2, 6, 3, d); addBullet(1, fx, fy, 7.5, 1.2, 6, 3, d); }
    if (F.mode === 'out' && F.lv >= 2) addBullet(1, F.x - 4, F.y + 7, -8, 0, 6, 3, d);
  }
}
var WAVE_DMG = [1, 1.3, 1.3, 1.6];
function fireVolley() {
  calcMuzzle();
  var lv = P.powerLv, cx = mzx - 2, cy = mzy, i, n, a, b;
  switch (P.weapon) {
    case 'spread':
      n = lv >= 2 ? 5 : 3;
      for (i = 0; i < n; i++) { a = (i - (n - 1) / 2) * 0.17; addBullet(2, cx, cy - 3, Math.cos(a) * 8, Math.sin(a) * 8, 6, 6, lv >= 2 ? 0.9 : 0.8, 30, 0); }
      sfx('shoot_spread', { x: P.x });
      break;
    case 'wave':
      for (i = 0; i < (lv >= 2 ? 4 : 2); i++) {
        b = addBullet(3, cx, cy - 3, 6.5, 0, 8, 6, WAVE_DMG[lv], 0, 2);
        if (b) { b.ph = (i & 1) ? PI : 0; b.amp = (i >> 1) ? 20 : (lv >= 2 ? 10 : 12); b.y0 = cy - 3; }
      }
      sfx('shoot_wave', { x: P.x });
      break;
    case 'laser':
      break;
    default:
      if (lv <= 0) addBullet(0, cx, cy - 1, 8, 0, 8, 3, 1);
      else if (lv === 1) { addBullet(0, cx, cy - 4, 8, 0, 8, 3, 1); addBullet(0, cx, cy + 2, 8, 0, 8, 3, 1); }
      else if (lv === 2) { addBullet(0, cx, cy - 1, 8.5, 0, 8, 3, 1); addBullet(0, cx, cy - 5, 8, -0.9, 8, 3, 1); addBullet(0, cx, cy + 3, 8, 0.9, 8, 3, 1); }
      else { addBullet(0, cx, cy - 3, 9, 0, 8, 3, 1.2); addBullet(0, cx, cy + 1, 9, 0, 8, 3, 1.2); addBullet(0, cx, cy - 6, 8, -1.3, 8, 3, 1); addBullet(0, cx, cy + 4, 8, 1.3, 8, 3, 1); }
      sfx('shoot', { variant: chargeTier() >= 1 ? 'wheeze' : 'main', x: P.x });
  }
  forceShots();
  anim('muzzle', mzx + 3, mzy, 6);
}
function fireBeam(tier) {
  calcMuzzle();
  var b = alloc(bullets); if (!b) return;
  b.on = true; b.kind = 4; b.tier = tier; b.w = CFG.beamW[tier]; b.h = CFG.beamH[tier]; b.x = mzx - 2; b.y = mzy - b.h / 2;
  b.vx = CFG.beamSpeed; b.vy = 0; b.dmg = CFG.beamDmg[tier]; b.t = 0; b.life = 0; b.pierce = 0; b.last = null;
  sfx('shoot_charged', { variant: 't' + tier, x: P.x });
  shake(1 + tier); vib(tier * 6);
}
function stopCharge() {
  if (chargeH && typeof chargeH.stop === 'function') { try { chargeH.stop(0.05); } catch (e) { /* silent */ } }
  chargeH = null;
}
function stopLaser() {
  if (laserH && typeof laserH.stop === 'function') { try { laserH.stop(0.05); } catch (e) { /* silent */ } }
  laserH = null; laser.on = false;
}
function releaseCharge(canFire) {
  var tier = chargeTier();
  stopCharge(); chargeT = 0;
  if (canFire && tier >= 1 && P.alive && !P.swallowed && mode === 'playing' && !paused) fireBeam(tier);
}
function setFiring(on) {
  if (on === firing) return;
  firing = on;
  if (on) { chargeT = 0; fireQueued = true; }
}
function recomputeFiring() { setFiring(touchFire > 0 || keyFire); }
function startSlow(n) {
  slowT = n; slowHalf = false;
  if (!slowOn) { slowOn = true; musicCall('setRate', 0.5); }
}
function endSlow() {
  slowT = 0; freezeT = 0;
  if (slowOn) { slowOn = false; musicCall('setRate', 1); }
}
function addBomb(pts) {
  if (bombReady) return;
  bombMeter = Math.min(CFG.bombNeed, bombMeter + pts);
  if (bombMeter >= CFG.bombNeed) { bombReady = true; sfx('bomb_ready'); popup(P.x, P.y - 12, 'BLAST READY', '#7dff7d'); }
}
function fireBomb() {
  if (!bombReady || !P.alive || P.swallowed || mode !== 'playing' || paused) return;
  bombReady = false; bombMeter = 0;
  sfx('bomb', { x: P.x }); shake(8); flashWhite = 14; vib([40, 30, 80]);
  P.inv = Math.max(P.inv, 60);
  var i, n = 0;
  for (i = 0; i < ebul.length; i++) if (ebul[i].on) { ebul[i].on = false; addScore(10); if ((n++ % 3) === 0) anim('bullet_hit', ebul[i].x + ebul[i].w / 2, ebul[i].y + ebul[i].h / 2, 8); }
  for (i = 0; i < enemies.length; i++) if (enemies[i].on && onScr(enemies[i])) damageEnemy(enemies[i], CFG.bombEnemyDmg, true);
  var bb = B, k;
  for (k = 0; k < 2; k++, bb = M) {
    if (bb.on && bb.mode !== 'dying' && bb.mode !== 'dead' && bb.x < W - 10) {
      bb.hp -= CFG.bombBossDmg; bb.flash = 4; bb.hitT = 6;
      if (bb.hp <= 0) bossDie(bb);
    }
  }
  popup(P.x, P.y - 12, 'FART BLAST!', '#7dff7d');
}
function safeNow() { return phase === 'clear' || (B.on && B.mode === 'dying'); }

/* ---------------- Force pod ---------------- */
function giveForce() {
  if (F.lv === 0) {
    F.on = true; F.lv = 1; F.mode = 'front'; F.x = P.x + 22; F.y = P.y; F.flashT = 12; F.vx = 0;
    sfx('force_attach', { x: F.x });
  } else F.lv++;
}
function forceToggle() {
  if (!P.alive || P.swallowed || !F.on || mode !== 'playing' || paused) return;
  if (F.mode === 'front' || F.mode === 'rear') {
    F.mode = 'out'; F.vx = CFG.throwSpeed; F.holdX = Math.min(W - 20, P.x + CFG.throwDist);
    sfx('force_throw', { x: F.x });
  } else if (F.mode === 'out') {
    F.mode = 'recall';
    sfx('force_recall', { x: F.x });
  }
}
function updateForce() {
  if (!F.on) return;
  if (F.flashT > 0) F.flashT--;
  switch (F.mode) {
    case 'front': F.x += (P.x + 22 - F.x) * 0.6; F.y += (P.y - F.y) * 0.6; break;
    case 'rear': F.x += (P.x - 17 - F.x) * 0.6; F.y += (P.y - F.y) * 0.6; break;
    case 'out':
      if (F.vx > 0) { F.x += F.vx; if (F.x >= F.holdX) { F.x = F.holdX; F.vx = 0; } }
      F.y += (P.y - F.y) * 0.06;
      break;
    case 'recall':
      var dx = P.x + 8 - F.x, dy = P.y - F.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 12) {
        F.mode = F.x > P.x + 10 ? 'front' : 'rear';
        F.flashT = 10; sfx('force_attach', { x: F.x });
      } else { var s = CFG.recallSpeed + Math.min(4, d * 0.02); F.x += dx / d * s; F.y += dy / d * s; }
      break;
  }
}

/* ---------------- hurt / die / respawn ---------------- */
function updateDanger() {
  var want = mode === 'playing' && lives === 1 && P.alive && !paused;
  if (want !== dangerOn) { dangerOn = want; dangerT = want ? tick : -1; musicCall('setDanger', want); }
}
function hurtPlayer() {
  if (!P.alive || P.inv > 0 || safeNow() || P.swallowed) return false;
  if (window.Game && window.Game.god) return false;
  if (P.shield) {
    P.shield = false; P.inv = 70; P.flash = 2;
    sfx('shield_break', { x: P.x }); shake(4); vib(25);
    anim('shield_pop', P.x + 12, P.y + 8, 12);
    sparks(P.x + 12, P.y + 8, 8, 2.5, ['#6ab4ff', '#bfe3ff', '#ffffff']);
    return true;
  }
  killPlayer(false);
  return true;
}
function killPlayer(swallow) {
  var hadForce = F.lv > 0, hadShield = P.shield;
  P.alive = false; P.inv = 0; P.swallowed = false;
  stopCharge(); stopLaser(); chargeT = 0;
  lives--;
  P.shield = false; P.powerLv = Math.max(0, P.powerLv - 1);
  F.on = false; F.lv = 0; F.mode = 'none';
  chain = 0; chainT = 0; mult = 1;
  rank = Math.max(0, rank - 0.25);
  deathsAtCp++;
  diedBoss = B.on || phase === 'boss' || phase === 'warn'; diedMid = M.on;
  var cx = P.x + 12, cy = P.y + 8;
  if (swallow) {
    shake(9); banner('SWALLOWED!', 110, '#ff3a3a');
    sparks(cx, cy, 10, 2, ['#ff5fa2', '#ffffff', '#d33a7a']);
    sfx('player_die', { x: P.x });
  } else {
    sfx('player_die', { x: P.x }); shake(10);
    anim('player_die', cx, cy, 30);
  }
  vib(120);
  startSlow(40); freezeT = 3;
  recovQ.length = 0;
  if (P.powerLv === 0 && lives > 0) {
    if (hadForce) recovQ.push({ at: tick + 100, name: 'pu_force' });
    recovQ.push({ at: tick + 220, name: 'pu_power' });
    if (hadShield) recovQ.push({ at: tick + 340, name: 'pu_shield' });
  }
  P.respawn = lives > 0 ? 90 : 130;
  updateDanger();
}
function respawnPlayer() {
  P.alive = true; P.x = 30; P.y = 100; P.tx = 30; P.ty = 100; P.inv = 120; P.flash = 0; P.fireCd = 0; P.vy = 0; P.swallowed = false;
  dragX = dragY = 0;
  sfx('respawn', { x: P.x });
  updateDanger();
}
function updateRecov() {
  for (var i = recovQ.length - 1; i >= 0; i--) {
    if (tick >= recovQ[i].at && P.alive) {          // wait for the respawn, then drop
      spawnPU(recovQ[i].name, W + 8, clamp(P.y, CEIL + 4, FLOOR - 16));
      recovQ.splice(i, 1);
    }
  }
}

/* ---------------- chain, graze, rank ---------------- */
function chainKill() {
  chain++; chainT = CFG.chainWin;
  var nm = Math.min(8, 1 + Math.floor(chain / 3));
  if (nm > mult) { mult = nm; sfx('chain_up', { variant: mult }); } else mult = nm;
  rank = Math.min(1, rank + 0.004 * mult);
}
function chainEnd() {
  if (chain >= 3) {
    var bonus = chain * 50 * mult;
    addScore(bonus);
    popup(P.x - 10, P.y - 14, 'CHAIN ' + chain + ' +' + bonus, '#ffe14a');
  }
  if (chain >= 4) sfx('chain_break');
  chain = 0; mult = 1;
}

/* ---------------- update ---------------- */
function updateLaser() {
  laser.on = false;
  if (P.weapon === 'laser' && firing && P.alive && !P.swallowed && mode === 'playing') {
    calcMuzzle();
    var lv = P.powerLv;
    laser.on = true; laser.x = mzx - 1; laser.y = mzy - 1; laser.len = 96 + 32 * lv;
    if (!laserH) laserH = sfx('laser', { x: P.x });
    if (laserH) {
      if (laserH.setX) laserH.setX(P.x);
      if (laserH.setLevel) laserH.setLevel(clamp(lv, 1, 3));
    }
    if (tick % 3 === 0) laserDamage();
  } else if (laserH) stopLaser();
}
var LASER_DMG = [0.7, 0.9, 1.1, 1.4];
function laserDamage() {
  var i, e, d = LASER_DMG[P.powerLv];
  for (i = 0; i < enemies.length; i++) {
    e = enemies[i];
    if (!e.on || !onScr(e)) continue;
    if (ov(laser.x, laser.y, laser.len, 3, e.x + e.hx, e.y + e.hy, e.hw, e.hh)) {
      damageEnemy(e, d, true, laser.x + laser.len > e.x ? e.x : laser.x);
      if (tick % 6 === 0) anim('bullet_hit', Math.max(laser.x, e.x + e.hx), laser.y + 1, 6);
    }
  }
  hitBossRect(B, laser.x, laser.y, laser.len, 3, d, true);
  hitBossRect(M, laser.x, laser.y, laser.len, 3, d, true);
}
function updatePlayer() {
  if (!P.alive) {
    dragX = dragY = 0;
    if (P.respawn > 0) {
      P.respawn--;
      if (P.respawn === 0) { if (lives > 0) respawnPlayer(); else outOfLives(); }
    }
    laser.on = false;
    return;
  }
  if (P.swallowed) { dragX = dragY = 0; laser.on = false; if (laserH) stopLaser(); return; }
  var sp = 2.2 + 0.5 * P.speedLv;
  var dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  P.tx = clamp(P.tx + dx * sp + dragX, 4, W - 28);
  P.ty = clamp(P.ty + dy * sp + dragY, CEIL, FLOOR - 16);
  dragX = dragY = 0;
  var cap = 9 + 2 * P.speedLv;
  var mx = clamp((P.tx - P.x) * 0.45, -cap, cap), my = clamp((P.ty - P.y) * 0.45, -cap, cap);
  P.x = clamp(P.x + mx, 4, W - 28);
  var oy = P.y;
  P.y = clamp(P.y + my, CEIL, FLOOR - 16);
  P.vy = P.y - oy;
  if (P.vy < -0.4) P.bank = 12; else if (P.vy > 0.4) P.bank = -12;
  else if (P.bank > 0) P.bank--; else if (P.bank < 0) P.bank++;
  if (P.inv > 0) P.inv--;
  if (P.flash > 0) P.flash--;
  // charge: counts while fire (touch/key) or X is held
  if (firing || xHold) {
    chargeT++;
    if (chargeT === CFG.chargeStart) chargeH = sfx('charge', { x: P.x });
    else if (chargeT === CFG.tier1 || chargeT === CFG.tier2 || chargeT === CFG.tier3) {
      if (chargeH && chargeH.setLevel) chargeH.setLevel(chargeTier());
      vib(8);
    }
    if (chargeH && chargeH.setX) chargeH.setX(P.x);
  } else if (chargeT > 0) releaseCharge(true);
  // autofire
  if (P.fireCd > 0) P.fireCd--;
  if ((firing || fireQueued) && P.fireCd <= 0) {
    fireVolley();
    var tr = chargeTier();
    if (tr >= 1) P.fireCd = CFG.wheezeCd;
    else if (P.weapon === 'spread') P.fireCd = (tick & 1) ? 9 : 10;
    else if (P.weapon === 'main') P.fireCd = (tick & 1) ? 7 : 8;
    else P.fireCd = 8;
    fireQueued = false;
  }
  updateLaser();
}
function outOfLives() {
  if (continues > 0) enterContinue(); else gameOver();
}

/* ======================================================================
 * 6. ENEMIES, WAVES, POWERUPS, BULLETS
 * ====================================================================== */
function onScr(e) { return e.x < W && e.x + e.sw > 0 && e.y < H && e.y + e.sh > 0; }
function fireRateMul() { return mods.fire * (0.8 + 0.4 * rank); }
function fireSpeedMul() { return (1 + (mods.fire - 1) * 0.5) * (0.9 + 0.2 * rank); }
function aimAng(x, y) { return (P.alive && !P.swallowed) ? Math.atan2(P.y + 8 - y, P.x + 12 - x) : PI; }
function fireEB(x, y, vx, vy, kind) {
  var b = alloc(ebul); if (!b) return null;
  b.on = true; b.kind = kind; b.t = 0; b.grazed = false; b.w = kind ? 10 : 6; b.h = b.w;
  b.x = x - b.w / 2; b.y = y - b.h / 2; b.vx = vx; b.vy = vy;
  return b;
}
function fireAng(x, y, spd, kind, ang) { return fireEB(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd, kind); }

/* one volley of an enemy's `fire` block */
function volley(e) {
  var f = e.fire, ox, oy, ang, n = (f.spread | 0) > 0 ? (f.spread | 0) : 1, k;
  if (e.beh === 'turret') { var m = muzzleOf(e.spr, 1, 3, 4); ox = e.x + m.x; oy = e.ceil ? e.y + e.sh - m.y : e.y + m.y; }
  else { ox = e.flipX ? e.x + e.sw - 2 : e.x + 2; oy = e.y + e.sh * 0.55; }
  if (f.aim === 'fixed') { var a = (f.angle || 0) * PI / 180; ang = Math.atan2(Math.sin(a), -Math.cos(a)); }
  else if (e.beh === 'turret') {
    var dx = P.x + 12 - ox, dy = e.ceil ? Math.max(P.y + 8 - oy, 6) : Math.min(P.y + 8 - oy, -6);
    ang = (P.alive && !P.swallowed) ? Math.atan2(dy, dx) : (e.ceil ? PI - 0.4 : PI + 0.4);
  } else ang = aimAng(ox, oy);
  for (k = 0; k < n; k++) fireAng(ox, oy, e.fspd, e.fkind, ang + (k - (n - 1) / 2) * 0.22 + (n === 1 ? rr(-0.04, 0.04) : 0));
}
function mineBurst(e, cx, cy) {
  var f = e.fire, n = f && (f.spread | 0) > 0 ? (f.spread | 0) : 4, a0 = aimAng(cx, cy), spd = e.fspd || 1.5;
  for (var k = 0; k < n; k++) fireAng(cx, cy, spd, 1, a0 + k * TAU / n);
}

function spawnEnemy(name, x, y, from, q) {
  var e = allocE(); if (!e) return null;
  var d = etype(name), sp = d.sprite || name, z = spr.size(sp), h = hitOf(sp, 0);
  e.on = true; e.def = d; e.name = name; e.spr = sp; e.sw = z.w; e.sh = z.h;
  e.flipX = from === 'left';
  e.hx = e.flipX ? z.w - h.x - h.w : h.x; e.hy = h.y; e.hw = h.w; e.hh = h.h;
  var beh = d.behavior || 'straight';
  if (beh === 'ground') beh = 'turret';
  if (beh === 'boss') beh = 'straight';
  e.dirx = from === 'left' ? 1 : -1; e.dirv = from === 'top' ? 1 : (from === 'bottom' ? -1 : 0); e.vert = e.dirv !== 0;
  if (e.vert && beh !== 'sine' && beh !== 'mine') beh = 'straight';
  if (name === 'butt_armored' && beh === 'straight') beh = 'armored';
  e.beh = beh;
  e.hp = e.maxhp = Math.max(1, Math.ceil((d.hp || 1) * mods.hp));
  var pxps = typeof d.pxps === 'number' ? d.pxps : (typeof d.speed === 'number' ? d.speed : 60);
  e.spd = pxps / 60 * mods.speed;
  e.armor = (beh === 'armored' || d.armor) ? (typeof d.armor === 'number' ? d.armor : 0.5) : 1;
  e.score = d.score === undefined ? 100 : d.score;
  e.x = x; e.y = y; e.baseX = x; e.baseY = y; e.t = 0; e.state = 0; e.timer = 0; e.flash = 0; e.beamCd = 0; e.forceCd = 0;
  e.spit = 0; e.windup = 0; e.burstN = 0; e.burstT = 0; e.carrier = q ? q.carry : ''; e.ty = y; e.ang = e.dirx < 0 ? PI : 0; e.vy = 0; e.tvy = 0;
  if (q && q.rigid) { e.ph = q.ph; e.amp = q.amp; e.vy = q.vy; e.stopX = q.stopX; e.hoverX = 292 + (q.stopX % 22); }
  else { e.ph = rng() * TAU; e.amp = rr(18, 34); e.vy = (rng() < 0.5 ? -1 : 1) * rr(1.0, 1.8); e.stopX = rr(W * 0.55, W * 0.72); e.hoverX = 292 + rng() * 22; }
  e.rigid = !!(q && q.rigid);
  e.ceil = !!(beh === 'turret' && q && q.side === 'ceil');
  if (beh === 'turret') { e.y = e.ceil ? CEIL : FLOOR - e.sh; e.baseY = e.y; }
  e.path = (q && q.path && !e.vert) ? q.path : null; e.px0 = x; e.py0 = y;
  var f = d.fire;
  e.fire = null; e.fireInt = 0; e.fireT = 0; e.fspd = 1.5; e.fkind = 0; e.burstMax = 1;
  if (f && typeof f === 'object') {
    e.fire = f;
    var rt = f.rate > 0 ? f.rate : 0.6;
    e.fireInt = clamp(Math.round(60 / (rt * fireRateMul())), 24, 600);
    e.fspd = (f.speed > 0 ? f.speed : 100) / 60 * fireSpeedMul();
    e.fkind = f.type === 'hair_ball' ? 1 : 0;
    e.burstMax = (f.burst | 0) > 0 ? (f.burst | 0) : 1;
    if (beh === 'mine') e.fireInt = 0;
    else if (beh === 'turret') e.fireT = ri(30, Math.max(31, e.fireInt));
    else if (beh === 'hover_spit') e.fireT = 45;
    else e.fireT = ri(40, Math.max(41, e.fireInt));
  }
  return e;
}

/* ---- wave layout: spawn position of member q.i of q.n (sets lx, ly) ---- */
var lx = 0, ly = 0;
function layout(q, name) {
  var d = etype(name), sp = d.sprite || name, z = spr.size(sp), w = z.w, h = z.h, i = q.i, n = q.n, pat = q.pat, k, a, r, o;
  var top = CEIL + 4, bot = Math.max(top + 1, FLOOR - 4 - h);
  if (q.from === 'top' || q.from === 'bottom') {
    var lo = 8, hi = Math.max(lo + 1, W - 8 - w), bx = lo + q.fy * (hi - lo), px = bx, dd = 0;
    if (q.offs) { o = q.offs[i]; if (o) { px = bx + (o[1] || 0); dd = o[0] || 0; } }
    else switch (pat) {
      case 'column': px = lo + (i + 0.5) / n * (hi - lo); break;
      case 'v': k = Math.ceil(i / 2); px = bx + ((i & 1) ? -1 : 1) * k * (w + 5); dd = k * 10; break;
      case 'wave': px = bx + Math.sin(i * 0.9) * 32; if (q.rigid) dd = i * (h + 6); break;
      case 'burst': px = lo + rng() * (hi - lo); break;
      case 'stagger': px = bx + ((i & 1) ? 1 : -1) * (w / 2 + 3); if (q.rigid) dd = i * (h + 4); break;
      case 'ring': r = Math.max(24, n * (Math.max(w, h) + 4) / TAU); a = i / n * TAU; px = bx + Math.cos(a) * r; dd = r + Math.sin(a) * r; break;
      default: if (q.rigid) dd = i * (h + 6);
    }
    lx = clamp(px, 2, W - 2 - w);
    ly = q.from === 'top' ? -h - 6 - dd : H + 6 + dd;
    return;
  }
  var base = top + q.fy * (bot - top), dx = 0, dy = 0;
  if (q.offs) { o = q.offs[i]; if (o) { dx = o[0] || 0; dy = o[1] || 0; } }
  else switch (pat) {
    case 'column': dy = top + (i + 0.5) / n * (bot - top) - base; break;
    case 'v': k = Math.ceil(i / 2); dx = k * 10; dy = ((i & 1) ? -1 : 1) * k * (h + 5); break;
    case 'wave': dy = Math.sin(i * 0.9) * 32; if (q.rigid) dx = i * (w + 6); break;
    case 'burst': dy = top + rng() * (bot - top) - base; break;
    case 'stagger': dy = ((i & 1) ? 1 : -1) * (h / 2 + 3); if (q.rigid) dx = i * (w + 4); break;
    case 'ring': r = Math.max(24, n * (Math.max(w, h) + 4) / TAU); a = i / n * TAU; dx = r + Math.cos(a) * r; dy = Math.sin(a) * r; break;
    default: if (q.rigid) dx = i * (w + 6);
  }
  ly = clamp(base + dy, top, bot);
  lx = q.from === 'left' ? -w - 6 - dx : W + 6 + dx;
}
var tq = { on: false, at: 0, name: '', from: 'right', pat: 'line', i: 0, n: 1, fy: 0.5, rigid: true, ph: 0, amp: 0, vy: 0, stopX: 0, offs: null, carry: '', side: '', path: null };
function spawnFromQ(q) {
  layout(q, q.name);
  spawnEnemy(q.name, lx, ly, q.from, q);
}
function queueWave(w) {
  var rel = deathsAtCp >= 2 ? 0.85 : 1;
  var n = clamp(Math.floor(((w.count | 0) || 1) * mods.count * rel), 1, 20);
  var rigid = (typeof w.spacing === 'number' && w.spacing <= 0);
  var sp = Math.round((typeof w.spacing === 'number' ? w.spacing : 0.4) * 60);
  var fy = (w.y === 'rand' || w.y === undefined || w.y === null || isNaN(+w.y)) ? rng() : clamp(+w.y, 0, 1);
  var from = (w.from === 'left' || w.from === 'top' || w.from === 'bottom') ? w.from : 'right';
  var offs = (w.offsets && w.offsets.length) ? w.offsets : null;
  var ph = rng() * TAU, amp = rr(18, 34), vy = (rng() < 0.5 ? -1 : 1) * rr(1.0, 1.8), stopX = rr(W * 0.55, W * 0.72);
  var pat = w.pattern || 'line', i, q;
  for (i = 0; i < n; i++) {
    q = rigid ? tq : alloc(spawnQ);
    if (!q) break;
    q.name = w.type; q.from = from; q.pat = pat; q.i = i; q.n = n; q.fy = fy; q.rigid = rigid; q.ph = ph; q.amp = amp; q.vy = vy; q.stopX = stopX;
    q.offs = offs; q.carry = (i === n - 1 && w.drop) ? w.drop : ''; q.side = w.side || ''; q.path = w.path || null;
    if (rigid) spawnFromQ(q);
    else { q.on = true; q.at = tick + i * sp; }
  }
  if (!w.quiet && typeof w.type === 'string' && w.type.indexOf('butt') === 0) {
    var px = from === 'left' ? 10 : (from === 'top' || from === 'bottom' ? 8 + fy * (W - 40) : W - 10);
    var py = from === 'top' ? 8 : (from === 'bottom' ? H - 20 : CEIL + 4 + fy * (FLOOR - CEIL - 30));
    sfx('fart', { volume: 0.5, x: px });
    anim('fart_puff', px, py, 20);
  }
  if (w.sfx) sfx(w.sfx);
}
function updateSpawnQ() {
  for (var i = 0; i < spawnQ.length; i++) {
    var q = spawnQ[i];
    if (!q.on || q.at > tick) continue;
    q.on = false;
    spawnFromQ(q);
  }
}

/* ---- enemy update ---- */
function updateEnemies() {
  var nearSpd = (stage.bg && typeof stage.bg.speedNear === 'number' ? stage.bg.speedNear : 45) / 60;
  var i, e, spd, dir, px = P.x + 12, py = P.y + 8;
  for (i = 0; i < enemies.length; i++) {
    e = enemies[i];
    if (!e.on) continue;
    e.t++;
    if (e.flash > 0) e.flash--;
    if (e.beamCd > 0) e.beamCd--;
    if (e.forceCd > 0) e.forceCd--;
    if (e.spit > 0) e.spit--;
    spd = e.spd; dir = e.dirx;
    if (e.path) pathMove(e);
    else switch (e.beh) {
      case 'sine':
        if (e.vert) { e.y += e.dirv * spd; e.x = e.baseX + Math.sin(e.t * 0.07 + e.ph) * e.amp; }
        else { e.x += dir * spd; e.y = e.baseY + Math.sin(e.t * 0.07 + e.ph) * e.amp; }
        break;
      case 'charge':
        if (e.state === 0) {
          e.x += dir * spd * 1.3;
          if ((dir < 0 && e.x <= e.stopX) || (dir > 0 && e.x >= W - e.stopX - e.sw)) { e.state = 1; e.timer = 48; }
        } else if (e.state === 1) {
          e.timer--;
          e.y += Math.sin(e.t * 2.1) * 0.6;
          if (e.timer === 14) e.ty = P.alive ? py - e.sh / 2 : e.y;
          if (e.timer <= 0) e.state = 2;
        } else {
          e.x += dir * Math.min(7, spd * 2.8);
          e.y += (e.ty - e.y) * 0.09;
        }
        break;
      case 'hover_spit':
        if (e.state === 0) {
          e.x += dir * spd * 1.6;
          if ((dir < 0 && e.x <= e.hoverX) || (dir > 0 && e.x >= W - e.hoverX - e.sw)) { e.state = 1; e.timer = 0; }
        } else if (e.state === 1) {
          e.timer++;
          e.y = e.baseY + Math.sin(e.t * 0.05 + e.ph) * 12;
          if (e.fireInt > 0) {
            e.fireT--;
            e.windup = (e.fireT > 0 && e.fireT <= 20) ? e.fireT : 0;
            if (e.fireT === 20 && onScr(e)) sfx('spit_windup', { x: e.x + e.sw / 2 });
            if (e.fireT <= 0 && e.x < W - 20 && e.x > 0) {
              volley(e);
              sfx('fart', { volume: 0.6, x: e.x + e.sw / 2 });
              e.fireT = e.fireInt; e.spit = 18;
            } else if (e.fireT <= 0) e.fireT = e.fireInt;
          }
          if (e.timer > 720) e.state = 2;
        } else e.x += dir * spd * 1.6;
        break;
      case 'bounce':
        e.x += dir * spd * 0.8; e.y += e.vy;
        if (e.y <= CEIL) { e.y = CEIL; e.vy = Math.abs(e.vy); }
        else if (e.y >= FLOOR - e.sh) { e.y = FLOOR - e.sh; e.vy = -Math.abs(e.vy); }
        break;
      case 'swoop':
        if (e.t < 40) e.x += dir * spd * 1.3;
        else {
          if (e.t < 125) {
            var want = Math.atan2((P.alive ? py : e.y) - (e.y + e.sh / 2), (P.alive ? px : e.x - 100 * dir) - (e.x + e.sw / 2));
            var da = want - e.ang;
            while (da > PI) da -= TAU;
            while (da < -PI) da += TAU;
            e.ang += clamp(da, -0.05, 0.05);
          }
          e.x += Math.cos(e.ang) * spd * 1.7; e.y += Math.sin(e.ang) * spd * 1.7;
        }
        break;
      case 'drift':
        e.x += dir * (spd * 0.55 + Math.sin(e.t * 0.09 + e.ph) * 0.35);
        if (e.t % 45 === 0) e.tvy = e.rigid ? Math.sin(((e.t / 45) | 0) * 2.7 + e.ph) * 1.1 : rr(-1.1, 1.1);
        e.vy += (e.tvy - e.vy) * 0.06;
        e.y += e.vy;
        if (e.y < CEIL) e.tvy = Math.abs(e.tvy); else if (e.y > FLOOR - e.sh) e.tvy = -Math.abs(e.tvy);
        break;
      case 'mine':
        if (e.vert) { e.y += e.dirv * spd; e.x += Math.sin(e.t * 0.05 + e.ph) * 0.35; }
        else { e.x += dir * spd; e.y += Math.sin(e.t * 0.05 + e.ph) * 0.35; }
        break;
      case 'turret':
        e.x -= nearSpd; e.y = e.ceil ? CEIL : FLOOR - e.sh;
        if (e.fire && e.fireInt > 0 && onScr(e) && e.x > 8) {
          e.fireT--;
          e.windup = (e.fireT > 0 && e.fireT <= 20) ? e.fireT : 0;
          if (e.fireT <= 0) { e.burstN = e.burstMax; e.burstT = 0; e.fireT = e.fireInt; }
        }
        if (e.burstN > 0) {
          if (e.burstT <= 0) {
            volley(e); sfx('turret_fire', { x: e.x + e.sw / 2 });
            e.burstN--; e.burstT = 7; e.spit = 8;
          } else e.burstT--;
        }
        break;
      default: // straight, armored
        if (e.vert) e.y += e.dirv * spd; else e.x += dir * spd;
    }
    if (!e.vert && e.beh !== 'turret') {
      if (e.y < CEIL) e.y = CEIL; else if (e.y > FLOOR - e.sh) e.y = FLOOR - e.sh;
    }
    // generic aimed shots
    if (e.fireInt > 0 && e.fire && e.beh !== 'hover_spit' && e.beh !== 'turret' && e.beh !== 'mine') {
      e.fireT--;
      if (e.fireT <= 0 && e.x < W - 16 && e.x > 28 && e.y > -4 && e.y < H) {
        volley(e);
        e.fireT = e.fireInt + ri(-12, 12);
      }
    }
    // despawn
    if (e.vert) { if ((e.dirv > 0 && e.y > H + 8) || (e.dirv < 0 && e.y < -e.sh - 8)) e.on = false; }
    else if ((dir < 0 && e.x < -e.sw - 40) || (dir > 0 && e.x > W + 40 && e.t > 30)) e.on = false;
    if (e.x < -e.sw - 320 || e.x > W + 340 || e.y < -340 || e.y > H + 340) e.on = false;
  }
}
/* wave.path: {kind:'bezier', pts:[[dx,dy]x4], dur} or {kind:'sine', amp, period}; px relative to the spawn point (right-spawn frame, mirrored for from:'left') */
function pathMove(e) {
  var pa = e.path, mir = -e.dirx;
  if (pa.kind === 'bezier' && pa.pts && pa.pts.length >= 4) {
    var durF = Math.max(1, (+pa.dur || 1) * 60), u = e.t / durF, p = pa.pts, a, b, c, d, x, y;
    var uu = u > 1 ? 1 : u, iu = 1 - uu;
    a = iu * iu * iu; b = 3 * iu * iu * uu; c = 3 * iu * uu * uu; d = uu * uu * uu;
    x = a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0];
    y = a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1];
    e.x = e.px0 + x * mir + (u > 1 ? (e.t - durF) * e.dirx * e.spd : 0);
    e.y = e.py0 + y;
  } else {
    e.x += e.dirx * e.spd;
    e.y = e.py0 + (+pa.amp || 20) * Math.sin(TAU * e.t / Math.max(10, (+pa.period || 2) * 60));
  }
}
function resolveCarrier(c) {
  var r = null, i;
  if (c === 'weapon') {
    var ws = ['pu_spread', 'pu_laser', 'pu_wave'], s0 = ri(0, 2);
    for (i = 0; i < 3; i++) { var w = ws[(s0 + i) % 3]; if (w !== 'pu_' + P.weapon) { r = w; break; } }
  } else if (c === 'random') {
    for (i = 0; i < 20 && !r; i++) r = powerupDrop('butt_mid');
  } else r = c;
  r = normCapsule(r);
  return r || normCapsule('pu_power');
}
function damageEnemy(e, d, pierce) {
  if (!pierce && e.armor < 1) d *= e.armor;
  e.hp -= d; e.flash = 2;
  if (e.hp <= 0) killEnemy(e); else sfx('hit', { variant: e.name, x: e.x + e.sw / 2 });
}
function killEnemy(e) {
  e.on = false;
  var cx = e.x + e.sw / 2, cy = e.y + e.sh / 2, big = e.maxhp >= 4 || e.sh >= 22;
  explode(cx, cy, big);
  sfx(big ? 'enemy_die_big' : 'enemy_die', { variant: e.name, x: cx });
  if (big) { shake(3); if (freezeT < 2) freezeT = 2; }
  chainKill();
  var pts = Math.round(e.score * mult);
  addScore(pts);
  addBomb(pts);
  popup(cx - 8, cy - 4, String(pts), mult > 1 ? '#ffe14a' : '#ffffff');
  if (e.def && e.def.hairy) tufts(cx, cy, big ? 4 : 2);
  if (e.beh === 'mine') mineBurst(e, cx, cy);
  var pu = e.carrier ? resolveCarrier(e.carrier) : powerupDrop(e.name);
  if (pu) spawnPU(pu, cx - 6, cy - 6);
}

/* ---- powerups ---- */
function spawnPU(name, x, y) {
  var p = alloc(powerups); if (!p) return;
  p.on = true; p.name = name; p.x = x; p.y = clamp(y, CEIL, FLOOR - 12); p.t = 0;
}
function updatePowerups() {
  for (var i = 0; i < powerups.length; i++) {
    var p = powerups[i];
    if (!p.on) continue;
    p.t++; p.x -= 0.7; p.y += Math.sin(p.t * 0.1) * 0.45;
    p.y = clamp(p.y, CEIL, FLOOR - 12);
    if (p.x < -16) p.on = false;
  }
}
var PU_VARIANT = { pu_power: 'power', pu_speed: 'speed', pu_shield: 'shield', pu_force: 'force', pu_spread: 'spread', pu_laser: 'laser', pu_wave: 'wave', pu_life: 'life' };
var PU_LABEL = { pu_power: 'POWER', pu_speed: 'SPEED', pu_shield: 'SHIELD', pu_force: 'FORCE', pu_spread: 'SPREAD', pu_laser: 'LASER', pu_wave: 'WAVE', pu_life: '1UP' };
function collectPU(p) {
  p.on = false;
  var n = p.name, bonus = false;
  if (n === 'pu_power') { if (P.powerLv < 3) P.powerLv++; else bonus = true; }
  else if (n === 'pu_speed') { if (P.speedLv < 3) P.speedLv++; else bonus = true; }
  else if (n === 'pu_shield') { if (!P.shield) P.shield = true; else bonus = true; }
  else if (n === 'pu_force') { if (F.lv < 3) giveForce(); else bonus = true; }
  else if (n === 'pu_life') { if (lives < 9) lives++; else bonus = true; }
  else if (n === 'pu_spread' || n === 'pu_laser' || n === 'pu_wave') {
    var w = n.substr(3);
    if (P.weapon !== w) { P.weapon = w; if (w !== 'laser') stopLaser(); }
    else if (P.powerLv < 3) P.powerLv++; else bonus = true;
  } else bonus = true;
  if (bonus) addScore(1000);
  rank = Math.min(1, rank + 0.02);
  sfx('powerup', { variant: bonus ? 'bonus' : (PU_VARIANT[n] || 'bonus'), x: p.x });
  anim('pu_flash', p.x + 6, p.y + 6, 15);
  popup(p.x - 4, p.y - 8, bonus ? '+1000' : (PU_LABEL[n] || 'BONUS'), '#7dff7d');
}

/* ---- bullets ---- */
var wavePhase = 0;
function updateEBullets() {
  for (var i = 0; i < ebul.length; i++) {
    var b = ebul[i];
    if (!b.on) continue;
    b.t++; b.x += b.vx; b.y += b.vy;
    if (b.x < -16 || b.x > W + 16 || b.y < -16 || b.y > H + 8) b.on = false;
  }
}
function updateBullets() {
  for (var i = 0; i < bullets.length; i++) {
    var b = bullets[i];
    if (!b.on) continue;
    b.t++;
    if (b.kind === 3) { b.x += b.vx; b.y = b.y0 + Math.sin(b.ph + b.t * 0.25) * b.amp; }
    else { b.x += b.vx; b.y += b.vy; }
    if (b.life > 0 && b.t >= b.life) b.on = false;
    if (b.x > W + 4 || b.x < -70) b.on = false;
    else if (b.kind !== 4 && (b.y < CEIL - 8 || b.y > FLOOR + 6)) b.on = false;
  }
}

/* ======================================================================
 * 7. BOSS + MID-BOSS (one engine, two instances B and M)
 * ====================================================================== */
var ATK_DEF = {
  fan:    { n: 5, gapRotate: true, speed: 108, every: 0.45, repeat: 3 },
  spiral: { arms: 2, dur: 3, rate: 0.1, speed: 84 },
  lunge:  { tele: 0.8, speed: 240 },
  spawn:  { type: 'butt_small', n: 3, every: 0.4 },
  rain:   { count: 6, speed: 96, every: 0.3 }
};
var ATK_ALIAS = { spread: 'fan', swallow: 'lunge', gulp: 'lunge' };
function copyInto(dst, src) { if (src) for (var k in src) if (k !== 'id' && Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k]; return dst; }
function mergeAtk(id, over, dict) {
  var p = copyInto({}, ATK_DEF[id]);
  if (dict && dict[id]) copyInto(p, dict[id]);
  copyInto(p, over);
  var sp = +p.speed;
  if (sp < 20) { warnOnce('spd' + id, 'attack "' + id + '" speed ' + sp + ' < 20 read as px/frame (use px/s)'); p.spf = sp; }
  else p.spf = sp / 60;
  p.everyF = Math.max(3, Math.round((+p.every || 0.45) * 60));
  p.rateF = Math.max(2, Math.round((+p.rate || 0.1) * 60));
  p.durF = Math.max(10, Math.round((+p.dur || 3) * 60));
  p.teleF = Math.max(20, Math.round((+p.tele || 0.8) * 60));
  p.repeatN = Math.max(1, (p.repeat | 0) || 3);
  return p;
}
function buildPhases(cfg, kind) {
  var raw = (cfg && cfg.phases && cfg.phases.length) ? cfg.phases : [{ hpAbove: 0, attacks: ['fan'], interval: 2 }];
  var dict = (cfg && cfg.attacks && typeof cfg.attacks === 'object' && cfg.attacks.length === undefined) ? cfg.attacks : null;
  var out = [], i, k;
  for (i = 0; i < raw.length; i++) {
    var r = raw[i] || {}, list = r.attacks || r.seq || [], items = [];
    if (typeof list === 'string') list = [list];
    for (k = 0; k < list.length; k++) {
      var it = list[k], id = typeof it === 'string' ? it : (it && it.id);
      if (ATK_ALIAS[id]) id = ATK_ALIAS[id];
      if (!ATK_DEF[id]) { warnOnce('atk' + id, 'unknown boss attack id "' + id + '" skipped'); continue; }
      if (kind === 'mid' && id === 'lunge') { warnOnce('midlunge', 'mid-boss cannot lunge, skipped'); continue; }
      items.push({ id: id, p: mergeAtk(id, typeof it === 'object' ? it : null, dict) });
    }
    if (!items.length) items.push({ id: 'fan', p: mergeAtk('fan', null, dict) });
    out.push({ above: typeof r.hpAbove === 'number' ? r.hpAbove : 0, interval: clamp(Math.round((typeof r.interval === 'number' ? r.interval : 2) * 60), 30, 600), list: items });
  }
  return out;
}
function phaseOf(b) {
  var f = b.hp / b.maxhp;
  for (var i = 0; i < b.phases.length; i++) if (f > b.phases[i].above) return i;
  return b.phases.length - 1;
}
var BOSS_PITCH = { boss_butt: 1, boss_crack: 0.85, boss_god: 0.7 };
function bossStart(b, cfg) {
  var nm = cfg.type || (b.kind === 'boss' ? 'boss_butt' : 'midboss_butt');
  var d = etype(nm), z = spr.size(nm);
  b.on = true; b.name = nm; b.w = z.w; b.h = z.h; b.mode = 'enter'; b.t = 0; b.flash = 0; b.flinch = 0; b.beamCd = 0; b.jx = 0; b.hitT = 0;
  b.aliveT = 0; b.blastT = 0; b.fr = 0; b.deadT = 0; b.sub = 0;
  b.maxhp = b.hp = Math.max(1, Math.ceil(typeof cfg.hp === 'number' ? cfg.hp : (d.hp || (b.kind === 'boss' ? 100 : 60))));   // arrives loop-scaled (C5)
  b.score = typeof cfg.score === 'number' ? cfg.score : (d.score || (b.kind === 'boss' ? 5000 : 2000));
  b.drop = cfg.drop || ''; b.flee = typeof cfg.flee === 'number' ? cfg.flee : 25;
  b.homeX = W - b.w - (b.kind === 'boss' ? 22 : 34);
  b.x = W + 16; b.y = b.kind === 'boss' ? 62 : 70; b.phaseI = 0; b.seqI = 0; b.lastLunge = tick; b.cur = null; b.lunged = false;
  b.phases = buildPhases(cfg, b.kind);
}
function bossMouth(b, out) { // muzzle point (mouth) in screen px
  var m = muzzleOf(b.name, 0, b.kind === 'boss' ? 36 : 20, b.kind === 'boss' ? 41 : 25);
  out.x = b.x + b.jx + m.x; out.y = b.y + m.y;
}
var mpt = { x: 0, y: 0 };
function bossFollow(b, rate) {
  var ty = clamp(P.y + 8 - b.h / 2, CEIL + 2, FLOOR - b.h);
  if (!P.alive) ty = 62;
  b.y += (ty - b.y) * rate;
  b.y = clamp(b.y, CEIL + 2, FLOOR - b.h);
}
function goIdle(b, atk) {
  var ph = b.phases[b.phaseI] || b.phases[0];
  b.mode = 'idle'; b.t = 0; b.atkT = atk || (ph.interval + ri(-10, 14));
}
function chooseAttack(b) {
  var ph = b.phases[b.phaseI] || b.phases[0], n = ph.list.length, pick = null, k, it;
  for (k = 0; k < n && !pick; k++) {
    it = ph.list[b.seqI % n]; b.seqI++;
    if (it.id === 'lunge' && (tick - b.lastLunge < CFG.lungeCooldown || !P.alive || P.swallowed)) continue;
    pick = it;
  }
  if (!pick) { pick = ph.list[0]; if (pick.id === 'lunge') pick = { id: 'fan', p: mergeAtk('fan', null, null) }; }
  b.cur = pick.p; b.t = 0; b.sub = 0;
  switch (pick.id) {
    case 'fan': b.mode = 'fan'; b.subMax = b.cur.repeatN; b.subT = b.kind === 'mid' ? 22 : 14; break;
    case 'spiral': b.mode = 'spiral'; b.spiralA = PI; break;
    case 'spawn': b.mode = 'spawn'; b.subMax = Math.max(1, b.cur.n | 0); b.subT = 14; break;
    case 'rain': b.mode = 'rain'; b.subMax = Math.max(1, b.cur.count | 0); b.subT = 10; break;
    case 'lunge':
      b.mode = 'tele'; b.lastLunge = tick; b.lunged = false;
      sfx('swallow_tele', { x: b.x + b.w / 2 }); vib([10, 40, 10, 40, 10]);
      break;
  }
}
function bossRecover(b) { b.mode = 'recover'; b.t = 0; b.cur = null; }
var brx = 0, bry = 0, brw = 0, brh = 0, mrx = 0, mry = 0, mrw = 0, mrh = 0;
function bossRect(b) {
  var h = hitOf(b.name, 0);
  brx = b.x + b.jx + h.x; bry = b.y + h.y; brw = h.w; brh = h.h;
}
function mouthRect(b) { // true when the mouth is open (weak point); fills mrx..mrh
  var m = spr.meta(b.name, b.fr), mt = null;
  if (m) { if (m.mouth && m.mouth.open) mt = m.mouth; }
  else if (b.fr === 2 || b.fr === 3 || b.fr === 5) mt = { x: 36, y: 30, w: 28, h: 34 };
  if (!mt) return false;
  mrx = b.x + b.jx + mt.x; mry = b.y + mt.y; mrw = mt.w; mrh = mt.h;
  return true;
}
function bossFrame(b) {
  if (b.kind === 'boss') {
    switch (b.mode) {
      case 'enter': return 0;
      case 'tele': return 4;
      case 'lunge': case 'gulp': return 3;
      case 'dying': return (b.deadT >> 2) & 3;
      case 'fan': case 'spiral': case 'spawn': case 'rain': return b.blastT > 0 ? 5 : 2;
      case 'return': case 'recover': return b.flinch > 0 ? 6 : ((b.t >> 5) & 1);
      default: // idle: closed 40f, mouth open 50f so there is always a damage window
        if (b.flinch > 0) return 6;
        return (b.t % 90) < 40 ? ((b.t >> 5) & 1) : 2;
    }
  }
  if (b.hitT > 0) return 3;
  if ((b.mode === 'fan' || b.mode === 'spawn') && b.subT <= 20) return 2;
  return (b.t >> 5) & 1;
}
function updateBoss(b) {
  b.t++; b.aliveT++;
  if (b.flash > 0) b.flash--;
  if (b.flinch > 0) b.flinch--;
  if (b.beamCd > 0) b.beamCd--;
  if (b.hitT > 0) b.hitT--;
  if (b.blastT > 0) b.blastT--;
  b.jx = 0;
  var alive = b.mode !== 'dying' && b.mode !== 'dead';
  var p = b.cur, k;
  if (alive && b.mode !== 'flee') {
    var pi = phaseOf(b);
    if (pi > b.phaseI) {
      b.phaseI = pi; sfx('boss_phase', { x: b.x + b.w / 2 }); musicCall('setPhase', Math.min(3, pi + 1));
      b.flinch = 20; shake(7); b.flash = 6;
      if (b.mode === 'idle') b.atkT = Math.min(b.atkT, 40);
    }
    if (b.kind === 'mid' && b.aliveT > b.flee * 60) { b.mode = 'flee'; b.t = 0; b.cur = null; }
  }
  switch (b.mode) {
    case 'enter':
      b.x -= 1.6; b.y = (b.kind === 'boss' ? 62 : 70) + Math.sin(b.t * 0.05) * 8;
      if (b.x <= b.homeX) { b.x = b.homeX; goIdle(b, 70); }
      break;
    case 'idle':
      bossFollow(b, 0.03);
      b.y += Math.sin(b.t * 0.07) * 0.5;
      b.atkT--;
      if (b.atkT <= 0) chooseAttack(b);
      break;
    case 'fan':
      bossFollow(b, 0.02);
      b.subT--;
      if (b.subT <= 0) {
        bossMouth(b, mpt);
        var n = Math.min(11, p.n + (b.kind === 'boss' ? b.phaseI : 0)), gap = p.gapRotate ? (b.sub * 2 + 1) % n : -1;
        var ang = aimAng(mpt.x, mpt.y);
        for (k = 0; k < n; k++) { if (k === gap && n > 3) continue; fireAng(mpt.x, mpt.y, p.spf * fireSpeedMul(), 1, ang + (k - (n - 1) / 2) * 0.22); }
        sfx('fart', { x: mpt.x }); anim('fart_puff', mpt.x - 6, mpt.y, 20); shake(2); b.blastT = 10;
        b.sub++; b.subT = p.everyF;
        if (b.sub >= b.subMax) bossRecover(b);
      }
      break;
    case 'spiral':
      bossFollow(b, 0.015);
      if (b.t % p.rateF === 0) {
        bossMouth(b, mpt);
        var arms = Math.max(1, p.arms | 0);
        for (k = 0; k < arms; k++) fireAng(mpt.x, mpt.y, p.spf * fireSpeedMul(), 1, b.spiralA + k * TAU / arms);
        b.spiralA += 0.33; b.blastT = 4;
        if (b.t % (p.rateF * 3) === 0) sfx('fart', { x: mpt.x });
      }
      if (b.t >= p.durF) bossRecover(b);
      break;
    case 'spawn':
      bossFollow(b, 0.02);
      b.subT--;
      if (b.subT <= 0) {
        bossMouth(b, mpt);
        var se = spawnEnemy(p.type, mpt.x - 12, clamp(mpt.y - 8 + rr(-14, 14), CEIL, FLOOR - 20), 'right', null);
        if (se) { se.baseY = se.y; se.baseX = se.x; }
        sfx('fart', { x: mpt.x }); b.blastT = 8;
        b.sub++; b.subT = p.everyF;
        if (b.sub >= b.subMax) bossRecover(b);
      }
      break;
    case 'rain':
      bossFollow(b, 0.02);
      b.subT--;
      if (b.subT <= 0) {
        fireEB(rr(W * 0.15, W - 20), CEIL + 6, -0.3, p.spf * fireSpeedMul(), 1);
        b.sub++; b.subT = p.everyF; b.blastT = 4;
        if (b.sub >= b.subMax) bossRecover(b);
      }
      break;
    case 'recover':
      bossFollow(b, 0.02);
      if (b.t > 20) goIdle(b);
      break;
    case 'tele':
      lane.on = true; lane.y = b.y + 6; lane.h = b.h - 12;
      if (b.t < p.teleF * 0.6) bossFollow(b, 0.12);
      b.jx = (b.t & 2) ? 1 : -1;
      if (b.t >= p.teleF) {
        b.mode = 'lunge'; b.t = 0; b.lungeSpd = p.spf; lane.on = false;
        sfx('boss_roar', { volume: 0.8, pitch: BOSS_PITCH[b.name] || 1 });
      }
      break;
    case 'lunge':
      b.lungeSpd = Math.min(Math.max(10, p.spf * 2.5), b.lungeSpd + 0.35);
      b.x -= b.lungeSpd;
      shake(2);
      if (P.alive && P.inv <= 0 && !safeNow() && !P.swallowed) {
        bossRect(b); playerCore();
        if (ov(pcx, pcy, pcw, pch, brx, bry, brw, brh)) swallowHit(b);
      }
      if (b.x < -b.w - 6 && b.mode === 'lunge') { b.mode = 'return'; b.t = 0; b.x = W + 12; }
      break;
    case 'gulp':
      if (P.swallowed) {
        if (P.taps >= CFG.struggleNeed) spitOut(b);
        else if (b.t > CFG.gulpFrames) { killPlayer(true); b.mode = 'return'; b.t = 0; }
      } else { b.mode = 'return'; b.t = 0; }
      break;
    case 'return':
      if (b.x < -b.w) b.x = W + 12;
      var dir = b.homeX > b.x ? 1 : -1;
      b.x += dir * 3;
      bossFollow(b, 0.04);
      if ((dir > 0 && b.x >= b.homeX) || (dir < 0 && b.x <= b.homeX)) { b.x = b.homeX; goIdle(b); }
      break;
    case 'flee':
      b.x += 3; b.y -= 0.4;
      if (b.x > W + 10) { b.on = false; b.mode = 'dead'; midGone(b); }
      break;
    case 'dying':
      b.deadT++;
      shake(b.kind === 'boss' ? 3 : 2);
      if (b.deadT % 5 === 0) { explode(b.x + rfr(8, b.w - 8), b.y + rfr(8, b.h - 8), rf() < 0.5); }
      if (b.deadT % 15 === 0) sfx('enemy_die', { variant: 'butt_mid', volume: 0.5, x: b.x + b.w / 2 });
      if (b.deadT >= (b.kind === 'boss' ? 150 : 45)) { if (b.kind === 'boss') bossFinish(b); else midFinish(b); }
      break;
  }
  if (b.mode !== 'tele' && b.kind === 'boss' && lane.on) lane.on = false;
  if (b.kind === 'boss' && alive && b.hp < b.maxhp * 0.3 && b.t % 7 === 0 && spr.has('smoke')) anim('smoke', b.x + rfr(10, b.w - 10), b.y + rfr(10, b.h - 10), 24);
  b.fr = bossFrame(b);
}
var pcx = 0, pcy = 0, pcw = 8, pch = 6;
function playerCore() { var h = hitOf('player', pFrame()); pcx = P.x + h.x; pcy = P.y + h.y; pcw = h.w; pch = h.h; }
function swallowHit(b) {
  if (P.shield) {
    P.shield = false; P.inv = 90; P.flash = 2;
    sfx('shield_break', { x: P.x }); sfx('spit_out', { x: P.x }); shake(6); vib(30);
    anim('shield_pop', P.x + 12, P.y + 8, 12);
    sparks(P.x + 12, P.y + 8, 8, 2.5, ['#ff5fa2', '#ffffff', '#6ab4ff']);
    return;
  }
  P.swallowed = true; P.taps = 0; P.lastTap = -99;
  stopCharge(); stopLaser(); chargeT = 0;
  b.mode = 'gulp'; b.t = 0;
  sfx('swallow', { x: P.x }); shake(6); vib([30, 30, 60]);
}
function spitOut(b) {
  P.swallowed = false;
  P.x = clamp(b.x - 30, 4, W - 28); P.y = clamp(b.y + b.h / 2 - 8, CEIL, FLOOR - 16); P.tx = P.x; P.ty = P.y;
  P.inv = 90; P.flash = 2; P.powerLv = Math.max(0, P.powerLv - 1);
  sfx('spit_out', { x: P.x }); shake(6); vib(30);
  sparks(P.x + 12, P.y + 8, 10, 2.5, ['#ff5fa2', '#ffffff', '#d33a7a']);
  popup(P.x, P.y - 10, 'SPAT OUT!', '#ff5fa2');
  b.mode = 'return'; b.t = 0;
}
function struggleTap() {
  if (!P.swallowed || tick - P.lastTap < CFG.struggleGap) return;
  P.lastTap = tick; P.taps++;
  sfx('struggle', { pitch: 1 + 0.03 * P.taps, x: P.x }); vib(6);
}
/* damage on a rect (bullets, beams, laser, force); returns true if it connected */
function hitBossRect(b, rx, ry, rw, rh, d) {
  if (!b.on || b.mode === 'dying' || b.mode === 'dead' || b.x >= W - 10) return false;
  bossRect(b);
  if (!ov(rx, ry, rw, rh, brx, bry, brw, brh)) return false;
  var mouth = false, m = 1;
  if (b.kind === 'boss') { if (mouthRect(b) && ov(rx, ry, rw, rh, mrx, mry, mrw, mrh)) mouth = true; else m = CFG.bossBodyMult; }
  b.hp -= d * m; b.flash = 2; b.hitT = 4;
  addScore(mouth ? 10 : 2);
  sfx('boss_hit', { variant: mouth || b.kind === 'mid' ? 'mouth' : 'body', x: b.x + b.w / 2 });
  if (b.hp <= 0) bossDie(b);
  return true;
}
function bossDie(b) {
  b.hp = 0; b.mode = 'dying'; b.deadT = 0; b.cur = null; lane.on = false;
  var i, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  for (i = 0; i < ebul.length; i++) ebul[i].on = false;
  if (b.kind === 'boss') {
    sfx('boss_die', { x: cx }); musicStop({ fade: 0.4 }); shake(10); vib([60, 40, 60]);
    startSlow(50); freezeT = 6;
    for (i = 0; i < enemies.length; i++) if (enemies[i].on) killEnemy(enemies[i]);
    anim('boss_gib', cx, cy, 48);
  } else {
    sfx('enemy_die_big', { variant: 'midboss_butt', x: cx }); shake(5); vib(60);
    anim('explosion', cx, cy, 20);
  }
}
function bossFinish(b) {
  b.on = false; b.mode = 'dead';
  var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  for (var i = 0; i < 5; i++) explode(cx + rfr(-30, 30), cy + rfr(-24, 24), true);
  flashWhite = 24; shake(12);
  addScore(b.score);
  clearBonus = 5000 * (stageIdx + 1) + Math.max(0, lives) * 1000;
  addScore(clearBonus);
  phase = 'clear'; phaseT = 0;
  stinger('clear'); stopLoops();
  vib([60, 40, 60, 40, 140]);
}
function midFinish(b) {
  b.on = false; b.mode = 'dead';
  var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  for (var i = 0; i < 3; i++) explode(cx + rfr(-16, 16), cy + rfr(-14, 14), true);
  addScore(b.score);
  var pu = resolveCarrier(b.drop || 'weapon');
  if (pu) spawnPU(pu, cx - 6, cy - 6);
  popup(cx - 30, cy - 20, 'MID-BOSS DOWN', '#ffe14a');
  stinger('midboss_clear');
  midState = 2;
  music(stage.music || 'stage1', { fade: 0.5 });
}
function midGone(b) { // fled: no bonus
  midState = 2;
  music(stage.music || 'stage1', { fade: 0.5 });
}

/* ======================================================================
 * 8. COLLISIONS
 * ====================================================================== */
var lastGrazePop = -99;
function collide() {
  var i, j, b, e, f, hit, d;
  // ---- player bullets / beams / Force vs enemies + bosses ----
  for (i = 0; i < bullets.length; i++) {
    b = bullets[i];
    if (!b.on) continue;
    if (b.kind !== 4) {
      hit = false;
      for (j = 0; j < enemies.length; j++) {
        e = enemies[j];
        if (!e.on || !onScr(e) || (b.kind === 3 && b.last === e)) continue;
        if (ov(b.x, b.y, b.w, b.h, e.x + e.hx, e.y + e.hy, e.hw, e.hh)) {
          anim('bullet_hit', b.x + b.w, b.y + b.h / 2, 6);
          damageEnemy(e, b.dmg, false);
          if (b.kind === 3 && b.pierce > 1) { b.pierce--; b.last = e; } else b.on = false;
          hit = true;
          break;
        }
      }
      if (!hit && b.on) {
        if ((B.on && hitBossRect(B, b.x, b.y, b.w, b.h, b.dmg)) || (M.on && hitBossRect(M, b.x, b.y, b.w, b.h, b.dmg))) {
          anim('bullet_hit', b.x + b.w, b.y + b.h / 2, 6);
          if (!(b.kind === 3 && b.pierce > 1)) b.on = false; else { b.pierce--; }
        }
      }
    } else {
      for (j = 0; j < enemies.length; j++) {
        e = enemies[j];
        if (!e.on || !onScr(e) || e.beamCd > 0) continue;
        if (ov(b.x, b.y, b.w, b.h, e.x + e.hx, e.y + e.hy, e.hw, e.hh)) { e.beamCd = CFG.beamTick; damageEnemy(e, b.dmg, true); }
      }
      if (B.on && B.beamCd <= 0 && hitBossRect(B, b.x, b.y, b.w, b.h, b.dmg)) B.beamCd = CFG.beamTick;
      if (M.on && M.beamCd <= 0 && hitBossRect(M, b.x, b.y, b.w, b.h, b.dmg)) M.beamCd = CFG.beamTick;
      if (b.tier >= 3) {
        for (j = 0; j < ebul.length; j++) {
          var q = ebul[j];
          if (q.on && ov(b.x, b.y, b.w, b.h, q.x, q.y, q.w, q.h)) { q.on = false; anim('bullet_hit', q.x + 3, q.y + 3, 6); }
        }
      }
    }
  }
  if (F.on) {
    var fx = F.x + 1, fy = F.y + 1;
    d = CFG.forceDmg + 0.5 * F.lv;
    for (j = 0; j < enemies.length; j++) {
      e = enemies[j];
      if (!e.on || !onScr(e) || e.forceCd > 0) continue;
      if (ov(fx, fy, 14, 14, e.x + e.hx, e.y + e.hy, e.hw, e.hh)) { e.forceCd = CFG.forceTick; damageEnemy(e, d, true); }
    }
    if (B.on && B.beamCd <= 0 && hitBossRect(B, fx, fy, 14, 14, d)) B.beamCd = CFG.forceTick;
    if (M.on && M.beamCd <= 0 && hitBossRect(M, fx, fy, 14, 14, d)) M.beamCd = CFG.forceTick;
    for (j = 0; j < ebul.length; j++) {
      var eb0 = ebul[j];
      if (eb0.on && ov(fx, fy, 14, 14, eb0.x, eb0.y, eb0.w, eb0.h)) { eb0.on = false; anim('bullet_hit', eb0.x + eb0.w / 2, eb0.y + eb0.h / 2, 6); }
    }
  }
  if (!P.alive || P.swallowed) return;
  playerCore();
  // ---- powerups ----
  for (i = 0; i < powerups.length; i++) {
    var p = powerups[i];
    if (p.on && ov(P.x + 2, P.y + 2, 20, 12, p.x, p.y, 12, 12)) collectPU(p);
  }
  // ---- enemy bullets: hit + graze ----
  var gz = CFG.grazeDist;
  for (i = 0; i < ebul.length; i++) {
    var eb = ebul[i];
    if (!eb.on) continue;
    var ins = eb.kind ? 2 : 1;
    if (ov(pcx, pcy, pcw, pch, eb.x + ins, eb.y + ins, eb.w - ins * 2, eb.h - ins * 2)) {
      eb.on = false;
      hurtPlayer();
      if (!P.alive) return;
    } else if (!eb.grazed && ov(pcx - gz, pcy - gz, pcw + gz * 2, pch + gz * 2, eb.x + ins, eb.y + ins, eb.w - ins * 2, eb.h - ins * 2)) {
      eb.grazed = true;
      addScore(CFG.grazeScore);
      if (chainT > 0) chainT = Math.min(CFG.chainMax, chainT + CFG.grazeAdd);
      rank = Math.min(1, rank + 0.003);
      sfx('graze', { pitch: 1 + 0.04 * chain, x: P.x });
      if (tick - lastGrazePop > 8) { lastGrazePop = tick; popup(P.x + 8, P.y - 6, '+' + CFG.grazeScore, '#7fe0ff'); }
    }
  }
  // ---- enemies vs player ----
  for (i = 0; i < enemies.length; i++) {
    e = enemies[i];
    if (!e.on || !onScr(e)) continue;
    if (ov(pcx, pcy, pcw, pch, e.x + e.hx, e.y + e.hy, e.hw, e.hh)) {
      if (hurtPlayer()) damageEnemy(e, 3, true);
      if (!P.alive) return;
    }
  }
  // ---- boss bodies (lunge/gulp handled in updateBoss) ----
  var bb = B, n;
  for (n = 0; n < 2; n++, bb = M) {
    if (bb.on && bb.mode !== 'lunge' && bb.mode !== 'gulp' && bb.mode !== 'dying' && bb.mode !== 'dead' && bb.mode !== 'tele') {
      bossRect(bb);
      if (ov(pcx, pcy, pcw, pch, brx, bry, brw, brh)) { hurtPlayer(); if (!P.alive) return; }
    }
  }
}

/* ======================================================================
 * 9. STAGE FLOW
 * ====================================================================== */
function cleanText(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9 .,!?:'\/-]/g, ' '); }
function clearPools() {
  var i;
  for (i = 0; i < bullets.length; i++) bullets[i].on = false;
  for (i = 0; i < ebul.length; i++) ebul[i].on = false;
  for (i = 0; i < enemies.length; i++) enemies[i].on = false;
  for (i = 0; i < powerups.length; i++) powerups[i].on = false;
  for (i = 0; i < spawnQ.length; i++) spawnQ[i].on = false;
  for (i = 0; i < popups.length; i++) popups[i].on = false;
  for (i = 0; i < parts.length; i++) parts[i].on = false;
  B.on = false; B.mode = 'dead'; M.on = false; M.mode = 'dead';
  lane.on = false; laser.on = false; recovQ.length = 0;
}
function beginStage() {
  stage = getStageData(stageIdx);
  mods = stage.mods || DEF_MODS;
  loopN = stage.loop | 0;
  stageName = cleanText(stage.name || 'UNKNOWN SECTOR'); stageIntro = cleanText(stage.intro || '');
  stageMutator = stage.mutator ? cleanText(stage.mutator) : '';
  stageT = 0; lastWaveT = 0; phase = 'intro'; phaseT = 0; midState = 0; lastCp = 0; deathsAtCp = 0;
  var theme = (stage.bg && typeof stage.bg.theme === 'number') ? stage.bg.theme : stageIdx;
  R.setStage(stage, theme);
  try {
    var S_ = window.Sprites;
    if (S_ && typeof S_.prewarm === 'function') {
      var names = [];
      if (stage.boss && stage.boss.type) { names.push(stage.boss.type); names.push(stage.boss.type + '_dmg'); }
      if (stage.midboss && stage.midboss.type) names.push(stage.midboss.type);
      S_.prewarm(names);
    }
  } catch (e) { /* ignore */ }
  stopLoops();
  music(stage.music || 'stage1', { fade: 0.3 });
  musicCall('setIntensity', 0.3);
  sfx('stage_intro');
  lastIntensity = tick;
}
function startGame() {
  clearPools();
  score = 0; scoreStr = pad(0, 7); lives = 3; continues = CFG.continues; nextExtra = 50000; chain = 0; chainT = 0; mult = 1; rank = 0.5;
  stageIdx = 0; loopN = 0;
  P.powerLv = 0; P.speedLv = 0; P.weapon = 'main'; P.shield = false; P.fireCd = 0; P.swallowed = false;
  F.on = false; F.lv = 0; F.mode = 'none'; bombMeter = 0; bombReady = false; endSlow();
  chargeT = 0; stopCharge(); stopLaser();
  respawnPlayer(); P.inv = 90;
  bannerT = 0; shakeAmt = 0; flashWhite = 0; newHi = false; paused = false;
  mode = 'playing';
  beginStage();
  sfx('menu_select');
}
function nextStage() {
  stageIdx++;
  var keepShield = P.shield;
  clearPools(); stopLoops(); stopCharge(); stopLaser(); chargeT = 0;
  P.shield = keepShield;
  beginStage();
}
function startMid() {
  var cfg = stage.midboss;
  bossStart(M, cfg);
  midState = 1;
  sfx('midboss_warn'); shake(3);
  music(cfg.music || 'midboss', { fade: 0.2 });
  musicCall('setPhase', 1);
}
function startBoss() {
  bossStart(B, stage.boss || DEF_STAGE.boss);
  phase = 'boss'; phaseT = 0;
  sfx('boss_roar', { pitch: BOSS_PITCH[B.name] || 1 }); shake(6);
  music('boss', { fade: 0.05 });
  musicCall('setIntensity', 1); musicCall('setPhase', 1);
}
function updateFlow() {
  var i, len = stage.length || 60;
  switch (phase) {
    case 'intro':
      if (phaseT >= 150) { phase = 'stage'; phaseT = 0; }
      break;
    case 'stage':
      var prev = stageT;
      if (!M.on) stageT += 1 / 60;
      if (stageT !== prev && (tick % 6) === 0) {
        var ws = getWaves(stageIdx, lastWaveT, stageT);
        lastWaveT = stageT;
        for (i = 0; i < ws.length; i++) if (ws[i]) queueWave(ws[i]);
      }
      var cps = stage.checkpoints;
      if (cps) for (i = 0; i < cps.length; i++) {
        if (cps[i] > lastCp && prev < cps[i] && stageT >= cps[i]) {
          lastCp = cps[i]; deathsAtCp = 0;
          sfx('checkpoint'); banner('CHECKPOINT', 70, '#7dff7d');
        }
      }
      if (stage.midboss && midState === 0 && stageT >= stage.midboss.t) startMid();
      if (stageT >= len && !M.on && midState !== 1) {
        var lastWs = getWaves(stageIdx, lastWaveT, len);
        lastWaveT = len;
        for (i = 0; i < lastWs.length; i++) if (lastWs[i]) queueWave(lastWs[i]);
        phase = 'warn'; phaseT = 0; musicCall('setIntensity', 0.8);
      }
      break;
    case 'warn':
      if (phaseT === 1) stinger('warning');
      if (phaseT >= 180) startBoss();
      break;
    case 'clear':
      if (phaseT >= 330) nextStage();
      break;
  }
  updateSpawnQ();
}
function enterContinue() {
  mode = 'continue'; contT = CFG.continueFrames;
  stopLoops(); musicStop({ fade: 0.3 });
  firing = false; touchFire = 0; keyFire = false; xHold = false;
}
function doContinue() {
  continues--; lives = 3;
  P.powerLv = 0; P.speedLv = 0; P.weapon = 'main'; P.shield = false; F.on = false; F.lv = 0; F.mode = 'none';
  chain = 0; chainT = 0; mult = 1; rank = 0.4;
  endSlow();
  var len = stage.length || 60, cps = stage.checkpoints || [0], last = 0, i, died = stageT;
  clearPools(); stopLoops(); stopCharge(); stopLaser(); chargeT = 0;
  if (diedBoss) { stageT = len; lastWaveT = len; phase = 'warn'; phaseT = 0; midState = 2; lastCp = last; }
  else {
    for (i = 0; i < cps.length; i++) if (cps[i] <= died + 0.001) last = cps[i];
    if (diedMid && stage.midboss) last = Math.max(last, stage.midboss.t);
    stageT = last; lastWaveT = last; lastCp = last; phase = 'stage'; phaseT = 0;
    midState = (stage.midboss && last > stage.midboss.t) ? 2 : 0;
  }
  mode = 'playing'; paused = false;
  respawnPlayer(); P.inv = 150;
  sfx('continue_ok');
  music(stage.music || 'stage1', { fade: 0.3 });
  banner('CONTINUE', 70, '#7dff7d');
}
function gameOver() {
  mode = 'gameover'; gameoverT = 0; endSlow();
  newHi = score > 0 && score >= hiScore && score > storedHi;
  if (hiScore > storedHi) { storedHi = hiScore; saveHi(hiScore); }
  stopCharge(); stopLaser(); chargeT = 0; stopLoops();
  if (newHi) sfx('hiscore');
  music('gameover');
}

/* ======================================================================
 * 10. FX UPDATE
 * ====================================================================== */
function updateFX() {
  var i, p;
  for (i = 0; i < parts.length; i++) {
    p = parts[i];
    if (!p.on) continue;
    p.life--;
    if (p.life <= 0) { p.on = false; continue; }
    p.x += p.vx; p.y += p.vy; p.vx *= p.drag; p.vy = p.vy * p.drag + p.grav;
  }
  for (i = 0; i < popups.length; i++) {
    p = popups[i];
    if (!p.on) continue;
    p.life--; p.y -= 0.35;
    if (p.life <= 0) p.on = false;
  }
  shakeAmt *= 0.9; if (shakeAmt < 0.2) shakeAmt = 0;
  if (shakeAmt > 0) { shakeX = Math.round((rf() - 0.5) * 2 * shakeAmt); shakeY = Math.round((rf() - 0.5) * 2 * shakeAmt); } else { shakeX = 0; shakeY = 0; }
  if (flashWhite > 0) flashWhite--;
}

/* ======================================================================
 * 11. INPUT (Pointer Events, keyboard, visibility)
 * ====================================================================== */
function tryFullscreen() {
  if (fsTries >= 2) return;
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    fsTries++;
    var el = document.documentElement;
    var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!fn) return;
    var r = fn.call(el);
    if (r && typeof r.then === 'function') {
      r.then(function () {
        try { if (window.screen && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) { /* ignore */ }
      }, function () { /* ignore */ });
    }
  } catch (e) { /* ignore */ }
}
function firstGesture() { sfxInit(); }
function setPause(v, quiet) {
  if (mode !== 'playing') return;
  if (v === paused) return;
  paused = v;
  if (v) {
    stopCharge(); stopLaser(); chargeT = 0;
    if (!quiet) sfx('pause');
    var Mu = window.SFX && window.SFX.music;
    if (Mu && typeof Mu.pause === 'function') musicCall('pause'); else musicStop();
    stopLoops();
  } else {
    var Mu2 = window.SFX && window.SFX.music;
    if (Mu2 && typeof Mu2.resume === 'function') musicCall('resume'); else if (curTrack) music(curTrack);
    if (firing) chargeT = 0;
  }
  updateDanger();
}
function toggleMute() { try { if (window.SFX && window.SFX.setMuted) window.SFX.setMuted(!window.SFX.muted); } catch (e) { /* silent */ } }
function toggleHaptics() { haptics = !haptics; saveHaptics(haptics); if (haptics) vib(20); }
function inRect(lx, ly, r) { return lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h; }
function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
var titleStung = false;
function onDown(e) {
  firstGesture();
  if (e.cancelable) e.preventDefault();
  try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  var rect = canvas.getBoundingClientRect();
  var lx = (e.clientX - rect.left) * W / rect.width, ly = (e.clientY - rect.top) * H / rect.height;
  if (mode === 'title') { stinger('title'); startGame(); return; }
  if (mode === 'gameover') { if (gameoverT > 50) startGame(); return; }
  if (mode === 'continue') { doContinue(); return; }
  if (paused) {
    if (inRect(lx, ly, R.btn.haptics)) toggleHaptics(); else setPause(false);
    return;
  }
  if (bombReady && inRect(lx, ly, R.btn.bomb)) { fireBomb(); return; }
  if (inRect(lx, ly, R.btn.pause)) { setPause(true); return; }
  if (inRect(lx, ly, R.btn.mute)) { toggleMute(); return; }
  var zone = (lx < W * 0.55) ? 0 : 1;
  ptrs[e.pointerId] = { zone: zone, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: nowMs(), travel: 0, ax: 0, ay: 0 };
  if (zone === 1) { touchFire++; recomputeFiring(); if (P.swallowed) struggleTap(); }
  else {
    stick.on = true; stick.ox = clamp(lx, 18, W - 18); stick.oy = clamp(ly, 18, H - 18); stick.cx = stick.ox; stick.cy = stick.oy; stick.a = 1;
  }
}
function onMove(e) {
  var p = ptrs[e.pointerId];
  if (!p) return;
  if (e.cancelable) e.preventDefault();
  var dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.travel += Math.abs(dx) + Math.abs(dy);
  if (p.zone === 0) {
    p.ax += dx; p.ay += dy;
    if (p.ax * p.ax + p.ay * p.ay >= 4) {           // 2px dead-zone
      var k = (W / cssW) * 1.3 * (1 + 0.1 * P.speedLv);
      dragX += p.ax * k; dragY += p.ay * k;
      p.ax = 0; p.ay = 0;
    }
    var ox = (e.clientX - p.sx) * W / cssW, oy = (e.clientY - p.sy) * W / cssW, l = Math.sqrt(ox * ox + oy * oy);
    if (l > 14) { ox = ox / l * 14; oy = oy / l * 14; }
    stick.cx = stick.ox + ox; stick.cy = stick.oy + oy;
  }
  p.x = e.clientX; p.y = e.clientY;
}
function onUp(e) {
  firstGesture();
  var p = ptrs[e.pointerId];
  if (p) {
    delete ptrs[e.pointerId];
    if (p.zone === 1) { touchFire = Math.max(0, touchFire - 1); recomputeFiring(); }
    else {
      stick.on = false;
      if (e.type === 'pointerup' && nowMs() - p.t0 < 200 && p.travel < 8) forceToggle();   // tap on the move thumb = throw / recall
    }
  }
  tryFullscreen();
}
function releaseAllInput() {
  keys.left = keys.right = keys.up = keys.down = false;
  keyFire = false; touchFire = 0; ptrs = {}; xHold = false; stick.on = false;
  recomputeFiring();
}
function onKeyDown(e) {
  firstGesture();
  var c = e.code, used = true;
  if (mode === 'title') {
    if (c === 'KeyM') { toggleMute(); return; }
    if (c === 'KeyV') { toggleHaptics(); return; }
    if (c === 'F5' || c === 'F11' || c === 'F12' || e.metaKey || e.altKey || e.ctrlKey) return;
    stinger('title'); startGame(); tryFullscreen();
    if (e.cancelable) e.preventDefault();
    return;
  }
  if (mode === 'gameover') {
    if (c === 'KeyM') { toggleMute(); return; }
    if (gameoverT > 50 && (c === 'Space' || c === 'Enter' || c === 'KeyZ' || c === 'KeyX')) startGame();
    return;
  }
  if (mode === 'continue') {
    if (c === 'Space' || c === 'Enter' || c === 'KeyZ' || c === 'KeyX') doContinue();
    return;
  }
  switch (c) {
    case 'ArrowLeft': case 'KeyA': keys.left = true; break;
    case 'ArrowRight': case 'KeyD': keys.right = true; break;
    case 'ArrowUp': case 'KeyW': keys.up = true; break;
    case 'ArrowDown': case 'KeyS': keys.down = true; break;
    case 'KeyZ': case 'Space': case 'ControlLeft': case 'ControlRight':
      if (!paused && !e.repeat) { keyFire = true; recomputeFiring(); if (P.swallowed) struggleTap(); }
      break;
    case 'KeyX': if (!paused && !e.repeat) xHold = true; break;
    case 'KeyC': case 'ShiftLeft': case 'ShiftRight': if (!e.repeat) forceToggle(); break;
    case 'KeyP': case 'Escape': if (!e.repeat) setPause(!paused); break;
    case 'KeyM': if (!e.repeat) toggleMute(); break;
    case 'KeyV': if (!e.repeat) toggleHaptics(); break;
    case 'KeyB': if (!e.repeat) fireBomb(); break;
    case 'Enter': if (paused) setPause(false); break;
    default: used = false;
  }
  if (used && e.cancelable) e.preventDefault();
  if (paused && (c === 'Space' || c === 'KeyZ')) setPause(false);
}
function onKeyUp(e) {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': keys.left = false; break;
    case 'ArrowRight': case 'KeyD': keys.right = false; break;
    case 'ArrowUp': case 'KeyW': keys.up = false; break;
    case 'ArrowDown': case 'KeyS': keys.down = false; break;
    case 'KeyZ': case 'Space': case 'ControlLeft': case 'ControlRight': keyFire = false; recomputeFiring(); break;
    case 'KeyX': xHold = false; break;
  }
  tryFullscreen();
}
function bindInput() {
  var opt = { passive: false };
  wrap.addEventListener('pointerdown', onDown, opt);
  wrap.addEventListener('pointermove', onMove, opt);
  wrap.addEventListener('pointerup', onUp, opt);
  wrap.addEventListener('pointercancel', onUp, opt);
  wrap.addEventListener('touchstart', firstGesture, { passive: true });
  wrap.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('keydown', onKeyDown, opt);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', function () { releaseAllInput(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { releaseAllInput(); setPause(true, true); }
  });
}

/* ======================================================================
 * 12. SCALING
 * ====================================================================== */
function resize() {
  var wrapEl = canvas.parentElement;
  var iw = (wrapEl && wrapEl.clientWidth) || window.innerWidth || W;
  var ih = (wrapEl && wrapEl.clientHeight) || window.innerHeight || H;
  var s = Math.min(iw / W, ih / H), si = Math.floor(s);
  scale = (si >= 1 && si >= s * 0.85) ? si : s;   // integer scale unless it wastes > 15%
  cssW = W * scale; cssH = H * scale;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  if (ih > iw && mode === 'playing' && !paused) setPause(true, true);
}

/* ======================================================================
 * 13. VIEW (handed to GameRender), MAIN LOOP, INIT, EXPORT
 * ====================================================================== */
var V = {
  mode: 'title', phase: 'intro', paused: false, tick: 0, titleT: 0, gameoverT: 0, phaseT: 0,
  P: P, F: F, B: B, M: M, enemies: enemies, bullets: bullets, ebul: ebul, powerups: powerups, parts: parts, popups: popups, critters: critters,
  score: '0000000', hiStr: '0000000', lives: 3, stageNo: 1, stageName: '', stageIntro: '', mutator: '', loopN: 0, clearBonus: 0,
  chain: 0, mult: 1, chainT: 0, chargeT: 0, chargeTier: 0, charging: false, bannerStr: '', bannerT: 0, bannerCol: '#ff3a3a',
  shakeX: 0, shakeY: 0, flashWhite: 0, strobe: false, dangerT: -1, stick: stick, mash: -1, contT: 0, contLeft: 0, newHi: false,
  bombReady: false, bombPct: 0, haptics: true, muted: false, weaponName: 'main', power: 0, forceLv: 0, shieldOn: false, laser: laser, lane: lane
};
function sync() {
  V.mode = mode; V.phase = phase; V.paused = paused; V.tick = tick; V.titleT = titleT; V.gameoverT = gameoverT; V.phaseT = phaseT;
  V.score = scoreStr; V.hiStr = hiStr; V.lives = lives; V.stageNo = stageIdx + 1; V.stageName = stageName; V.stageIntro = stageIntro;
  V.mutator = stageMutator; V.loopN = loopN; V.clearBonus = clearBonus; V.chain = chain; V.mult = mult; V.chainT = chainT;
  V.chargeT = chargeT; V.chargeTier = chargeTier(); V.charging = (firing || xHold) && P.alive && !P.swallowed;
  V.bannerStr = bannerStr; V.bannerT = bannerT; V.bannerCol = bannerCol;
  V.shakeX = paused ? 0 : shakeX; V.shakeY = paused ? 0 : shakeY; V.flashWhite = flashWhite;
  V.strobe = phase === 'warn' || (B.on && B.mode === 'enter'); V.dangerT = dangerT;
  V.mash = P.swallowed ? P.taps / CFG.struggleNeed : -1; V.contT = contT; V.contLeft = continues; V.newHi = newHi;
  V.bombReady = bombReady; V.bombPct = bombMeter / CFG.bombNeed;
  V.haptics = haptics; V.weaponName = P.weapon; V.power = P.powerLv; V.forceLv = F.lv; V.shieldOn = P.shield;
  try { V.muted = !!(window.SFX && window.SFX.muted); } catch (e) { V.muted = false; }
}

function initCritters() {
  critters.length = 0;
  var names = ['butt_small', 'alien_eye', 'butt_mid', 'alien_squid', 'butt_charger', 'butt_spitter'];
  for (var j = 0; j < names.length; j++) critters.push({ n: names[j], x: rfr(0, W), y: 100 + rfr(0, 70), v: 0.4 + rf() * 0.8, ph: rf() * TAU });
}
var lastDangerCheck = 0;
function update() {
  if (freezeT > 0) { freezeT--; tick++; return; }
  if (slowT > 0) {
    if (slowHalf) { slowHalf = false; tick++; return; }
    slowHalf = true; slowT--;
    if (slowT === 0) endSlow();
  }
  tick++;
  R.step();
  if (!stick.on && stick.a > 0) stick.a = Math.max(0, stick.a - 1 / 24);
  if (mode === 'title') {
    titleT++;
    for (var i = 0; i < critters.length; i++) { var c = critters[i]; c.x -= c.v; if (c.x < -40) { c.x = W + 20; c.y = 100 + rfr(0, 70); } }
    return;
  }
  if (mode === 'gameover') { gameoverT++; if (gameoverT === 480) music('title'); updateFX(); return; }
  if (mode === 'continue') { contT--; updateFX(); if (contT <= 0) gameOver(); return; }
  phaseT++;
  updatePlayer();
  updateForce();
  updateFlow();
  updateBullets();
  updateEnemies();
  if (B.on) updateBoss(B);
  if (M.on) updateBoss(M);
  updateEBullets();
  updatePowerups();
  updateRecov();
  collide();
  updateFX();
  if (chainT > 0) { chainT--; if (chainT === 0) chainEnd(); }
  if (bannerT > 0) bannerT--;
  updateDanger();
  if (tick - lastIntensity >= 30) {
    lastIntensity = tick;
    if (phase === 'stage' || phase === 'intro') {
      var cnt = 0, k;
      for (k = 0; k < enemies.length; k++) if (enemies[k].on) cnt++;
      var f = M.on ? 1 : 0.2 + 0.5 * stageT / Math.max(1, stage.length || 60) + Math.min(0.3, cnt / 20);
      musicCall('setIntensity', clamp(f, 0, 1));
    }
  }
}

var lastT = null, acc = 0;
function frame(now) {
  window.requestAnimationFrame(frame);
  if (lastT === null) lastT = now;
  var dt = now - lastT;
  lastT = now;
  if (dt > 100) dt = 100;
  if (dt < 0) dt = 0;
  if (Math.abs(dt - STEP) < 1.5) dt = STEP;
  var n = 0;
  acc += dt;
  if (!paused) {
    while (acc >= STEP && n < 8) { update(); acc -= STEP; n++; }
    if (n >= 8) acc = 0;
  } else {
    while (acc >= STEP) { tick++; acc -= STEP; n++; if (n >= 2) { acc = 0; break; } }
  }
  if (n > 0) { sync(); R.draw(V); }   // render only when the sim advanced (halves GPU work on 120Hz screens)
}

function init(cv) {
  if (inited) return;
  inited = true;
  canvas = cv || document.getElementById('game');
  wrap = canvas.parentNode || document.body;
  canvas.width = W; canvas.height = H;
  ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  R.init(canvas, ctx);
  rf = R.rf;
  hiScore = storedHi = loadHi(); hiStr = pad(hiScore, 7); scoreStr = pad(0, 7);
  haptics = loadHaptics();
  P.alive = false; B.on = false; B.mode = 'dead'; M.on = false; M.mode = 'dead';
  initCritters();
  stage = getStageData(0); mods = stage.mods || DEF_MODS;
  R.setStage(stage, (stage.bg && typeof stage.bg.theme === 'number') ? stage.bg.theme : 0);
  bindInput();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();
  music('title');
  window.requestAnimationFrame(frame);
}

window.Game = {
  init: init,
  god: false,
  get state() { return mode; },
  get phase() { return phase; },
  get paused() { return paused; },
  info: function () {
    var cnt = 0;
    for (var i = 0; i < enemies.length; i++) if (enemies[i].on) cnt++;
    return {
      state: mode, phase: phase, paused: paused, tick: tick, score: score, hi: hiScore, lives: lives, continues: continues,
      stage: stageIdx + 1, stageIdx: stageIdx, stageT: stageT, chain: chain, mult: mult, rank: rank, alive: P.alive,
      power: P.powerLv, weapon: P.weapon, speed: P.speedLv, force: { lv: F.lv, mode: F.on ? F.mode : 'none' }, shield: P.shield,
      swallowed: P.swallowed, charge: chargeT, bomb: bombReady, slow: slowT, boss: B.on ? { hp: B.hp, max: B.maxhp, mode: B.mode, phaseI: B.phaseI, fr: B.fr } : null,
      mid: M.on ? { hp: M.hp, max: M.maxhp, mode: M.mode } : null, midState: midState,
      enemies: cnt, allocFails: allocFails, scale: scale
    };
  },
  start: function () { if (mode !== 'playing') startGame(); },
  pause: function (v) { setPause(!!v, true); },
  skipToBoss: function () {
    if (mode === 'playing' && stage) { phase = 'stage'; midState = 2; stageT = (stage.length || 60) - 0.05; lastWaveT = stageT; phaseT = 0; }
  },
  skipToMid: function () {
    if (mode === 'playing' && stage && stage.midboss) { phase = 'stage'; midState = 0; stageT = stage.midboss.t - 0.1; lastWaveT = stageT; phaseT = 0; }
  },
  skipTo: function (raw, t) {
    if (mode !== 'playing') return;
    clearPools(); stageIdx = raw | 0; beginStage();
    phase = 'stage'; stageT = t || 0; lastWaveT = stageT; phaseT = 0;
    if (stage.midboss && stageT > stage.midboss.t) midState = 2;
  },
  kill: function () { if (mode === 'playing' && P.alive) { P.inv = 0; P.swallowed = false; killPlayer(false); } },
  give: function (power, forceLv, shield) {
    P.powerLv = clamp(power | 0, 0, 3); P.shield = !!shield;
    var fl = clamp(forceLv | 0, 0, 3);
    if (fl > 0) { if (F.lv === 0) giveForce(); F.lv = fl; } else { F.on = false; F.lv = 0; F.mode = 'none'; }
  },
  giveWeapon: function (name) { if (name === 'main' || name === 'spread' || name === 'laser' || name === 'wave') { P.weapon = name; if (name !== 'laser') stopLaser(); } },
  damageBoss: function (d) {
    var b = B.on ? B : (M.on ? M : null);
    if (!b || b.mode === 'dying' || b.mode === 'dead') return;
    b.hp -= (d || 10); b.flash = 2;
    if (b.hp <= 0) bossDie(b);
  },
  queueWave: function (w) { queueWave(w); },   // test hook
  giveBomb: function () { bombMeter = CFG.bombNeed; bombReady = true; },
  bomb: function () { fireBomb(); },
  spawn: function (name, x, y, from) { return spawnEnemy(name, x, y, from || 'right', null); },   // test hook
  step: function (n) { for (var i = 0; i < (n | 0); i++) update(); sync(); },
  seed: function (n) { seed = (n >>> 0) || 1; },
  debug: { P: P, B: B, M: M, F: F, enemies: enemies, bullets: bullets, ebul: ebul, powerups: powerups, CFG: CFG, V: V, stick: stick }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { init(document.getElementById('game')); });
} else {
  init(document.getElementById('game'));
}
})();
