/* ==========================================================================
 * aasssMaster - sprites.js  ->  global `Sprites`
 * Procedural pixel art. Every sprite is stored as arrays of strings (one char
 * per pixel, '.' = transparent) plus a palette (char -> CSS colour) and is
 * rasterised once, synchronously, into offscreen canvases at script load.
 * Many frames / sprites are *derived* programmatically (shape fills, wobbles,
 * seeded hair) but always end up as plain string rows, see Sprites._defs.
 * No external images, no network, no modules.
 *
 * Tileable backgrounds (bg_rocks, bg_ceiling, bg_far) are built only from
 * functions that are periodic in x with period = tile width (integer-frequency
 * sines, wrapped value-noise lattice, wrapped circles/strands), so column 0
 * continues seamlessly from column w-1.  (Verified by an offline seam check.)
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ utils */
  function rng(seed) {                       // mulberry32
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mk(w, h) {
    var g = [], y, x, r;
    for (y = 0; y < h; y++) { r = []; for (x = 0; x < w; x++) r.push('.'); g.push(r); }
    return g;
  }
  function put(g, x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c;
  }
  function at(g, x, y) {
    x = Math.floor(x); y = Math.floor(y);
    return (y >= 0 && y < g.length && x >= 0 && x < g[0].length) ? g[y][x] : '.';
  }
  function ell(g, cx, cy, rx, ry, fn) {      // filled ellipse (pixel centres tested)
    var x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    var y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry), x, y, u, v, c;
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
      u = (x + 0.5 - cx) / rx; v = (y + 0.5 - cy) / ry;
      if (u * u + v * v <= 1) {
        c = (typeof fn === 'function') ? fn(x, y, u, v) : fn;
        if (c) put(g, x, y, c);
      }
    }
  }
  function line(g, x0, y0, x1, y1, c) {      // Bresenham
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, e2;
    for (;;) {
      put(g, x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function rect(g, x, y, w, h, c) {
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) put(g, x + i, y + j, c);
  }
  function outline(g, c, diag) {             // 1px outline on transparent cells touching art
    var h = g.length, w = g[0].length, list = [], x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (g[y][x] !== '.') continue;
      if (at(g, x + 1, y) !== '.' || at(g, x - 1, y) !== '.' ||
          at(g, x, y + 1) !== '.' || at(g, x, y - 1) !== '.' ||
          (diag && (at(g, x + 1, y + 1) !== '.' || at(g, x - 1, y - 1) !== '.' ||
                    at(g, x + 1, y - 1) !== '.' || at(g, x - 1, y + 1) !== '.'))) list.push([x, y]);
    }
    list.forEach(function (p) { g[p[1]][p[0]] = c; });
  }
  function transpose(g) {
    var h = g.length, w = g[0].length, o = mk(h, w), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) o[x][y] = g[y][x];
    return o;
  }
  function paste(dst, src, ox, oy) {         // copy non-transparent cells
    for (var y = 0; y < src.length; y++) for (var x = 0; x < src[0].length; x++)
      if (src[y][x] !== '.') put(dst, x + ox, y + oy, src[y][x]);
  }
  function rows(g) { return g.map(function (r) { return r.join(''); }); }
  function inSet(ch, set) { return set.indexOf(ch) >= 0; }

  /* ---------------------------------------------------------------- palette */
  var PAL = {
    K: '#1a0a1f',                                              // hard outline
    L: '#ffe6e6', l: '#ffb4c0', p: '#f4809a', d: '#c4506e', D: '#8c3058', // flesh
    h: '#5e3014', H: '#9a6030',                                // hair
    m: '#5a0a22', M: '#2c0612',                                // mouth
    w: '#fff6dc', s: '#d2bc94',                                // teeth
    t: '#e63a5c', T: '#a21c3e', q: '#ff8aa0',                  // tongue
    W: '#ffffff', Y: '#fff27a', y: '#ffd23a', o: '#ff9a22',    // fire / light
    r: '#e8402a', R: '#a02020', X: '#5a1832', e: '#ffffff'
  };

  var defs = {};
  function mkpal(extra) {
    var pal = {}, k;
    for (k in PAL) pal[k] = PAL[k];
    if (extra) for (k in extra) pal[k] = extra[k];
    return pal;
  }
  function toRows(frames) {
    return frames.map(function (f) { return (typeof f[0] === 'string') ? f.slice() : rows(f); });
  }
  function def(name, w, h, frames, extra) {
    defs[name] = { w: w, h: h, frames: toRows(frames), pal: mkpal(extra) };
  }
  /* lazily built sprite: size / frame count are declared, pixels are made on first get/draw/meta */
  function lazy(name, w, h, nf, builder, extra) {
    defs[name] = { w: w, h: h, nf: nf, build: builder, frames: null, pal: mkpal(extra) };
  }
  function alias(name, target) { defs[name] = { alias: target }; }

  /* =============================================================== PLAYER ==
   * R-9 style needle fighter. Frame 0 is built from a column profile, frames 1
   * (nose up) and 2 (nose down) shear the columns. */
  function playerBase() {
    var g = mk(24, 16), cy = 8, x, y;
    //            x: 0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23
    var top = [-9, -9, 1, 2, 4, 4, 3, 2, 2, 2, 3, 3, 3, 3, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0];
    var bot = [-9, -9, 1, 1, 1, 1, 2, 3, 3, 3, 3, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
    for (x = 2; x < 24; x++) {
      for (y = cy - top[x]; y <= cy + bot[x]; y++) {
        var rel = y - cy, c;
        if (rel <= -2) c = 'w';
        else if (rel === -1) c = 'w';
        else if (rel === 0) c = 'g';
        else if (rel === 1) c = 'b';
        else c = 'B';
        put(g, x, y, c);
      }
    }
    // swept lower wing detail + upper fin stripe
    for (x = 6; x <= 11; x++) put(g, x, cy + 2, 'b');
    for (x = 7; x <= 10; x++) put(g, x, cy + 3, 'B');
    put(g, 4, cy - 4, 'r'); put(g, 5, cy - 4, 'r'); put(g, 4, cy - 3, 'r'); put(g, 3, cy - 2, 'g');
    // red hull stripe
    for (x = 13; x <= 16; x++) put(g, x, cy, 'r');
    // cockpit canopy
    ell(g, 12.5, cy - 2.4, 3.6, 2.2, function (px, py, u, v) {
      return v > 0.2 ? 'C' : (u < -0.2 && v < -0.2 ? 'W' : 'c');
    });
    // engine nozzle block
    put(g, 2, cy - 1, 'B'); put(g, 2, cy, 'y'); put(g, 2, cy + 1, 'B'); put(g, 3, cy, 'g');
    // nose cannon tip
    put(g, 23, cy, 'y'); put(g, 22, cy, 'o');
    outline(g, 'K', false);
    return g;
  }
  function shear(base, dir) {
    var g = mk(24, 16), x, y;
    for (x = 0; x < 24; x++) {
      var dy = dir * Math.floor((x + 2) / 9);
      for (y = 0; y < 16; y++) if (base[y][x] !== '.') put(g, x, y + dy, base[y][x]);
    }
    return g;
  }
  (function () {
    var f0 = playerBase(), f1 = shear(f0, -1), f2 = shear(f0, 1);
    // banking: extra visible cue (belly lit when pitching up, canopy glint when down)
    put(f1, 9, 12 - 1, 'w'); put(f1, 10, 12 - 1, 'w');
    put(f2, 12, 4 + 2, 'W'); put(f2, 13, 4 + 2, 'W');
    def('player', 24, 16, [f0, f1, f2], {
      w: '#eef4ff', g: '#a5b4d4', b: '#6478a8', B: '#3a4a78', c: '#5fe8ff', C: '#1c8ad0'
    });
  })();

  /* ======================================================== THRUSTER / ORB == */
  (function () {
    var Ls = [8, 6, 7, 5], fr = [];
    Ls.forEach(function (L, f) {
      var g = mk(8, 8), x, y;
      for (x = 0; x < 8; x++) {
        var d = 7 - x; if (d >= L) continue;
        var t = d / L, hh = 2.1 * (1 - t) + 0.5;
        for (y = 0; y < 8; y++) {
          var dist = Math.abs(y + 0.5 - 4);
          if (dist > hh) continue;
          var c = dist <= 0.5 ? (t < 0.55 ? 'W' : 'Y') : dist <= 1.5 ? (t < 0.7 ? 'y' : 'o') : 'r';
          if (d === L - 1 && c !== 'r') c = 'o';
          put(g, x, y, c);
        }
      }
      if (f % 2) { put(g, 8 - L, 3, '.'); put(g, 7 - L + 1, 4, 'o'); }
      fr.push(g);
    });
    def('thruster', 8, 8, fr);

    var op = [], pts = [[2, 2], [5, 2], [5, 5], [2, 5]], glow = [[3, 0], [7, 3], [4, 7], [0, 4]];
    for (var f = 0; f < 4; f++) {
      var g = mk(8, 8);
      ell(g, 4, 4, 4, 4, 'K');
      ell(g, 4, 4, 3.15, 3.15, function (x, y, u, v) {
        var l = -u * 0.6 - v * 0.8; return l > 0.35 ? 'Y' : (l < -0.4 ? 'o' : 'y');
      });
      put(g, pts[f][0], pts[f][1], 'W');
      put(g, glow[f][0], glow[f][1], 'y');
      put(g, glow[(f + 2) % 4][0], glow[(f + 2) % 4][1], 'o');
      op.push(g);
    }
    def('option', 8, 8, op);
  })();

  /* ============================================================== SHIELD == */
  (function () {
    var fr = [];
    for (var f = 0; f < 2; f++) {
      var g = mk(32, 24), a, i;
      ell(g, 16, 12, 15.5, 11.5, function (x, y, u, v) {
        var rr = u * u + v * v;
        if (rr > 0.80) return (f === 0 || ((x + y) % 3) !== 0) ? 'a' : 'b';
        return 'f';
      });
      for (a = 3.4; a < 4.3; a += 0.12)               // glossy arc, upper-left
        put(g, 16 + Math.cos(a + f * 0.18) * 12.8, 12 + Math.sin(a + f * 0.18) * 9, 'h');
      var sp = f ? [[24, 5], [8, 18], [27, 14]] : [[7, 6], [25, 17], [20, 20]];
      for (i = 0; i < sp.length; i++) {
        put(g, sp[i][0], sp[i][1], 'h');
        put(g, sp[i][0] - 1, sp[i][1], 'g'); put(g, sp[i][0] + 1, sp[i][1], 'g');
        put(g, sp[i][0], sp[i][1] - 1, 'g'); put(g, sp[i][0], sp[i][1] + 1, 'g');
      }
      fr.push(g);
    }
    def('shield', 32, 24, fr, {
      a: 'rgba(140,230,255,0.95)', b: 'rgba(140,230,255,0.45)', f: 'rgba(70,160,255,0.16)',
      h: 'rgba(255,255,255,0.92)', g: 'rgba(190,245,255,0.6)'
    });
  })();

  /* =========================================================== PROJECTILES ==
   * Rule of thumb: ours are cool & thin (white/yellow/cyan/green), HOSTILE ones are
   * the brightest, fattest things on screen (white core, hot ring, dark outline). */
  def('bullet', 8, 3, [[
    '.yYYYYy.',
    'oWWWWWWW',
    '.yYYYYy.'
  ]]);
  def('bullet_opt', 6, 3, [[
    '.oyyo.',
    'oYWWYo',
    '.oyyo.'
  ]]);

  /* beams: tail ramps up, plateau, round head on the right.  tier 3 is crackling. */
  function beamFrame(w, h, f, tier) {
    var g = mk(w, h), x, y, cy = h / 2, tail = Math.max(4, Math.round(w * 0.3)), head = Math.min(6, Math.round(h * 0.4));
    var R = rng(300 + tier * 17 + f * 5);
    for (x = 0; x < w; x++) {
      var th;
      if (x < tail) th = 0.35 + (cy - 0.35) * (x / tail);
      else th = cy;
      if (x > w - 1 - head) { var q = (x - (w - 1 - head)) / head; th *= Math.sqrt(Math.max(0, 1 - q * q)); }
      th = Math.max(0.6, th - 0.3);
      th += ((x + f) % 3 === 0 ? 0.55 : ((x + f) % 3 === 1 ? -0.35 : 0)) * (x < w * 0.75 ? (tier > 1 ? 1.3 : 0.8) : 0.2);
      th = Math.max(0.6, Math.min(cy, th));
      for (y = 0; y < h; y++) {
        var dy = Math.abs(y + 0.5 - cy);
        if (dy > th) continue;
        var a = dy / th;
        put(g, x, y, a < 0.34 ? 'W' : a < 0.6 ? 'c' : a < 0.85 ? 'z' : 'n');
      }
    }
    var n = tier === 3 ? 14 : (tier === 2 ? 6 : 3), i;
    for (i = 0; i < n; i++) {                              // sparks / crackle around the beam
      var sx = Math.floor(R() * w * 0.85), sy = Math.floor(R() * h);
      if (at(g, sx, sy) === '.') put(g, sx, sy, R() < 0.5 ? 'c' : 'z');
    }
    if (tier === 3) for (i = 0; i < 6; i++) {              // white lightning flecks on the body
      var lx = 6 + Math.floor(R() * (w - 14)), ly = Math.floor(cy + (R() - 0.5) * h * 0.55);
      put(g, lx, ly, 'W'); put(g, lx + 1, ly + (R() < 0.5 ? 1 : -1), 'W');
    }
    for (y = 0; y < h; y++) if (at(g, w - 1, y) !== '.') put(g, w - 1, y, 'W');
    return g;
  }
  var BEAMPAL = { c: '#6ee8ff', z: '#2a8cff', n: '#18287c' };
  def('beam_t1', 24, 10, [beamFrame(24, 10, 0, 1), beamFrame(24, 10, 1, 1)], BEAMPAL);
  def('beam_t2', 40, 16, [beamFrame(40, 16, 0, 2), beamFrame(40, 16, 1, 2)], { c: '#7ff0ff', z: '#3a8cff', n: '#1a2a8c' });
  def('beam_t3', 64, 24, [beamFrame(64, 24, 0, 3), beamFrame(64, 24, 1, 3)], { c: '#b8f8ff', z: '#6a9cff', n: '#3a2aa8' });
  def('bullet_charged', 24, 10, [beamFrame(24, 10, 0, 1)], BEAMPAL);    // v1 name: alias of beam_t1 frame 0

  /* our alternative weapons */
  (function () {
    var g = mk(6, 6);
    ell(g, 3, 3, 3, 3, 'z'); ell(g, 3, 3, 2.2, 2.2, 'c'); ell(g, 3, 3, 1.1, 1.1, 'W');
    def('bullet_spread', 6, 6, [g], { z: '#3a9a1a', c: '#b8ff5a' });
  })();
  def('bullet_wave', 8, 6, [[
    '..cWWc..',
    '.cWWWWc.',
    'zcWWWWcz',
    'zccWWccz',
    '.zzccZz.',
    '..zzzz..'
  ], [
    '..zzzz..',
    '.zccccz.',
    'zcWWWWcz',
    'zcWWWWcz',
    '.cWWWWc.',
    '..cWWc..'
  ]], { z: '#18a0a0', c: '#60f0d8', Z: '#18a0a0' });
  def('bullet_laser', 16, 3, [[
    '.vvvvvvvvvvvvvv.',
    'WWWWWWWWWWWWWWWW',
    '.vvvvvvvvvvvvvv.'
  ]], { v: '#b89cff' });

  /* hostile projectiles */
  def('enemy_bullet', 6, 6, [[
    '.KKKK.',
    'KrYYrK',
    'KYWWYK',
    'KYWWYK',
    'KrYYrK',
    '.KKKK.'
  ], [
    '.KKKK.',
    'KoWWoK',
    'KWYYWK',
    'KWYYWK',
    'KoWWoK',
    '.KKKK.'
  ]]);

  (function () {
    var fr = [];
    for (var f = 0; f < 2; f++) {
      var g = mk(10, 10), i, base = f ? Math.PI / 8 : 0;
      for (i = 0; i < 8; i++) {
        var a = base + i * Math.PI / 4, len = (i % 2) ? 4.6 : 4.95;
        line(g, 4.5, 4.5, 4.5 + Math.cos(a) * len, 4.5 + Math.sin(a) * len, 'h');
        put(g, 4.5 + Math.cos(a) * len, 4.5 + Math.sin(a) * len, 'H');
      }
      ell(g, 5, 5, 3.6, 3.6, 'Z');                         // bright rim so it pops on brown ground
      ell(g, 5, 5, 3, 3, function (x, y, u, v) {
        var l = -u * 0.6 - v * 0.8; return l > 0.3 ? 'H' : (l < -0.35 ? 'h' : ((x + y + f) % 3 === 0 ? 'h' : 'H'));
      });
      put(g, 4, 4, 'W');
      fr.push(g);
    }
    def('hair_ball', 10, 10, fr, { h: '#a8682c', H: '#f0bc70', Z: '#fff0c0' });
  })();

  /* ================================================================ BUTTS ==
   * butt(o) builds a hairy butt-alien on a char grid:
   *  two shaded cheeks -> 1px outline -> outward hair strokes -> interior fur ->
   *  vertical crack -> mouth in the crack (lip, throat, teeth, tongue, ball,
   *  lip hair) -> optional angry eyes / bruises. */
  var FLESH = 'pLlLdD';
  function hairStroke(g, R, x, y, ang, len) {
    var ux = Math.cos(ang), uy = Math.sin(ang);
    for (var i = 0; i <= len; i++) {
      var px = Math.round(x + ux * i), py = Math.round(y + uy * i);
      if (at(g, px, py) === '.') put(g, px, py, (i === len && len > 0) ? 'H' : 'h');
    }
  }
  function teethRing(g, mx, my, rx, ry, n, len, tw, a0) {
    for (var i = 0; i < n; i++) {
      var a = a0 + i * 2 * Math.PI / n, ca = Math.cos(a), sa = Math.sin(a);
      var bx = mx + ca * rx * 0.95, by = my + sa * ry * 0.95;
      var nx = -ca / rx, ny = -sa / ry, nl = Math.sqrt(nx * nx + ny * ny); nx /= nl; ny /= nl;
      var px = -ny, py = nx;
      var rA = 1 / Math.sqrt((ca / rx) * (ca / rx) + (sa / ry) * (sa / ry));   // ellipse radius at this angle
      var tl = Math.max(2, Math.min(len, Math.round(rA * 0.42)));
      for (var t = 0; t < tl; t++) {
        var hw = (1 - t / tl) * (tw / 2);
        for (var k = -Math.floor(hw); k <= Math.floor(hw); k++) {
          var X = Math.round(bx + nx * t + px * k), Y = Math.round(by + ny * t + py * k);
          var cur = at(g, X, Y);
          if (cur === 'm' || cur === 'M' || cur === 'w' || cur === 's')
            put(g, X, Y, (t >= tl - 1 || k > 0 && t > tl / 2) ? 's' : 'w');
        }
      }
    }
  }
  function butt(o) {
    var w = o.w, h = o.h, g = mk(w, h), R = rng(o.seed || 7), i, x, y;
    var cx = o.cx, cy = o.cy, rx = o.rx, ry = o.ry, sep = o.sep;
    var C = [{ x: cx - sep, y: cy + (o.lDy || 0) }, { x: cx + sep, y: cy + (o.rDy || 0) }];
    C.forEach(function (c) {
      ell(g, c.x, c.y, rx, ry, function (px, py, u, v) {
        var rr = u * u + v * v, l = -0.55 * u - 0.8 * v + (o.dither ? (((px + py) & 1) ? 0.05 : -0.05) : 0);
        var a = u + 0.4, b = v + 0.45;
        if (a * a + b * b < (o.spot || 0.07)) return 'L';
        if (l > 0.32 && rr < 0.8) return 'l';
        if (l < -0.78 && rr > 0.5) return 'D';
        if (l < -0.3) return 'd';
        return 'p';
      });
    });
    outline(g, 'K', false);
    if (o.outline2) outline(g, 'K', false);

    // ---- hair radiating from the outline
    var cand = [];
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (g[y][x] !== '.') continue;
      if (at(g, x + 1, y) === 'K' || at(g, x - 1, y) === 'K' || at(g, x, y + 1) === 'K' || at(g, x, y - 1) === 'K')
        cand.push([x, y]);
    }
    cand.forEach(function (p) {
      if (R() >= (o.hair || 0.4)) return;
      var c = p[0] + 0.5 < cx ? C[0] : C[1];
      var dx = p[0] + 0.5 - c.x, dy = (p[1] + 0.5 - c.y) * 0.8;
      var len = 1 + (R() < (o.hairLong || 0.4) ? 1 : 0) + (o.hairMax && R() < 0.5 ? o.hairMax : 0);
      hairStroke(g, R, p[0], p[1], Math.atan2(dy, dx) + (R() - 0.5) * 0.9, len);
    });

    // ---- fur flecks on the cheeks
    var cw = o.cw, st = Math.round(cx - cw / 2), cols = [];
    for (i = 0; i < cw; i++) cols.push(st + i);
    for (i = 0; i < (o.fur || 0); i++) {
      var ci = R() < 0.5 ? 0 : 1, u = (R() * 2 - 1) * 0.85, v = (R() * 2 - 1) * 0.85;
      if (u * u + v * v > 0.62) continue;
      var fx = Math.floor(C[ci].x + u * rx), fy = Math.floor(C[ci].y + v * ry);
      if (Math.abs(fx + 0.5 - cx) < cw / 2 + 1.5) continue;
      if (o.fur > 30 && inSet(at(g, fx, fy), 'plLdD')) {
        var fa = (ci ? Math.PI * 0.28 : Math.PI * 0.72) + (R() - 0.5) * 0.9, fl = 2 + Math.floor(R() * 3);
        for (var q = 0; q <= fl; q++) {
          var qx = Math.round(fx + Math.cos(fa) * q), qy = Math.round(fy + Math.sin(fa) * q);
          if (inSet(at(g, qx, qy), 'plLdD')) put(g, qx, qy, q === fl ? 'H' : 'h');
        }
      } else if (inSet(at(g, fx, fy), 'plLdD')) {
        put(g, fx, fy, 'h');
        var sx = ci ? 1 : -1;
        if (inSet(at(g, fx + sx, fy - 1), 'plLdD') && R() < 0.8) put(g, fx + sx, fy - 1, 'h');
        if (o.fur > 30 && inSet(at(g, fx + 2 * sx, fy - 1), 'plLdD') && R() < 0.4) put(g, fx + 2 * sx, fy - 1, 'H');
      }
    }

    // ---- the crack
    var topY = -1, botY = -1;
    for (y = 0; y < h; y++) {
      var cc = at(g, cols[0], y);
      if (cc !== '.' && cc !== 'h' && cc !== 'H') { if (topY < 0) topY = y; botY = y; }
    }
    for (y = 0; y < h; y++) cols.forEach(function (col) {
      var cc = at(g, col, y);
      if (cc !== '.' && cc !== 'h' && cc !== 'H') put(g, col, y, 'K');
    });
    for (y = 0; y < h; y++) [st - 1, st + cw].forEach(function (col) {
      var cc = at(g, col, y);
      if (cc === 'p' || cc === 'l' || cc === 'L') put(g, col, y, 'd');
      else if (cc === 'd') put(g, col, y, 'D');
    });
    if (topY >= 0) {
      for (i = 0; i < (o.tuft || 3); i++) hairStroke(g, R, cols[0] + R() * cw, topY - 1, -Math.PI / 2 + (R() - 0.5) * 1.7, 1 + Math.floor(R() * (o.tuftLen || 2)));
      for (i = 0; i < (o.tuft || 3); i++) hairStroke(g, R, cols[0] + R() * cw, botY + 1, Math.PI / 2 + (R() - 0.5) * 1.7, 1 + Math.floor(R() * (o.tuftLen || 2)));
    }

    // ---- the mouth
    var M = o.mouth;
    if (M) {
      var mx = cx, my = cy + (M.dy || 0), lipW = M.lip || 0;
      ell(g, mx, my, M.rx + lipW + 1, M.ry + lipW + 1, 'K');
      if (lipW) ell(g, mx, my, M.rx + lipW, M.ry + lipW, function (px, py, u, v) { return v < -0.45 ? 'p' : (v > 0.55 ? 'D' : 'd'); });
      ell(g, mx, my, M.rx, M.ry, function (px, py, u, v) {
        return (u * u + v * v < 0.3 || v < -0.55) ? 'M' : 'm';
      });
      if (M.ball) {                                       // hairball about to be spat
        var br = M.ball;
        ell(g, mx, my + 1, br + 1, br + 1, 'K');
        ell(g, mx, my + 1, br, br, function (px, py, u, v) { return (-u * 0.6 - v * 0.8) > 0.2 ? 'H' : 'h'; });
        for (i = 0; i < 8; i++) {
          var ba = i * Math.PI / 4 + 0.3;
          put(g, mx + Math.cos(ba) * (br + 1.6), my + 1 + Math.sin(ba) * (br + 1.6), 'H');
        }
      }
      if (M.tongue) {
        var T = M.tongue, tcx = mx, tcy = my + M.ry * (T.dy || 0.45);
        ell(g, tcx, tcy, T.rx, T.ry, function (px, py, u, v) {
          var cur = at(g, px, py);
          if (cur !== 'm' && cur !== 'M') return null;
          if (Math.abs(px + 0.5 - tcx) < 0.6 && v > -0.2) return 'T';
          return (-u * 0.5 - v * 0.9) > 0.45 ? 'q' : 't';
        });
      }
      if (M.teeth) teethRing(g, mx, my, M.rx, M.ry, M.teeth.n, M.teeth.len, M.teeth.w, M.teeth.a0 || 0.3);
      if (M.tongueOut) {                                  // lolling tongue over lower lip
        var TO = M.tongueOut, ty0 = my + M.ry * 0.3;
        for (y = Math.floor(ty0); y < my + M.ry + lipW + 1 + TO.len; y++) {
          var prog = (y - ty0) / (M.ry * 0.7 + lipW + 1 + TO.len);
          var half = TO.w * (1 - Math.pow(Math.max(0, prog - 0.6) / 0.4, 2) * 0.9);
          for (x = Math.floor(mx - half - 1); x <= Math.ceil(mx + half); x++) {
            var du = (x + 0.5 - mx) / half;
            if (Math.abs(du) > 1) continue;
            var edge = Math.abs(du) > 0.78 || y >= my + M.ry + lipW + TO.len;
            put(g, x, y, Math.abs(x + 0.5 - mx) < 0.9 && y > my + M.ry ? 'T' : (edge ? 'T' : (du < -0.3 ? 'q' : 't')));
          }
        }
      }
      for (i = 0; i < (M.lipHair || 0); i++) {            // hairs round the lips
        var la = i / M.lipHair * 2 * Math.PI + (R() - 0.5) * 0.3;
        var r0x = M.rx + lipW + 1.6, r0y = M.ry + lipW + 1.6;
        hairStroke(g, R, mx + Math.cos(la) * r0x, my + Math.sin(la) * r0y,
          Math.atan2(Math.sin(la) * 1.0 / r0y, Math.cos(la) / r0x) + (R() - 0.5) * 0.5, 1 + Math.floor(R() * (M.lipHairLen || 2)));
      }
    }

    // ---- angry eyes
    if (o.eyes) {
      C.forEach(function (c, ci) {
        var ex = c.x + (ci ? -0.6 : 0.6), ey = c.y - ry * 0.28, inward = ci ? -1 : 1;
        if (o.wink === ci + 1 || o.wink === 3) {                            // winking: a happy closed-eye arc
          line(g, ex - 2.6, ey + 0.4, ex, ey - 0.8, 'K'); line(g, ex, ey - 0.8, ex + 2.6, ey + 0.4, 'K');
          line(g, ex - 2.6, ey + 1.4, ex, ey, 'K'); line(g, ex, ey, ex + 2.6, ey + 1.4, 'K');
          return;
        }
        ell(g, ex, ey, o.eyes + 1.1, o.eyes * 0.8 + 1.1, 'K');
        ell(g, ex, ey, o.eyes, o.eyes * 0.8, 'e');
        rect(g, Math.floor(ex + inward * 0.9 - 0.5 + (ci ? 0 : 0)), Math.floor(ey - 0.2), 2, 2, 'K');
        line(g, ex - inward * 3.4, ey - 3.6, ex + inward * 2.4, ey - 1.5, 'K');
        line(g, ex - inward * 3.4, ey - 4.6, ex + inward * 2.4, ey - 2.5, 'D');
      });
    }

    // ---- damage (boss only): bruises + cracks
    if (o.dmg) {
      var RD = rng(o.dmgSeed || 91);
      var bru = [[-0.3, -0.2, 7, 9], [0.45, 0.2, 6, 8], [-0.1, 0.55, 6, 5], [0.2, -0.55, 5, 6], [-0.55, 0.35, 5, 7]];
      bru.forEach(function (b, bi) {
        var c = C[bi % 2];
        var bx = c.x + b[0] * rx, by = c.y + b[1] * ry;
        ell(g, bx, by, b[2], b[3], function (px, py, u, v) {
          var cur = at(g, px, py);
          if (!inSet(cur, 'pLldD')) return null;
          return (u * u + v * v > 0.55) ? 'U' : 'u';
        });
      });
      for (i = 0; i < 6; i++) {
        var cI = C[i % 2], px0 = cI.x + (RD() * 2 - 1) * rx * 0.6, py0 = cI.y + (RD() * 2 - 1) * ry * 0.6;
        var ddx = RD() < 0.5 ? -1 : 1, ddy = RD() < 0.5 ? -1 : 1, n = 12 + Math.floor(RD() * 14);
        for (var s = 0; s < n; s++) {
          if (inSet(at(g, px0, py0), 'plLdDuU')) { put(g, px0, py0, 'K'); if (inSet(at(g, px0 + 1, py0), 'plLdDuU')) put(g, px0 + 1, py0, 'K'); }
          px0 += RD() < 0.65 ? ddx : 0; py0 += (RD() < 0.65 ? ddy : 0) + (RD() < 0.18 ? -ddy : 0);
        }
      }
      for (i = 0; i < 6; i++) {                             // blood/sweat flecks
        var bxp = cx + (RD() * 2 - 1) * (sep + rx * 0.8), byp = cy + (RD() * 2 - 1) * ry * 0.8;
        if (inSet(at(g, bxp, byp), 'plLdDuU')) { put(g, bxp, byp, 'r'); put(g, bxp, byp + 1, 'r'); }
      }
    }
    return g;
  }

  /* ---- butt_small 16x16 */
  (function () {
    var P = [
      { l: 0, r: 0, mr: 0.6, my: 1.0 }, { l: -1, r: 0, mr: 1.0, my: 1.6 },
      { l: -1, r: -1, mr: 1.5, my: 2.4 }, { l: 0, r: -1, mr: 1.8, my: 3.0 }];
    var fr = P.map(function (p, f) {
      return butt({
        w: 16, h: 16, seed: 21 + f * 0, cx: 7.5, cw: 1, cy: 8.8, rx: 3.5, ry: 4.6, sep: 2.2,
        lDy: p.l, rDy: p.r, hair: 0.55, hairLong: 0.35, fur: 3, tuft: 2, tuftLen: 2, spot: 0.06,
        mouth: { dy: 0.8, rx: p.mr, ry: p.my, teeth: f >= 2 ? { n: 4, len: 1, w: 1 } : null }
      });
    });
    def('butt_small', 16, 16, fr);
  })();

  /* ---- butt_mid 24x24 (angry eyes) */
  (function () {
    var P = [
      { l: 0, r: 0, mr: 1.4, my: 2.2 }, { l: -1, r: 0, mr: 1.9, my: 2.9 },
      { l: -1, r: -1, mr: 2.4, my: 3.6 }, { l: 0, r: -1, mr: 2.8, my: 4.2 }];
    var fr = P.map(function (p, f) {
      return butt({
        w: 24, h: 24, seed: 33, cx: 12, cw: 2, cy: 13, rx: 6.1, ry: 7.2, sep: 3.5,
        lDy: p.l, rDy: p.r, hair: 0.65, hairLong: 0.5, fur: 14, tuft: 3, tuftLen: 3, spot: 0.06,
        eyes: 2.1,
        mouth: { dy: 3.4, rx: p.mr, ry: p.my, teeth: { n: 6, len: 2, w: 2 }, lipHair: f >= 2 ? 6 : 4 }
      });
    });
    def('butt_mid', 24, 24, fr, { p: '#f27468', l: '#ff9c8e', L: '#ffd8cc', d: '#c43a4c', D: '#82203c' });   // flushed & furious
  })();

  /* ---- butt_spitter 24x20 (frames 2-3 spit) */
  (function () {
    var P = [
      { l: 0, r: 0, sep: 3.6, mr: 3.1, my: 4.4, ball: 0 },
      { l: -1, r: 0, sep: 3.6, mr: 3.5, my: 4.8, ball: 0 },
      { l: 0, r: 0, sep: 3.2, mr: 4.0, my: 5.2, ball: 2.4 },
      { l: -1, r: -1, sep: 3.9, mr: 4.4, my: 5.6, ball: 0 },
      { l: 0, r: 0, sep: 4.3, mr: 4.0, my: 5.4, ball: 3, rx: 6.8, ry: 6.9 }];     // frame 4 = WIND-UP (cheeks puffed, hairball swelling)
    var fr = P.map(function (p, f) {
      return butt({
        w: 24, h: 20, seed: 45, cx: 12, cw: 2, cy: 10.6, rx: p.rx || 6.3, ry: p.ry || 6.3, sep: p.sep,
        lDy: p.l, rDy: p.r, hair: 0.5, hairLong: 0.5, fur: 10, tuft: 3, tuftLen: 3, spot: 0.06,
        mouth: {
          dy: 0.8, rx: p.mr, ry: p.my, ball: p.ball || 0,
          teeth: { n: 9, len: 2, w: 2 }, lipHair: 8,
          tongue: p.ball ? null : { rx: p.mr * 0.7, ry: p.my * 0.35, dy: 0.5 }
        }
      });
    });
    def('butt_spitter', 24, 20, fr, { p: '#c4d25a', l: '#e8f48c', L: '#fbffd0', d: '#869c34', D: '#566a26' });   // bloated, sickly
  })();

  /* ---- butt_charger 20x16 : a horizontal butt (mouth at the nose, left) with a rocket strapped on */
  (function () {
    var P = [
      { l: 0, r: 0, mr: 1.1, my: 1.5, fl: 4 }, { l: -1, r: 0, mr: 1.4, my: 2.1, fl: 2 },
      { l: 0, r: -1, mr: 1.7, my: 2.6, fl: 3 }];
    var fr = P.map(function (p, f) {
      var v = butt({
        w: 16, h: 11, seed: 57, cx: 7.5, cw: 1, cy: 5.7, rx: 3.5, ry: 4.4, sep: 2.2,
        lDy: p.l, rDy: p.r, hair: 0.45, hairLong: 0.35, fur: 3, tuft: 2, tuftLen: 2, spot: 0.06,
        mouth: { dy: -2.0, rx: p.mr, ry: p.my, teeth: { n: 5, len: 1, w: 1 } }
      });
      var g = mk(20, 16);
      paste(g, transpose(v), 1, 0);
      // rocket pod on the back
      for (var x = 11; x <= 15; x++) {
        put(g, x, 6, 'K'); put(g, x, 9, 'K');
        put(g, x, 7, x === 13 ? 'r' : 'g'); put(g, x, 8, x === 13 ? 'R' : 'G');
      }
      put(g, 11, 7, 'K'); put(g, 11, 8, 'K'); put(g, 16, 7, 'G'); put(g, 16, 8, 'G');
      put(g, 16, 6, 'K'); put(g, 16, 9, 'K'); put(g, 17, 7, 'K'); put(g, 17, 8, 'K');
      put(g, 12, 7, 'W');
      // flames
      for (var k = 0; k < p.fl; k++) {
        var fx = 17 + k; if (fx > 19) break;
        put(g, fx, 7, k < 1 ? 'W' : k < 3 ? 'Y' : 'o'); put(g, fx, 8, k < 1 ? 'Y' : k < 3 ? 'y' : 'r');
        if (k < 2) { put(g, fx, 6, 'o'); put(g, fx, 9, 'r'); }
      }
      if (f === 1) { put(g, 19, 6, 'o'); put(g, 19, 9, 'r'); }
      return g;
    });
    def('butt_charger', 20, 16, fr, { g: '#b0b8c8', G: '#6a7488' });
  })();

  /* ============================================================ ALIEN EYE == */
  (function () {
    var fr = [], look = [[-1, 0], [-2, 0.5], [-1, 1], [0, 0.5]];
    for (var f = 0; f < 4; f++) {
      var g = mk(16, 16), i, y, ph = f * Math.PI / 2;
      ell(g, 8, 6.8, 6.4, 5.6, function (x, yy, u, v) {
        var l = -u * 0.5 - v * 0.8;
        return l < -0.45 ? 'f' : (l < 0 && u * u + v * v > 0.6 ? 'E' : 'e');
      });
      outline(g, 'K', false);
      // iris, pupil, glint
      var ix = 8 + look[f][0], iy = 6.5 + look[f][1];
      ell(g, ix, iy, 3.3, 3.3, function (x, yy, u, v) { return (u * u + v * v > 0.5) ? 'I' : 'i'; });
      rect(g, Math.floor(ix - 0.5 - 0), Math.floor(iy - 0.5), 2, 2, 'K');
      put(g, ix - 1.6, iy - 1.8, 'W');
      // bloodshot veins
      var vn = [[3, 5, 5, 6], [3, 8, 5, 7], [13, 4, 11, 5], [12, 9, 11, 8]];
      vn.forEach(function (q, k) { if ((k + f) % 3 !== 0) line(g, q[0], q[1], q[2], q[3], 'r'); });
      // tentacles
      var bx = [5, 7, 9, 11];
      for (i = 0; i < 4; i++) for (y = 11; y < 16; y++) {
        var dx = Math.round(Math.sin(ph + i * 1.3 + (y - 11) * 0.9) * 0.45 * (y - 10));
        put(g, bx[i] + dx, y, y >= 15 ? 'V' : (y % 2 ? 'v' : 'V'));
        if (y < 14) put(g, bx[i] + dx + 1, y, 'V');
      }
      fr.push(g);
    }
    def('alien_eye', 16, 16, fr, {
      f: '#9fb4d8', E: '#dce6f8', i: '#38d078', I: '#1a8a4c', v: '#c070e8', V: '#7a3aa8'
    });
  })();

  /* =========================================================== ALIEN SQUID == */
  (function () {
    var fr = [];
    for (var f = 0; f < 4; f++) {
      var g = mk(20, 24), i, y, ph = f * Math.PI / 2;
      // fins
      ell(g, 3.4, 9.5, 2.4, 3.8, 'c'); ell(g, 16.6, 9.5, 2.4, 3.8, 'c');
      outline(g, 'K', false);
      var g2 = mk(20, 24);
      ell(g2, 10, 8.8, 6.4, 7.8, function (x, yy, u, v) {
        var l = -u * 0.55 - v * 0.8;
        if (l > 0.4 && u * u + v * v < 0.8) return 'a';
        if (l < -0.35) return 'c';
        return ((x * 3 + yy * 5) % 11 === 0 && v < 0.2) ? 'a' : 'b';
      });
      for (y = 0; y < 5; y++) for (i = 0; i < 20; i++) if (Math.abs(i + 0.5 - 10) > 1.6 + y * 1.1) g2[y][i] = '.';
      outline(g2, 'K', false);
      paste(g, g2, 0, 0);
      // eyes + beak
      [[7, 12.4], [13, 12.4]].forEach(function (e, k) {
        ell(g, e[0], e[1], 2.2, 2, 'K'); ell(g, e[0], e[1], 1.5, 1.3, 'y');
        put(g, e[0] + (k ? -0.4 : 0.4), e[1], 'K');
      });
      line(g, 5, 10, 8, 11, 'K'); line(g, 15, 10, 12, 11, 'K');   // angry brows
      put(g, 9, 15, 'o'); put(g, 10, 15, 'o'); put(g, 9, 16, 'K'); put(g, 10, 16, 'K');
      // tentacles
      var bx = [4.5, 7.2, 9.8, 12.4, 15.2];
      for (i = 0; i < 5; i++) for (y = 16; y < 24; y++) {
        var dx = Math.round(Math.sin(ph + i * 1.1 + (y - 16) * 0.7) * (0.6 + (y - 16) * 0.28));
        var xx = Math.round(bx[i]) + dx;
        put(g, xx, y, y >= 22 ? 'c' : 'b');
        if (y < 20) put(g, xx + 1, y, 'c');
        if (y % 3 === 0) put(g, xx, y, 'a');
      }
      fr.push(g);
    }
    def('alien_squid', 20, 24, fr, { a: '#a8fff0', b: '#22c0a4', c: '#0e7a7c' });
  })();

  /* ================================================================= BOSS ==
   * Three 96x80 bosses share one body generator, 7 poses each (+ a bruised _dmg set):
   * 0 closed  1 part-open  2 open  3 swallow (wide open + tongue)  4 wind-up (clenched, veins, sweat)
   * 5 blast (mouth wide, cheeks flared)  6 flinch (squeezed, impact stars).
   * Mouth centre stays at (48,41) in every pose so meta().mouth lines up with the art.
   * Built lazily on first use (Sprites.prewarm to do it during the stage intro). */
  var BOSS_POSE = [
    { open: 0,    lDy: 0,  rDy: 0,  sep: 12,   tongueOut: 0 },
    { open: 0.35, lDy: -1, rDy: 0,  sep: 13.05 },
    { open: 0.7,  lDy: 0,  rDy: -1, sep: 14.1 },
    { open: 1,    lDy: -2, rDy: -2, sep: 15,   tongueOut: 1 },
    { open: 0,    lDy: 1,  rDy: 1,  sep: 10.4 },                     // wind-up
    { open: 0.9,  lDy: -2, rDy: -2, sep: 15.6, flare: 1 },           // blast
    { open: 0,    lDy: 2,  rDy: 2,  sep: 8.6,  flinch: 1 }           // flinch
  ];
  function walk(g, x, y, steps, c, R, set) {                          // jagged vein / crack on flesh
    var dx = R() < 0.5 ? -1 : 1, dy = R() < 0.5 ? -1 : 1, i;
    for (i = 0; i < steps; i++) {
      if (inSet(at(g, x, y), set)) put(g, x, y, c);
      x += R() < 0.7 ? dx : 0; y += (R() < 0.6 ? dy : 0) + (R() < 0.15 ? -dy : 0);
    }
  }
  function bossPose(f, dmg, V) {
    var P = BOSS_POSE[f], open = P.open;
    var mrx = 3 + open * 10, mry = 13 + open * 9;
    var g = butt({
      w: 96, h: 80, seed: 11, cx: 48, cw: 3, cy: 41, rx: P.flinch ? 28 : 29, ry: P.flinch ? 30 : 32, sep: P.sep,
      lDy: P.lDy, rDy: P.rDy, hair: 0.9, hairLong: 0.7, hairMax: 2, fur: 230, tuft: 10, tuftLen: 6,
      spot: 0.05, outline2: true, dither: true, dmg: dmg, dmgSeed: V.dmgSeed,
      mouth: {
        dy: 0, rx: mrx, ry: mry, lip: 3,
        teeth: { n: 12, len: 6 + Math.round(open * 4), w: 5, a0: 0.15 },
        tongue: open > 0.3 ? { rx: mrx * 0.85, ry: mry * 0.5, dy: 0.5 } : null,
        tongueOut: P.tongueOut ? { len: 7, w: 7.5 } : null,
        lipHair: 34, lipHairLen: 5
      }
    });
    var FL = 'pLldDuU', R = rng(500 + f);
    if (f === 4) {                                                    // wind-up: bulging veins + sweat
      var vs = [[24, 22], [30, 50], [20, 38], [72, 24], [66, 52], [76, 40], [34, 62], [62, 64], [28, 30], [70, 34], [40, 20], [58, 22]], i;
      for (i = 0; i < vs.length; i++) { walk(g, vs[i][0], vs[i][1], 16, 'r', R, FL); walk(g, vs[i][0] + 1, vs[i][1], 10, 'R', R, FL); }
      [[14, 20], [82, 24], [18, 58]].forEach(function (d) {
        put(g, d[0], d[1], 'e'); put(g, d[0], d[1] + 1, 'e'); put(g, d[0] - 1, d[1] + 1, 'q'); put(g, d[0] + 1, d[1] + 1, 'q'); put(g, d[0], d[1] + 2, 'q');
      });
    }
    if (f === 6) {                                                    // flinch: impact stars + ow-lines
      [[24, 30], [74, 50], [30, 58]].forEach(function (c) {
        line(g, c[0] - 4, c[1], c[0] + 4, c[1], 'W'); line(g, c[0], c[1] - 4, c[0], c[1] + 4, 'W');
        line(g, c[0] - 3, c[1] - 3, c[0] + 3, c[1] + 3, 'Y'); line(g, c[0] - 3, c[1] + 3, c[0] + 3, c[1] - 3, 'Y');
      });
      line(g, 8, 36, 14, 38, 'K'); line(g, 88, 34, 82, 36, 'K'); line(g, 10, 46, 16, 45, 'K'); line(g, 86, 46, 80, 45, 'K');
    }
    if (V.deco) V.deco(g, f);
    return g;
  }
  function bossFrames(V, dmg) { var o = [], f; for (f = 0; f < 7; f++) o.push(bossPose(f, dmg, V)); return o; }

  function hornAt(g, bx, by, side, h) {                               // curved bone horn, base inside the head
    var t, pts = [];
    for (t = 0; t <= 1.001; t += 0.05) pts.push([bx + side * (t * t * 9 + t * 2), by - t * h]);
    var tmp = mk(96, 80);
    pts.forEach(function (p, k) {
      var r = 3.2 * (1 - k / pts.length) + 0.6;
      ell(tmp, p[0], p[1], r, r, function (x, y, u, v) { return (-u * 0.5 - v * 0.5) > 0.1 ? 'w' : 's'; });
    });
    outline(tmp, 'K', false);
    paste(g, tmp, 0, 0);
  }
  function decoCrack(g, f) {
    hornAt(g, 31, 16, -1, 17); hornAt(g, 65, 16, 1, 17);
    var y, x, c;                                                       // white terry-cloth sweat-band, red edges
    for (y = 22; y <= 28; y++) for (x = 6; x < 90; x++) {
      c = at(g, x, y);
      if ('pLldDuU'.indexOf(c) >= 0) put(g, x, y, (y === 22 || y === 28) ? 'R' : ((y === 23 || y === 27) ? 'r' : ((x + y) % 6 === 0 ? 'q' : 'W')));
    }
    line(g, 12, 25, 6, 33, 'r'); line(g, 12, 26, 9, 35, 'R'); line(g, 12, 25, 4, 29, 'r');   // knot tails
    ell(g, 12, 25.5, 2.6, 2.6, 'R'); put(g, 11, 24, 'r');
  }
  function decoGod(g, f) {
    var i, x, y, a;
    for (a = 0; a < 6.283; a += 0.015) {                              // halo: golden ring BEHIND the head (only on empty cells)
      x = 48 + Math.cos(a) * 40; y = 9 + Math.sin(a) * 6.5;
      for (var t = 0; t < 2; t++) if (at(g, x, y + t) === '.') put(g, x, y + t, t ? 'o' : 'Y');
    }
    var spikes = [37, 42.5, 48, 53.5, 59];
    for (x = 36; x <= 60; x++) for (y = 6; y <= 9; y++) put(g, x, y, y === 6 ? 'Y' : (y === 9 ? 'o' : 'y'));    // crown band
    spikes.forEach(function (px, k) {
      var hh = k % 2 ? 4 : 6, j, w;
      for (j = 0; j < hh; j++) { w = Math.round(1.6 * (1 - j / hh)); for (var q = -w; q <= w; q++) put(g, px + q, 5 - j, j === hh - 1 ? 'W' : (q > 0 ? 'o' : 'Y')); }
    });
    put(g, 48, 7, 'r'); put(g, 48, 8, 'r'); put(g, 41, 8, 'c'); put(g, 55, 8, 'c');                 // gems
    var tmp = mk(96, 80);
    for (y = 0; y <= 10; y++) for (x = 34; x <= 62; x++) if ('YyoWrc'.indexOf(at(g, x, y)) >= 0) tmp[y][x] = 'x';
    for (y = 0; y <= 11; y++) for (x = 33; x <= 63; x++) if (tmp[y][x] === '.' && (tmp[y][x - 1] === 'x' || tmp[y][x + 1] === 'x' || (y > 0 && tmp[y - 1][x] === 'x') || tmp[y + 1][x] === 'x') && 'YyoWrc'.indexOf(at(g, x, y)) < 0) put(g, x, y, 'K');
  }
  var BOSS_V = [
    { name: 'boss_butt', deco: null, dmgSeed: 91, pal: {}, dpal: { u: '#8a4aa8', U: '#52207a' } },
    { name: 'boss_crack', deco: decoCrack, dmgSeed: 92,
      pal: { p: '#e8603c', L: '#ffc890', l: '#ff9262', d: '#aa2e28', D: '#681a22', h: '#2a0c10', H: '#8a2a1c', m: '#3a0610', t: '#ffb02a', T: '#c06a10', q: '#ffe08a', R: '#7a1018' },
      dpal: { u: '#7a2a58', U: '#44123c' } },
    { name: 'boss_god', deco: decoGod, dmgSeed: 93,
      pal: { p: '#74cc62', L: '#eaffbc', l: '#b4f488', d: '#3a8a40', D: '#1c5232', h: '#6a5008', H: '#f0c838', m: '#0e3a22', M: '#06200f', w: '#fff6c8', s: '#d8c070', c: '#5fe8ff' },
      dpal: { u: '#5a7aa8', U: '#2c3a78' } }
  ];
  BOSS_V.forEach(function (V) {
    var pal = V.pal, dp = {}, k;
    for (k in pal) dp[k] = pal[k];
    for (k in V.dpal) dp[k] = V.dpal[k];
    lazy(V.name, 96, 80, 7, function () { return bossFrames(V, false); }, pal);
    lazy(V.name + '_dmg', 96, 80, 7, function () { return bossFrames(V, true); }, dp);
  });

  /* ============================================================ EXPLOSIONS == */
  function boomFrame(S, R0, bands, hole, drop, seed, f) {
    var g = mk(S, S), c = S / 2, rnd = rng(seed), x, y;
    var p1 = rnd() * 6, p2 = rnd() * 6, p3 = rnd() * 6;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
      var lump = 1 + 0.17 * Math.sin(3 * a + p1) + 0.11 * Math.sin(5 * a + p2) + 0.07 * Math.sin(9 * a + p3);
      var t = d / (R0 * lump);
      if (t > 1) continue;
      if (d < hole) { if (hole > 0 && rnd() < 0.55) put(g, x, y, 'S'); continue; }
      if (t > 0.45 && rnd() < drop) continue;
      var col = t < bands[0] ? 'W' : t < bands[1] ? 'Y' : t < bands[2] ? 'o' : t < bands[3] ? 'r' : 'X';
      if (f >= 4 && col !== 'X' && rnd() < 0.25) col = 'S';
      put(g, x, y, col);
    }
    // flying sparks
    for (var i = 0; i < Math.floor(R0 / 2.5); i++) {
      var sa = rnd() * 6.283, sr = R0 * (0.9 + rnd() * 0.35);
      var px = c + Math.cos(sa) * sr, py = c + Math.sin(sa) * sr;
      if (at(g, px, py) === '.') put(g, px, py, rnd() < 0.5 ? 'Y' : 'o');
    }
    return g;
  }
  def('explosion', 32, 32, [
    boomFrame(32, 7.5, [0.55, 0.9, 1.0, 1.0], 0, 0, 101, 0),
    boomFrame(32, 11.5, [0.4, 0.7, 0.92, 1.0], 0, 0, 102, 1),
    boomFrame(32, 14.5, [0.22, 0.5, 0.76, 0.93], 0, 0, 103, 2),
    boomFrame(32, 15.5, [0.0, 0.38, 0.68, 0.9], 4, 0.14, 104, 3),
    boomFrame(32, 15.5, [0.0, 0.0, 0.42, 0.74], 8, 0.30, 105, 4),
    boomFrame(32, 15.5, [0.0, 0.0, 0.0, 0.5], 11, 0.58, 106, 5)
  ], { S: '#4a3a5a' });
  def('explosion_small', 16, 16, [
    boomFrame(16, 4, [0.55, 0.95, 1.0, 1.0], 0, 0, 111, 0),
    boomFrame(16, 6.2, [0.35, 0.7, 0.92, 1.0], 0, 0, 112, 1),
    boomFrame(16, 7.4, [0.0, 0.4, 0.72, 0.92], 2, 0.15, 113, 2),
    boomFrame(16, 7.6, [0.0, 0.0, 0.4, 0.7], 4.5, 0.45, 114, 3)
  ], { S: '#4a3a5a' });

  /* ============================================================== POWER-UPS == */
  (function () {
    var LET = {
      P: ['XXX', 'X.X', 'XXX', 'X..', 'X..'], S: ['XXX', 'X..', 'XXX', '..X', 'XXX'],
      B: ['XX.', 'X.X', 'XX.', 'X.X', 'XX.'], O: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
      // new icons (v2): spread fan, laser bar, wave "~", force pod ring
      '3': ['...XX', '.XX..', 'XXXXX', '.XX..', '...XX'], L: ['.X....', '.XXXXX', 'XXXXXX', '.XXXXX', '.X....'],
      '~': ['......', '.XX..X', 'X..XX.', '......'], F: ['.XXX.', 'X...X', 'X.X.X', 'X...X', '.XXX.']
    };
    function cap(letter, pal, f) {
      var g = mk(12, 12), x, y;
      for (y = 1; y <= 10; y++) for (x = 1; x <= 10; x++) {
        if ((x === 1 || x === 10) && (y === 1 || y === 10)) continue;
        var c = y <= 2 ? 'a' : (y >= 9 || x === 10) ? 'c' : 'b';
        if (f) c = (c === 'a') ? 'W' : (c === 'b' ? 'a' : 'b');
        put(g, x, y, c);
      }
      outline(g, 'K', false);
      var gl = LET[letter], gw = gl[0].length, gh = gl.length, ox = Math.round(5.5 - gw / 2), oy = Math.round(5.5 - gh / 2);
      for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) if (gl[y][x] === 'X') {
        put(g, ox + 1 + x, oy + 1 + y, 'c');
      }
      // redraw letter on top of shadow pass in correct order
      for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) if (gl[y][x] === 'X') put(g, ox + x, oy + y, 'W');
      put(g, 2, 2, f ? 'W' : 'a');
      if (f) { put(g, 9, 9, 'W'); }
      return g;
    }
    var spec = {
      pu_power: ['P', { a: '#ff9a9a', b: '#e02a2a', c: '#8a1020' }],
      pu_speed: ['S', { a: '#a8f59a', b: '#2ec04a', c: '#146a2a' }],
      pu_shield: ['B', { a: '#9ad8ff', b: '#2a78e0', c: '#143a8a' }],
      pu_option: ['O', { a: '#ffd890', b: '#f08a1c', c: '#8a4210' }],
      pu_force: ['F', { a: '#fff0a0', b: '#e8b410', c: '#7a5200' }],
      pu_spread: ['3', { a: '#e8b0ff', b: '#a040e0', c: '#521a8a' }],
      pu_laser: ['L', { a: '#f4f8ff', b: '#8294b8', c: '#3a4668' }],
      pu_wave: ['~', { a: '#a0fff0', b: '#18b8b0', c: '#0a6068' }]
    };
    Object.keys(spec).forEach(function (n) {
      def(n, 12, 12, [cap(spec[n][0], spec[n][1], 0), cap(spec[n][0], spec[n][1], 1)], spec[n][1]);
    });
  })();

  /* ============================================================== HAIR TUFT == */
  (function () {
    var fr = [];
    for (var f = 0; f < 3; f++) {
      var g = mk(8, 8), i, rot = f * 0.55, R = rng(77);
      for (i = 0; i < 5; i++) {
        var a = rot + i * 1.25 + (R() - 0.5) * 0.4, len = 2.2 + R() * 1.6;
        line(g, 3.5, 3.5, 3.5 + Math.cos(a) * len, 3.5 + Math.sin(a) * len, 'h');
        put(g, 3.5 + Math.cos(a) * len, 3.5 + Math.sin(a) * len, 'H');
      }
      put(g, 3, 3, 'h'); put(g, 4, 4, 'h'); put(g, 3, 4, 'H');
      fr.push(g);
    }
    def('hair_tuft', 8, 8, fr);
  })();

  /* ==================================================== v2 GAMEPLAY / FX SPRITES == */

  /* ---- force pod 16x16: orange armoured sphere with a rotating band, cyan core (0-3 spin, 4-5 flash) */
  (function () {
    var fr = [];
    for (var f = 0; f < 6; f++) {
      var g = mk(16, 16), spin = f < 4 ? f : 0, fl = f >= 4, ang = spin * Math.PI / 2 + 0.4;
      ell(g, 8, 8, 8, 8, 'K');
      ell(g, 8, 8, 7, 7, function (x, y, u, v) {
        var l = -u * 0.6 - v * 0.8, c;
        c = l > 0.5 ? 'Y' : (l > 0.12 ? 'y' : (l > -0.35 ? 'o' : (l > -0.7 ? 'r' : 'R')));
        if (fl) c = (f === 4) ? (l > 0.1 ? 'W' : 'Y') : (l > -0.3 ? 'W' : 'y');
        return c;
      });
      var i;
      for (i = 0; i < 16; i++) {                                   // equator band with rotating rivets
        var bx = Math.round(8 + Math.cos(i / 16 * 6.283 + ang) * 6.6), by = Math.round(8 + Math.sin(i / 16 * 6.283 + ang) * 2.2);
        if (Math.sin(i / 16 * 6.283 + ang) > -0.1) put(g, bx, by, fl ? 'W' : (i % 4 === 0 ? 'Y' : 'R'));
      }
      ell(g, 8, 8, 3.1, 3.1, 'K');
      ell(g, 8, 8, 2.3, 2.3, function (x, y, u, v) { return fl ? 'W' : ((-u - v) > 0.5 ? 'W' : (v > 0.2 ? 'C' : 'c')); });
      put(g, Math.round(8 + Math.cos(ang) * 1.2), Math.round(8 + Math.sin(ang) * 1.2), 'W');
      fr.push(g);
    }
    def('force', 16, 16, fr, { c: '#5fe8ff', C: '#1c8ad0' });
  })();

  /* ---- charge orb 16x16: 0-1 growing, 2 tier-1 (+ring), 3 tier-2 (+double ring), 4-5 tier-3 flicker */
  (function () {
    var rad = [2.2, 3.6, 4.8, 5.6, 6.4, 6.4], fr = [];
    for (var f = 0; f < 6; f++) {
      var g = mk(16, 16), r = rad[f], i, a;
      ell(g, 8, 8, r + 1, r + 1, 'z');
      ell(g, 8, 8, r, r, function (x, y, u, v) { return (u * u + v * v) < 0.35 ? 'W' : 'c'; });
      if (f >= 4) {
        ell(g, 8, 8, r + 1, r + 1, f === 4 ? 'W' : 'c');
        ell(g, 8, 8, r, r, function (x, y, u, v) { return (u * u + v * v) < 0.5 ? 'W' : (f === 4 ? 'c' : 'Y'); });
      }
      if (f >= 2) for (a = 0; a < 6.283; a += 0.35) put(g, 8 + Math.cos(a) * (r + 2), 8 + Math.sin(a) * (r + 2), 'c');
      if (f >= 3) for (a = 0; a < 6.283; a += 0.22) put(g, 8 + Math.cos(a) * (r + 3 - (f >= 4 ? 0.4 : 0)), 8 + Math.sin(a) * (r + 3 - (f >= 4 ? 0.4 : 0)), 'W');
      if (f >= 4) for (i = 0; i < 8; i++) {                         // sparks
        var sa = i * 0.785 + (f === 5 ? 0.39 : 0);
        put(g, 8 + Math.cos(sa) * 7.4, 8 + Math.sin(sa) * 7.4, 'W');
      }
      fr.push(g);
    }
    def('charge_orb', 16, 16, fr, { c: '#6ee8ff', z: '#2a8cff' });
  })();

  /* ---- muzzle flash 8x8 (left edge = nose tip, vertical centre = row 4) */
  (function () {
    var spec = [[3.4, 3.2, 7], [2.6, 2.2, 5], [1.6, 1.3, 3]], fr = [];
    spec.forEach(function (sp, f) {
      var g = mk(8, 8);
      ell(g, sp[0], 4, sp[0] + 0.4, sp[1], function (x, y, u, v) { return (u * u + v * v) < 0.35 ? 'W' : (f === 2 ? 'o' : 'Y'); });
      for (var x = 0; x < sp[2]; x++) put(g, x, 3.5 + (x % 2 ? 0 : 0.5), x > sp[2] - 3 ? 'o' : 'Y');
      if (f < 2) { put(g, 1, 1, 'o'); put(g, 1, 6, 'o'); }
      fr.push(g);
    });
    def('muzzle', 8, 8, fr);
  })();

  /* ---- bullet hit spark 8x8 */
  def('bullet_hit', 8, 8, [[
    '...WW...',
    '...WW...',
    '.W.WW.W.',
    'WWWWWWWW',
    'WWWWWWWW',
    '.W.WW.W.',
    '...WW...',
    '...WW...'
  ], [
    'Y..oo..Y',
    '.Y.YY.Y.',
    '..YWWY..',
    'oYWWWWYo',
    'oYWWWWYo',
    '..YWWY..',
    '.Y.YY.Y.',
    'Y..oo..Y'
  ], [
    '.o....o.',
    '........',
    '...r....',
    'o......o',
    '....r...',
    '...r..r.',
    '........',
    '.o....o.'
  ]]);

  /* ---- player death 32x32: ship (at 4,8) flashes, splits, fireball, debris, embers */
  (function () {
    var base = playerBase(), fr = [], R = rng(808), i;
    function chunk(dst, x0, x1, dx, dy) {
      for (var y = 0; y < 16; y++) for (var x = x0; x <= x1; x++)
        if (base[y][x] !== '.') put(dst, x + 4 + dx, y + 8 + dy, base[y][x]);
    }
    function debris(g, n, r0, r1) {
      for (var k = 0; k < n; k++) {
        var a = R() * 6.283, d = r0 + R() * (r1 - r0), cx = 16 + Math.cos(a) * d, cy = 16 + Math.sin(a) * d * 0.8;
        var c = ['w', 'b', 'B', 'g', 'y'][Math.floor(R() * 5)];
        put(g, cx, cy, c); if (R() < 0.5) put(g, cx + 1, cy, c);
      }
    }
    function fire(gr, g) { paste(g, gr, 0, 0); }
    var g;
    g = mk(32, 32); chunk(g, 0, 23, 0, 0);                       // f0: white-hot flash
    for (var y = 0; y < 32; y++) for (var x = 0; x < 32; x++) if (g[y][x] !== '.' && g[y][x] !== 'K') g[y][x] = (x + y) % 2 ? 'W' : 'Y';
    put(g, 3, 16, 'o'); put(g, 2, 16, 'r'); put(g, 28, 16, 'W'); fr.push(g);
    g = mk(32, 32); fire(boomFrame(32, 6, [0.55, 0.9, 1, 1], 0, 0, 801, 1), g);   // f1: split + small fireball
    chunk(g, 0, 9, -3, 2); chunk(g, 10, 16, 0, -3); chunk(g, 17, 23, 3, 1); debris(g, 6, 8, 12); fr.push(g);
    g = mk(32, 32); fire(boomFrame(32, 10.5, [0.4, 0.7, 0.92, 1], 0, 0, 802, 2), g);
    chunk(g, 0, 7, -7, 5); chunk(g, 12, 15, 1, -8); chunk(g, 19, 23, 7, 3); debris(g, 10, 9, 14); fr.push(g);
    g = mk(32, 32); fire(boomFrame(32, 14.5, [0.22, 0.5, 0.76, 0.93], 0, 0, 803, 3), g);
    debris(g, 12, 11, 15); fr.push(g);
    g = mk(32, 32); fire(boomFrame(32, 15.5, [0, 0.3, 0.62, 0.86], 5, 0.2, 804, 4), g); debris(g, 8, 13, 15.5); fr.push(g);
    g = mk(32, 32); fire(boomFrame(32, 14, [0, 0, 0.2, 0.55], 9, 0.5, 805, 5), g); fr.push(g);
    def('player_die', 32, 32, fr, { w: '#eef4ff', g: '#a5b4d4', b: '#6478a8', B: '#3a4a78', c: '#5fe8ff', C: '#1c8ad0', S: '#4a3a5a' });
  })();

  /* ---- shield pop 32x24: the bubble cracks, breaks into arcs, then shards and sparkles */
  (function () {
    var fr = [];
    for (var f = 0; f < 4; f++) {
      var g = mk(32, 24), a, i, R = rng(900 + f);
      for (a = 0; a < 6.283; a += 0.018) {
        var px = 16 + Math.cos(a) * 15.2, py = 12 + Math.sin(a) * 11.2, keep;
        if (f === 0) keep = Math.sin(a * 5) > -0.7;
        else if (f === 1) keep = Math.sin(a * 6 + 1) > 0.15;
        else if (f === 2) keep = Math.sin(a * 11) > 0.72;
        else keep = Math.sin(a * 17) > 0.9;
        if (keep) put(g, px, py, f < 2 ? 'a' : 'b');
        if (f === 0 && keep) put(g, 16 + Math.cos(a) * 14.2, 12 + Math.sin(a) * 10.2, 'b');
      }
      if (f === 0) for (i = 0; i < 3; i++) {                        // cracks
        var ca = 0.7 + i * 2.1;
        line(g, 16 + Math.cos(ca) * 15, 12 + Math.sin(ca) * 11, 16 + Math.cos(ca) * 8, 12 + Math.sin(ca) * 6, 'h');
      }
      var n = [0, 6, 9, 6][f];
      for (i = 0; i < n; i++) {                                     // flying shards / sparkles
        var sa = R() * 6.283, sd = 6 + R() * 9;
        var sx = 16 + Math.cos(sa) * sd * 1.2, sy = 12 + Math.sin(sa) * sd * 0.9;
        put(g, sx, sy, f === 3 ? 'h' : 'g'); if (f < 3) put(g, sx + 1, sy, 'b');
      }
      fr.push(g);
    }
    def('shield_pop', 32, 24, fr, {
      a: 'rgba(140,230,255,0.95)', b: 'rgba(140,230,255,0.55)', f: 'rgba(70,160,255,0.16)',
      h: 'rgba(255,255,255,0.95)', g: 'rgba(190,245,255,0.8)'
    });
  })();

  /* ---- pickup flash 24x24: star + expanding ring */
  (function () {
    var fr = [];
    for (var f = 0; f < 5; f++) {
      var g = mk(24, 24), a, r = [3, 6, 9, 11, 11.8][f], arm = [5, 8, 6, 3, 0][f];
      for (a = 0; a < 6.283; a += 0.04) {
        if (f >= 3 && Math.sin(a * 9 + f) < 0) continue;
        if (f === 4 && Math.sin(a * 5) < 0.3) continue;
        put(g, 12 + Math.cos(a) * r, 12 + Math.sin(a) * r, f < 2 ? 'Y' : (f < 4 ? 'y' : 'o'));
      }
      for (var k = -arm; k <= arm; k++) {
        put(g, 12 + k, 11, Math.abs(k) < arm * 0.5 ? 'W' : 'Y'); put(g, 11, 12 + k, Math.abs(k) < arm * 0.5 ? 'W' : 'Y');
        if (k > -2 && k < 2) { put(g, 12 + k, 12, 'W'); put(g, 12, 12 + k, 'W'); }
      }
      if (f > 0 && f < 4) { put(g, 12 - r * 0.7, 12 - r * 0.7, 'W'); put(g, 12 + r * 0.7, 12 + r * 0.7, 'W'); put(g, 12 + r * 0.7, 12 - r * 0.7, 'Y'); put(g, 12 - r * 0.7, 12 + r * 0.7, 'Y'); }
      fr.push(g);
    }
    def('pu_flash', 24, 24, fr);
  })();

  /* ---- fart puff 12x12 (frame 0 = biggest, brightest burst) */
  (function () {
    var fr = [], spec = [[4.9, 0], [5.3, 0.12], [4.7, 0.3], [3.8, 0.5], [3, 0.72]];
    spec.forEach(function (sp, f) {
      var g = mk(12, 12), R = rng(70 + f);
      var lumps = [[5.8, 6.4, sp[0] * 0.72], [3.6, 5.6, sp[0] * 0.55], [8.2, 6, sp[0] * 0.6], [6, 4, sp[0] * 0.5]];
      lumps.forEach(function (L) {
        ell(g, L[0], L[1], L[2], L[2] * 0.85, function (x, y, u, v) {
          if (R() < sp[1]) return null;
          var l = -u * 0.5 - v * 0.8;
          return l > 0.3 ? 'a' : (l > -0.25 ? 'b' : 'c');
        });
      });
      if (f < 3) outline(g, 'd', false);
      fr.push(g);
    });
    def('fart_puff', 12, 12, fr, { a: '#e4ff96', b: '#a0e03c', c: '#5e9c20', d: '#2e5a14' });
  })();

  /* ---- smoke 8x8 (grey puff rising, thinner each frame) */
  (function () {
    var fr = [], spec = [[2.2, 5.2, 0], [3, 4.4, 0.1], [3.4, 3.6, 0.3], [3.6, 2.8, 0.55]];
    spec.forEach(function (sp, f) {
      var g = mk(8, 8), R = rng(33 + f);
      ell(g, 4, sp[1], sp[0], sp[0] * 0.9, function (x, y, u, v) {
        if (R() < sp[2]) return null; var l = -u * 0.5 - v * 0.8; return l > 0.3 ? 'a' : (l > -0.3 ? 'b' : 'c');
      });
      fr.push(g);
    });
    def('smoke', 8, 8, fr, { a: '#c4bcd4', b: '#807690', c: '#483e5c' });
  })();

  /* ---- life icon 12x8 */
  def('icon_life', 12, 8, [[
    '...KK.......',
    '..KwwKKK....',
    'KKwwwwcKKK..',
    'KygggggwwoKK',
    'KBbbbbbbbKK.',
    '.KBBbbKKK...',
    '..KKKK......',
    '............'
  ]], { w: '#eef4ff', g: '#a5b4d4', b: '#6478a8', B: '#3a4a78', c: '#5fe8ff' });

  /* ---- boss death 64x64: fireball + flesh chunks (lazy) */
  lazy('boss_gib', 64, 64, 8, function () {
    var spec = [[10, [0.55, 0.9, 1, 1], 0, 0], [19, [0.4, 0.7, 0.92, 1], 0, 0], [27, [0.22, 0.5, 0.76, 0.93], 0, 0],
      [31, [0, 0.38, 0.68, 0.9], 6, 0.14], [31, [0, 0, 0.42, 0.74], 12, 0.3], [31, [0, 0, 0, 0.5], 17, 0.5],
      [31, [0, 0, 0, 0.35], 21, 0.7], [30, [0, 0, 0, 0.3], 24, 0.85]], out = [];
    spec.forEach(function (sp, f) {
      var g = boomFrame(64, sp[0], sp[1], sp[2], sp[3], 950 + f, f), R = rng(960), k, t = f / 7;
      if (f >= 1) for (k = 0; k < 14; k++) {
        var a = k * 6.283 / 14 + R() * 0.3, d0 = 5 + R() * 7, sp2 = 14 + R() * 17;
        var d = d0 + sp2 * (1 - (1 - t) * (1 - t)), cx = 32 + Math.cos(a) * d, cy = 32 + Math.sin(a) * d * 0.9 + 14 * t * t;
        var ch = R() < 0.7 ? ['p', 'l', 'd', 'L'] : ['h', 'H', 'h', 'H'], q, w2;
        for (q = -1; q <= 3; q++) for (w2 = -1; w2 <= 3; w2++) if (q < 0 || w2 < 0 || q > 2 || w2 > 2) { if (!((q < 0 || q > 2) && (w2 < 0 || w2 > 2)) && at(g, cx + q, cy + w2) !== 'K') put(g, cx + q, cy + w2, 'K'); }
        for (q = 0; q < 3; q++) for (w2 = 0; w2 < 3; w2++) put(g, cx + q, cy + w2, (q + w2 === 0) ? ch[1] : ((q + w2 >= 3) ? ch[2] : ch[0]));
        put(g, cx, cy, ch[3]);
      }
      out.push(g);
    });
    return out;
  }, { S: '#4a3a5a' });

  /* ---- butt_armored 24x24: hairy butt in white briefs with metal plates; 3 crack levels */
  (function () {
    var fr = [];
    for (var lv = 0; lv < 3; lv++) {
      var g = butt({
        w: 24, h: 24, seed: 83, cx: 12, cw: 2, cy: 13, rx: 6.1, ry: 7.2, sep: 3.5, hair: 0.65, hairLong: 0.5, fur: 6, tuft: 3, tuftLen: 3,
        spot: 0.06, eyes: 2.1, mouth: { dy: 3.4, rx: 1.9, ry: 2.7, teeth: { n: 6, len: 2, w: 2 }, lipHair: 4 }
      }), x, y, R = rng(84 + lv);
      for (y = 14; y < 24; y++) for (x = 0; x < 24; x++) {
        var c = g[y][x];
        if ('pLlLdD'.indexOf(c) < 0 || Math.abs(x + 0.5 - 12) <= 3.5) continue;
        g[y][x] = (c === 'd') ? 'k' : (c === 'D' ? 'u' : 'j');
      }
      for (x = 0; x < 24; x++) if (at(g, x, 14) === 'j' || at(g, x, 14) === 'k') { put(g, x, 14, 'u'); put(g, x, 15, x % 3 === 0 ? 'j' : (at(g, x, 15) === '.' ? '.' : 'k')); }
      [[7, 17], [16, 17]].forEach(function (pt) {                   // metal plates
        for (var j = 0; j < 4; j++) for (var i = 0; i < 4; i++) if (at(g, pt[0] + i, pt[1] + j) !== '.' && at(g, pt[0] + i, pt[1] + j) !== 'K') put(g, pt[0] + i, pt[1] + j, j === 0 || i === 0 ? 'W' : (j === 3 || i === 3 ? 'u' : 'k'));
      });
      if (lv >= 1) {
        walk(g, 5, 15, 8, 'K', R, 'jku'); walk(g, 18, 16, 8, 'K', R, 'jku'); walk(g, 10, 19, 5, 'K', R, 'jku');
      }
      if (lv >= 2) {
        walk(g, 6, 18, 9, 'K', R, 'jku'); walk(g, 17, 20, 9, 'K', R, 'jku'); walk(g, 3, 21, 6, 'K', R, 'jku');
        [[5, 19], [6, 19], [5, 20], [17, 18], [18, 18], [18, 19]].forEach(function (q) { if ('jku'.indexOf(at(g, q[0], q[1])) >= 0) put(g, q[0], q[1], (q[0] + q[1]) % 2 ? 'p' : 'd'); });
        put(g, 4, 18, 'y'); put(g, 19, 17, 'y'); put(g, 7, 21, 'Y');
      }
      fr.push(g);
    }
    def('butt_armored', 24, 24, fr, { j: '#f6f8ff', k: '#b4bcd8', u: '#656f90' });
  })();

  /* ---- gas_cloud 20x16: grinning green fart cloud, 4-frame loop */
  (function () {
    var fr = [];
    for (var f = 0; f < 4; f++) {
      var g = mk(20, 16), ph = f * Math.PI / 2, bl = [[6, 9.5, 4.8, 4], [11, 6.8, 5.4, 4.6], [15, 9.4, 4.3, 3.8], [10, 11, 6, 3.3]];
      bl.forEach(function (b, i) {
        var jx = Math.sin(ph + i * 1.7) * 0.7, jy = Math.cos(ph + i * 2.3) * 0.7;
        ell(g, b[0] + jx, b[1] + jy, b[2], b[3], function (x, y, u, v) { return v < -0.35 ? 'a' : (v > 0.4 ? 'c' : 'b'); });
      });
      outline(g, 'd', false);
      [[8, 8.5], [13, 8.5]].forEach(function (e, k) {                // angry eyes
        ell(g, e[0], e[1], 2, 1.7, 'W'); put(g, e[0] + (k ? -0.6 : 0.6), e[1] + 0.3, 'K'); put(g, e[0] + (k ? -0.6 : 0.6), e[1] - 0.7, 'K');
        line(g, e[0] - (k ? -2 : 2), e[1] - 2.8, e[0] + (k ? -2 : 2), e[1] - 1.8, 'd');
      });
      line(g, 8, 12, 10, 13, 'd'); line(g, 10, 13, 13, 12, 'd'); put(g, 10, 12, 'W'); put(g, 11, 12, 'W');   // grin w/ teeth
      var by = 14 - ((f * 2) % 8) * 0.3;
      ell(g, 18, by, 1.4, 1.4, 'a'); outline(g, 'd', false); put(g, 17, by - 1, 'W');
      fr.push(g);
    }
    def('gas_cloud', 20, 16, fr, { a: '#d4f87a', b: '#8cd030', c: '#549a1c', d: '#27541a' });
  })();

  /* ---- tooth_mine 14x14: hairy ball, gaping toothed mouth, spikes turn */
  (function () {
    var fr = [];
    for (var f = 0; f < 3; f++) {
      var g = mk(14, 14), i, base = f * Math.PI / 12 + 0.2, mr = [1.7, 2.3, 2.9][f];
      for (i = 0; i < 10; i++) {
        var a = base + i * Math.PI / 5, len = (i % 2) ? 6.2 : 6.9;
        line(g, 6.5, 6.5, 6.5 + Math.cos(a) * len, 6.5 + Math.sin(a) * len, 'h');
        put(g, 6.5 + Math.cos(a) * len, 6.5 + Math.sin(a) * len, 'H');
      }
      ell(g, 7, 7, 5.3, 5.3, 'K');
      ell(g, 7, 7, 4.5, 4.5, function (x, y, u, v) { var l = -u * 0.6 - v * 0.8; return l > 0.4 ? 'l' : (l < -0.35 ? 'd' : 'p'); });
      ell(g, 7, 7.3, mr, mr * 1.15, function (x, y, u, v) { return (u * u + v * v < 0.3) ? 'M' : 'm'; });
      teethRing(g, 7, 7.3, mr, mr * 1.15, 6, 2, 2, 0.3 + f * 0.5);
      fr.push(g);
    }
    def('tooth_mine', 14, 14, fr, { h: '#7a4018', H: '#e0a060' });
  })();

  /* ---- butt_turret 16x16: floor mound + hairy stalk + butt head (0 closed, 1 open, 2 firing); base on bottom row */
  (function () {
    var fr = [];
    for (var f = 0; f < 3; f++) {
      var g = mk(16, 16), y, x, R = rng(15);
      ell(g, 9, 14.6, 6.8, 2.6, function (x, y, u, v) { return v < -0.3 ? 'p' : (v > 0.3 ? 'D' : 'd'); });          // mound
      for (y = 8; y <= 13; y++) { put(g, 8, y, 'p'); put(g, 9, y, 'd'); put(g, 10, y, 'D'); }                    // stalk
      for (y = 9; y <= 13; y += 2) { put(g, 7, y, 'h'); put(g, 11, y + 1, 'h'); }
      outline(g, 'K', false);
      var head = butt({
        w: 12, h: 11, seed: 19, cx: 5.5, cw: 1, cy: 5.4, rx: 3.5, ry: 4.6, sep: 2.2, hair: 0.5, hairLong: 0.3, fur: 2, tuft: 2, tuftLen: 2, spot: 0.06,
        mouth: { dy: 0.2, rx: [0.6, 1.3, 1.9][f], ry: [1.4, 2.5, 3.2][f], teeth: f ? { n: 5, len: 1, w: 1 } : null }
      });
      paste(g, head, 0, 0);
      if (f === 2) { put(g, 1, 3, 'Y'); put(g, 0, 2, 'o'); put(g, 0, 4, 'o'); put(g, 2, 4, 'W'); put(g, 1, 4, 'Y'); }
      fr.push(g);
    }
    def('butt_turret', 16, 16, fr);
  })();

  /* ---- midboss_butt 56x48: twin cheeks, hair crown, furious eyes (lazy).  0-1 idle, 2 mouth open, 3 hurt */
  lazy('midboss_butt', 56, 48, 4, function () {
    var P = [{ l: 0, r: 0, mr: 2, my: 8 }, { l: -1, r: 0, mr: 2, my: 8 }, { l: -1, r: -1, mr: 6, my: 11, open: 1 }, { l: 1, r: 1, mr: 2, my: 8, hurt: 1 }];
    return P.map(function (p, f) {
      var g = butt({
        w: 56, h: 48, seed: 71, cx: 28, cw: 2, cy: 25.5, rx: 15.5, ry: 17.5, sep: p.hurt ? 8 : 8.5, lDy: p.l, rDy: p.r,
        hair: 0.8, hairLong: 0.6, hairMax: 1, fur: 60, tuft: 8, tuftLen: 5, spot: 0.06, wink: p.hurt ? 3 : 0, eyes: 3, dither: true,
        mouth: { dy: 0, rx: p.mr, ry: p.my, lip: 1, teeth: { n: 10, len: 3 + (p.open ? 1 : 0), w: 3 }, tongue: p.open ? { rx: p.mr * 0.8, ry: p.my * 0.5, dy: 0.5 } : null, lipHair: 12, lipHairLen: 3 }
      });
      if (p.hurt) {                                                   // impact stars + sweat
        [[12, 14], [44, 34]].forEach(function (c) {
          line(g, c[0] - 3, c[1], c[0] + 3, c[1], 'W'); line(g, c[0], c[1] - 3, c[0], c[1] + 3, 'W');
          line(g, c[0] - 2, c[1] - 2, c[0] + 2, c[1] + 2, 'Y'); line(g, c[0] - 2, c[1] + 2, c[0] + 2, c[1] - 2, 'Y');
        });
      }
      return g;
    });
  });

  /* ============================================ TILEABLE BACKGROUNDS =======
   * Five layers x three themes (0 flesh/violet, 1 lava-red crack, 2 green/gold temple), registered as
   * bg_<layer>_<i>.  Every generator is periodic in x with period = tile width (integer-frequency sines,
   * wrapped value-noise, wrapped bumps), so column 0 continues seamlessly from column W-1.
   * Theme 0 is built eagerly (it is also the v1 alias bg_far / bg_rocks / bg_ceiling); 1-2 lazily. */
  var TAU = Math.PI * 2;
  function hash2(ix, iy, seed) {
    var n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, cell, period, seed) {          // value noise, periodic in x with `period`
    var gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy);
    var fx = gx - ix, fy = gy - iy, n = period / cell;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var x0 = ((ix % n) + n) % n, x1 = (x0 + 1) % n;
    var a = hash2(x0, iy, seed), b = hash2(x1, iy, seed), c = hash2(x0, iy + 1, seed), d = hash2(x1, iy + 1, seed);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  function wrapPut(g, x, y, c) { put(g, ((x % g[0].length) + g[0].length) % g[0].length, y, c); }
  function wrapDist(a, b, P) { var d = Math.abs(a - b) % P; return Math.min(d, P - d); }

  var TH = [
    { // ---- 0: pink flesh / violet (the v1 look)
      ph: [0.6, 2.0, 4.0, 1.3], bumps: [[10, 6, 5], [38, 5, 6], [54, 4, 4], [84, 6, 5], [102, 5, 6], [118, 4, 4]], shape: 'tri',
      rocks: { a: '#c0708c', b: '#80446e', c: '#5e2f58', d: '#44223f', e: '#2e1530', O: '#8a5236', o: '#6b3a2a', q: '#3e2018', g: '#9a6a86', V: '#3a1c5a', r: '#a8305a', K: '#140818' },
      ceil: { a: '#d07a9a', b: '#9a4670', c: '#7a3260', d: '#52204a', e: '#b05882', r: '#6a1c44', K: '#140818' },
      far: { a: '#4a5cb0', b: '#2a3a85', B: '#323f92', c: '#2f3d8a', C: '#1a2260', D: '#141a50', E: '#0c1038', L: '#6a8ae0' },
      mid: { a: '#7a4a98', b: '#4a2a68', c: '#38204f', d: '#2a1840', r: '#c05a90' },
      fore: { a: '#4a2a40', K: '#12060e' }
    },
    { // ---- 1: lava-red crack
      ph: [2.1, 0.4, 5.1, 3.3], bumps: [[8, 3, 8], [30, 4, 9], [46, 3, 6], [70, 3, 9], [92, 4, 8], [110, 3, 6]], shape: 'tri', lava: true,
      rocks: { a: '#d8603c', b: '#7a2e2a', c: '#56201e', d: '#3a1418', e: '#26101a', O: '#5a3a3a', o: '#3e2630', q: '#241418', g: '#a8503a', V: '#3a1018', r: '#ff7a20', K: '#14060a', h: '#2a0a0a', H: '#8a2a1a' },
      ceil: { a: '#e0643c', b: '#8a3030', c: '#64222a', d: '#40161e', e: '#b04838', r: '#ff8a20', K: '#14060a', h: '#2a0a0a', H: '#8a2a1a' },
      far: { a: '#a04060', b: '#5a1a3a', B: '#681f40', c: '#4a1632', C: '#2e0e24', D: '#1c0818', E: '#10040e', L: '#ff9a40' },
      mid: { a: '#b04838', b: '#4a1a22', c: '#35121a', d: '#240c14', r: '#ff8a30' },
      fore: { a: '#5a1a14', K: '#0e0406' }
    },
    { // ---- 2: green / gold temple
      ph: [4.2, 1.1, 2.6, 5.5], bumps: [[16, 3, 7], [48, 3, 9], [80, 3, 7], [112, 3, 9]], shape: 'rect', bricks: true,
      rocks: { a: '#90c870', b: '#4a8a50', c: '#2f6040', d: '#1f4030', e: '#142a22', O: '#d8b048', o: '#8a6a28', q: '#3a3018', g: '#d8e8a0', V: '#0e281a', r: '#e8c850', K: '#08140c', h: '#2f6a30', H: '#7ac060' },
      ceil: { a: '#a0d078', b: '#4a8a58', c: '#336a48', d: '#1f4632', e: '#78b068', r: '#e8c850', K: '#08140c', O: '#d8b048', o: '#8a6a28', h: '#2f6a30', H: '#7ac060' },
      far: { a: '#6ab890', b: '#2e6a58', B: '#357a60', c: '#1f5040', C: '#123a30', D: '#0c2a24', E: '#061814', L: '#f0d870' },
      mid: { a: '#7ab070', b: '#2f5a40', c: '#224434', d: '#16302a', r: '#e8c850' },
      fore: { a: '#2a5a30', K: '#06140a' }
    }
  ];

  function rocksGen(T) {
    var W = 128, H = 40, g = mk(W, H), x, y, ph = T.ph;
    for (x = 0; x < W; x++) {
      var ys = 10 + 3 * Math.sin(TAU * 2 * x / W + ph[0]) + 2 * Math.sin(TAU * 3 * x / W + ph[1]) + 1.5 * Math.sin(TAU * 10 * x / W + ph[2]) + 1 * Math.sin(TAU * 5 * x / W + ph[3]);
      ys = T.bricks ? 12 + 2 * Math.round(Math.sin(TAU * 3 * x / W + ph[0]) * 1.3) : Math.round(ys);
      var bump = 0;
      T.bumps.forEach(function (b) {
        var d = wrapDist(x, b[0], W);
        if (d < b[1]) bump = Math.max(bump, T.shape === 'rect' ? b[2] : Math.round(b[2] * (1 - d / b[1])));
      });
      ys -= bump;
      for (y = Math.max(0, ys - 1); y < H; y++) {
        var dd = y - ys, c;
        if (dd < 0) c = 'K';
        else {
          var n1 = vnoise(x, y, 8, W, 3), n2 = vnoise(x, y, 4, W, 9), n3 = hash2(x, y, 17);
          var brown = vnoise(x, y, 16, W, 21) > 0.55;
          if (dd === 0) c = 'a';
          else if (dd <= 2) c = brown ? 'O' : 'b';
          else if (dd < 9) c = (n2 > 0.55 ? (brown ? 'O' : 'b') : (brown ? 'o' : 'c'));
          else if (dd < 20) c = (n1 > 0.5 ? (brown ? 'o' : 'c') : (brown ? 'q' : 'd'));
          else c = (n2 > 0.6 ? (brown ? 'q' : 'd') : 'e');
          if (dd > 2) {
            var crk = Math.abs(n1 - 0.5), lv = 22 + 4 * Math.sin(TAU * 4 * x / W + 1);
            if (T.lava && Math.abs(y - lv) < 1.15) c = Math.abs(y - lv) < 0.45 ? 'Y' : 'r';
            else if (T.lava && Math.abs(y - lv) < 2.0 && n3 < 0.5) c = 'g';
            else if (crk < 0.012 && dd > 5) c = 'K';
            else if (!T.lava && Math.abs(y - (22 + 4 * Math.sin(TAU * 4 * x / W + 1))) < 0.7) c = 'r';
            else if (Math.abs(y - (31 + 3 * Math.sin(TAU * 6 * x / W + 4))) < 0.55) c = 'V';
            else if (n3 > 0.965) c = 'g';
            else if (n3 < 0.03) c = 'K';
          }
          if (T.bricks && dd > 2) {                       // temple blocks + gold trim
            var by = dd % 7, row = Math.floor(dd / 7);
            if (dd === 3 || dd === 4) c = dd === 3 ? 'O' : 'o';
            else if (by === 0) c = 'V';
            else if (((x + (row % 2) * 8) % 16) === 0) c = 'V';
            else if (by === 1 && c !== 'g') c = (n3 > 0.5) ? 'b' : c;
          }
        }
        put(g, x, y, c);
      }
    }
    for (x = 0; x < W; x++) {                              // short hairs (moss / burnt hair) from the surface
      if (hash2(x, 5, 41 + T.ph[0] * 7 | 0) < 0.13) {
        var top = 0; while (top < H && g[top][x] === '.') top++;
        var len = 1 + Math.floor(hash2(x, 6, 42) * 3);
        for (var k = 1; k <= len; k++) wrapPut(g, x + (k > 2 ? 1 : 0), top - 1 - k + 1, k === len ? 'H' : 'h');
      }
    }
    return g;
  }

  function ceilingGen(T) {
    var W = 128, H = 20, g = mk(W, H), x, y, R = rng(8 + (T.ph[0] * 10 | 0)), yb = [], ph = T.ph;
    var drips = T.shape === 'rect' ? [[10, 3, 3], [42, 3, 4], [74, 3, 3], [106, 3, 4]] : [[8, 4, 3], [30, 5, 4], [50, 3, 3], [76, 4, 3], [98, 5, 4], [118, 3, 3]];
    for (x = 0; x < W; x++) {
      yb[x] = Math.round(8 + 2.2 * Math.sin(TAU * 4 * x / W + 1.0 + ph[0]) + 1.6 * Math.sin(TAU * 5 * x / W + 3.0 + ph[1]) + 0.9 * Math.sin(TAU * 9 * x / W + ph[2]) + 1.2 * Math.sin(TAU * 3 * x / W + ph[3]));
      drips.forEach(function (b) {
        var d = wrapDist(x, b[0], W); if (d < b[1]) yb[x] += Math.round(b[2] * (1 - d / b[1]));
      });
    }
    for (x = 0; x < W; x++) {
      for (y = 0; y <= yb[x] + 1; y++) {
        var n1 = vnoise(x, y, 8, W, 31), n2 = vnoise(x, y, 4, W, 37), n3 = hash2(x, y, 61), c;
        if (y === yb[x] + 1) c = 'K';
        else if (y === yb[x]) c = 'a';
        else if (y >= yb[x] - 1) c = 'e';
        else if (y < 3) c = 'd';
        else c = n1 > 0.58 ? 'e' : (n2 < 0.36 ? 'c' : 'b');
        if (y < yb[x] - 1 && y >= 3) {
          if (Math.abs(n1 - 0.5) < 0.022) c = 'd';
          else if (n3 > 0.97) c = 'a';
          else if (n3 < 0.025) c = 'K';
          else if (Math.abs(y - (5 + 2 * Math.sin(TAU * 6 * x / W + 2))) < 0.5) c = 'r';
        }
        if (T.shape === 'rect' && y < yb[x] && (x % 32 < 2)) c = (x % 32 === 0) ? 'O' : 'o';        // gold ribs
        put(g, x, y, c);
      }
      if (T.lava && yb[x] > 10 && R() < 0.5) { put(g, x, yb[x], 'r'); put(g, x, yb[x] - 1, 'r'); }    // glowing drip tips
    }
    for (var i = 0; i < 30; i++) {                          // hanging hair strands / vines (wrapped)
      var sx = Math.floor(R() * W), len = 3 + Math.floor(R() * 6), ph2 = R() * 6, sway = 0.8 + R() * 0.8, y0 = yb[sx] + 2;
      for (var k = 0; k < len && y0 + k < H; k++)
        wrapPut(g, sx + Math.round(Math.sin(ph2 + k * 0.7) * sway * Math.min(1, k / 2)), y0 + k, k >= len - 1 ? 'H' : 'h');
    }
    return g;
  }
  // hairs on theme ceilings share h/H with the ground palette
  function farGen(T, kind) {
    var W = 128, H = 60, g = mk(W, H), x, y, ph = T.ph, back = [], front = [];
    function circTop(x, c) { var d = wrapDist(x, c[0], W); return d >= c[2] ? 999 : c[1] - Math.sqrt(c[2] * c[2] - d * d); }
    function cone(x, cx, w, hgt) { var d = wrapDist(x, cx, W); return d < w ? hgt * (1 - d / w) : 0; }
    for (x = 0; x < W; x++) {
      if (kind === 0) {
        back[x] = 30 + 7 * Math.sin(TAU * 4 * x / W + 0.3) + 4.5 * Math.sin(TAU * 9 * x / W + 1.7) + 2 * Math.sin(TAU * 17 * x / W) + 3 * Math.sin(TAU * 3 * x / W + 2.2);
        [[14, 3, 11], [50, 4, 14], [78, 3, 12], [114, 4, 15]].forEach(function (s) { back[x] -= cone(x, s[0], s[1], s[2]); });
        front[x] = 44 + 4 * Math.sin(TAU * 5 * x / W + 2) + 2.5 * Math.sin(TAU * 13 * x / W + 0.5);
        front[x] = Math.min(front[x], Math.min(circTop(x, [27, 52, 10]), circTop(x, [38, 52, 10]), circTop(x, [91, 52, 10]), circTop(x, [102, 52, 10])));
      } else if (kind === 1) {                              // volcanoes
        back[x] = 36 + 4 * Math.sin(TAU * 5 * x / W + 1) + 2 * Math.sin(TAU * 14 * x / W);
        [[22, 18, 26], [70, 22, 30], [108, 14, 18]].forEach(function (s) { back[x] -= cone(x, s[0], s[1], s[2]); });
        front[x] = 46 + 3 * Math.sin(TAU * 6 * x / W + 2) + 2 * Math.sin(TAU * 17 * x / W + 1);
        [[44, 8, 7], [92, 10, 8]].forEach(function (s) { front[x] -= cone(x, s[0], s[1], s[2]); });
      } else {                                              // temple columns + domes
        back[x] = 36 + 3 * Math.sin(TAU * 3 * x / W + 0.5) + 2 * Math.sin(TAU * 8 * x / W + 1);
        [[18, 3, 16], [26, 3, 20], [34, 3, 16], [82, 3, 18], [90, 3, 22], [98, 3, 18]].forEach(function (s) { if (wrapDist(x, s[0], W) <= s[1]) back[x] -= s[2]; });
        [[62, 12, 8], [8, 7, 5]].forEach(function (s) { var d = wrapDist(x, s[0], W); if (d < s[1]) back[x] = Math.min(back[x], 31 - s[2] * Math.sqrt(1 - d * d / (s[1] * s[1])) + 6); });
        front[x] = 47 + 3 * Math.sin(TAU * 4 * x / W + 1) + 2 * Math.sin(TAU * 11 * x / W + 2);
      }
    }
    for (x = 0; x < W; x++) {
      var yb = Math.round(back[x]), yf = Math.round(front[x]);
      for (y = 0; y < H; y++) {
        var c = '.';
        if (y >= yb) c = (y === yb) ? 'a' : ((y - yb < 6 && (x + y) % 2 === 0) ? 'b' : (y - yb < 6 ? 'B' : 'b'));
        if (y >= yb + 6) c = 'b';
        if (y >= yf) {
          c = (y === yf) ? 'c' : 'C';
          if (y > yf && y < yf + 4 && (x + y) % 2 === 0) c = 'D';
          if (y >= yf + 4) c = 'D';
          if (y >= H - 6) c = (y + x) % 2 === 0 ? 'E' : 'D';
          if (y >= H - 3) c = 'E';
        }
        if (c !== '.') put(g, x, y, c);
      }
    }
    var lights = kind === 1 ? [[22, 12], [70, 8], [108, 22], [8, 38], [50, 40]] : [[6, 36], [20, 33], [33, 38], [46, 35], [58, 37], [72, 36], [86, 33], [99, 38], [112, 35], [124, 37]];
    lights.forEach(function (p) {
      var c = at(g, p[0], p[1]);
      if (kind === 1) {                                     // crater glow + lava streak down the cone
        if (p[1] < 30) { for (var k = 0; k < 6; k++) if (at(g, p[0], p[1] + k) !== '.') put(g, p[0] + (k % 2), p[1] + k, k < 2 ? 'L' : 'L'); }
      } else if (c === 'b' || c === 'B') put(g, p[0], p[1], 'L');
    });
    if (kind === 1) for (x = 0; x < W; x += 1) if (hash2(x, 3, 77) > 0.985) { var tp = Math.round(back[x]) + 1; if (at(g, x, tp) !== '.') put(g, x, tp, 'L'); }
    return g;
  }

  function midGen(T, kind) {
    var W = 128, H = 48, g = mk(W, H), x, y, ph = T.ph, top = [];
    function bump(x, cx, w, hgt, sharp) { var d = wrapDist(x, cx, W); if (d >= w) return 0; var t = 1 - d / w; return hgt * (sharp ? t : Math.sqrt(t)); }
    for (x = 0; x < W; x++) {
      var base = 34 + 3 * Math.sin(TAU * 4 * x / W + ph[0]) + 1.5 * Math.sin(TAU * 11 * x / W + ph[1]);
      if (kind === 0) {                                     // hairy stalks
        [[10, 3, 18], [26, 2, 24], [48, 3, 20], [66, 2, 28], [90, 3, 22], [104, 2, 26], [120, 3, 16]].forEach(function (s) { base -= bump(x, s[0], s[1], s[2], false) + (wrapDist(x, s[0], W) < 1 ? 2 : 0); });
      } else if (kind === 1) {                              // stalagmites
        [[12, 9, 30], [34, 7, 22], [58, 10, 34], [82, 7, 24], [100, 9, 30], [120, 6, 16]].forEach(function (s) { base -= bump(x, s[0], s[1], s[2], true); });
      } else {                                              // columns + capitals
        [[14, 3, 22], [38, 3, 30], [60, 3, 18], [86, 3, 26], [108, 3, 34]].forEach(function (s) {
          var d = wrapDist(x, s[0], W);
          if (d <= s[1]) base -= s[2]; else if (d <= s[1] + 2 && base > 20) base -= s[2] - 3 * (d - s[1]);
        });
        base = Math.round(base);
      }
      top[x] = Math.round(Math.max(3, base));
    }
    for (x = 0; x < W; x++) for (y = top[x]; y < H; y++) {
      var n3 = hash2(x, y, 5 + kind), c = (y === top[x]) ? 'a' : (y < top[x] + 3 ? 'b' : (y < top[x] + 12 ? 'c' : 'd'));
      if (y > top[x] + 1 && n3 > 0.985) c = 'r';
      else if (y > top[x] + 2 && n3 < 0.04) c = (c === 'b' ? 'c' : 'd');
      put(g, x, y, c);
    }
    if (kind === 0) for (x = 0; x < W; x++) if (hash2(x, 9, 12) < 0.12 && top[x] > 4) wrapPut(g, x, top[x] - 1, 'a');
    return g;
  }

  function foreGen(T, kind) {
    var W = 192, H = 24, g = mk(W, H), x, y, i, R = rng(40 + kind * 7);
    var base = [];
    for (x = 0; x < W; x++) base[x] = 2 + Math.round(1.5 + 1.5 * Math.sin(TAU * 7 * x / W + kind) + 1.2 * Math.sin(TAU * 13 * x / W));
    for (x = 0; x < W; x++) for (y = H - base[x]; y < H; y++) put(g, x, y, y === H - base[x] ? 'a' : 'K');
    var n = kind === 1 ? 14 : 18;
    for (i = 0; i < n; i++) {
      var sx = Math.floor((i + R() * 0.8) * W / n), hgt = (i % 6 === 3) ? 17 + Math.floor(R() * 5) : 6 + Math.floor(R() * 8), lean = (R() - 0.5) * 6, k;
      for (k = 0; k < hgt; k++) {
        var t = k / hgt, cx = sx + lean * t * t + (kind === 0 ? Math.sin(t * 5 + i) * 1.2 : 0), w = kind === 1 ? Math.max(0, 3.2 * (1 - t)) : Math.max(0.6, 1.8 * (1 - t));
        var yy = H - 1 - k;
        for (var q = -Math.floor(w); q <= Math.floor(w); q++) wrapPut(g, Math.round(cx) + q, yy, (q === -Math.floor(w) && w > 1) ? 'a' : 'K');
        if (kind === 2 && k > 3 && k % 3 === 0) { wrapPut(g, Math.round(cx) - 2, yy - 1, 'K'); wrapPut(g, Math.round(cx) + 2, yy - 1, 'K'); wrapPut(g, Math.round(cx) - 1, yy, 'K'); wrapPut(g, Math.round(cx) + 1, yy, 'K'); }
      }
    }
    return g;
  }

  function regLayer(name, w, h, i, build, pal) {
    if (i === 0) def(name, w, h, [build()], pal);
    else lazy(name, w, h, 1, function () { return [build()]; }, pal);
  }
  [0, 1, 2].forEach(function (i) {
    var T = TH[i];
    regLayer('bg_rocks_' + i, 128, 40, i, function () { return rocksGen(T); }, T.rocks);
    regLayer('bg_ceiling_' + i, 128, 20, i, function () { return ceilingGen(T); }, T.ceil);
    regLayer('bg_far_' + i, 128, 60, i, function () { return farGen(T, i); }, T.far);
    regLayer('bg_mid_' + i, 128, 48, i, function () { return midGen(T, i); }, T.mid);
    regLayer('bg_fore_' + i, 192, 24, i, function () { return foreGen(T, i); }, T.fore);
  });
  alias('bg_rocks', 'bg_rocks_0'); alias('bg_ceiling', 'bg_ceiling_0'); alias('bg_far', 'bg_far_0');   // v1 names

  /* ================================================================== LOGO ==
   * "aasssMASTER": chunky 3x glyphs (lowercase cream, caps golden), 3px extrusion, hard outline, hairs on the
   * lowercase tops and a big hairy butt sitting on the M.  Frame 1: the butt winks and opens its mouth. */
  (function () {
    var GL = {
      a: ['011110', '111111', '000011', '011111', '111111', '110011', '111111', '011111'],
      s: ['011111', '111111', '110000', '111110', '011111', '000011', '111111', '111110'],
      M: ['1100011', '1110111', '1111111', '1101011', '1100011', '1100011', '1100011', '1100011', '1100011', '1100011'],
      A: ['011110', '111111', '110011', '110011', '111111', '111111', '110011', '110011', '110011', '110011'],
      S: ['011110', '111111', '110011', '110000', '111110', '011111', '000011', '110011', '111111', '011110'],
      T: ['111111', '111111', '001100', '001100', '001100', '001100', '001100', '001100', '001100', '001100'],
      E: ['111111', '111111', '110000', '110000', '111100', '111100', '110000', '110000', '111111', '111111'],
      R: ['111110', '111111', '110011', '110011', '111111', '111110', '110110', '110011', '110011', '110011']
    };
    var TEXT = 'aasssMASTER', W = 224, H = 56, BASE = 51, SC = 3, GAP = 1, EX = 3;
    var LOW = ['W', 'w', 'w', 'w', 's', 's', 'z', 'z'];
    var GOLD = ['u', 'y', 'y', 'y', 'o', 'o', 'o', 'n', 'n', 'k'];
    var g = mk(W, H), face = mk(W, H), i, x, y, cx0 = 5, pos = [];
    for (i = 0; i < TEXT.length; i++) {
      var ch = TEXT[i], gl = GL[ch], gw = gl[0].length;
      pos.push({ ch: ch, x: cx0, gw: gw, gh: gl.length, low: ch === ch.toLowerCase() });
      cx0 += gw * SC + GAP;
    }
    pos.forEach(function (p) {                              // extrusion
      var gl = GL[p.ch], y0 = BASE - p.gh * SC;
      for (y = 0; y < p.gh; y++) for (x = 0; x < p.gw; x++) if (gl[y][x] === '1') {
        for (var dy = 0; dy < SC; dy++) for (var dx = 0; dx < SC; dx++) {
          var X = p.x + x * SC + dx, Y = y0 + y * SC + dy;
          for (var k = 1; k <= EX; k++) [[k, k], [k - 1, k], [k, k - 1]].forEach(function (o) { if (at(g, X + o[0], Y + o[1]) === '.') put(g, X + o[0], Y + o[1], 'X'); });
        }
      }
    });
    pos.forEach(function (p) {                              // faces
      var gl = GL[p.ch], y0 = BASE - p.gh * SC, pal = p.low ? LOW : GOLD;
      for (y = 0; y < p.gh; y++) for (x = 0; x < p.gw; x++) if (gl[y][x] === '1') {
        for (var dy = 0; dy < SC; dy++) for (var dx = 0; dx < SC; dx++) {
          var X = p.x + x * SC + dx, Y = y0 + y * SC + dy, c = pal[y];
          if (x + 1 >= p.gw || gl[y][x + 1] !== '1') { if (dx === SC - 1) c = p.low ? 'z' : 'o'; }
          put(g, X, Y, c); put(face, X, Y, '1');
        }
      }
    });
    var lst = [];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (face[y][x] !== '1') {
      if (at(face, x + 1, y) === '1' || at(face, x - 1, y) === '1' || at(face, x, y + 1) === '1' || at(face, x, y - 1) === '1') lst.push([x, y]);
    }
    lst.forEach(function (q) { g[q[1]][q[0]] = 'K'; });
    outline(g, 'K', false);
    var R = rng(99);
    pos.forEach(function (p) {                              // hairs on the lowercase tops
      if (!p.low) return;
      var top = BASE - p.gh * SC - 2;
      [2, 7, 12].forEach(function (ox) {
        var hx = p.x + ox, len = 2 + Math.floor(R() * 4), lean = (R() - 0.5) * 1.4;
        for (var j = 0; j < len; j++) put(g, Math.round(hx + lean * j), top - j, j === len - 1 ? 'H' : 'h');
      });
    });
    var M = pos[5], frames = [];
    for (var f = 0; f < 2; f++) {
      var bt = butt({
        w: 28, h: 24, seed: 12, cx: 13.5, cw: 2, cy: 12.5, rx: 7.2, ry: 8.4, sep: 4.4, lDy: 0, rDy: 0, hair: 0.55, hairLong: 0.5,
        fur: 10, tuft: 3, tuftLen: 3, spot: 0.07, eyes: 2, wink: f ? 1 : 0,
        mouth: { dy: 3, rx: f ? 2.3 : 1.3, ry: f ? 3.6 : 2.4, teeth: f ? { n: 6, len: 2, w: 2 } : null, tongue: f ? { rx: 1.8, ry: 1.4, dy: 0.5 } : null }
      });
      var gf = g.map(function (r) { return r.slice(); });
      paste(gf, bt, M.x + 10 - 14, 0);
      frames.push(gf);
    }
    def('logo', W, H, frames, { u: '#fff59a', n: '#e05a1a', k: '#a8301c', z: '#a8946c' });
  })();

  /* ============================================================ RASTERISE ==
   * Eager sprites are rasterised synchronously at load; lazy ones (bosses, themes 1-2,
   * midboss, boss_gib) on first get/draw/meta/prewarm. */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  var canvases = {}, flashCache = {}, shadowCache = {}, metaCache = {};
  function rasterise(name) {
    var d = defs[name];
    if (!d.frames) d.frames = toRows(d.build());
    canvases[name] = d.frames.map(function (rws) {
      var c = makeCanvas(d.w, d.h), ctx = c.getContext('2d'), last = null, x, y;
      for (y = 0; y < rws.length; y++) for (x = 0; x < rws[y].length; x++) {
        var ch = rws[y][x];
        if (ch === '.') continue;
        var col = d.pal[ch] || '#ff00ff';
        if (col !== last) { ctx.fillStyle = col; last = col; }
        ctx.fillRect(x, y, 1, 1);
      }
      return c;
    });
  }
  function resolve(name) {                         // follow aliases; returns a defs key or null
    var d = defs[name], n = 0;
    while (d && d.alias && n++ < 4) { name = d.alias; d = defs[name]; }
    return d && !d.alias ? name : null;
  }
  function getC(name) {                            // canvases of a sprite (building it if lazy) or null
    var k = resolve(name);
    if (!k) return null;
    if (!canvases[k]) rasterise(k);
    return canvases[k];
  }
  Object.keys(defs).forEach(function (n) { if (!defs[n].alias && !defs[n].build) rasterise(n); });
  var MISSING = (function () {
    var c = makeCanvas(8, 8), x = c.getContext('2d');
    x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 8, 8); return c;
  })();

  function silhouette(src, color) {
    var c = makeCanvas(src.width, src.height), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function frameIndex(n, frame) {
    var f = Math.floor(frame || 0);
    return ((f % n) + n) % n;
  }

  /* ============================================================ BITMAP FONT ==
   * 5x7 glyphs, 1px spacing. */
  var FONT = {
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
    '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
    ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
    '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '\'': ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
    '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
    '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
    ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
    '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
    '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
    '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
    '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
    '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
    '"': ['.#.#.', '.#.#.', '.#.#.', '.....', '.....', '.....', '.....'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....']
  };
  var glyphCache = {}, DARK = '#1a0a1f';
  function hexRGB(c) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c).trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function mixHex(c, t, k) {                         // mix colour c toward 255 (t=1) / 0 (t=0) by k
    var rgb = hexRGB(c);
    if (!rgb) return c;
    var tg = t ? 255 : 0, o = rgb.map(function (v) { return Math.round(v + (tg - v) * k); });
    return 'rgb(' + o[0] + ',' + o[1] + ',' + o[2] + ')';
  }
  var STYLES = { plain: 1, shadow: 1, outline: 1, banner: 1 };
  function stampGlyph(ctx, rowsG, color, s, ox, oy, bands) {
    var x, y;
    for (y = 0; y < 7; y++) {
      ctx.fillStyle = bands ? bands[y < 2 ? 0 : (y < 5 ? 1 : 2)] : color;
      for (x = 0; x < 5; x++) if (rowsG[y].charAt(x) === '#') ctx.fillRect(ox + x * s, oy + y * s, s, s);
    }
  }
  /* returns {c, px, py}: canvas + where the glyph's top-left sits inside it */
  function glyphCanvas(ch, color, scale, style) {
    var key = style + '|' + color + '|' + scale + '|' + ch, e = glyphCache[key];
    if (e) return e;
    var rowsG = FONT[ch], s = scale, padL = 0, padT = 0, padR = 0, padB = 0;
    if (style === 'outline') { padL = padT = padR = padB = s; }
    else if (style === 'shadow') { padR = padB = s; }
    else if (style === 'banner') { padL = padT = padR = s; padB = 3 * s; }
    var c = makeCanvas(5 * s + padL + padR, 7 * s + padT + padB), ctx = c.getContext('2d'), dx, dy;
    if (style === 'outline' || style === 'banner') {
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++)
        if (dx || dy) stampGlyph(ctx, rowsG, DARK, s, padL + dx * s, padT + dy * s);
    }
    if (style === 'shadow') stampGlyph(ctx, rowsG, DARK, s, padL + s, padT + s);
    if (style === 'banner') {
      for (dx = -1; dx <= 1; dx++) { stampGlyph(ctx, rowsG, DARK, s, padL + dx * s, padT + 2 * s); stampGlyph(ctx, rowsG, DARK, s, padL + dx * s, padT + s); }
      stampGlyph(ctx, rowsG, color, s, padL, padT, [mixHex(color, 1, 0.55), color, mixHex(color, 0, 0.4)]);
    } else stampGlyph(ctx, rowsG, color, s, padL, padT);
    e = glyphCache[key] = { c: c, px: padL, py: padT };
    return e;
  }
  function advance(ch, scale) { return (ch === ' ' ? 4 : 6) * scale; }
  function textWidth(str, scale) {
    scale = scale || 1; str = String(str == null ? '' : str);
    var w = 0, i;
    for (i = 0; i < str.length; i++) w += advance(str.charAt(i), scale);
    return str.length ? w - scale : 0;
  }
  function text(ctx, str, x, y, color, scale, style) {
    scale = Math.max(1, Math.round(scale || 1)); color = color || '#fff';
    style = STYLES[style] ? style : 'plain';
    str = String(str == null ? '' : str).toUpperCase();
    x = Math.round(x); y = Math.round(y);
    var cx = x, i, ch, e;
    for (i = 0; i < str.length; i++) {
      ch = str.charAt(i);
      if (!FONT[ch]) ch = ' ';
      if (ch !== ' ') { e = glyphCanvas(ch, color, scale, style); ctx.drawImage(e.c, cx - e.px, y - e.py); }
      cx += advance(ch, scale);
    }
    return textWidth(str, scale);
  }

  /* ===================================================================== META ==
   * meta(name, frame) -> {hit:{x,y,w,h}, mouth:{x,y,w,h,open}|null, muzzle:{x,y}|null} (px from the
   * UNFLIPPED sprite's top-left).  hit defaults to the opaque bbox of that frame inset by 2px (1px for
   * sprites <= 12px); the table below overrides it where the art is not the hitbox. */
  function bboxOf(d, f) {
    var rws = d.frames[f], x0 = 999, y0 = 999, x1 = -1, y1 = -1, x, y;
    for (y = 0; y < rws.length; y++) for (x = 0; x < rws[y].length; x++) if (rws[y].charAt(x) !== '.') {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x1 < 0 ? { x: 0, y: 0, w: d.w, h: d.h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function R4(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }
  var BOSS_MOUTH = [
    [45, 28, 6, 26, false], [42, 25, 13, 32, false], [38, 22, 20, 38, true], [35, 19, 26, 44, true],
    [45, 28, 6, 26, false], [36, 20, 24, 42, true], [45, 28, 6, 26, false]];
  function bossMeta(f) {
    var m = BOSS_MOUTH[f % 7];
    return { hit: R4(6, 8, 84, 66), mouth: { x: m[0], y: m[1], w: m[2], h: m[3], open: m[4] }, muzzle: { x: 36, y: 41 } };
  }
  var MID_MOUTH = [[26, 17, 4, 16, false], [26, 17, 4, 16, false], [22, 14, 12, 22, true], [26, 17, 4, 16, false]];
  var META = {
    player: function (f) {
      var o = [[8, 5, 8, 6, 23, 8], [8, 4, 8, 6, 23, 6], [8, 6, 8, 6, 23, 10]][f % 3];
      return { hit: R4(o[0], o[1], o[2], o[3]), muzzle: { x: o[4], y: o[5] } };
    },
    force: function () { return { hit: R4(1, 1, 14, 14), muzzle: { x: 15, y: 8 } }; },
    midboss_butt: function (f) {
      var m = MID_MOUTH[f % 4];
      return { hit: R4(4, 5, 48, 40), mouth: { x: m[0], y: m[1], w: m[2], h: m[3], open: m[4] }, muzzle: { x: 20, y: 25 } };
    },
    butt_turret: function (f) { return { hit: R4(2, 2, 12, 14), muzzle: f > 0 ? { x: 4, y: 5 } : null }; },
    bullet: function () { return { hit: R4(0, 0, 8, 3) }; },
    enemy_bullet: function () { return { hit: R4(1, 1, 4, 4) }; }
  };
  ['boss_butt', 'boss_crack', 'boss_god'].forEach(function (n) { META[n] = bossMeta; META[n + '_dmg'] = bossMeta; });
  function meta(name, frame) {
    var k = resolve(name);
    if (!k) return null;
    var d = defs[k];
    if (!d.frames) getC(k);
    var f = frameIndex(d.frames.length, frame), ck = k + '#' + f, m = metaCache[ck];
    if (m) return m;
    var o = META[k] ? META[k](f) : {}, hit = o.hit;
    if (!hit) {
      var b = bboxOf(d, f), ins = (d.w <= 12 || d.h <= 12) ? 1 : 2;
      hit = R4(b.x + ins, b.y + ins, Math.max(1, b.w - 2 * ins), Math.max(1, b.h - 2 * ins));
    }
    m = metaCache[ck] = { hit: hit, mouth: o.mouth || null, muzzle: o.muzzle || null };
    return m;
  }

  /* =================================================================== THEMES ==
   * theme(i) -> names of the five parallax layers for stage theme i (mod themeCount) + a fog colour. */
  var THEME_FOG = ['#3a1a5a', '#5a1a30', '#1f3a2a'];
  var themeCount = 3;
  function theme(i) {
    i = ((Math.floor(i) || 0) % themeCount + themeCount) % themeCount;
    return { far: 'bg_far_' + i, mid: 'bg_mid_' + i, ceiling: 'bg_ceiling_' + i, ground: 'bg_rocks_' + i, fore: 'bg_fore_' + i, fog: THEME_FOG[i] };
  }

  /* ==================================================================== API */
  function xform(ctx, src, x, y, flipX, flipY) {
    if (flipX || flipY) {
      ctx.save();
      ctx.translate(x + (flipX ? src.width : 0), y + (flipY ? src.height : 0));
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    } else ctx.drawImage(src, x, y);
  }
  var Sprites = {
    get: function (name, frame) {
      var cs = getC(name);
      return cs ? cs[frameIndex(cs.length, frame)] : MISSING;
    },
    frames: function (name) {
      var k = resolve(name);
      return k ? (defs[k].frames ? defs[k].frames.length : defs[k].nf) : 1;
    },
    size: function (name) {
      var k = resolve(name), d = k && defs[k];
      return d ? { w: d.w, h: d.h } : { w: 8, h: 8 };
    },
    draw: function (ctx, name, x, y, opts) {
      opts = opts || {};
      var cs = getC(name), src;
      if (!cs) src = MISSING;
      else {
        var fi = frameIndex(cs.length, opts.frame);
        if (opts.flash) {
          var k = resolve(name) + '#' + fi;
          src = flashCache[k] || (flashCache[k] = silhouette(cs[fi], '#ffffff'));
        } else src = cs[fi];
      }
      x = Math.round(x); y = Math.round(y);
      if (opts.alpha != null && opts.alpha < 1) {
        var pa = ctx.globalAlpha;
        ctx.globalAlpha = pa * Math.max(0, opts.alpha);
        xform(ctx, src, x, y, opts.flipX, opts.flipY);
        ctx.globalAlpha = pa;
      } else xform(ctx, src, x, y, opts.flipX, opts.flipY);
    },
    drawShadow: function (ctx, name, x, y, opts) {
      opts = opts || {};
      var cs = getC(name);
      if (!cs) return;
      var fi = frameIndex(cs.length, opts.frame), k = resolve(name) + '#' + fi;
      var src = shadowCache[k] || (shadowCache[k] = silhouette(cs[fi], '#000000'));
      var sq = opts.squash != null ? opts.squash : 0.4;
      var dh = Math.max(1, Math.round(src.height * sq));
      x = Math.round(x); y = Math.round(y);
      var prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * 0.45 * (opts.alpha != null ? opts.alpha : 1);
      if (opts.flipX) {
        ctx.save();
        ctx.translate(x + src.width, y);
        ctx.scale(-1, 1);
        ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, src.width, dh);
        ctx.restore();
      } else ctx.drawImage(src, 0, 0, src.width, src.height, x, y, src.width, dh);
      ctx.globalAlpha = prev;
    },
    meta: meta,
    theme: theme,
    themeCount: themeCount,
    prewarm: function (names) {
      (names || []).forEach(function (n) { try { getC(n); meta(n, 0); } catch (e) { /* ignore */ } });
    },
    text: text,
    textWidth: textWidth,
    names: function () { return Object.keys(defs); },
    _defs: defs,            // string-array source of every sprite (lazy ones have frames === null until built)
    _font: FONT
  };

  /* ---- self check (C8): every shipped name with its exact size and frame count.  Returns problems[]. */
  var SPEC = {
    player: [24, 16, 3], thruster: [8, 8, 4], option: [8, 8, 4], shield: [32, 24, 2], bullet: [8, 3, 1], bullet_opt: [6, 3, 1],
    bullet_charged: [24, 10, 1], beam_t1: [24, 10, 2], beam_t2: [40, 16, 2], beam_t3: [64, 24, 2], bullet_spread: [6, 6, 1],
    bullet_wave: [8, 6, 2], bullet_laser: [16, 3, 1], enemy_bullet: [6, 6, 2], hair_ball: [10, 10, 2],
    butt_small: [16, 16, 4], butt_mid: [24, 24, 4], butt_charger: [20, 16, 3], butt_spitter: [24, 20, 5], alien_eye: [16, 16, 4],
    alien_squid: [20, 24, 4], butt_armored: [24, 24, 3], gas_cloud: [20, 16, 4], tooth_mine: [14, 14, 3], butt_turret: [16, 16, 3],
    midboss_butt: [56, 48, 4], boss_butt: [96, 80, 7], boss_butt_dmg: [96, 80, 7], boss_crack: [96, 80, 7], boss_crack_dmg: [96, 80, 7],
    boss_god: [96, 80, 7], boss_god_dmg: [96, 80, 7], boss_gib: [64, 64, 8], explosion: [32, 32, 6], explosion_small: [16, 16, 4],
    force: [16, 16, 6], charge_orb: [16, 16, 6], muzzle: [8, 8, 3], bullet_hit: [8, 8, 3], player_die: [32, 32, 6], shield_pop: [32, 24, 4],
    pu_flash: [24, 24, 5], fart_puff: [12, 12, 5], smoke: [8, 8, 4], icon_life: [12, 8, 1],
    pu_power: [12, 12, 2], pu_speed: [12, 12, 2], pu_shield: [12, 12, 2], pu_option: [12, 12, 2],
    pu_force: [12, 12, 2], pu_spread: [12, 12, 2], pu_laser: [12, 12, 2], pu_wave: [12, 12, 2], hair_tuft: [8, 8, 3],
    bg_rocks: [128, 40, 1], bg_ceiling: [128, 20, 1], bg_far: [128, 60, 1], logo: [224, 56, 2]
  };
  [0, 1, 2].forEach(function (i) {
    SPEC['bg_far_' + i] = [128, 60, 1]; SPEC['bg_mid_' + i] = [128, 48, 1]; SPEC['bg_rocks_' + i] = [128, 40, 1];
    SPEC['bg_ceiling_' + i] = [128, 20, 1]; SPEC['bg_fore_' + i] = [192, 24, 1];
  });
  Sprites._spec = SPEC;
  Sprites._selfCheck = function () {
    var bad = [];
    Object.keys(SPEC).forEach(function (n) {
      var sp = SPEC[n], z = Sprites.size(n), nf = Sprites.frames(n), cs = getC(n);
      if (!cs) { bad.push(n + ': missing'); return; }
      if (z.w !== sp[0] || z.h !== sp[1]) bad.push(n + ': size ' + z.w + 'x' + z.h + ' != ' + sp[0] + 'x' + sp[1]);
      if (nf !== sp[2] || cs.length !== sp[2]) bad.push(n + ': frames ' + nf + '/' + cs.length + ' != ' + sp[2]);
      if (cs[0].width !== sp[0] || cs[0].height !== sp[1]) bad.push(n + ': canvas size');
    });
    return bad;
  };

  global.Sprites = Sprites;
})(typeof window !== 'undefined' ? window : this);
