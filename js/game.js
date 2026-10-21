/* ======================================================================
 * aasssMaster - js/game.js  (global `Game`)
 * Loop, entities, input, collision, raster FX, shadows, HUD, flow.
 * Codes strictly against CONTRACT.md; every external lookup is guarded.
 * ====================================================================== */
(function () {
'use strict';

/* ======================================================================
 * 1. CONSTANTS, RNG, UTILS, POOLS
 * ====================================================================== */
var W = 384, H = 216, FLOOR = 196, CEIL = 20, TAU = Math.PI * 2, PI = Math.PI;
var STEP = 1000 / 60;
var CHARGE_START = 15;   // frames (0.25s) before the charge sfx starts
var CHARGE_FULL = 36;    // frames (0.6s) needed for a charged shot
var HI_KEY = 'aasssMaster.hi';

var canvas = null, ctx = null, wrap = null, inited = false;
var scale = 1, cssW = W, cssH = H;
var tick = 0;

var seed = ((Date.now() & 0x7fffffff) ^ 0x5bd1e995) >>> 0;
function rng() { // mulberry32
  seed = (seed + 0x6D2B79F5) | 0;
  var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rr(a, b) { return a + (b - a) * rng(); }
function ri(a, b) { return Math.floor(a + (b - a + 1) * rng()); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function ov(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function pad(n, len) { var s = String(n); while (s.length < len) s = '0' + s; return s; }
function cleanText(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9 .,!?:'\/-]/g, ' '); }

function makePool(n, ctor) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = ctor(); return a; }
function alloc(pool) { for (var i = 0; i < pool.length; i++) if (!pool[i].on) return pool[i]; return null; }

function loadHi() { try { var v = parseInt(window.localStorage.getItem(HI_KEY), 10); return isNaN(v) ? 0 : v; } catch (e) { return 0; } }
function saveHi(v) { try { window.localStorage.setItem(HI_KEY, String(v)); } catch (e) { /* ignore */ } }

/* ======================================================================
 * 2. ADAPTERS: sprites / text / sfx / music / levels (all guarded)
 * ====================================================================== */
var FB_SIZE = {
  player: [24, 16], thruster: [8, 8], option: [8, 8], shield: [32, 24], bullet: [8, 3], bullet_charged: [24, 8],
  enemy_bullet: [6, 6], hair_ball: [10, 10], butt_small: [16, 16], butt_mid: [24, 24], butt_charger: [20, 16],
  butt_spitter: [24, 20], alien_eye: [16, 16], alien_squid: [20, 24], boss_butt: [96, 80], boss_butt_dmg: [96, 80],
  explosion: [32, 32], explosion_small: [16, 16], pu_power: [12, 12], pu_speed: [12, 12], pu_shield: [12, 12],
  pu_option: [12, 12], hair_tuft: [8, 8], bg_rocks: [64, 40], bg_ceiling: [64, 20], bg_far: [64, 60], logo: [160, 40]
};
var FB_FRAMES = {
  player: 3, thruster: 4, option: 4, shield: 2, bullet: 1, bullet_charged: 2, enemy_bullet: 2, hair_ball: 2,
  butt_small: 4, butt_mid: 4, butt_charger: 3, butt_spitter: 4, alien_eye: 4, alien_squid: 4, boss_butt: 4,
  boss_butt_dmg: 1, explosion: 6, explosion_small: 4, pu_power: 2, pu_speed: 2, pu_shield: 2, pu_option: 2, hair_tuft: 3
};
var spriteOK = {}, sizeCache = {}, frameCache = {};
var _o = { frame: 0, flipX: false, flash: false };

function hasSpr(name) {
  var v = spriteOK[name];
  if (v !== undefined) return v;
  v = false;
  try {
    if (window.Sprites && typeof window.Sprites.get === 'function') {
      var c = window.Sprites.get(name, 0);
      v = !!(c && c.width > 0);
    }
  } catch (e) { v = false; }
  spriteOK[name] = v;
  return v;
}
function sprSize(name) {
  var s = sizeCache[name];
  if (s) return s;
  s = null;
  if (hasSpr(name)) {
    try {
      var z = window.Sprites.size ? window.Sprites.size(name) : null;
      if (z && z.w > 0 && z.h > 0) s = { w: z.w, h: z.h };
      else { var c = window.Sprites.get(name, 0); s = { w: c.width, h: c.height }; }
    } catch (e) { s = null; }
  }
  if (!s) { var f = FB_SIZE[name] || [16, 16]; s = { w: f[0], h: f[1] }; }
  sizeCache[name] = s;
  return s;
}
function sprFrames(name) {
  var n = frameCache[name];
  if (n) return n;
  n = 0;
  if (hasSpr(name)) { try { n = window.Sprites.frames ? (window.Sprites.frames(name) | 0) : 1; } catch (e) { n = 0; } }
  if (!n) n = FB_FRAMES[name] || 1;
  frameCache[name] = n;
  return n;
}
/* S(name, x, y, frame, flipX, flash): draw sprite or magenta placeholder */
function S(name, x, y, frame, flipX, flash) {
  x = Math.round(x); y = Math.round(y);
  if (hasSpr(name)) {
    try {
      _o.frame = frame | 0; _o.flipX = !!flipX; _o.flash = !!flash;
      window.Sprites.draw(ctx, name, x, y, _o);
      return;
    } catch (e) { spriteOK[name] = false; }
  }
  var z = sprSize(name);
  ctx.fillStyle = flash ? '#fff' : '#f0f';
  ctx.fillRect(x, y, z.w, z.h);
}
/* scaled draw of a frame (used for the wide beam / tiny life icons) */
function SS(name, x, y, frame, w, h) {
  x = Math.round(x); y = Math.round(y);
  if (hasSpr(name)) {
    try {
      var c = window.Sprites.get(name, frame | 0);
      ctx.drawImage(c, x, y, w, h);
      return;
    } catch (e) { spriteOK[name] = false; }
  }
  ctx.fillStyle = '#f0f';
  ctx.fillRect(x, y, w, h);
}
function SH(name, frame, x, y) { // low-level shadow draw at the exact position
  x = Math.round(x); y = Math.round(y);
  if (hasSpr(name) && window.Sprites.drawShadow) {
    try {
      _o.frame = frame | 0; _o.flipX = false; _o.flash = false;
      window.Sprites.drawShadow(ctx, name, x, y, _o);
      return;
    } catch (e) { /* fall through */ }
  }
  var z = sprSize(name);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y + Math.round(z.h * 0.2), z.w, Math.max(1, Math.round(z.h * 0.2)));
}
/* shadow of an airborne sprite whose top-left is (x,y): alpha fades with altitude */
function shadow(name, frame, x, y) {
  var z = sprSize(name);
  var sh = Math.max(1, Math.round(z.h * 0.4));
  var alt = FLOOR - (y + z.h);
  if (alt < 0) alt = 0;
  var a = 1 - alt / 260;                 // fade with altitude (floor 0.45 -> ~0.2 effective)
  a = a < 0.5 ? 0.5 : (a > 1 ? 1 : a);
  ctx.globalAlpha = a;
  // light comes from the upper-left: high flyers cast their shadow further right
  SH(name, frame, x + Math.round(alt * 0.12), FLOOR - sh);
  // second pass darkens the core so shadows read on the dark floor
  ctx.globalAlpha = a * 0.6;
  SH(name, frame, x + Math.round(alt * 0.12), FLOOR - sh);
  ctx.globalAlpha = 1;
}
/* text */
function T(str, x, y, color, sc) {
  sc = sc || 1; color = color || '#fff';
  if (window.Sprites && typeof window.Sprites.text === 'function') {
    try { return window.Sprites.text(ctx, str, Math.round(x), Math.round(y), color, sc); } catch (e) { /* fall */ }
  }
  ctx.font = 'bold ' + (8 * sc) + 'px monospace';
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.fillText(str, Math.round(x), Math.round(y));
  return str.length * 6 * sc;
}
function TW(str, sc) {
  sc = sc || 1;
  if (window.Sprites && typeof window.Sprites.textWidth === 'function') {
    try { var w = window.Sprites.textWidth(str, sc); if (w >= 0) return w; } catch (e) { /* fall */ }
  }
  return str.length * 6 * sc;
}
function TS(str, x, y, color, sc) { T(str, x + 1, y + 1, '#000', sc); return T(str, x, y, color, sc); } // shadowed
function TC(str, y, color, sc) { // centered + shadowed
  sc = sc || 1;
  var x = Math.round((W - TW(str, sc)) / 2);
  TS(str, x, y, color, sc);
}

/* sfx / music (throttled, guarded) */
var sfxLast = {};
var sfxGap = { hit: 3, boss_hit: 5, shoot: 4, enemy_die: 2, enemy_die_big: 3, fart: 6, shield_break: 6 };
function sfx(name, opts) {
  var g = sfxGap[name];
  if (g) { if (tick - (sfxLast[name] || -999) < g) return null; sfxLast[name] = tick; }
  try { if (window.SFX && typeof window.SFX.play === 'function') return window.SFX.play(name, opts) || null; } catch (e) { /* silent */ }
  return null;
}
var curTrack = null;
function music(track) {
  curTrack = track;
  try { if (window.SFX && window.SFX.music && window.SFX.music.start) window.SFX.music.start(track); } catch (e) { /* silent */ }
}
function musicStop() {
  try { if (window.SFX && window.SFX.music && window.SFX.music.stop) window.SFX.music.stop(); } catch (e) { /* silent */ }
}
function musicIntensity(v) {
  try { if (window.SFX && window.SFX.music && window.SFX.music.setIntensity) window.SFX.music.setIntensity(v); } catch (e) { /* silent */ }
}
function sfxInit() { try { if (window.SFX && window.SFX.init) window.SFX.init(); } catch (e) { /* silent */ } }

/* ---------------------- Levels adapter + built-in fallback stage ---------------------- */
var FB = (function () {
  var types = {
    butt_small:   { sprite: 'butt_small',   hp: 1, speed: 1.4, score: 100, w: 16, h: 16, behavior: 'sine', hairy: true },
    butt_mid:     { sprite: 'butt_mid',     hp: 4, speed: 0.9, score: 300, w: 24, h: 24, behavior: 'straight', hairy: true, fire: 2.6 },
    butt_charger: { sprite: 'butt_charger', hp: 2, speed: 1.2, score: 200, w: 20, h: 16, behavior: 'charge' },
    butt_spitter: { sprite: 'butt_spitter', hp: 5, speed: 1.0, score: 400, w: 24, h: 20, behavior: 'hover_spit', hairy: true },
    butt_bouncer: { sprite: 'butt_small',   hp: 2, speed: 1.0, score: 150, w: 16, h: 16, behavior: 'bounce', hairy: true },
    alien_eye:    { sprite: 'alien_eye',    hp: 2, speed: 1.3, score: 150, w: 16, h: 16, behavior: 'swoop' },
    alien_squid:  { sprite: 'alien_squid',  hp: 3, speed: 0.8, score: 250, w: 20, h: 24, behavior: 'drift', fire: 3.2 },
    boss_butt:    { sprite: 'boss_butt',    hp: 120, speed: 1, score: 5000, w: 96, h: 80, behavior: 'boss' }
  };
  var order = ['butt_small', 'alien_eye', 'butt_charger', 'butt_mid', 'butt_bouncer', 'butt_spitter', 'alien_squid'];
  var waves = [];
  for (var i = 0; i < 16; i++) {
    var ty = order[i % order.length];
    waves.push({
      t: 2 + i * 3.3, type: ty,
      count: ty === 'butt_spitter' ? 2 : (ty === 'butt_mid' ? 2 : 3 + (i % 3)),
      y: ty === 'butt_spitter' ? 'rand' : ((i * 3) % 5) / 4,
      spacing: 0.55, pattern: i % 3 === 0 ? 'vee' : (i % 3 === 1 ? 'line' : 'wave')
    });
  }
  var stage = {
    name: 'HAIRY NEBULA', length: 60, music: 'stage',
    bg: { speedFar: 0.25, speedMid: 0.6, speedNear: 1.6, palette: null },
    waves: waves, boss: { type: 'boss_butt', hp: 120 }
  };
  return {
    enemyTypes: types,
    stages: [stage],
    getWaves: function (si, from, to) {
      var out = [];
      for (var k = 0; k < waves.length; k++) if (waves[k].t >= from && waves[k].t < to) out.push(waves[k]);
      return out;
    },
    powerupDrop: function (name, r) {
      if (r() > 0.14) return null;
      var q = r();
      return q < 0.35 ? 'pu_power' : (q < 0.6 ? 'pu_speed' : (q < 0.8 ? 'pu_option' : 'pu_shield'));
    }
  };
})();

function LV() {
  var L = window.Levels;
  return (L && L.enemyTypes && L.stages && L.stages.length && typeof L.getWaves === 'function') ? L : FB;
}
function etype(name) {
  var L = window.Levels, d = null;
  try { if (L && L.enemyTypes) d = L.enemyTypes[name]; } catch (e) { d = null; }
  return d || FB.enemyTypes[name] || FB.enemyTypes.butt_small;
}
function stageCount() { return LV().stages.length; }
function curStage() { var L = LV(); return L.stages[stageIdx % L.stages.length] || FB.stages[0]; }
function getWaves(from, to) {
  try {
    var r = LV().getWaves(stageIdx % stageCount(), from, to);
    return r && r.length !== undefined ? r : [];
  } catch (e) { return []; }
}
function powerupDrop(name) {
  var L = window.Levels, fn = (L && typeof L.powerupDrop === 'function') ? L.powerupDrop : FB.powerupDrop;
  try { var r = fn.call(L || FB, name, rng); return (typeof r === 'string' && r.indexOf('pu_') === 0) ? r : null; } catch (e) { return null; }
}

/* ======================================================================
 * 3. GAME STATE + POOLS
 * ====================================================================== */
var mode = 'title';        // title | playing | gameover
var phase = 'intro';       // intro | stage | warn | boss | clear
var paused = false;
var phaseT = 0, titleT = 0, gameoverT = 0, bannerT = 0, bannerStr = '';
var score = 0, hiScore = 0, lives = 3, nextExtra = 50000, scoreStr = '0000000', hiStr = '0000000';
var stageIdx = 0, loopN = 0, stageT = 0, stageObj = null, stageName = '', newHi = false;
var combo = 0, comboT = 0;
var shakeAmt = 0, flashWhite = 0;
var clearBonus = 0;

var bullets  = makePool(48,  function () { return { on: false, x: 0, y: 0, vx: 0, vy: 0, w: 8, h: 3, dmg: 1, beam: false, t: 0 }; });
var ebul     = makePool(110, function () { return { on: false, x: 0, y: 0, vx: 0, vy: 0, kind: 0, w: 6, h: 6, t: 0 }; });
var parts    = makePool(320, function () { return { on: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: '#fff', s: 1, spr: '', nf: 1, grav: 0, drag: 1 }; });
var enemies  = makePool(44,  function () { return { on: false }; });
var powerups = makePool(8,   function () { return { on: false, x: 0, y: 0, name: 'pu_power', t: 0 }; });
var popups   = makePool(14,  function () { return { on: false, x: 0, y: 0, str: '', life: 0, c: '#fff' }; });
var spawnQ   = makePool(90,  function () { return { on: false, at: 0, name: '', fy: 0, i: 0, n: 1, pat: '', wy: 0 }; });

var P = {
  x: 40, y: 100, w: 24, h: 16, alive: false, respawn: 0, inv: 0, flash: 0, vy: 0, bank: 0,
  powerLv: 0, speedLv: 0, opts: 0, shield: false, fireCd: 0, oph: 0,
  ox: [0, 0], oy: [0, 0]
};
var B = {
  on: false, x: W + 20, y: 62, w: 96, h: 80, hp: 1, maxhp: 1, mode: 'enter', t: 0, sub: 0, subMax: 0, subT: 0,
  flash: 0, beamCd: 0, atkT: 0, homeX: 266, phaseI: 0, phases: [], lastSwallow: -9999, lastAtk: '', lungeSpd: 0,
  jx: 0, gulpT: 0, name: 'boss_butt', score: 5000, deadT: 0
};

/* input state */
var keys = { left: false, right: false, up: false, down: false };
var keyFire = false, touchFire = 0, firing = false, fireQueued = false, chargeT = 0, chargeH = null;
var xCool = 0;
var dragX = 0, dragY = 0;
var ptrs = {};
var fsTries = 0;

/* ======================================================================
 * 4. FX HELPERS: particles, popups, shake, score
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
    var a = rng() * TAU, v = rr(0.4, spd);
    var p = spawnP(0, x, y, Math.cos(a) * v, Math.sin(a) * v, ri(14, 32), cols[ri(0, cols.length - 1)], rng() < 0.3 ? 2 : 1);
    if (p) { p.grav = 0.03; p.drag = 0.97; }
  }
}
function explode(cx, cy, big) {
  var nm = big ? 'explosion' : 'explosion_small';
  var z = sprSize(nm);
  var p = spawnP(1, cx - z.w / 2, cy - z.h / 2, 0, 0, big ? 20 : 13, '#fff', 1);
  if (p) { p.spr = nm; p.nf = sprFrames(nm); }
  if (big) {
    for (var k = 0; k < 2; k++) {
      var q = spawnP(1, cx - 8 + rr(-12, 12), cy - 8 + rr(-12, 12), 0, 0, 14, '#fff', 1);
      if (q) { q.spr = 'explosion_small'; q.nf = sprFrames('explosion_small'); }
    }
  }
  sparks(cx, cy, big ? 16 : 8, big ? 3.2 : 2.2);
}
function tufts(cx, cy, n) {
  for (var i = 0; i < n; i++) {
    var p = spawnP(2, cx - 4, cy - 4, rr(-1.4, 0.6), rr(-1.6, 0.2), ri(30, 55), '#fff', 1);
    if (p) { p.spr = 'hair_tuft'; p.nf = sprFrames('hair_tuft'); p.grav = 0.02; p.drag = 0.98; }
  }
}
function popup(x, y, str, c) {
  var p = alloc(popups); if (!p) return;
  p.on = true; p.x = x; p.y = y; p.str = str; p.life = 50; p.c = c || '#fff';
}
function shake(v) { if (v > shakeAmt) shakeAmt = v; }
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
 * 5. PLAYER: fire, charge, hurt, die, respawn
 * ====================================================================== */
function addBullet(x, y, vx, vy, dmg) {
  var b = alloc(bullets); if (!b) return;
  b.on = true; b.beam = false; b.x = x; b.y = y - 1; b.vx = vx; b.vy = vy; b.w = 8; b.h = 3; b.dmg = dmg; b.t = 0;
}
function shootNormal() {
  var cx = P.x + 20, cy = P.y + 8, lv = P.powerLv;
  if (lv <= 0) { addBullet(cx, cy, 8, 0, 1); }
  else if (lv === 1) { addBullet(cx, cy - 3, 8, 0, 1); addBullet(cx, cy + 3, 8, 0, 1); }
  else if (lv === 2) { addBullet(cx, cy, 8.5, 0, 1); addBullet(cx, cy - 4, 8, -0.9, 1); addBullet(cx, cy + 4, 8, 0.9, 1); }
  else { addBullet(cx, cy - 2, 9, 0, 1.2); addBullet(cx, cy + 2, 9, 0, 1.2); addBullet(cx, cy - 5, 8, -1.3, 1); addBullet(cx, cy + 5, 8, 1.3, 1); }
  for (var i = 0; i < P.opts; i++) addBullet(P.ox[i] + 7, P.oy[i] + 4, 8, 0, 0.6);
  sfx('shoot');
}
function fireCharged() {
  var b = alloc(bullets); if (!b) return;
  b.on = true; b.beam = true; b.x = P.x + 18; b.y = P.y + 2; b.vx = 6.5; b.vy = 0; b.w = 24; b.h = 12; b.dmg = 4; b.t = 0;
  sfx('shoot_charged');
  shake(2);
}
function startCharge() { chargeH = sfx('charge'); }
function stopCharge() {
  if (chargeH && typeof chargeH.stop === 'function') { try { chargeH.stop(); } catch (e) { /* silent */ } }
  chargeH = null;
}
function releaseCharge(canFire) {
  var was = chargeT;
  stopCharge();
  chargeT = 0;
  if (canFire && was >= CHARGE_FULL && P.alive && mode === 'playing' && !paused) fireCharged();
}
function setFiring(on) {
  if (on === firing) return;
  firing = on;
  if (on) { chargeT = 0; fireQueued = true; }
  else releaseCharge(true);
}
function recomputeFiring() { setFiring(touchFire > 0 || keyFire); }

function safeNow() { return phase === 'clear' || (B.on && B.mode === 'dying'); }

/* returns true if the hit registered */
function hurtPlayer(swallow) {
  if (!P.alive || P.inv > 0 || safeNow()) return false;
  if (window.Game && window.Game.god) return false;
  if (!swallow && P.shield) {
    P.shield = false; P.inv = 70; P.flash = 2;
    sfx('shield_break'); shake(4);
    sparks(P.x + 12, P.y + 8, 12, 2.5, ['#6ab4ff', '#bfe3ff', '#ffffff']);
    return true;
  }
  killPlayer(!!swallow);
  return true;
}
function killPlayer(swallow) {
  P.alive = false; P.inv = 0;
  stopCharge(); chargeT = 0;
  lives--;
  P.opts = 0; P.shield = false; P.powerLv = Math.max(0, P.powerLv - 1);
  combo = 0; comboT = 0;
  var cx = P.x + 12, cy = P.y + 8;
  if (swallow) {
    sfx('swallow'); shake(9);
    bannerStr = 'SWALLOWED!'; bannerT = 110;
    sparks(cx, cy, 14, 2, ['#ff5fa2', '#ffffff', '#d33a7a']);
  } else {
    sfx('player_die'); shake(10);
    explode(cx, cy, true);
  }
  P.respawn = lives > 0 ? 90 : 130;
}
function respawnPlayer() {
  P.alive = true; P.x = 30; P.y = 100; P.inv = 120; P.flash = 0; P.fireCd = 0; P.vy = 0;
  dragX = dragY = 0;
}
function gameOver() {
  mode = 'gameover'; gameoverT = 0;
  newHi = score > 0 && score >= hiScore && score > storedHi;
  if (hiScore > storedHi) { storedHi = hiScore; saveHi(hiScore); }
  stopCharge(); chargeT = 0;
  music('gameover');
}
var storedHi = 0;

function updatePlayer() {
  if (!P.alive) {
    dragX = dragY = 0;
    if (P.respawn > 0) {
      P.respawn--;
      if (P.respawn === 0) { if (lives > 0) respawnPlayer(); else gameOver(); }
    }
    return;
  }
  var sp = 2.2 + 0.5 * P.speedLv;
  var dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  var mx = dx * sp + dragX, my = dy * sp + dragY;
  dragX = dragY = 0;
  var cap = 9 + 2 * P.speedLv;
  mx = clamp(mx, -cap, cap); my = clamp(my, -cap, cap);
  P.x = clamp(P.x + mx, 4, W - 28);
  var oy = P.y;
  P.y = clamp(P.y + my, CEIL, FLOOR - 16);
  P.vy = P.y - oy;
  if (P.vy < -0.4) P.bank = 12; else if (P.vy > 0.4) P.bank = -12;
  else if (P.bank > 0) P.bank--; else if (P.bank < 0) P.bank++;
  if (P.inv > 0) P.inv--;
  if (P.flash > 0) P.flash--;
  if (xCool > 0) xCool--;

  // options orbit on an elliptical sine path around the ship
  P.oph += 0.07;
  for (var i = 0; i < P.opts; i++) {
    var a = P.oph + i * PI;
    P.ox[i] = P.x + 12 + Math.cos(a) * 21 - 4;
    P.oy[i] = P.y + 8 + Math.sin(a) * 13 - 4;
  }
  // fire
  if (P.fireCd > 0) P.fireCd--;
  if (firing) {
    chargeT++;
    if (chargeT === CHARGE_START && !chargeH) startCharge();
  }
  if ((firing || fireQueued) && P.fireCd <= 0) {
    shootNormal();
    P.fireCd = (tick & 1) ? 7 : 8;
    fireQueued = false;
  }
}

/* ======================================================================
 * 6. ENEMIES
 * ====================================================================== */
function fireAt(x, y, speed, kind, angOff) {
  var b = alloc(ebul); if (!b) return;
  var ang = PI;
  if (P.alive) ang = Math.atan2((P.y + 8) - y, (P.x + 12) - x);
  ang += angOff || 0;
  b.on = true; b.kind = kind; b.t = 0;
  b.w = kind ? 10 : 6; b.h = b.w;
  b.x = x - b.w / 2; b.y = y - b.h / 2;
  b.vx = Math.cos(ang) * speed; b.vy = Math.sin(ang) * speed;
}
function volley(e, speed) {
  var n = e.fireSpread || 1;
  for (var k = 0; k < n; k++) fireAt(e.x + 2, e.y + e.h * 0.55, speed, e.fireKind, (k - (n - 1) / 2) * 0.22 + (n === 1 ? rr(-0.05, 0.05) : 0));
}
function spawnEnemy(name, x, y) {
  var e = alloc(enemies); if (!e) return null;
  var d = etype(name);
  var spr = d.sprite || name;
  var z = sprSize(spr);
  e.on = true; e.def = d; e.name = name; e.spr = spr;
  e.sw = z.w; e.sh = z.h;
  e.w = d.w || z.w; e.h = d.h || z.h;
  e.beh = d.behavior || 'straight';
  if (e.beh === 'boss') e.beh = 'straight';
  e.hp = e.maxhp = Math.max(1, Math.ceil((d.hp || 1) * (1 + 0.35 * loopN)));
  var sp = d.speed || 1;
  e.spd = sp > 8 ? sp / 60 : sp;
  e.score = d.score === undefined ? 100 : d.score;
  e.x = x; e.y = y; e.baseY = y; e.t = 0; e.state = 0; e.timer = 0; e.ph = rng() * TAU; e.flash = 0; e.beamCd = 0;
  e.vx = 0; e.vy = 0; e.amp = rr(18, 34); e.ang = PI; e.tvy = 0; e.ty = y; e.spit = 0;
  e.hx = 292 + rng() * 22; e.stopX = rr(W * 0.55, W * 0.72);
  var f = d.fire, fi = 0;
  e.fireKind = e.beh === 'hover_spit' ? 1 : 0; e.fireSpread = 1;
  if (typeof f === 'number') fi = f > 20 ? f : f * 60;
  else if (f && typeof f === 'object') {
    // { rate (shots/sec), type: 'enemy_bullet'|'hair_ball', spread (shots per volley) }
    var rt = typeof f.rate === 'number' && f.rate > 0 ? f.rate : 0.6;
    fi = clamp(60 / rt, 30, 400);
    if (f.type === 'hair_ball') e.fireKind = 1; else if (f.type === 'enemy_bullet') e.fireKind = 0;
    if (typeof f.spread === 'number' && f.spread >= 1) e.fireSpread = Math.min(5, f.spread | 0);
  } else if (f) fi = 150;
  e.fireInt = fi;
  e.fireT = fi ? ri(40, Math.max(41, fi)) : 0;
  if (e.beh === 'hover_spit') { e.fireT = 45; if (!fi) e.fireInt = 90; }
  if (e.beh === 'bounce') { e.vy = (rng() < 0.5 ? -1 : 1) * rr(1.0, 1.8); }
  if (e.beh === 'drift') { e.tvy = rr(-1, 1); }
  return e;
}
function patternY(pat, i, n, baseY, h, top, bot) {
  var y = baseY, k;
  switch (String(pat || 'line')) {
    case 'column': case 'wall': case 'vertical': y = top + (i + 0.5) / n * (bot - top); break;
    case 'v': case 'vee': case 'wedge':
      k = Math.ceil(i / 2); y = baseY + ((i & 1) ? -1 : 1) * k * (h + 5); break;
    case 'sine': case 'wave': case 'snake': y = baseY + Math.sin(i * 0.9) * 32; break;
    case 'stairs': case 'diagonal': case 'diag': y = baseY + (i - (n - 1) / 2) * (h * 0.9); break;
    case 'random': case 'scatter': case 'burst': y = top + rng() * (bot - top); break;
    default: y = baseY;
  }
  return clamp(y, top, bot);
}
function queueWave(w) {
  var n = Math.max(1, Math.min(14, (w.count | 0) || 1));
  var sp = Math.round((typeof w.spacing === 'number' ? w.spacing : 0.4) * 60);
  var fy = (w.y === 'rand' || w.y === undefined || w.y === null || isNaN(+w.y)) ? rng() : clamp(+w.y, 0, 1);
  for (var i = 0; i < n; i++) {
    var q = alloc(spawnQ); if (!q) break;
    q.on = true; q.at = tick + i * sp; q.name = w.type; q.fy = fy; q.i = i; q.n = n; q.pat = w.pattern; q.wy = rng();
  }
  if (typeof w.type === 'string' && w.type.indexOf('butt') === 0) sfx('fart', { volume: 0.5 });
}
function updateSpawnQ() {
  for (var i = 0; i < spawnQ.length; i++) {
    var q = spawnQ[i];
    if (!q.on || q.at > tick) continue;
    q.on = false;
    var d = etype(q.name), z = sprSize(d.sprite || q.name);
    var h = d.h || z.h;
    var top = CEIL + 4, bot = Math.max(top + 1, FLOOR - 4 - h);
    var base = top + q.fy * (bot - top);
    var y = patternY(q.pat, q.i, q.n, base, h, top, bot);
    var xo = (q.pat === 'v' || q.pat === 'vee' || q.pat === 'wedge') ? Math.ceil(q.i / 2) * 10 : 0;
    spawnEnemy(q.name, W + 6 + xo, y);
  }
}

function updateEnemies() {
  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (!e.on) continue;
    e.t++;
    if (e.flash > 0) e.flash--;
    if (e.beamCd > 0) e.beamCd--;
    var spd = e.spd, px = P.x + 12, py = P.y + 8;
    switch (e.beh) {
      case 'sine':
        e.x -= spd; e.y = e.baseY + Math.sin(e.t * 0.07 + e.ph) * e.amp; break;
      case 'charge':
        if (e.state === 0) {
          e.x -= spd * 1.3;
          if (e.x <= e.stopX) { e.state = 1; e.timer = 48; }
        } else if (e.state === 1) {
          e.timer--;
          e.y += Math.sin(e.t * 2.1) * 0.6;
          if (e.timer === 14) e.ty = P.alive ? py - e.h / 2 : e.y;
          if (e.timer <= 0) { e.state = 2; }
        } else {
          e.x -= Math.min(7, spd * 2.8);
          e.y += (e.ty - e.y) * 0.09;
        }
        break;
      case 'hover_spit':
        if (e.state === 0) {
          e.x -= spd * 1.6;
          if (e.x <= e.hx) { e.state = 1; e.timer = 0; }
        } else if (e.state === 1) {
          e.timer++;
          e.y = e.baseY + Math.sin(e.t * 0.05 + e.ph) * 12;
          e.fireT--;
          if (e.fireT <= 0 && e.x < W - 20) {
            volley(e, 1.7);
            sfx('fart', { volume: 0.6 });
            e.fireT = e.fireInt; e.spit = 18;
          }
          if (e.timer > 720) e.state = 2;
        } else {
          e.x -= spd * 1.6;
        }
        if (e.spit > 0) e.spit--;
        break;
      case 'bounce':
        e.x -= spd * 0.8; e.y += e.vy;
        if (e.y <= CEIL) { e.y = CEIL; e.vy = Math.abs(e.vy); }
        else if (e.y >= FLOOR - e.h) { e.y = FLOOR - e.h; e.vy = -Math.abs(e.vy); }
        break;
      case 'swoop':
        if (e.t < 40) { e.x -= spd * 1.3; }
        else {
          if (e.t < 125) {
            var want = Math.atan2((P.alive ? py : e.y) - (e.y + e.h / 2), (P.alive ? px : e.x - 100) - (e.x + e.w / 2));
            var da = want - e.ang;
            while (da > PI) da -= TAU;
            while (da < -PI) da += TAU;
            e.ang += clamp(da, -0.05, 0.05);
          }
          e.x += Math.cos(e.ang) * spd * 1.7; e.y += Math.sin(e.ang) * spd * 1.7;
        }
        break;
      case 'drift':
        e.x -= spd * 0.55 + Math.sin(e.t * 0.09 + e.ph) * 0.35;
        if (e.t % 45 === 0) e.tvy = rr(-1.1, 1.1);
        e.vy += (e.tvy - e.vy) * 0.06;
        e.y += e.vy;
        break;
      default: // 'straight'
        e.x -= spd;
    }
    if (e.y < CEIL) { e.y = CEIL; if (e.beh === 'drift') e.tvy = Math.abs(e.tvy); }
    else if (e.y > FLOOR - e.h) { e.y = FLOOR - e.h; if (e.beh === 'drift') e.tvy = -Math.abs(e.tvy); }
    // generic aimed shots for types that have `fire`
    if (e.fireInt > 0 && e.beh !== 'hover_spit' && e.beh !== 'charge') {
      e.fireT--;
      if (e.fireT <= 0 && e.x < W - 16 && e.x > 28) {
        volley(e, 1.5);
        e.fireT = e.fireInt + ri(-20, 20);
      }
    }
    if (e.x < -e.w - 40 || e.x > W + 260) e.on = false;
  }
}

function damageEnemy(e, d) {
  e.hp -= d; e.flash = 2;
  if (e.hp <= 0) killEnemy(e); else sfx('hit');
}
function killEnemy(e) {
  e.on = false;
  var cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  var big = e.maxhp >= 4 || e.h >= 22;
  explode(cx, cy, big);
  sfx(big ? 'enemy_die_big' : 'enemy_die');
  if (big) shake(3);
  combo++; comboT = 120;
  var mult = Math.min(8, 1 + Math.floor(combo / 3));
  var pts = e.score * mult;
  addScore(pts);
  popup(cx - 8, cy - 4, String(pts), mult > 1 ? '#ffe14a' : '#fff');
  if (e.def && e.def.hairy) tufts(cx, cy, big ? 5 : 3);
  var pu = powerupDrop(e.name);
  if (pu) spawnPU(pu, cx - 6, cy - 6);
}
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
function collectPU(p) {
  p.on = false;
  var n = p.name;
  if (n === 'pu_power') { if (P.powerLv < 3) { P.powerLv++; sfx('powerup'); } else { addScore(1000); sfx('powerup'); } }
  else if (n === 'pu_speed') { if (P.speedLv < 3) { P.speedLv++; sfx('powerup'); } else { addScore(1000); sfx('powerup'); } }
  else if (n === 'pu_shield') { if (!P.shield) { P.shield = true; sfx('shield_up'); } else { addScore(1000); sfx('powerup'); } }
  else if (n === 'pu_option') { if (P.opts < 2) { P.opts++; sfx('option_get'); } else { addScore(1000); sfx('powerup'); } }
  else { addScore(500); sfx('powerup'); }
  sparks(p.x + 6, p.y + 6, 8, 2, ['#ffffff', '#ffe14a']);
  popup(p.x - 4, p.y - 8, n === 'pu_power' ? 'POWER' : (n === 'pu_speed' ? 'SPEED' : (n === 'pu_shield' ? 'SHIELD' : (n === 'pu_option' ? 'OPTION' : 'BONUS'))), '#7dff7d');
}

function updateEBullets() {
  for (var i = 0; i < ebul.length; i++) {
    var b = ebul[i];
    if (!b.on) continue;
    b.t++; b.x += b.vx; b.y += b.vy;
    if (b.x < -14 || b.x > W + 14 || b.y < -14 || b.y > H + 6) b.on = false;
  }
}
function updateBullets() {
  for (var i = 0; i < bullets.length; i++) {
    var b = bullets[i];
    if (!b.on) continue;
    b.t++; b.x += b.vx; b.y += b.vy;
    if (b.x > W + 4 || b.x < -30 || b.y < CEIL - 6 || b.y > FLOOR + 4) b.on = false;
  }
}

/* ======================================================================
 * 7. BOSS
 * ====================================================================== */
function atkId(s) {
  s = String(s).toLowerCase();
  if (/swallow|lunge|gulp|dash/.test(s)) return 'swallow';
  if (/spawn|summon|minion|butt|launch/.test(s)) return 'spawn';
  if (/spit|hair|fire|shoot|spread|ball|burst|volley/.test(s)) return 'spread';
  return null;
}
var DEFAULT_PHASES = [
  { attacks: ['spread', 'spawn'], interval: 105 },
  { attacks: ['spread', 'spawn', 'swallow'], interval: 88 },
  { attacks: ['spread', 'spawn', 'swallow', 'swallow'], interval: 70 }
];
function buildPhases(cfg) {
  var raw = cfg && cfg.phases, out = [], i, k;
  if (raw && raw.length) {
    for (i = 0; i < raw.length; i++) {
      var r = raw[i] || {}, list = r.attacks || r.moves || r.patterns || r.pattern || r.attack || [];
      if (typeof list === 'string') list = [list];
      var ids = [];
      if (list && list.length) {
        for (k = 0; k < list.length; k++) {
          var a = typeof list[k] === 'string' ? list[k] : (list[k] && (list[k].type || list[k].name || list[k].id));
          var id = a ? atkId(a) : null;
          if (id && ids.indexOf(id) < 0) ids.push(id);
        }
      }
      var def = DEFAULT_PHASES[Math.min(i, DEFAULT_PHASES.length - 1)];
      var iv = typeof r.interval === 'number' ? r.interval : (typeof r.rate === 'number' ? r.rate : 0);
      iv = iv ? clamp(iv > 12 ? iv : iv * 60, 40, 400) : def.interval;
      // Levels format: hpAbove = this phase runs while hp fraction > hpAbove (so it begins where the previous one ends).
      var at = [r.at, r.hpBelow, r.threshold, r.hpPct, (typeof r.hp === 'number' && r.hp > 0 && r.hp <= 1) ? r.hp : undefined];
      var atv = NaN;
      for (k = 0; k < at.length; k++) if (typeof at[k] === 'number' && at[k] > 0 && at[k] <= 1) { atv = at[k]; break; }
      out.push({ attacks: ids.length ? ids : def.attacks.slice(), interval: iv, at: atv, above: typeof r.hpAbove === 'number' ? r.hpAbove : NaN });
    }
    var ok = true, allAbove = true;
    for (i = 0; i < out.length; i++) if (isNaN(out[i].above) || (i > 0 && out[i].above >= out[i - 1].above)) allAbove = false;
    if (allAbove) {
      for (i = 0; i < out.length; i++) out[i].at = i === 0 ? 1 : out[i - 1].above;
    } else {
      for (i = 0; i < out.length; i++) { if (isNaN(out[i].at) || (i > 0 && out[i].at >= out[i - 1].at)) ok = false; }
      for (i = 0; i < out.length; i++) { if (!ok) out[i].at = 1 - i / out.length; }
      if (ok && out[0].at < 1) out[0].at = 1;
    }
    var hasSw = false;
    for (i = 0; i < out.length; i++) if (out[i].attacks.indexOf('swallow') >= 0) hasSw = true;
    if (!hasSw) { out[out.length - 1].attacks.push('swallow'); if (out.length > 1) out[out.length - 2].attacks.push('swallow'); }
  } else {
    for (i = 0; i < DEFAULT_PHASES.length; i++) {
      out.push({ attacks: DEFAULT_PHASES[i].attacks.slice(), interval: DEFAULT_PHASES[i].interval, at: 1 - i / DEFAULT_PHASES.length });
    }
  }
  return out;
}
function bossStart() {
  var st = curStage(), cfg = st.boss || {};
  var nm = cfg.type || 'boss_butt';
  var d = etype(nm);
  B.on = true; B.name = nm; B.mode = 'enter'; B.t = 0; B.flash = 0; B.beamCd = 0; B.jx = 0;
  B.w = 96; B.h = 80;
  var z = sprSize('boss_butt'); B.w = z.w; B.h = z.h;
  B.maxhp = B.hp = Math.max(20, Math.ceil((cfg.hp || d.hp || 120) * (1 + 0.5 * loopN)));
  B.score = d.score || 5000;
  B.x = W + 16; B.y = 62; B.homeX = W - B.w - 22; B.phaseI = 0; B.lastAtk = ''; B.lastSwallow = tick;
  B.phases = buildPhases(cfg);
  phase = 'boss'; phaseT = 0;
  sfx('boss_roar'); shake(6);
  music('boss'); musicIntensity(1);
}
function bossFrac() { return B.hp / B.maxhp; }
function bossBodyRect() { return { x: B.x + 8, y: B.y + 6, w: B.w - 16, h: B.h - 12 }; }
function bossMouthX() { return B.x + 8; }
function bossMouthY() { return B.y + 46; }
function bossChoose() {
  var ph = B.phases[B.phaseI] || B.phases[0];
  var pool = [], i;
  for (i = 0; i < ph.attacks.length; i++) {
    var a = ph.attacks[i];
    if (a === 'swallow' && (tick - B.lastSwallow < 380 || !P.alive)) continue;
    if (a === B.lastAtk && ph.attacks.length > 2 && rng() < 0.7) continue;
    pool.push(a);
  }
  if (!pool.length) pool.push('spread');
  var pick = pool[ri(0, pool.length - 1)];
  B.lastAtk = pick;
  B.t = 0;
  if (pick === 'spread') { B.mode = 'spread'; B.sub = 0; B.subMax = 3 + B.phaseI; B.subT = 6; }
  else if (pick === 'spawn') { B.mode = 'spawn'; B.sub = 0; B.subMax = 2 + B.phaseI; B.subT = 10; }
  else { B.mode = 'tele'; B.t = 0; sfx('wave_warning'); B.lastSwallow = tick; }
}
function bossIdle() {
  var ph = B.phases[B.phaseI] || B.phases[0];
  B.mode = 'idle'; B.t = 0; B.atkT = ph.interval + ri(-12, 18);
}
function bossFollow(rate) {
  var ty = clamp(P.y + 8 - B.h / 2, CEIL + 2, FLOOR - B.h);
  if (!P.alive) ty = 62;
  B.y += (ty - B.y) * rate;
  B.y = clamp(B.y, CEIL + 2, FLOOR - B.h);
}
function updateBoss() {
  var b = B;
  b.t++;
  if (b.flash > 0) b.flash--;
  if (b.beamCd > 0) b.beamCd--;
  b.jx = 0;
  if (b.mode !== 'dying' && b.mode !== 'dead') {
    // phase by hp
    var f = bossFrac(), pi = 0, i;
    for (i = 0; i < b.phases.length; i++) if (f <= b.phases[i].at + 0.0001) pi = i;
    if (pi > b.phaseI) {
      b.phaseI = pi; sfx('boss_roar'); shake(7); b.flash = 6;
      if (b.mode === 'idle') b.atkT = Math.min(b.atkT, 40);
    }
  }
  switch (b.mode) {
    case 'enter':
      b.x -= 1.6; b.y = 62 + Math.sin(b.t * 0.05) * 8;
      if (b.x <= b.homeX) { b.x = b.homeX; bossIdle(); b.atkT = 70; }
      break;
    case 'idle':
      bossFollow(0.03);
      b.y += Math.sin(b.t * 0.07) * 0.5;
      b.atkT--;
      if (b.atkT <= 0) bossChoose();
      break;
    case 'spread':
      bossFollow(0.02);
      b.subT--;
      if (b.subT <= 0) {
        var n = 3 + b.phaseI, k;
        for (k = 0; k < n; k++) fireAt(bossMouthX(), bossMouthY(), 1.8, 1, (k - (n - 1) / 2) * 0.24);
        sfx('fart'); shake(2);
        b.sub++; b.subT = 22;
        if (b.sub >= b.subMax) { b.mode = 'spreadEnd'; b.t = 0; }
      }
      break;
    case 'spreadEnd':
      if (b.t > 20) bossIdle();
      break;
    case 'spawn':
      bossFollow(0.02);
      b.subT--;
      if (b.subT <= 0) {
        var e = spawnEnemy('butt_small', bossMouthX() - 12, bossMouthY() - 8 + rr(-14, 14));
        if (e) { e.beh = 'sine'; e.baseY = e.y; e.spd = 1.8; }
        sfx('fart');
        b.sub++; b.subT = 24;
        if (b.sub >= b.subMax) { b.mode = 'spreadEnd'; b.t = 0; }
      }
      break;
    case 'tele':
      if (b.t < 36) bossFollow(0.12);
      b.jx = (b.t & 2) ? 1 : -1;
      if (b.t >= 48) { b.mode = 'lunge'; b.t = 0; b.lungeSpd = 4; sfx('boss_roar', { volume: 0.8 }); }
      break;
    case 'lunge':
      b.lungeSpd = Math.min(10, b.lungeSpd + 0.35);
      b.x -= b.lungeSpd;
      shake(2);
      if (P.alive && P.inv <= 0 && !safeNow()) {
        var r = bossBodyRect();
        if (ov(P.x + 6, P.y + 3, 12, 10, r.x, r.y, r.w, r.h)) {
          if (hurtPlayer(true)) { b.mode = 'gulp'; b.t = 0; }
        }
      }
      if (b.x < -b.w - 6 && b.mode === 'lunge') { b.mode = 'return'; b.t = 0; b.x = W + 12; }
      break;
    case 'gulp':
      if (b.t > 70) { b.mode = 'return'; b.t = 0; }
      break;
    case 'return':
      if (b.x < -b.w) b.x = W + 12;
      var dir = b.homeX > b.x ? 1 : -1;
      b.x += dir * 3;
      bossFollow(0.04);
      if ((dir > 0 && b.x >= b.homeX) || (dir < 0 && b.x <= b.homeX)) { b.x = b.homeX; bossIdle(); }
      break;
    case 'dying':
      b.deadT++;
      shake(3);
      if (b.deadT % 5 === 0) {
        explode(b.x + rr(8, b.w - 8), b.y + rr(8, b.h - 8), rng() < 0.5);
        sfx('enemy_die');
      }
      if (b.deadT >= 150) bossFinish();
      break;
  }
}
function damageBoss(d) {
  if (B.mode === 'dying' || B.mode === 'dead' || B.x >= W - 10) return;
  B.hp -= d; B.flash = 2;
  addScore(10);
  if (B.hp <= 0) {
    B.hp = 0; B.mode = 'dying'; B.deadT = 0;
    sfx('boss_die'); musicStop(); shake(10);
    for (var i = 0; i < ebul.length; i++) ebul[i].on = false;
    for (var j = 0; j < enemies.length; j++) if (enemies[j].on) killEnemy(enemies[j]);
  } else sfx('boss_hit');
}
function bossFinish() {
  B.on = false; B.mode = 'dead';
  var cx = B.x + B.w / 2, cy = B.y + B.h / 2;
  for (var i = 0; i < 6; i++) explode(cx + rr(-30, 30), cy + rr(-24, 24), true);
  flashWhite = 24; shake(12);
  addScore(B.score);
  clearBonus = 5000 * (stageIdx + 1) + Math.max(0, lives) * 1000;
  addScore(clearBonus);
  phase = 'clear'; phaseT = 0;
  sfx('powerup');
}

/* ======================================================================
 * 8. STAGE FLOW
 * ====================================================================== */
function clearPools() {
  var i;
  for (i = 0; i < bullets.length; i++) bullets[i].on = false;
  for (i = 0; i < ebul.length; i++) ebul[i].on = false;
  for (i = 0; i < enemies.length; i++) enemies[i].on = false;
  for (i = 0; i < powerups.length; i++) powerups[i].on = false;
  for (i = 0; i < spawnQ.length; i++) spawnQ[i].on = false;
  for (i = 0; i < popups.length; i++) popups[i].on = false;
  for (i = 0; i < parts.length; i++) parts[i].on = false;
  B.on = false; B.mode = 'dead';
}
function beginStage() {
  stageObj = curStage();
  stageName = cleanText(stageObj.name || 'UNKNOWN SECTOR');
  stageT = 0; phase = 'intro'; phaseT = 0;
  loopN = Math.floor(stageIdx / stageCount());
  rebuildSky();
  music(stageObj.music || 'stage');
  musicIntensity(0.3);
}
function startGame() {
  clearPools();
  score = 0; scoreStr = pad(0, 7); lives = 3; nextExtra = 50000; combo = 0; comboT = 0; stageIdx = 0; loopN = 0;
  P.powerLv = 0; P.speedLv = 0; P.opts = 0; P.shield = false; P.fireCd = 0;
  respawnPlayer(); P.inv = 90;
  bannerT = 0; shakeAmt = 0; flashWhite = 0; newHi = false; paused = false;
  mode = 'playing';
  beginStage();
  sfx('menu_select');
}
function nextStage() {
  stageIdx++;
  var keepShield = P.shield;
  clearPools();
  P.shield = keepShield;
  beginStage();
}
function updateFlow() {
  switch (phase) {
    case 'intro':
      if (phaseT >= 150) { phase = 'stage'; phaseT = 0; stageT = 0; }
      break;
    case 'stage':
      var prev = stageT;
      stageT += 1 / 60;
      var ws = getWaves(prev, stageT);
      for (var i = 0; i < ws.length; i++) if (ws[i]) queueWave(ws[i]);
      var len = (stageObj && stageObj.length) || 60;
      if (stageT >= len) { phase = 'warn'; phaseT = 0; sfx('wave_warning'); musicIntensity(0.8); }
      break;
    case 'warn':
      if (phaseT === 90) sfx('wave_warning');
      if (phaseT === 150) sfx('boss_roar');
      if (phaseT >= 180) bossStart();
      break;
    case 'clear':
      if (phaseT >= 330) nextStage();
      break;
  }
  updateSpawnQ();
}

/* ======================================================================
 * 9. COLLISIONS
 * ====================================================================== */
function collide() {
  var i, j, b, e;
  var hbx = P.x + 8, hby = P.y + 5;  // player hit box 8x6 (forgiving)
  var br = B.on ? bossBodyRect() : null;
  var bossHit = B.on && B.mode !== 'dying' && B.mode !== 'dead';
  // player bullets vs enemies / boss
  for (i = 0; i < bullets.length; i++) {
    b = bullets[i];
    if (!b.on) continue;
    if (!b.beam) {
      var hit = false;
      for (j = 0; j < enemies.length; j++) {
        e = enemies[j];
        if (!e.on || e.x >= W) continue;
        if (ov(b.x, b.y, b.w, b.h, e.x + 1, e.y + 1, e.w - 2, e.h - 2)) {
          b.on = false; hit = true;
          sparks(b.x + 8, b.y + 1, 3, 1.6, ['#ffe14a', '#fff']);
          damageEnemy(e, b.dmg);
          break;
        }
      }
      if (!hit && bossHit && ov(b.x, b.y, b.w, b.h, br.x, br.y, br.w, br.h)) {
        b.on = false;
        sparks(b.x + 8, b.y + 1, 3, 1.6, ['#ffe14a', '#fff']);
        damageBoss(b.dmg);
      }
    } else {
      for (j = 0; j < enemies.length; j++) {
        e = enemies[j];
        if (!e.on || e.x >= W || e.beamCd > 0) continue;
        if (ov(b.x, b.y, b.w, b.h, e.x, e.y, e.w, e.h)) { e.beamCd = 6; damageEnemy(e, b.dmg); }
      }
      if (bossHit && B.beamCd <= 0 && ov(b.x, b.y, b.w, b.h, br.x, br.y, br.w, br.h)) { B.beamCd = 6; damageBoss(b.dmg); }
      for (j = 0; j < ebul.length; j++) {
        var q = ebul[j];
        if (q.on && ov(b.x, b.y, b.w, b.h, q.x, q.y, q.w, q.h)) { q.on = false; sparks(q.x + 3, q.y + 3, 3, 1.5, ['#ff5fa2', '#fff']); }
      }
    }
  }
  if (!P.alive) return;
  // powerups
  for (i = 0; i < powerups.length; i++) {
    var p = powerups[i];
    if (p.on && ov(P.x + 2, P.y + 2, 20, 12, p.x, p.y, 12, 12)) collectPU(p);
  }
  // enemy bullets vs player
  for (i = 0; i < ebul.length; i++) {
    var eb = ebul[i];
    if (!eb.on) continue;
    var ins = eb.kind ? 2 : 1;
    if (ov(hbx, hby, 8, 6, eb.x + ins, eb.y + ins, eb.w - ins * 2, eb.h - ins * 2)) {
      eb.on = false;
      hurtPlayer(false);
      if (!P.alive) return;
    }
  }
  // enemies vs player
  for (i = 0; i < enemies.length; i++) {
    e = enemies[i];
    if (!e.on || e.x >= W) continue;
    if (ov(hbx, hby, 8, 6, e.x + 3, e.y + 3, e.w - 6, e.h - 6)) {
      if (hurtPlayer(false)) damageEnemy(e, 3);
      if (!P.alive) return;
    }
  }
  // boss body (non-lunge contact = normal hit; lunge handled in updateBoss)
  if (bossHit && B.mode !== 'lunge' && B.mode !== 'gulp' && ov(hbx, hby, 8, 6, br.x, br.y, br.w, br.h)) {
    hurtPlayer(false);
  }
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
  if (!quiet) sfx('pause');
  if (v) { stopCharge(); musicStop(); }
  else { if (firing) chargeT = 0; if (curTrack) music(curTrack); }
}
function toggleMute() {
  try { if (window.SFX && window.SFX.setMuted) window.SFX.setMuted(!window.SFX.muted); } catch (e) { /* silent */ }
}
function onDown(e) {
  firstGesture();
  if (e.cancelable) e.preventDefault();
  try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  var rect = canvas.getBoundingClientRect();
  var lx = (e.clientX - rect.left) * W / rect.width, ly = (e.clientY - rect.top) * H / rect.height;
  if (mode === 'title') { startGame(); }
  else if (mode === 'gameover') { if (gameoverT > 50) startGame(); return; }
  else if (paused) { setPause(false); return; }
  else if (ly < 14 && lx >= W - 16) { setPause(true); return; }
  else if (ly < 14 && lx >= W - 30 && lx < W - 16) { toggleMute(); return; }
  var zone = (e.clientX / Math.max(1, window.innerWidth)) < 0.6 ? 0 : 1;
  ptrs[e.pointerId] = { zone: zone, x: e.clientX, y: e.clientY };
  if (zone === 1) { touchFire++; recomputeFiring(); }
}
function onMove(e) {
  var p = ptrs[e.pointerId];
  if (!p) return;
  if (e.cancelable) e.preventDefault();
  if (p.zone === 0) {
    var k = (W / cssW) * 1.3 * (1 + 0.1 * P.speedLv);
    dragX += (e.clientX - p.x) * k;
    dragY += (e.clientY - p.y) * k;
  }
  p.x = e.clientX; p.y = e.clientY;
}
function onUp(e) {
  var p = ptrs[e.pointerId];
  if (p) {
    delete ptrs[e.pointerId];
    if (p.zone === 1) { touchFire = Math.max(0, touchFire - 1); recomputeFiring(); }
  }
  tryFullscreen();
}
function releaseAllInput() {
  keys.left = keys.right = keys.up = keys.down = false;
  keyFire = false; touchFire = 0; ptrs = {};
  recomputeFiring();
}
function onKeyDown(e) {
  firstGesture();
  var c = e.code, used = true;
  if (mode === 'title') {
    if (c === 'KeyM') { toggleMute(); return; }
    if (c === 'F5' || c === 'F11' || c === 'F12' || e.metaKey || e.altKey) return;
    startGame(); tryFullscreen();
    if (e.cancelable) e.preventDefault();
    return;
  }
  if (mode === 'gameover') {
    if (c === 'KeyM') { toggleMute(); return; }
    if (gameoverT > 50 && (c === 'Space' || c === 'Enter' || c === 'KeyZ' || c === 'KeyX')) startGame();
    return;
  }
  switch (c) {
    case 'ArrowLeft': case 'KeyA': keys.left = true; break;
    case 'ArrowRight': case 'KeyD': keys.right = true; break;
    case 'ArrowUp': case 'KeyW': keys.up = true; break;
    case 'ArrowDown': case 'KeyS': keys.down = true; break;
    case 'KeyZ': case 'Space': case 'ControlLeft': case 'ControlRight':
      if (!paused && !e.repeat) { keyFire = true; recomputeFiring(); }
      break;
    case 'KeyX':
      if (!paused && !e.repeat && P.alive && xCool <= 0) { fireCharged(); xCool = 50; }
      break;
    case 'KeyP': case 'Escape': if (!e.repeat) setPause(!paused); break;
    case 'KeyM': if (!e.repeat) toggleMute(); break;
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
  }
  tryFullscreen();
}
function bindInput() {
  var opt = { passive: false };
  wrap.addEventListener('pointerdown', onDown, opt);
  wrap.addEventListener('pointermove', onMove, opt);
  wrap.addEventListener('pointerup', onUp, opt);
  wrap.addEventListener('pointercancel', onUp, opt);
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
  // Measure the wrapper (it carries the phone safe-area padding), not the raw window.
  var wrapEl = canvas.parentElement;
  var iw = (wrapEl && wrapEl.clientWidth) || window.innerWidth || W;
  var ih = (wrapEl && wrapEl.clientHeight) || window.innerHeight || H;
  var s = Math.min(iw / W, ih / H);
  var si = Math.floor(s);
  // Integer scale keeps pixels crisp, but on phones it can leave half the screen black.
  // Use the integer scale only when it fills at least 85% of the available fit; otherwise fill the screen.
  scale = (si >= 1 && si >= s * 0.85) ? si : s;
  cssW = W * scale; cssH = H * scale;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  if (ih > iw && mode === 'playing' && !paused) setPause(true, true);
}

/* ======================================================================
 * 13. RENDERING
 * ====================================================================== */
var SKY_STEPS = 32, skyLUT = null, skyStops = null;
var skyTop = [10, 6, 34], skyBot = [104, 30, 86], skyBar = [255, 122, 64];
var scrollFar = 0, scrollMid = 0, scrollNear = 0, sFar = 0.25, sMid = 0.6, sNear = 1.6;
var stars = [], critters = [];
var scanCanvas = null, vigCanvas = null;
var strips = {};

function parseCol(s) {
  if (typeof s !== 'string') return null;
  var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (m) {
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s.trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function bgSpeed(v, def) { return (typeof v === 'number' && v >= 0) ? (v > 6 ? v / 60 : v) : def; }
function rebuildSky() {
  var bg = stageObj && stageObj.bg, pal = bg && bg.palette, cols = [], i;
  // palette may be an array of colors, or { sky: [colors top->bottom], far, fog }
  var plist = pal && pal.sky && pal.sky.length ? pal.sky : pal;
  if (plist && plist.length) for (i = 0; i < plist.length; i++) { var c = parseCol(plist[i]); if (c) cols.push(c); }
  var top = skyTop, bot = skyBot, bar = skyBar;
  skyStops = null;
  if (cols.length >= 2) {
    top = cols[0]; bot = cols[cols.length - 1];
    bar = [Math.min(255, bot[0] + 100), Math.min(255, bot[1] + 70), Math.min(255, bot[2] + 40)];
    if (cols.length > 2) skyStops = cols;
  }
  sFar = bgSpeed(bg && bg.speedFar, 0.25); sMid = bgSpeed(bg && bg.speedMid, 0.6); sNear = bgSpeed(bg && bg.speedNear, 1.6);
  skyLUT = new Array(SKY_STEPS);
  for (var s = 0; s < SKY_STEPS; s++) {
    var ph = s / SKY_STEPS * TAU, rows = new Array(H + 8);
    for (var yi = 0; yi < H + 8; yi++) {
      var y = yi - 4, t = clamp(y / H, 0, 1);
      var v = Math.sin(y * 0.16 + ph) * 0.5 + 0.5, v2 = Math.sin(y * 0.045 - ph) * 0.5 + 0.5;
      var q = Math.floor(v * 4) / 4 * (0.10 + 0.20 * t) + Math.floor(v2 * 3) / 3 * 0.05;
      var r, g, bl;
      if (skyStops) {
        var fpos = t * (skyStops.length - 1), i0 = Math.min(skyStops.length - 2, Math.floor(fpos)), ft = fpos - i0;
        var ca = skyStops[i0], cb = skyStops[i0 + 1];
        r = ca[0] + (cb[0] - ca[0]) * ft; g = ca[1] + (cb[1] - ca[1]) * ft; bl = ca[2] + (cb[2] - ca[2]) * ft;
      } else {
        r = top[0] + (bot[0] - top[0]) * t; g = top[1] + (bot[1] - top[1]) * t; bl = top[2] + (bot[2] - top[2]) * t;
      }
      r += (bar[0] - r) * q; g += (bar[1] - g) * q; bl += (bar[2] - bl) * q;
      rows[yi] = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (bl | 0) + ')';
    }
    skyLUT[s] = rows;
  }
}
function getStrip(name) {
  var st = strips[name];
  if (st !== undefined) return st;
  st = null;
  if (hasSpr(name)) {
    try {
      var z = sprSize(name), tiles = Math.ceil((W + 8 + z.w) / z.w) + 1;
      var c = document.createElement('canvas');
      c.width = z.w * tiles; c.height = z.h;
      var g = c.getContext('2d');
      var src = window.Sprites.get(name, 0);
      for (var i = 0; i < tiles; i++) g.drawImage(src, i * z.w, 0);
      st = { c: c, w: z.w, h: z.h };
    } catch (e) { st = null; }
  }
  strips[name] = st;
  return st;
}
function drawStrip(st, scroll, y) {
  var off = ((Math.floor(scroll) % st.w) + st.w) % st.w;
  ctx.drawImage(st.c, off, 0, W + 8, st.h, -4, y, W + 8, st.h);
}
function initStars() {
  stars = [];
  for (var i = 0; i < 90; i++) stars.push({ x: rng() * W, y: CEIL + 2 + rng() * 130, l: i % 3, k: i });
  critters = [];
  var names = ['butt_small', 'alien_eye', 'butt_mid', 'alien_squid', 'butt_charger', 'butt_spitter'];
  for (var j = 0; j < names.length; j++) {
    critters.push({ n: names[j], x: rng() * W, y: 90 + rng() * 80, v: 0.4 + rng() * 0.8, ph: rng() * TAU });
  }
}
function makeOverlays() {
  scanCanvas = document.createElement('canvas'); scanCanvas.width = W; scanCanvas.height = H;
  var g = scanCanvas.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (var y = 1; y < H; y += 2) g.fillRect(0, y, W, 1);
  vigCanvas = document.createElement('canvas'); vigCanvas.width = W; vigCanvas.height = H;
  var v = vigCanvas.getContext('2d');
  var gr = v.createRadialGradient(W / 2, H / 2, 70, W / 2, H / 2, 240);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
  v.fillStyle = gr; v.fillRect(0, 0, W, H);
}
function updateBG() {
  scrollFar += sFar; scrollMid += sMid; scrollNear += sNear;
  for (var i = 0; i < stars.length; i++) {
    var s = stars[i];
    s.x -= s.l === 0 ? 0.12 : (s.l === 1 ? 0.35 : 0.8);
    if (s.x < 0) { s.x += W; s.y = CEIL + 2 + rng() * 130; }
  }
}
var STAR_COL = ['#56649c', '#9aa8d8', '#ffffff'];
function drawBackdrop() {
  var i, y;
  // copper-bar sky: 1px scanlines from a pre-built per-phase LUT
  if (!skyLUT) rebuildSky();
  var rows = skyLUT[((tick >> 2) % SKY_STEPS)];
  for (y = -4; y < H + 4; y++) { ctx.fillStyle = rows[y + 4]; ctx.fillRect(-4, y, W + 8, 1); }
  // stars (3 parallax speeds, twinkling) - drawn right over the sky, behind the far layer
  for (i = 0; i < stars.length; i++) {
    var s = stars[i];
    ctx.fillStyle = ((tick >> 4) + s.k) % 9 === 0 ? '#2c3460' : STAR_COL[s.l];
    ctx.fillRect(s.x | 0, s.y | 0, s.l === 2 ? 2 : 1, 1);
  }
  // far layer with per-scanline sine "heat wave"
  var far = getStrip('bg_far'), T = tick / 60, y0 = 176 - 60 + 10;
  if (far) {
    var base = Math.floor(scrollFar);
    for (i = 0; i < far.h; i++) {
      var dx = Math.round(Math.sin((y0 + i) * 0.15 + T * 3) * 2);
      var off = (((base + dx) % far.w) + far.w) % far.w;
      ctx.drawImage(far.c, off, i, W + 8, 1, -4, y0 + i, W + 8, 1);
    }
  } else {
    ctx.fillStyle = '#10183c'; ctx.fillRect(-4, y0 + 24, W + 8, 40);
  }
  // ceiling
  var ce = getStrip('bg_ceiling');
  if (ce) drawStrip(ce, scrollMid, 0); else { ctx.fillStyle = '#4a1f44'; ctx.fillRect(-4, 0, W + 8, 20); }
  ctx.fillStyle = '#3a1636'; ctx.fillRect(-4, -4, W + 8, 4);
  // ground
  var gr = getStrip('bg_rocks');
  if (gr) drawStrip(gr, scrollNear, H - gr.h); else { ctx.fillStyle = '#3a2030'; ctx.fillRect(-4, H - 40, W + 8, 40); }
  ctx.fillStyle = '#1c1020'; ctx.fillRect(-4, H, W + 8, 4);
}

function enemyFrame(e) {
  var nf = sprFrames(e.spr), f;
  if (e.beh === 'charge') f = e.state;
  else if (e.beh === 'hover_spit') f = e.spit > 0 ? 2 + ((e.spit >> 3) & 1) : ((e.t >> 4) & 1);
  else f = (e.t >> 3) % nf;
  return f >= nf ? nf - 1 : f;
}
function bossSprite() { return (B.hp / B.maxhp < 0.3 && hasSpr('boss_butt_dmg')) ? 'boss_butt_dmg' : 'boss_butt'; }
function bossFrame() {
  switch (B.mode) {
    case 'spread': case 'spawn': return 1 + ((B.t >> 3) & 1);
    case 'tele': return 2;
    case 'lunge': case 'gulp': return 3;
    case 'dying': return (B.deadT >> 2) & 3;
    default: return (B.t >> 5) & 1 ? 1 : 0;
  }
}

function drawWorld() {
  var i, e, b, p, f;
  // ---- shadows ----
  if (P.alive) {
    shadow('player', 0, P.x, P.y);
    for (i = 0; i < P.opts; i++) shadow('option', 0, P.ox[i], P.oy[i]);
  }
  for (i = 0; i < enemies.length; i++) {
    e = enemies[i];
    if (e.on && e.x < W) shadow(e.spr, 0, e.x + (e.w - e.sw) / 2, e.y + (e.h - e.sh) / 2);
  }
  for (i = 0; i < powerups.length; i++) { p = powerups[i]; if (p.on) shadow(p.name, 0, p.x, p.y); }
  for (i = 0; i < ebul.length; i++) { b = ebul[i]; if (b.on && b.kind) shadow('hair_ball', 0, b.x, b.y); }
  if (B.on) shadow('boss_butt', 0, B.x + B.jx, B.y);

  // ---- powerups, enemies, boss ----
  for (i = 0; i < powerups.length; i++) {
    p = powerups[i];
    if (p.on) S(p.name, p.x, p.y, (p.t >> 4) & 1, false, false);
  }
  for (i = 0; i < enemies.length; i++) {
    e = enemies[i];
    if (e.on) S(e.spr, e.x + (e.w - e.sw) / 2, e.y + (e.h - e.sh) / 2, enemyFrame(e), false, e.flash > 0);
  }
  if (B.on) {
    var flashing = B.flash > 0 || (B.mode === 'dying' && ((B.deadT >> 2) & 1));
    S(bossSprite(), B.x + B.jx, B.y, bossFrame(), false, flashing);
  }
  // ---- enemy bullets ----
  for (i = 0; i < ebul.length; i++) {
    b = ebul[i];
    if (!b.on) continue;
    if (b.kind) S('hair_ball', b.x, b.y, (b.t >> 2) & 1, false, false);
    else S('enemy_bullet', b.x, b.y, (b.t >> 2) & 1, false, false);
  }
  // ---- player bullets / beams ----
  for (i = 0; i < bullets.length; i++) {
    b = bullets[i];
    if (!b.on) continue;
    if (b.beam) SS('bullet_charged', b.x, b.y, (b.t >> 2) & 1, 24, 12);
    else S('bullet', b.x, b.y, 0, false, false);
  }
  // ---- player ----
  if (P.alive) {
    var show = !(P.inv > 0 && ((tick >> 2) & 1));
    if (show) {
      S('thruster', P.x - 8, P.y + 4, (tick >> 1) & 3, false, false);
      f = P.bank > 0 ? 1 : (P.bank < 0 ? 2 : 0);
      S('player', P.x, P.y, f, false, P.flash > 0);
      for (i = 0; i < P.opts; i++) S('option', P.ox[i], P.oy[i], (tick >> 2) & 3, false, false);
      if (P.shield) {
        if (!(P.inv > 0 && ((tick >> 1) & 1))) S('shield', P.x - 4, P.y - 4, (tick >> 3) & 1, false, false);
      }
    }
    // charge indicator
    if (firing && chargeT >= CHARGE_START) {
      var cf = Math.min(1, (chargeT - CHARGE_START) / (CHARGE_FULL - CHARGE_START));
      var rs = 1 + Math.round(cf * 5), full = chargeT >= CHARGE_FULL;
      ctx.fillStyle = full ? (((tick >> 1) & 1) ? '#ffffff' : '#7fe0ff') : '#3a8cff';
      ctx.fillRect(Math.round(P.x + 24 - rs / 2), Math.round(P.y + 8 - rs / 2), rs, rs);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(P.x, P.y + 19, 24, 3);
      ctx.fillStyle = full ? '#7fe0ff' : '#3a8cff'; ctx.fillRect(P.x + 1, P.y + 20, Math.round(22 * Math.min(1, chargeT / CHARGE_FULL)), 1);
    }
  }
  // ---- particles ----
  for (i = 0; i < parts.length; i++) {
    p = parts[i];
    if (!p.on) continue;
    if (p.kind === 0) {
      if (p.life < 8) ctx.globalAlpha = p.life / 8;
      ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
      ctx.globalAlpha = 1;
    } else if (p.kind === 1) {
      f = Math.min(p.nf - 1, Math.floor((1 - p.life / p.max) * p.nf));
      S(p.spr, p.x, p.y, f, false, false);
    } else {
      if (p.life < 10) ctx.globalAlpha = p.life / 10;
      S(p.spr, p.x, p.y, ((p.life >> 3) + i) % p.nf, false, false);
      ctx.globalAlpha = 1;
    }
  }
  for (i = 0; i < popups.length; i++) {
    p = popups[i];
    if (!p.on) continue;
    if (p.life < 10) ctx.globalAlpha = p.life / 10;
    TS(p.str, p.x, p.y, p.c, 1);
    ctx.globalAlpha = 1;
  }
}

function drawTitleScene() {
  var i, c;
  for (i = 0; i < critters.length; i++) {
    c = critters[i];
    var cy = c.y + Math.sin(titleT * 0.04 + c.ph) * 10;
    shadow(c.n, 0, c.x, cy);
  }
  for (i = 0; i < critters.length; i++) {
    c = critters[i];
    S(c.n, c.x, c.y + Math.sin(titleT * 0.04 + c.ph) * 10, (titleT >> 3) % sprFrames(c.n), false, false);
  }
}

function drawHUD() {
  var i;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, 13);
  TS('SCORE ' + scoreStr, 4, 3, '#ffffff', 1);
  var hs = 'HI ' + hiStr;
  TS(hs, Math.round((W - TW(hs, 1)) / 2), 3, '#ffe14a', 1);
  var n = Math.min(lives, 6);
  for (i = 0; i < n; i++) SS('player', W - 38 - i * 13, 3, 0, 12, 8);
  // pause + mute buttons
  ctx.fillStyle = '#ffffff'; ctx.fillRect(W - 12, 3, 2, 7); ctx.fillRect(W - 8, 3, 2, 7);
  var muted = false; try { muted = !!(window.SFX && window.SFX.muted); } catch (e) { muted = false; }
  T('M', W - 26, 3, muted ? '#ff5050' : '#aaaaaa', 1);
  // combo
  if (combo >= 2 && comboT > 0) {
    var mult = Math.min(8, 1 + Math.floor(combo / 3));
    var cs = 'COMBO ' + combo + ' X' + mult;
    TS(cs, 4, 15, (tick >> 2) & 1 ? '#ffe14a' : '#ff9a2a', 1);
    ctx.fillStyle = '#ffe14a'; ctx.fillRect(4, 24, Math.round(comboT / 120 * 44), 1);
  }
  // boss bar
  if (B.on) {
    var fr = Math.max(0, B.hp / B.maxhp);
    ctx.fillStyle = '#000'; ctx.fillRect(91, 15, 202, 7);
    ctx.fillStyle = '#5a1020'; ctx.fillRect(92, 16, 200, 5);
    ctx.fillStyle = B.flash > 0 ? '#ffffff' : (fr < 0.3 ? '#ff9a2a' : '#ff3a3a');
    ctx.fillRect(92, 16, Math.round(200 * fr), 5);
    TS('BOSS', 62, 15, '#ff5fa2', 1);
  }
}
function drawBanners() {
  var a;
  if (phase === 'intro') {
    a = Math.min(1, phaseT / 20, (150 - phaseT) / 20);
    if (a > 0) {
      ctx.globalAlpha = a;
      var st = 'STAGE ' + (stageIdx + 1) + ' - ' + stageName;
      TC(st, 78, '#ffe14a', 2);
      if (loopN > 0) TC('LOOP ' + (loopN + 1) + ' - THEY ARE HAIRIER NOW', 102, '#ff5fa2', 1);
      else TC('GET READY', 102, '#ffffff', 1);
      ctx.globalAlpha = 1;
    }
  } else if (phase === 'warn') {
    if (((phaseT >> 3) & 1) === 0) {
      TC('WARNING!', 80, '#ff3a3a', 3);
      TC('AN ENORMOUS BUTT APPROACHES', 112, '#ffffff', 1);
    }
  } else if (phase === 'clear') {
    TC('STAGE CLEAR', 76, '#7dff7d', 3);
    TC('BONUS ' + clearBonus, 108, '#ffe14a', 2);
    if (phaseT > 200) TC('GET READY', 134, '#ffffff', 1);
  }
  if (bannerT > 0) {
    var jx = bannerT > 80 ? (tick & 1 ? 2 : -2) : 0;
    var w3 = TW(bannerStr, 3);
    var x = Math.round((W - w3) / 2) + jx;
    if (bannerT < 20) ctx.globalAlpha = bannerT / 20;
    TS(bannerStr, x, 92, '#ff3a3a', 3);
    ctx.globalAlpha = 1;
  }
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  var sx = 0, sy = 0;
  if (shakeAmt > 0 && !paused) { sx = Math.round((rng() - 0.5) * 2 * shakeAmt); sy = Math.round((rng() - 0.5) * 2 * shakeAmt); }
  ctx.setTransform(1, 0, 0, 1, sx, sy);
  drawBackdrop();
  if (mode === 'title') drawTitleScene(); else drawWorld();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (flashWhite > 0) { ctx.globalAlpha = Math.min(0.85, flashWhite / 24); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  // red strobe on boss approach
  if (mode === 'playing' && (phase === 'warn' || (B.on && B.mode === 'enter'))) {
    ctx.fillStyle = ((tick >> 2) & 1) ? 'rgba(255,0,0,0.30)' : 'rgba(255,0,0,0.08)';
    ctx.fillRect(0, 0, W, H);
  }
  if (mode === 'title') drawTitleUI();
  else {
    drawHUD();
    drawBanners();
    if (mode === 'gameover') drawGameOverUI();
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
      TC('PAUSED', 86, '#ffffff', 3);
      if ((tick >> 5) & 1) TC('TAP TO RESUME', 122, '#ffe14a', 1);
    }
  }
  // scanlines, then vignette
  if (scanCanvas) ctx.drawImage(scanCanvas, 0, 0);
  if (vigCanvas) { ctx.globalAlpha = 0.35; ctx.drawImage(vigCanvas, 0, 0); ctx.globalAlpha = 1; }
}

function drawTitleUI() {
  var ly = 34 + Math.round(Math.abs(Math.sin(titleT * 0.045)) * -10 + 10);
  if (hasSpr('logo')) S('logo', (W - 160) / 2, ly, 0, false, false);
  else TC('AASSSMASTER', ly + 10, '#ff5fa2', 3);
  TC('HI-SCORE ' + hiStr, 90, '#ffe14a', 1);
  TC('TAP TO START', 112, ((titleT >> 4) & 1) ? '#ffffff' : '#ff5fa2', 2);
  TC('DRAG LEFT: MOVE - HOLD RIGHT: FIRE - RELEASE AFTER 0.6S: BEAM', 190, '#cfd6ff', 1);
  TC('KEYS: ARROWS MOVE - Z FIRE - X BEAM - P PAUSE - M MUTE', 200, '#8a93c8', 1);
}
function drawGameOverUI() {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 50, W, 110);
  TC('GAME OVER', 58, '#ff3a3a', 3);
  TC('SCORE ' + scoreStr, 92, '#ffffff', 2);
  TC('HI-SCORE ' + hiStr, 114, '#ffe14a', 1);
  if (newHi && ((tick >> 3) & 1)) TC('NEW HI-SCORE!', 128, '#7dff7d', 1);
  if (gameoverT > 50 && ((gameoverT >> 4) & 1)) TC('TAP TO RESTART', 144, '#ffffff', 1);
}

/* ======================================================================
 * 14. MAIN LOOP + INIT + EXPORT
 * ====================================================================== */
function update() {
  tick++;
  updateBG();
  if (mode === 'title') { titleT++; for (var i = 0; i < critters.length; i++) { var c = critters[i]; c.x -= c.v; if (c.x < -30) { c.x = W + 20; c.y = 90 + rng() * 80; } } return; }
  if (mode === 'gameover') { gameoverT++; updateFX(); return; }
  phaseT++;
  updatePlayer();
  updateFlow();
  updateBullets();
  updateEnemies();
  if (B.on) updateBoss();
  updateEBullets();
  updatePowerups();
  collide();
  updateFX();
  if (comboT > 0) { comboT--; if (comboT === 0) combo = 0; }
  if (bannerT > 0) bannerT--;
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
  if (!paused) {
    acc += dt;
    var n = 0;
    while (acc >= STEP && n < 8) { update(); acc -= STEP; n++; }
    if (n >= 8) acc = 0;
  } else { acc = 0; tick++; }
  render();
}

function init(cv) {
  if (inited) return;
  inited = true;
  canvas = cv || document.getElementById('game');
  wrap = canvas.parentNode || document.body;
  canvas.width = W; canvas.height = H;
  ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  hiScore = storedHi = loadHi(); hiStr = pad(hiScore, 7); scoreStr = pad(0, 7);
  P.alive = false; B.on = false; B.mode = 'dead';
  initStars();
  makeOverlays();
  stageObj = curStage();
  rebuildSky();
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
    return {
      state: mode, phase: phase, paused: paused, tick: tick, score: score, hi: hiScore, lives: lives,
      stage: stageIdx + 1, stageT: stageT, combo: combo, alive: P.alive, power: P.powerLv, speed: P.speedLv,
      options: P.opts, shield: P.shield, boss: B.on ? { hp: B.hp, max: B.maxhp, mode: B.mode } : null,
      enemies: enemies.filter(function (e) { return e.on; }).length, scale: scale
    };
  },
  start: function () { if (mode !== 'playing') startGame(); },
  pause: function (v) { setPause(!!v, true); },
  skipToBoss: function () { if (mode === 'playing' && stageObj) { phase = 'stage'; stageT = ((stageObj.length) || 60) - 0.05; phaseT = 0; } },
  kill: function () { if (mode === 'playing' && P.alive) { P.inv = 0; killPlayer(false); } },
  give: function (power, opts, shield) { P.powerLv = power | 0; P.opts = Math.min(2, opts | 0); P.shield = !!shield; },
  damageBoss: function (d) { if (B.on) damageBoss(d || 10); },
  debug: { P: P, B: B, enemies: enemies, bullets: bullets, ebul: ebul }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { init(document.getElementById('game')); });
} else {
  init(document.getElementById('game'));
}
})();
