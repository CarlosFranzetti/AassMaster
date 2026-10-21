/* ======================================================================
 * aasssMaster v2 - js/render.js  (global `GameRender`)
 * Everything that touches the canvas: sprite/text adapters, backdrop +
 * raster FX, world, HUD, banners, title/continue/game-over screens.
 * Only talks to `Sprites`. game.js owns the state and hands it over as
 * the `view` object each frame (GameRender.draw(view)).
 * ====================================================================== */
(function () {
'use strict';

var W = 384, H = 216, FLOOR = 196, CEIL = 20, TAU = Math.PI * 2;
var canvas = null, ctx = null;

/* ---------------------------------------------------------------- fx RNG */
var fxSeed = 0x2f6e2b1;
function rf() {
  fxSeed = (fxSeed + 0x6D2B79F5) | 0;
  var t = Math.imul(fxSeed ^ (fxSeed >>> 15), 1 | fxSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/* ----------------------------------------------------------- sprite adapter */
var FB_SIZE = {
  player: [24, 16], thruster: [8, 8], shield: [32, 24], bullet: [8, 3], bullet_opt: [6, 3], bullet_spread: [6, 6],
  bullet_wave: [8, 6], bullet_laser: [16, 3], beam_t1: [24, 10], beam_t2: [40, 16], beam_t3: [64, 24],
  enemy_bullet: [6, 6], hair_ball: [10, 10], butt_small: [16, 16], butt_mid: [24, 24], butt_charger: [20, 16],
  butt_spitter: [24, 20], alien_eye: [16, 16], alien_squid: [20, 24], butt_armored: [24, 24], gas_cloud: [20, 16],
  tooth_mine: [14, 14], butt_turret: [16, 16], midboss_butt: [56, 48], boss_butt: [96, 80], boss_crack: [96, 80],
  boss_god: [96, 80], force: [16, 16], charge_orb: [16, 16], muzzle: [8, 8], bullet_hit: [8, 8], player_die: [32, 32],
  shield_pop: [32, 24], pu_flash: [24, 24], fart_puff: [12, 12], boss_gib: [64, 64], icon_life: [12, 8],
  explosion: [32, 32], explosion_small: [16, 16], hair_tuft: [8, 8], smoke: [8, 8], gib: [4, 4], pu_power: [12, 12],
  pu_speed: [12, 12], pu_shield: [12, 12], pu_force: [12, 12], pu_spread: [12, 12], pu_laser: [12, 12],
  pu_wave: [12, 12], pu_life: [12, 12], logo: [224, 56]
};
var spriteNames = null, hasCache = {}, cvCache = {}, sizeCache = {}, metaCache = {};
var _o = { frame: 0, flipX: false, flipY: false, flash: false, alpha: 1 };

function Spr() { return window.Sprites || null; }
function loadNames() {
  spriteNames = {};
  var s = Spr();
  try { if (s && typeof s.names === 'function') { var a = s.names(); for (var i = 0; i < a.length; i++) spriteNames[a[i]] = true; } else spriteNames = null; }
  catch (e) { spriteNames = null; }
}
function has(name) {
  var v = hasCache[name];
  if (v !== undefined) return v;
  v = false;
  var s = Spr();
  try {
    if (s) {
      if (typeof s.has === 'function') v = !!s.has(name);
      else {
        if (spriteNames === null) loadNames();
        if (spriteNames) v = spriteNames[name] === true;
        else { var c = s.get(name, 0); v = !!(c && c.width > 0); }
      }
    }
  } catch (e) { v = false; }
  hasCache[name] = v;
  return v;
}
function size(name) {
  var z = sizeCache[name];
  if (z) return z;
  z = null;
  if (has(name)) {
    try {
      var q = Spr().size(name);
      if (q && q.w > 0 && q.h > 0) z = { w: q.w, h: q.h };
    } catch (e) { z = null; }
  }
  if (!z) { var f = FB_SIZE[name] || [16, 16]; z = { w: f[0], h: f[1] }; }
  sizeCache[name] = z;
  return z;
}
function frames(name) {
  var e = cvCache[name];
  if (!e) e = cvEntry(name);
  return e.nf;
}
function cvEntry(name) {
  var e = { ok: has(name), nf: 1, list: [] };
  if (e.ok) { try { var n = Spr().frames(name) | 0; e.nf = n > 0 ? n : 1; } catch (er) { e.ok = false; } }
  cvCache[name] = e;
  return e;
}
function cvOf(name, f) {
  var e = cvCache[name] || cvEntry(name);
  if (!e.ok) return null;
  var i = f % e.nf; if (i < 0) i += e.nf;
  var c = e.list[i];
  if (!c) {
    try { c = Spr().get(name, i); } catch (er) { c = null; }
    if (!c) { e.ok = false; return null; }
    e.list[i] = c;
  }
  return c;
}
/* Sprites.meta(name, frame) -> {hit, mouth, muzzle} | null, cached; returns null when unavailable */
function meta(name, frame) {
  var k = name + '#' + (frame | 0), m = metaCache[k];
  if (m !== undefined) return m;
  m = null;
  var s = Spr();
  if (s && typeof s.meta === 'function' && has(name)) { try { m = s.meta(name, frame | 0) || null; } catch (e) { m = null; } }
  metaCache[k] = m;
  return m;
}
/* S(name, x, y, frame, flipX, flash, flipY, alpha): draw a sprite or a magenta placeholder */
function S(name, x, y, frame, flipX, flash, flipY, alpha) {
  x = Math.round(x); y = Math.round(y);
  var c = cvOf(name, frame | 0);
  if (c) {
    if (!flipX && !flash && !flipY) {
      if (alpha !== undefined) { ctx.globalAlpha = alpha; ctx.drawImage(c, x, y); ctx.globalAlpha = 1; }
      else ctx.drawImage(c, x, y);
      return;
    }
    try {
      _o.frame = frame | 0; _o.flipX = !!flipX; _o.flipY = !!flipY; _o.flash = !!flash; _o.alpha = alpha === undefined ? 1 : alpha;
      Spr().draw(ctx, name, x, y, _o);
      return;
    } catch (e) { /* fall to placeholder */ }
  }
  var z = size(name);
  ctx.fillStyle = flash ? '#fff' : '#f0f';
  ctx.fillRect(x, y, z.w, z.h);
}
var _so = { frame: 0, squash: 0.4, alpha: 1, flipX: false };
function shadowAt(name, frame, x, y, squash, alpha) { // low-level, caller chooses (x,y)
  x = Math.round(x); y = Math.round(y);
  var s = Spr();
  if (s && typeof s.drawShadow === 'function' && has(name)) {
    try {
      _so.frame = frame | 0; _so.squash = squash; _so.alpha = alpha; _so.flipX = false;
      s.drawShadow(ctx, name, x, y, _so);
      return;
    } catch (e) { /* fall through */ }
  }
  var z = size(name);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x, y + Math.round(z.h * squash * 0.5), z.w, Math.max(1, Math.round(z.h * squash * 0.5)));
}
/* shadow of an airborne sprite whose top-left is (x,y), alpha fades with altitude */
function shadow(name, frame, x, y, w, h, squash) {
  squash = squash || 0.4;
  var sh = Math.max(1, Math.round(h * squash));
  var alt = FLOOR - (y + h);
  if (alt < 0) alt = 0;
  var a = 1 - alt / 260;
  a = a < 0.5 ? 0.5 : (a > 1 ? 1 : a);
  shadowAt(name, frame, x + Math.round(alt * 0.12), FLOOR - sh, squash, a);
}

/* ---------------------------------------------------------------- text */
var tcache = {}, tcount = 0;
function TW(str, sc) {
  sc = sc || 1;
  var s = Spr();
  if (s && typeof s.textWidth === 'function') { try { var w = s.textWidth(str, sc); if (w >= 0) return w; } catch (e) { /* fall */ } }
  return str.length * 6 * sc;
}
function textCanvas(str, color, sc, style) {
  var key = style + '|' + sc + '|' + color + '|' + str, e = tcache[key];
  if (e) return e;
  var s = Spr();
  if (!s || typeof s.text !== 'function') return null;
  if (tcount > 120) { tcache = {}; tcount = 0; }
  var pad = 3 * sc, w = TW(str, sc) + pad * 2 + 1, h = 7 * sc + pad * 2 + 1;
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  var g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  try { s.text(g, str, pad, pad, color, sc, style); } catch (er) { return null; }
  e = { c: c, pad: pad };
  tcache[key] = e; tcount++;
  return e;
}
/* T(str, x, y, color, scale, style): cached text blit, returns glyph width */
function T(str, x, y, color, sc, style) {
  sc = sc || 1; color = color || '#fff'; style = style || 'plain';
  str = String(str);
  var e = textCanvas(str, color, sc, style);
  if (e) { ctx.drawImage(e.c, Math.round(x) - e.pad, Math.round(y) - e.pad); return TW(str, sc); }
  ctx.font = 'bold ' + (8 * sc) + 'px monospace';
  ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillStyle = '#000'; ctx.fillText(str, Math.round(x) + 1, Math.round(y) + 1);
  ctx.fillStyle = color; ctx.fillText(str, Math.round(x), Math.round(y));
  return str.length * 6 * sc;
}
function TC(str, y, color, sc, style) { // centred
  sc = sc || 1;
  T(str, Math.round((W - TW(str, sc)) / 2), y, color, sc, style);
}

/* ---------------------------------------------------------------- backdrop */
var SKY_STEPS = 32, skyCols = null;
var strips = { far: null, mid: null, ceil: null, ground: null, fore: null };
var themeNames = null;
var scrollFar = 0, scrollMid = 0, scrollNear = 0, sFar = 0.13, sMid = 0.4, sNear = 0.8;
var heatAmp = 1, heatOmega = TAU / 125, copper = 1, scanA = 0.18;
var starCv = [null, null, null, null], starPos = [0, 0, 0];
var overlayCv = null, dangerCv = null, ringCv = null, dotCv = null;
var stats = { frameMs: 0, blits: 0 };

function parseCol(s) {
  if (typeof s !== 'string') return null;
  var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  var h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}
function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function bakeSky(stops, cop) {
  var out = new Array(SKY_STEPS), s, yi;
  for (s = 0; s < SKY_STEPS; s++) {
    var c = mkCanvas(1, H + 8), g = c.getContext('2d'), ph = s / SKY_STEPS * TAU;
    for (yi = 0; yi < H + 8; yi++) {
      var y = yi - 4, t = clamp(y / H, 0, 1);
      var v = Math.sin(y * 0.16 + ph) * 0.5 + 0.5, v2 = Math.sin(y * 0.045 - ph) * 0.5 + 0.5;
      var q = (Math.floor(v * 4) / 4 * (0.10 + 0.20 * t) + Math.floor(v2 * 3) / 3 * 0.05) * cop;
      var fpos = t * (stops.length - 1), i0 = Math.min(stops.length - 2, Math.floor(fpos)), ft = fpos - i0;
      var ca = stops[i0], cb = stops[i0 + 1];
      var r = ca[0] + (cb[0] - ca[0]) * ft, gg = ca[1] + (cb[1] - ca[1]) * ft, bl = ca[2] + (cb[2] - ca[2]) * ft;
      var bar0 = Math.min(255, cb[0] + 100), bar1 = Math.min(255, cb[1] + 70), bar2 = Math.min(255, cb[2] + 40);
      r += (bar0 - r) * q; gg += (bar1 - gg) * q; bl += (bar2 - bl) * q;
      g.fillStyle = 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (bl | 0) + ')';
      g.fillRect(0, yi, 1, 1);
    }
    out[s] = c;
  }
  return out;
}
function bakeStrip(name) {
  if (!name || !has(name)) return null;
  var z = size(name), tiles = Math.ceil((W + 8 + z.w) / z.w) + 1;
  var c = mkCanvas(z.w * tiles, z.h), g = c.getContext('2d');
  var src = cvOf(name, 0);
  if (!src) return null;
  for (var i = 0; i < tiles; i++) g.drawImage(src, i * z.w, 0);
  return { c: c, w: z.w, h: z.h };
}
function bakeStars() {
  var l, i, v;
  for (l = 0; l < 3; l++) {
    var n = l === 0 ? 40 : (l === 1 ? 26 : 16);
    var variants = l === 2 ? 2 : 1;
    for (v = 0; v < variants; v++) {
      var c = mkCanvas(W * 2, H), g = c.getContext('2d');
      var save = fxSeed; fxSeed = 777 + l * 31; // stable layout per layer, identical across variants
      for (i = 0; i < n; i++) {
        var x = (rf() * W) | 0, y = (CEIL + 2 + rf() * 130) | 0, dim = (v === 1 && i % 5 === 0);
        g.fillStyle = dim ? '#2c3460' : (l === 0 ? '#56649c' : (l === 1 ? '#9aa8d8' : '#ffffff'));
        g.fillRect(x, y, l === 2 ? 2 : 1, 1); g.fillRect(x + W, y, l === 2 ? 2 : 1, 1);   // duplicated so one blit wraps
      }
      fxSeed = save;
      starCv[l === 2 ? 2 + v : l] = c;
    }
  }
}
function bakeOverlay(scan) {
  var c = mkCanvas(W, H), g = c.getContext('2d');
  var gr = g.createRadialGradient(W / 2, H / 2, 70, W / 2, H / 2, 240);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,' + scan + ')';
  for (var y = 1; y < H; y += 2) g.fillRect(0, y, W, 1);
  return c;
}
function bakeMisc() {
  var c = mkCanvas(W, H), g = c.getContext('2d');
  var gr = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 230);
  gr.addColorStop(0, 'rgba(255,20,20,0)'); gr.addColorStop(1, 'rgba(255,20,20,1)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  dangerCv = c;
  // thumb-stick ghost: pixel ring + dot
  var r = mkCanvas(34, 34), rg = r.getContext('2d'), x, y;
  for (y = 0; y < 34; y++) for (x = 0; x < 34; x++) {
    var d = Math.sqrt((x - 16.5) * (x - 16.5) + (y - 16.5) * (y - 16.5));
    if (d > 14.2 && d < 16.2) { rg.fillStyle = '#ffffff'; rg.fillRect(x, y, 1, 1); }
  }
  ringCv = r;
  var dd = mkCanvas(10, 10), dg = dd.getContext('2d');
  for (y = 0; y < 10; y++) for (x = 0; x < 10; x++) {
    var e = Math.sqrt((x - 4.5) * (x - 4.5) + (y - 4.5) * (y - 4.5));
    if (e < 4.3) { dg.fillStyle = e < 3 ? '#ffffff' : '#bfe3ff'; dg.fillRect(x, y, 1, 1); }
  }
  dotCv = dd;
}
function bgSpeed(v, def) { return (typeof v === 'number' && v >= 0) ? v / 60 : def; }

var SKY_DEF = [[10, 6, 34], [104, 30, 86]];
/* setStage(stageObj, themeIdx): bake everything that depends on the stage */
function setStage(st, themeIdx) {
  var bg = (st && st.bg) || {}, pal = bg.palette || {}, ras = bg.raster || {}, i;
  var stops = [];
  var sky = pal.sky || pal;
  if (sky && sky.length) for (i = 0; i < sky.length; i++) { var c = parseCol(sky[i]); if (c) stops.push(c); }
  if (stops.length < 2) stops = SKY_DEF;
  copper = typeof ras.copper === 'number' ? ras.copper : 1;
  heatAmp = typeof ras.heatAmp === 'number' ? ras.heatAmp : 1;
  heatOmega = TAU / (typeof ras.heatPeriod === 'number' && ras.heatPeriod > 8 ? ras.heatPeriod : 125);
  scanA = typeof ras.scan === 'number' ? ras.scan : 0.18;
  sFar = bgSpeed(bg.speedFar, 0.13); sMid = bgSpeed(bg.speedMid, 0.4); sNear = bgSpeed(bg.speedNear, 0.8);
  skyCols = bakeSky(stops, copper);
  overlayCv = bakeOverlay(scanA);
  var th = null, s = Spr();
  try { if (s && typeof s.theme === 'function') th = s.theme(themeIdx | 0); } catch (e) { th = null; }
  var n = (th && th.far) ? th : { far: 'bg_far', mid: null, ceiling: 'bg_ceiling', ground: 'bg_rocks', fore: null };
  strips.far = bakeStrip(n.far); strips.mid = bakeStrip(n.mid); strips.ceil = bakeStrip(n.ceiling);
  strips.ground = bakeStrip(n.ground); strips.fore = bakeStrip(n.fore);
  themeNames = n;
}
function stepBG() {
  scrollFar += sFar; scrollMid += sMid; scrollNear += sNear;
  starPos[0] += 0.12; starPos[1] += 0.35; starPos[2] += 0.8;
}
function stripBlit(st, scroll, y) {
  var off = ((Math.floor(scroll) % st.w) + st.w) % st.w;
  ctx.drawImage(st.c, off, 0, W + 8, st.h, -4, y, W + 8, st.h);
}
function drawBackdrop(V) {
  var i;
  if (!skyCols) setStage(null, 0);
  ctx.drawImage(skyCols[(V.tick >> 2) % SKY_STEPS], 0, 0, 1, H + 8, -4, -4, W + 8, H + 8);
  for (i = 0; i < 3; i++) {
    var cvs = starCv[i === 2 ? 2 + (((V.tick >> 4) & 1)) : i];
    if (!cvs) continue;
    ctx.drawImage(cvs, -(Math.floor(starPos[i]) % W), 0);
  }
  var far = strips.far, y0 = 126;
  if (far) {
    if (heatAmp <= 0.01) stripBlit(far, scrollFar, y0);
    else {
      var base = Math.floor(scrollFar), T = V.tick * heatOmega, bandH = 8;
      for (i = 0; i < far.h; i += bandH) {
        var dx = Math.round(Math.sin((y0 + i) * 0.15 + T) * heatAmp);
        var off = (((base + dx) % far.w) + far.w) % far.w;
        ctx.drawImage(far.c, off, i, W + 8, Math.min(bandH, far.h - i), -4, y0 + i, W + 8, Math.min(bandH, far.h - i));
      }
    }
  } else { ctx.fillStyle = '#10183c'; ctx.fillRect(-4, y0 + 24, W + 8, 40); }
  if (strips.mid) stripBlit(strips.mid, scrollMid * 0.8, 128);
  if (strips.ceil) stripBlit(strips.ceil, scrollMid, 0); else { ctx.fillStyle = '#4a1f44'; ctx.fillRect(-4, 0, W + 8, 20); }
  ctx.fillStyle = '#3a1636'; ctx.fillRect(-4, -4, W + 8, 4);
  if (strips.ground) stripBlit(strips.ground, scrollNear, H - strips.ground.h); else { ctx.fillStyle = '#3a2030'; ctx.fillRect(-4, H - 40, W + 8, 40); }
  ctx.fillStyle = '#1c1020'; ctx.fillRect(-4, H, W + 8, 4);
}

/* ---------------------------------------------------------------- world */
function enemyFrame(e) {
  var nf = frames(e.spr), f;
  switch (e.beh) {
    case 'charge': f = e.state; break;
    case 'hover_spit':
      f = e.spit > 0 ? 2 + ((e.spit >> 3) & 1) : (e.windup > 0 && nf > 4 ? 4 : ((e.t >> 4) & 1));
      break;
    case 'armored': f = e.hp > e.maxhp * 0.66 ? 0 : (e.hp > e.maxhp * 0.33 ? 1 : 2); break;
    case 'turret': f = e.windup > 0 ? 1 : (e.spit > 0 ? 2 : 0); break;
    default: f = (e.t >> 3) % nf;
  }
  return f >= nf ? nf - 1 : (f < 0 ? 0 : f);
}
function drawBoss(b) {
  var nm = b.name;
  if (b.kind === 'boss' && b.hp < b.maxhp * 0.3 && has(nm + '_dmg')) nm = nm + '_dmg';
  var flashing = b.flash > 0 || (b.mode === 'dying' && ((b.deadT >> 2) & 1));
  var fr = b.fr;
  var nf = frames(nm);
  if (fr >= nf) fr = nf - 1;
  S(nm, b.x + b.jx, b.y, fr, false, flashing);
}
var sparkCols = [];
function sparkIndex(c) { var k = sparkCols.indexOf(c); if (k < 0) { sparkCols.push(c); k = sparkCols.length - 1; } return k; }
function drawWorld(V) {
  var i, e, b, p, f, P = V.P, F = V.F, B = V.B, M = V.M, tick = V.tick;
  var enemies = V.enemies, ebul = V.ebul, bullets = V.bullets, powerups = V.powerups, parts = V.parts;
  /* ---- lunge lane telegraph ---- */
  if (V.lane.on) {
    var ly0 = Math.round(V.lane.y), lh0 = Math.round(V.lane.h);
    ctx.fillStyle = ((tick >> 2) & 1) ? 'rgba(255,40,40,0.42)' : 'rgba(255,40,40,0.24)';
    ctx.fillRect(0, ly0, W, lh0);
    ctx.fillStyle = 'rgba(255,220,220,0.8)'; ctx.fillRect(0, ly0, W, 1); ctx.fillRect(0, ly0 + lh0 - 1, W, 1);
  }
  /* ---- shadows (enemy shadows are dropped when the screen is crowded: keeps the draw-call budget) ---- */
  var crowd = 0;
  for (i = 0; i < enemies.length; i++) if (enemies[i].on) crowd++;
  for (i = 0; i < ebul.length; i++) if (ebul[i].on) crowd++;
  for (i = 0; i < bullets.length; i++) if (bullets[i].on) crowd++;
  var enemyShadows = crowd < 46, lod = crowd >= 40;
  if (P.alive && !P.swallowed) shadow('player', 0, P.x, P.y, 24, 16);
  if (F.on) shadow('force', 0, F.x, F.y, 16, 16);
  for (i = 0; enemyShadows && i < enemies.length; i++) {
    e = enemies[i];
    if (e.on && e.x < W && e.x > -e.sw && e.y < FLOOR && e.y + e.sh > 92 && e.beh !== 'turret') shadow(e.spr, 0, e.x, e.y, e.sw, e.sh);
  }
  if (B.on) shadow(B.name, 0, B.x + B.jx, B.y, B.w, B.h, 0.15);
  if (M.on) shadow(M.name, 0, M.x + M.jx, M.y, M.w, M.h, 0.25);
  /* ---- powerups, enemies, bosses ---- */
  for (i = 0; i < powerups.length; i++) {
    p = powerups[i];
    if (p.on) S(p.name, p.x, p.y, (p.t >> 4) & 1);
  }
  for (i = 0; i < enemies.length; i++) {
    e = enemies[i];
    if (!e.on || e.x >= W || e.x + e.sw <= 0 || e.y >= H || e.y + e.sh <= 0) continue;
    var fl = e.flash > 0 || (e.carrier && (tick & 15) < 3);
    S(e.spr, e.x, e.y, enemyFrame(e), e.flipX, fl, e.ceil);
  }
  if (B.on) drawBoss(B);
  if (M.on) drawBoss(M);
  /* ---- force pod ---- */
  if (F.on) {
    var ff = F.flashT > 0 ? 4 + ((F.flashT >> 1) & 1) : ((tick >> 2) & 3);
    S('force', F.x, F.y, ff, F.mode === 'rear');
  }
  /* ---- enemy bullets ---- */
  for (i = 0; i < ebul.length; i++) {
    b = ebul[i];
    if (!b.on || b.x >= W || b.x + b.w <= 0) continue;
    S(b.kind ? 'hair_ball' : 'enemy_bullet', b.x, b.y, (b.t >> 2) & 1);
  }
  /* ---- player bullets / beams / laser ---- */
  for (i = 0; i < bullets.length; i++) {
    b = bullets[i];
    if (!b.on || b.x >= W || b.x + b.w <= 0) continue;
    switch (b.kind) {
      case 4: S('beam_t' + b.tier, b.x, b.y, (b.t >> 2) & 1); break;
      case 1: S('bullet_opt', b.x, b.y + 0, 0); break;
      case 2: S('bullet_spread', b.x, b.y, 0); break;
      case 3: S('bullet_wave', b.x, b.y, (b.t >> 2) & 1); break;
      default: S('bullet', b.x, b.y, 0);
    }
  }
  var L = V.laser;
  if (L.on) {
    var lc = cvOf('bullet_laser', 0);
    if (lc) ctx.drawImage(lc, 0, 0, lc.width, lc.height, Math.round(L.x), Math.round(L.y), L.len, lc.height);
    else { ctx.fillStyle = '#7fe0ff'; ctx.fillRect(Math.round(L.x), Math.round(L.y), L.len, 3); }
  }
  /* ---- player ---- */
  if (P.alive && !P.swallowed) {
    var show = !(P.inv > 0 && ((tick >> 2) & 1));
    if (show) {
      S('thruster', P.x - 8, P.y + 4, (tick >> 1) & 3);
      f = P.bank > 0 ? 1 : (P.bank < 0 ? 2 : 0);
      S('player', P.x, P.y, f, false, P.flash > 0);
      if (V.shieldOn && !(P.inv > 0 && ((tick >> 1) & 1))) S('shield', P.x - 4, P.y - 4, (tick >> 3) & 1);
    }
    if (V.charging && V.chargeT >= 21) {
      var mz = meta('player', f), mx = mz && mz.muzzle ? mz.muzzle.x : 23, my = mz && mz.muzzle ? mz.muzzle.y : 8;
      var tier = V.chargeTier, of;
      if (tier >= 3) of = 4 + ((tick >> 2) & 1);
      else if (tier === 2) of = 3;
      else if (tier === 1) of = 2;
      else of = V.chargeT < 26 ? 0 : 1;
      S('charge_orb', P.x + mx - 4, P.y + my - 8, of);
    }
  }
  /* ---- particles (sparks are batched into one fill per colour) ---- */
  var ci, any;
  for (i = 0; i < parts.length; i++) {
    p = parts[i];
    if (!p.on) continue;
    if (p.kind === 0) { if (p.cc !== p.c) { p.cc = p.c; p.ci = sparkIndex(p.c); } }
    else if (p.kind === 1) {
      if (lod && (p.spr === 'bullet_hit' || p.spr === 'muzzle')) continue;
      f = Math.min(p.nf - 1, Math.floor((1 - p.life / p.max) * p.nf));
      S(p.spr, p.x, p.y, f);
    } else {
      if (lod) continue;
      if (p.life < 10) ctx.globalAlpha = p.life / 10;
      S(p.spr, p.x, p.y, ((p.life >> 3) + i) % p.nf);
      ctx.globalAlpha = 1;
    }
  }
  for (ci = 0; ci < sparkCols.length; ci++) {
    any = false;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (p.on && p.kind === 0 && p.ci === ci) {
        if (!any) { ctx.fillStyle = sparkCols[ci]; ctx.beginPath(); any = true; }
        ctx.rect(Math.round(p.x), Math.round(p.y), p.s, p.s);
      }
    }
    if (any) ctx.fill();
  }
  /* ---- foreground layer (in front of entities, bottom edge only) ---- */
  if (strips.fore) stripBlit(strips.fore, scrollNear * 1.5, H - strips.fore.h);
  /* ---- popups ---- */
  for (i = 0; i < V.popups.length; i++) {
    p = V.popups[i];
    if (!p.on) continue;
    if (p.life < 10) ctx.globalAlpha = p.life / 10;
    T(p.str, p.x, p.y, p.c, 1, 'outline');
    ctx.globalAlpha = 1;
  }
}

function drawTitleScene(V) {
  var i, c, cy;
  for (i = 0; i < V.critters.length; i++) {
    c = V.critters[i]; cy = c.y + Math.sin(V.titleT * 0.04 + c.ph) * 10;
    var z = size(c.n); shadow(c.n, 0, c.x, cy, z.w, z.h);
  }
  for (i = 0; i < V.critters.length; i++) {
    c = V.critters[i]; cy = c.y + Math.sin(V.titleT * 0.04 + c.ph) * 10;
    S(c.n, c.x, cy, (V.titleT >> 3) % frames(c.n));
  }
}

/* ---------------------------------------------------------------- HUD */
var BTN = { bomb: { x: W - 38, y: H - 42, w: 34, h: 30 }, pause: { x: W - 24, y: 0, w: 24, h: 22 }, mute: { x: W - 48, y: 0, w: 24, h: 22 }, haptics: { x: W / 2 - 62, y: 150, w: 124, h: 18 } };
var WEAPON_ICON = { main: 'pu_power', spread: 'pu_spread', laser: 'pu_laser', wave: 'pu_wave' };
var hudTop = null, hudBot = null;
var hkT = { s: null, h: null, l: -1, m: null }, hkB = { w: null, p: -1, f: -1, sh: null };
function drawHUD(V) {
  var i, y;
  if (!hudTop) { hudTop = mkCanvas(W, 24); hudBot = mkCanvas(64, 16); }
  /* top bar + bottom-left status are baked into small canvases and only re-rendered when a value changes */
  if (hkT.s !== V.score || hkT.h !== V.hiStr || hkT.l !== V.lives || hkT.m !== V.muted) {
    hkT.s = V.score; hkT.h = V.hiStr; hkT.l = V.lives; hkT.m = V.muted;
    var gt = hudTop.getContext('2d'), save = ctx;
    gt.clearRect(0, 0, W, 24); gt.imageSmoothingEnabled = false; ctx = gt;
    T('SCORE ' + V.score, 4, 3, '#ffffff', 1, 'outline');
    var hs = 'HI ' + V.hiStr;
    T(hs, Math.round((W - TW(hs, 1)) / 2), 3, '#ffe14a', 1, 'outline');
    var n = Math.min(V.lives, 5), lw = size('icon_life').w + 1;
    for (i = 0; i < n; i++) S('icon_life', W - 52 - (i + 1) * lw, 5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(W - 14, 4, 2, 8); ctx.fillRect(W - 10, 4, 2, 8);
    T('M', W - 38, 4, V.muted ? '#ff5050' : '#cccccc', 1, 'outline');
    ctx = save;
  }
  ctx.drawImage(hudTop, 0, 0);
  // chain (live)
  if (V.chain >= 2 && V.chainT > 0) {
    T('CHAIN ' + V.chain + ' X' + V.mult, 4, 15, ((V.tick >> 2) & 1) ? '#ffe14a' : '#ff9a2a', 1, 'outline');
    ctx.fillStyle = '#000'; ctx.fillRect(4, 25, 52, 3);
    ctx.fillStyle = '#ffe14a'; ctx.fillRect(5, 26, Math.round(50 * clamp(V.chainT / 150, 0, 1)), 1);
  }
  // weapon / force / shield status, bottom-left
  if (hkB.w !== V.weaponName || hkB.p !== V.power || hkB.f !== V.forceLv || hkB.sh !== V.shieldOn) {
    hkB.w = V.weaponName; hkB.p = V.power; hkB.f = V.forceLv; hkB.sh = V.shieldOn;
    var gb = hudBot.getContext('2d'), sv = ctx;
    gb.clearRect(0, 0, 64, 16); gb.imageSmoothingEnabled = false; ctx = gb;
    S(WEAPON_ICON[V.weaponName] || 'pu_power', 0, 0, 0);
    for (i = 0; i < 3; i++) { ctx.fillStyle = i < V.power ? '#ffe14a' : '#3a2a50'; ctx.fillRect(14 + i * 4, 3, 3, 6); }
    if (V.forceLv > 0) T('F' + V.forceLv, 30, 3, '#ffa040', 1, 'outline');
    if (V.shieldOn) T('B', 44, 3, '#6ab4ff', 1, 'outline');
    ctx = sv;
  }
  ctx.drawImage(hudBot, 4, H - 15);
  // bomb meter + button (bottom-right)
  if (V.mode === 'playing') {
    if (V.bombReady) {
      var bn = BTN.bomb, pulse = ((V.tick >> 3) & 1);
      ctx.fillStyle = pulse ? 'rgba(120,255,120,0.55)' : 'rgba(40,160,60,0.45)'; ctx.fillRect(bn.x, bn.y, bn.w, bn.h);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(bn.x, bn.y, bn.w, 1); ctx.fillRect(bn.x, bn.y + bn.h - 1, bn.w, 1); ctx.fillRect(bn.x, bn.y, 1, bn.h); ctx.fillRect(bn.x + bn.w - 1, bn.y, 1, bn.h);
      T('BLAST', bn.x + 3, bn.y + 11, '#ffffff', 1, 'outline');
    } else if (V.bombPct > 0.01) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W - 44, H - 8, 40, 4);
      ctx.fillStyle = '#7dff7d'; ctx.fillRect(W - 43, H - 7, Math.round(38 * V.bombPct), 2);
    }
  }
  // boss bars
  var bb = V.B.on ? V.B : (V.M.on ? V.M : null);
  if (bb) {
    var fr = Math.max(0, bb.hp / bb.maxhp), bw = bb.kind === 'boss' ? 200 : 120, bx = Math.round((W - bw) / 2) + 6;
    ctx.fillStyle = '#000'; ctx.fillRect(bx - 1, 15, bw + 2, 7);
    ctx.fillStyle = '#5a1020'; ctx.fillRect(bx, 16, bw, 5);
    ctx.fillStyle = bb.flash > 0 ? '#ffffff' : (fr < 0.3 ? '#ff9a2a' : '#ff3a3a');
    ctx.fillRect(bx, 16, Math.round(bw * fr), 5);
    T(bb.kind === 'boss' ? 'BOSS' : 'MID', bx - 30, 15, '#ff5fa2', 1, 'outline');
  }
}
function drawBanners(V) {
  var a;
  if (V.phase === 'intro') {
    a = Math.min(1, V.phaseT / 20, (150 - V.phaseT) / 20);
    if (a > 0) {
      ctx.globalAlpha = a;
      TC('STAGE ' + V.stageNo, 62, '#ffe14a', 2, 'banner');
      TC(V.stageName, 82, '#ffffff', 2, 'banner');
      if (V.stageIntro) TC(V.stageIntro, 106, '#cfd6ff', 1, 'outline');
      if (V.mutator) TC(V.mutator.toUpperCase() + ' LOOP ' + (V.loopN + 1) + ' - THEY ARE HAIRIER NOW', 120, '#ff5fa2', 1, 'outline');
      else if (V.loopN > 0) TC('LOOP ' + (V.loopN + 1) + ' - THEY ARE HAIRIER NOW', 120, '#ff5fa2', 1, 'outline');
      else TC('GET READY', 120, '#ffffff', 1, 'outline');
      ctx.globalAlpha = 1;
    }
  } else if (V.phase === 'warn') {
    if (((V.phaseT >> 3) & 1) === 0) {
      TC('WARNING!', 78, '#ff3a3a', 3, 'banner');
      TC('AN ENORMOUS BUTT APPROACHES', 112, '#ffffff', 1, 'outline');
    }
  } else if (V.phase === 'clear') {
    TC('STAGE CLEAR', 74, '#7dff7d', 3, 'banner');
    TC('BONUS ' + V.clearBonus, 108, '#ffe14a', 2, 'banner');
    if (V.phaseT > 200) TC('GET READY', 134, '#ffffff', 1, 'outline');
  }
  if (V.bannerT > 0) {
    var jx = V.bannerT > 80 ? ((V.tick & 1) ? 2 : -2) : 0;
    var w3 = TW(V.bannerStr, 3);
    if (V.bannerT < 20) ctx.globalAlpha = V.bannerT / 20;
    T(V.bannerStr, Math.round((W - w3) / 2) + jx, 92, V.bannerCol, 3, 'banner');
    ctx.globalAlpha = 1;
  }
  if (V.mash >= 0) {
    TC('MASH FIRE!', 70, ((V.tick >> 2) & 1) ? '#ffffff' : '#ff5fa2', 2, 'banner');
    ctx.fillStyle = '#000'; ctx.fillRect(142, 96, 100, 8);
    ctx.fillStyle = '#ff5fa2'; ctx.fillRect(143, 97, Math.round(98 * clamp(V.mash, 0, 1)), 6);
  }
}
function drawStick(V) {
  var s = V.stick;
  if (s.a <= 0 || !ringCv) return;
  ctx.globalAlpha = 0.45 * s.a;
  ctx.drawImage(ringCv, Math.round(s.ox - 17), Math.round(s.oy - 17));
  ctx.globalAlpha = 0.8 * s.a;
  ctx.drawImage(dotCv, Math.round(s.cx - 5), Math.round(s.cy - 5));
  ctx.globalAlpha = 1;
}
function drawDanger(V) {
  if (V.dangerT < 0 || !dangerCv) return;
  var ph = (V.tick - V.dangerT) % 36;
  var lub = Math.max(0, 1 - Math.abs(ph) / 9), dub = 0.7 * Math.max(0, 1 - Math.abs(ph - 10) / 9);
  var a = Math.max(lub, dub) * 0.35 + 0.05;
  ctx.globalAlpha = a; ctx.drawImage(dangerCv, 0, 0); ctx.globalAlpha = 1;
}
function drawTitleUI(V) {
  var ly = 22 + Math.round(Math.abs(Math.sin(V.titleT * 0.045)) * -8 + 8);
  if (has('logo')) {
    var z = size('logo'), wink = (V.titleT % 180) < 25 ? 1 : 0;
    var nf = frames('logo');
    S('logo', Math.round((W - z.w) / 2), ly, wink < nf ? wink : 0);
  } else TC('AASSSMASTER', ly + 10, '#ff5fa2', 3, 'banner');
  TC('HI-SCORE ' + V.hiStr, 96, '#ffe14a', 1, 'outline');
  TC('TAP TO START', 114, ((V.titleT >> 4) & 1) ? '#ffffff' : '#ff5fa2', 2, 'banner');
  TC('LEFT THUMB: DRAG TO MOVE - TAP TO THROW FORCE', 170, '#cfd6ff', 1, 'outline');
  TC('RIGHT THUMB: HOLD TO FIRE - HOLD LONGER FOR BEAM', 181, '#cfd6ff', 1, 'outline');
  TC('KEYS: ARROWS - Z FIRE - X BEAM - C FORCE - P PAUSE - M MUTE', 195, '#8a93c8', 1, 'outline');
}
function drawGameOverUI(V) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 50, W, 110);
  TC('GAME OVER', 58, '#ff3a3a', 3, 'banner');
  TC('SCORE ' + V.score, 92, '#ffffff', 2, 'banner');
  TC('HI-SCORE ' + V.hiStr, 114, '#ffe14a', 1, 'outline');
  if (V.newHi && ((V.tick >> 3) & 1)) TC('NEW HI-SCORE!', 128, '#7dff7d', 1, 'outline');
  if (V.gameoverT > 50 && ((V.gameoverT >> 4) & 1)) TC('TAP TO RESTART', 144, '#ffffff', 1, 'outline');
}
function drawContinueUI(V) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 44, W, 120);
  TC('CONTINUE?', 54, '#ffe14a', 3, 'banner');
  TC(String(Math.ceil(V.contT / 60)), 88, '#ffffff', 5, 'banner');
  TC('TAP TO CONTINUE - ' + V.contLeft + ' LEFT', 132, ((V.tick >> 4) & 1) ? '#ffffff' : '#ff5fa2', 1, 'outline');
  TC('SCORE ' + V.score, 146, '#cfd6ff', 1, 'outline');
}
function drawPauseUI(V) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
  TC('PAUSED', 70, '#ffffff', 3, 'banner');
  if ((V.tick >> 5) & 1) TC('TAP TO RESUME', 112, '#ffe14a', 1, 'outline');
  var b = BTN.haptics;
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(b.x, b.y, b.w, 1); ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
  ctx.fillRect(b.x, b.y, 1, b.h); ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
  TC('HAPTICS: ' + (V.haptics ? 'ON' : 'OFF') + ' (V)', b.y + 5, V.haptics ? '#7dff7d' : '#ff8080', 1, 'outline');
}

/* ---------------------------------------------------------------- frame */
function draw(V) {
  var t0 = (window.performance && performance.now) ? performance.now() : 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, V.shakeX, V.shakeY);
  drawBackdrop(V);
  if (V.mode === 'title') drawTitleScene(V); else drawWorld(V);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (V.flashWhite > 0) { ctx.globalAlpha = Math.min(0.85, V.flashWhite / 24); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  if (V.mode === 'playing' && V.strobe) {
    ctx.fillStyle = ((V.tick >> 2) & 1) ? 'rgba(255,0,0,0.30)' : 'rgba(255,0,0,0.08)';
    ctx.fillRect(0, 0, W, H);
  }
  if (V.mode === 'title') drawTitleUI(V);
  else {
    if (V.mode === 'playing') drawDanger(V);
    drawHUD(V);
    drawBanners(V);
    if (V.mode === 'playing') drawStick(V);
    if (V.mode === 'gameover') drawGameOverUI(V);
    if (V.mode === 'continue') drawContinueUI(V);
    if (V.paused) drawPauseUI(V);
  }
  if (overlayCv) ctx.drawImage(overlayCv, 0, 0);
  if (t0) { var d = performance.now() - t0; stats.frameMs = stats.frameMs * 0.9 + d * 0.1; }
}

function init(cv, c) {
  canvas = cv; ctx = c;
  ctx.imageSmoothingEnabled = false;
  bakeStars(); bakeMisc();
  overlayCv = bakeOverlay(0.18);
}

window.GameRender = {
  init: init, setStage: setStage, step: stepBG, draw: draw, stats: stats,
  btn: BTN, rf: rf,
  spr: { has: has, size: size, frames: frames, meta: meta }
};
})();
