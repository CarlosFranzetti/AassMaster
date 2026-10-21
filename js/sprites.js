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
  (function () {
    var fr = [];
    for (var f = 0; f < 2; f++) {
      var g = mk(6, 6);
      ell(g, 3, 3, 3, 3, 'K');
      ell(g, 3, 3, 2.35, 2.35, function (x, y, u, v) { var l = -u * 0.6 - v * 0.8; return f ? (l > 0.2 ? 'Y' : 'o') : (l > 0.3 ? 'o' : 'r'); });
      ell(g, 3, 3, 1.1, 1.1, f ? 'Y' : 'W');
      put(g, f ? 3 : 2, f ? 3 : 2, 'W');
      fr.push(g);
    }
    def('enemy_bullet', 6, 6, fr);
  })();

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
        if (o.wink === ci + 1) {                            // winking: a happy closed-eye arc
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

  /* ================================================================= BOSS == */
  function bossFrame(f, dmg) {
    var open = [0, 0.35, 0.7, 1][f];
    var lDy = [0, -1, 0, -2][f], rDy = [0, 0, -1, -2][f];
    var mrx = 3 + open * 10, mry = 13 + open * 9;
    return butt({
      w: 96, h: 80, seed: 11, cx: 48, cw: 3, cy: 41, rx: 29, ry: 32, sep: 12 + open * 3,
      lDy: lDy, rDy: rDy, hair: 0.9, hairLong: 0.7, hairMax: 2, fur: 230, tuft: 10, tuftLen: 6,
      spot: 0.05, outline2: true, dither: true, dmg: dmg,
      mouth: {
        dy: 0, rx: mrx, ry: mry, lip: 3,
        teeth: { n: 12, len: 6 + Math.round(open * 4), w: 5, a0: 0.15 },
        tongue: open > 0.3 ? { rx: mrx * 0.85, ry: mry * 0.5, dy: 0.5 } : null,
        tongueOut: f === 3 ? { len: 7, w: 7.5 } : null,
        lipHair: 34, lipHairLen: 5
      }
    });
  }
  (function () {
    var fr = [0, 1, 2, 3].map(function (f) { return bossFrame(f, false); });
    def('boss_butt', 96, 80, fr);
    def('boss_butt_dmg', 96, 80, [bossFrame(2, true)], { u: '#8a4aa8', U: '#52207a' });
  })();

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
      B: ['XX.', 'X.X', 'XX.', 'X.X', 'XX.'], O: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX']
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
      var gl = LET[letter];
      for (y = 0; y < 5; y++) for (x = 0; x < 3; x++) if (gl[y][x] === 'X') {
        put(g, 5 + x, 4 + y, 'c');
      }
      // redraw letter on top of shadow pass in correct order
      for (y = 0; y < 5; y++) for (x = 0; x < 3; x++) if (gl[y][x] === 'X') put(g, 4 + x, 3 + y, 'W');
      put(g, 2, 2, f ? 'W' : 'a');
      if (f) { put(g, 9, 9, 'W'); }
      return g;
    }
    var spec = {
      pu_power: ['P', { a: '#ff9a9a', b: '#e02a2a', c: '#8a1020' }],
      pu_speed: ['S', { a: '#a8f59a', b: '#2ec04a', c: '#146a2a' }],
      pu_shield: ['B', { a: '#9ad8ff', b: '#2a78e0', c: '#143a8a' }],
      pu_option: ['O', { a: '#ffd890', b: '#f08a1c', c: '#8a4210' }]
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

  /* ============================================ TILEABLE BACKGROUNDS ======= */
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

  /* ---- bg_rocks 64x40 : alien rock / flesh ground */
  (function () {
    var W = 64, H = 40, g = mk(W, H), x, y, R = rng(5);
    for (x = 0; x < W; x++) {
      var ys = Math.round(10 + 3 * Math.sin(TAU * 1 * x / W + 0.6) + 2 * Math.sin(TAU * 3 * x / W + 2.0) + 1.5 * Math.sin(TAU * 5 * x / W + 4.0));
      // a few spiky rocks (periodic triangle bumps)
      var bump = 0;
      [[10, 6, 5], [38, 5, 6], [54, 4, 4]].forEach(function (b) {
        var d = wrapDist(x, b[0], W); if (d < b[1]) bump = Math.max(bump, Math.round(b[2] * (1 - d / b[1])));
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
            var crk = Math.abs(n1 - 0.5);
            if (crk < 0.012 && dd > 5) c = 'K';
            else if (Math.abs(y - (22 + 4 * Math.sin(TAU * 2 * x / W + 1))) < 0.7) c = 'r';
            else if (Math.abs(y - (31 + 3 * Math.sin(TAU * 3 * x / W + 4))) < 0.55) c = 'V';
            else if (n3 > 0.965) c = 'g';
            else if (n3 < 0.03) c = 'K';
          }
        }
        put(g, x, y, c);
      }
    }
    // short hairs growing from the surface
    for (x = 0; x < W; x++) {
      if (hash2(x, 5, 41) < 0.14) {
        var top = 0; while (top < H && g[top][x] === '.') top++;
        var len = 1 + Math.floor(hash2(x, 6, 42) * 3);
        for (var k = 1; k <= len; k++) wrapPut(g, x + (k > 2 ? 1 : 0), top - 1 - k + 1 - 0, k === len ? 'H' : 'h');
      }
    }
    def('bg_rocks', W, H, [g], {
      a: '#c0708c', b: '#80446e', c: '#5e2f58', d: '#44223f', e: '#2e1530',
      O: '#8a5236', o: '#6b3a2a', q: '#3e2018', g: '#9a6a86', V: '#3a1c5a', r: '#a8305a', K: '#140818'
    });
  })();

  /* ---- bg_ceiling 64x20 : hairy fleshy ceiling */
  (function () {
    var W = 64, H = 20, g = mk(W, H), x, y, R = rng(8);
    var yb = [];
    for (x = 0; x < W; x++) {
      yb[x] = Math.round(8 + 2.2 * Math.sin(TAU * 2 * x / W + 1.0) + 1.6 * Math.sin(TAU * 5 * x / W + 3.0) + 0.9 * Math.sin(TAU * 9 * x / W));
      // hanging fleshy drips (periodic)
      [[8, 4, 3], [30, 5, 4], [50, 3, 3]].forEach(function (b) {
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
          else if (Math.abs(y - (5 + 2 * Math.sin(TAU * 3 * x / W + 2))) < 0.5) c = 'r';
        }
        put(g, x, y, c);
      }
    }
    // hanging hair strands (wrapped horizontally)
    for (var i = 0; i < 16; i++) {
      var sx = Math.floor(R() * W), len = 3 + Math.floor(R() * 6), ph = R() * 6, sway = 0.8 + R() * 0.8;
      var y0 = yb[sx] + 2;
      for (var k = 0; k < len && y0 + k < H; k++)
        wrapPut(g, sx + Math.round(Math.sin(ph + k * 0.7) * sway * Math.min(1, k / 2)), y0 + k, k >= len - 1 ? 'H' : (k % 2 ? 'h' : 'h'));
    }
    def('bg_ceiling', W, H, [g], {
      a: '#d07a9a', b: '#9a4670', c: '#7a3260', d: '#52204a', e: '#b05882', r: '#6a1c44', K: '#140818'
    });
  })();

  /* ---- bg_far 64x60 : far organic silhouettes, dark blue */
  (function () {
    var W = 64, H = 60, g = mk(W, H), x, y;
    function circTop(x, c) { var d = wrapDist(x, c[0], W); return d >= c[2] ? 999 : c[1] - Math.sqrt(c[2] * c[2] - d * d); }
    var back = [], front = [];
    for (x = 0; x < W; x++) {
      back[x] = 30 + 7 * Math.sin(TAU * 2 * x / W + 0.3) + 4.5 * Math.sin(TAU * 5 * x / W + 1.7) + 2 * Math.sin(TAU * 11 * x / W);
      // spires (tentacle-ish) in the back layer
      var sp = wrapDist(x, 14, W); if (sp < 3) back[x] -= 11 * (1 - sp / 3);
      sp = wrapDist(x, 50, W); if (sp < 4) back[x] -= 14 * (1 - sp / 4);
      front[x] = 44 + 4 * Math.sin(TAU * 3 * x / W + 2) + 2.5 * Math.sin(TAU * 7 * x / W + 0.5);
      // two round "cheek" mounds with a crack between them
      var m = Math.min(circTop(x, [27, 52, 10]), circTop(x, [38, 52, 10]));
      front[x] = Math.min(front[x], m);
    }
    for (x = 0; x < W; x++) {
      for (y = 0; y < H; y++) {
        var c = '.';
        var yb = Math.round(back[x]), yf = Math.round(front[x]);
        if (y >= yb) {
          c = (y === yb) ? 'r1' : 'B';
          c = (y === yb) ? 'a' : ((y - yb < 6 && (x + y) % 2 === 0) ? 'b' : (y - yb < 6 ? 'B' : 'b'));
          if ((y - yb) >= 6) c = 'b';
        }
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
    // faint organic lights on the back layer
    [[6, 36], [20, 33], [33, 38], [46, 35], [58, 37]].forEach(function (p) {
      if (at(g, p[0], p[1]) === 'b' || at(g, p[0], p[1]) === 'B') put(g, p[0], p[1], 'L');
    });
    def('bg_far', W, H, [g], {
      a: '#4a5cb0', b: '#2a3a85', B: '#323f92', c: '#2f3d8a', C: '#1a2260', D: '#141a50', E: '#0c1038', L: '#6a8ae0'
    });
  })();

  /* ================================================================== LOGO ==
   * "aasssMASTER": chunky 2x-scaled glyphs (lowercase pink, caps golden), 2px
   * extrusion, hard outline, hairs on the lowercase tops and a little hairy
   * butt sitting on the M. */
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
    var TEXT = 'aasssMASTER', W = 160, H = 40, BASE = 33, SC = 2, GAP = 2;
    var PINK = ['L', 'l', 'l', 'p', 'p', 'd', 'd', 'D'];
    var GOLD = ['u', 'y', 'y', 'y', 'o', 'o', 'o', 'n', 'n', 'k'];
    var g = mk(W, H), face = mk(W, H), i, x, y, cx0 = 2, pos = [];
    for (i = 0; i < TEXT.length; i++) {
      var ch = TEXT[i], gl = GL[ch], gw = gl[0].length;
      pos.push({ ch: ch, x: cx0, gw: gw, gh: gl.length, low: ch === ch.toLowerCase() });
      cx0 += gw * SC + GAP;
    }
    // extrusion
    pos.forEach(function (p) {
      var gl = GL[p.ch], y0 = BASE - p.gh * SC;
      for (y = 0; y < p.gh; y++) for (x = 0; x < p.gw; x++) if (gl[y][x] === '1') {
        for (var dy = 0; dy < SC; dy++) for (var dx = 0; dx < SC; dx++) {
          var X = p.x + x * SC + dx, Y = y0 + y * SC + dy;
          [[1, 1], [2, 1], [1, 2], [2, 2]].forEach(function (o) { if (at(g, X + o[0], Y + o[1]) === '.') put(g, X + o[0], Y + o[1], 'X'); });
        }
      }
    });
    // faces
    pos.forEach(function (p) {
      var gl = GL[p.ch], y0 = BASE - p.gh * SC, pal = p.low ? PINK : GOLD;
      for (y = 0; y < p.gh; y++) for (x = 0; x < p.gw; x++) if (gl[y][x] === '1') {
        for (var dy = 0; dy < SC; dy++) for (var dx = 0; dx < SC; dx++) {
          var X = p.x + x * SC + dx, Y = y0 + y * SC + dy, c = pal[y];
          // darker right edge of each stroke
          if (x + 1 >= p.gw || gl[y][x + 1] !== '1') { if (dx === SC - 1) c = p.low ? 'd' : 'o'; }
          put(g, X, Y, c); put(face, X, Y, '1');
        }
      }
    });
    // outline the faces (over extrusion), then the whole silhouette
    var lst = [];
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (face[y][x] !== '1') {
      if (at(face, x + 1, y) === '1' || at(face, x - 1, y) === '1' || at(face, x, y + 1) === '1' || at(face, x, y - 1) === '1') lst.push([x, y]);
    }
    lst.forEach(function (q) { g[q[1]][q[0]] = 'K'; });
    outline(g, 'K', false);
    // hairs on the lowercase tops
    var R = rng(99);
    pos.forEach(function (p) {
      if (!p.low) return;
      var top = BASE - p.gh * SC - 2;
      [2, 6, 9].forEach(function (ox, k) {
        var hx = p.x + ox, len = 2 + Math.floor(R() * 3), lean = (R() - 0.5) * 1.2;
        for (var j = 0; j < len; j++) put(g, Math.round(hx + lean * j), top - j, j === len - 1 ? 'H' : 'h');
      });
    });
    // the butt sitting on the M
    var M = pos[5];
    var bt = butt({
      w: 16, h: 13, seed: 12, cx: 7.5, cw: 1, cy: 8, rx: 3.6, ry: 3.9, sep: 2.2, lDy: 0, rDy: 0,
      hair: 0.55, hairLong: 0.5, fur: 2, tuft: 2, tuftLen: 3, spot: 0.07,
      mouth: { dy: 0.6, rx: 0.9, ry: 1.7 }
    });
    paste(g, bt, M.x + 7 - 8, 0);
    def('logo', W, H, [g], { u: '#fff59a', n: '#e05a1a', k: '#a8301c' });
  })();

  /* ============================================================ RASTERISE ==
   * (all synchronous, at load) */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  var canvases = {}, flashCache = {}, shadowCache = {};
  Object.keys(defs).forEach(function (name) {
    var d = defs[name];
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
  });
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
  function frameIndex(name, frame) {
    var n = canvases[name].length, f = Math.floor(frame || 0);
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
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....']
  };
  var glyphCache = {};
  function glyphCanvas(ch, color, scale) {
    var key = color + '|' + scale + '|' + ch, c = glyphCache[key];
    if (c) return c;
    var rowsG = FONT[ch];
    c = makeCanvas(5 * scale, 7 * scale);
    var ctx = c.getContext('2d'), x, y;
    ctx.fillStyle = color;
    for (y = 0; y < 7; y++) for (x = 0; x < 5; x++)
      if (rowsG[y].charAt(x) === '#') ctx.fillRect(x * scale, y * scale, scale, scale);
    glyphCache[key] = c;
    return c;
  }
  function advance(ch, scale) { return (ch === ' ' ? 4 : 6) * scale; }
  function textWidth(str, scale) {
    scale = scale || 1; str = String(str == null ? '' : str);
    var w = 0, i;
    for (i = 0; i < str.length; i++) w += advance(str.charAt(i), scale);
    return str.length ? w - scale : 0;
  }
  function text(ctx, str, x, y, color, scale) {
    scale = Math.max(1, Math.round(scale || 1)); color = color || '#fff';
    str = String(str == null ? '' : str).toUpperCase();
    x = Math.round(x); y = Math.round(y);
    var cx = x, i, ch;
    for (i = 0; i < str.length; i++) {
      ch = str.charAt(i);
      if (!FONT[ch]) ch = ' ';
      if (ch !== ' ') ctx.drawImage(glyphCanvas(ch, color, scale), cx, y);
      cx += advance(ch, scale);
    }
    return textWidth(str, scale);
  }

  /* ==================================================================== API */
  var Sprites = {
    get: function (name, frame) {
      if (!canvases[name]) return MISSING;
      return canvases[name][frameIndex(name, frame)];
    },
    frames: function (name) { return canvases[name] ? canvases[name].length : 1; },
    size: function (name) {
      var d = defs[name];
      return d ? { w: d.w, h: d.h } : { w: 8, h: 8 };
    },
    draw: function (ctx, name, x, y, opts) {
      opts = opts || {};
      var src;
      if (!canvases[name]) src = MISSING;
      else {
        var fi = frameIndex(name, opts.frame);
        if (opts.flash) {
          var k = name + '#' + fi;
          src = flashCache[k] || (flashCache[k] = silhouette(canvases[name][fi], '#ffffff'));
        } else src = canvases[name][fi];
      }
      x = Math.round(x); y = Math.round(y);
      if (opts.flipX) {
        ctx.save();
        ctx.translate(x + src.width, y);
        ctx.scale(-1, 1);
        ctx.drawImage(src, 0, 0);
        ctx.restore();
      } else ctx.drawImage(src, x, y);
    },
    drawShadow: function (ctx, name, x, y, opts) {
      opts = opts || {};
      if (!canvases[name]) return;
      var fi = frameIndex(name, opts.frame), k = name + '#' + fi;
      var src = shadowCache[k] || (shadowCache[k] = silhouette(canvases[name][fi], '#000000'));
      var dh = Math.max(1, Math.round(src.height * 0.4));
      x = Math.round(x); y = Math.round(y);
      var prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * 0.45;
      if (opts.flipX) {
        ctx.save();
        ctx.translate(x + src.width, y);
        ctx.scale(-1, 1);
        ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, src.width, dh);
        ctx.restore();
      } else ctx.drawImage(src, 0, 0, src.width, src.height, x, y, src.width, dh);
      ctx.globalAlpha = prev;
    },
    text: text,
    textWidth: textWidth,
    names: function () { return Object.keys(defs); },
    _defs: defs,            // string-array source of every sprite (for tooling/tests)
    _font: FONT
  };

  global.Sprites = Sprites;
})(typeof window !== 'undefined' ? window : this);
