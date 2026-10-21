# aasssMaster — module contract (READ THIS FIRST)

Horizontal pixel-art shmup (R-Type style). You fly left→right, shooting hairy pixel butt-aliens
("aasssMonsters") before they swallow you with their hairy mouth (butt). Landscape, touchscreen-first.

Plain browser JS, NO build step, NO npm, NO modules — every file attaches ONE global and is loaded via
<script> tags in index.html in this order:  sprites.js → sfx.js → levels.js → game.js
Each file must be self-contained and must not read any other file's internals except via the API below.

## Internal resolution
Canvas logical size: W = 384, H = 216 (16:9). Game scales it to the screen with `image-rendering: pixelated`.
All sprites are drawn at 1:1 logical pixels (no sub-pixel; use Math.round on draw positions).
Ground/"floor" line is at y = 196 (shadows are projected onto it). Sky/ceiling occupies 0..20 (hairy ceiling).

## sprites.js  →  global `Sprites`
Procedural pixel art: every sprite is defined as an array of strings (one char per pixel, '.' = transparent)
plus a palette map, rendered once into offscreen canvases at load. No external images, no network.

API:
  Sprites.get(name, frame = 0)          -> HTMLCanvasElement (never undefined for the names below; frame wraps)
  Sprites.frames(name)                   -> number of frames (>= 1)
  Sprites.size(name)                     -> {w, h}
  Sprites.draw(ctx, name, x, y, opts)    -> draws frame at integer (x,y) top-left.
       opts: {frame, flipX, flash}  flash=true draws an all-white silhouette (hit flash).
  Sprites.drawShadow(ctx, name, x, y, opts) -> draws a black 45% alpha silhouette of the frame,
       vertically squashed to 40% height, at (x, y) — the caller computes where. (Used for floor shadows.)
  Sprites.text(ctx, str, x, y, color = '#fff', scale = 1) -> draws with a built-in 5x7 (or 3x5) pixel font,
       chars A-Z 0-9 and .,!?:-'/ space. Returns width drawn.
  Sprites.textWidth(str, scale = 1)

Required sprite names and exact sizes (w x h) and frame counts:
  player            24x16   3 frames: 0 = level flight, 1 = banking up, 2 = banking down. Small spaceship, cool.
  thruster          8x8     4 frames (flame animation, drawn behind player)
  option            8x8     4 frames (orbiting satellite orb, glowing)
  shield            32x24   2 frames (translucent bubble around player)
  bullet            8x3     1 frame (yellow laser)
  bullet_charged    24x8    2 frames (big blue beam, pulsing)
  enemy_bullet      6x6     2 frames (pink blob)
  hair_ball         10x10   2 frames (brown spiky hairball spat by enemies)
  butt_small        16x16   4 frames: hairy pink butt alien, 2 cheeks, frames = hover wobble + mouth opening
  butt_mid          24x24   4 frames: bigger, hairier, angry eyes on cheeks, wobbling
  butt_charger      20x16   3 frames: streamlined butt with a rocket, flames
  butt_spitter      24x20   4 frames: butt with wide open hairy mouth (frames 2-3 = spitting)
  alien_eye         16x16   4 frames: floating eyeball alien with tentacles
  alien_squid       20x24   4 frames: squid alien, tentacles waving
  boss_butt         96x80   4 frames: GIANT hairy butt boss, huge gaping mouth in the crack with teeth,
                              frames = mouth closed → wide open (frame 3 = swallowing pose)
  boss_butt_dmg     96x80   1 frame: same but bruised/cracked (shown under 30% hp)
  explosion         32x32   6 frames
  explosion_small   16x16   4 frames
  pu_power          12x12   2 frames (red "P" capsule, blinking)
  pu_speed          12x12   2 frames (green "S")
  pu_shield         12x12   2 frames (blue "B")
  pu_option         12x12   2 frames (orange "O")
  hair_tuft         8x8     3 frames (little floating hair particle)
  bg_rocks          64x40   1 frame: tileable (horizontally) alien rock/flesh ground, dark purples/browns
  bg_ceiling        64x20   1 frame: tileable hairy fleshy ceiling hanging down
  bg_far            64x60   1 frame: tileable far mountains/organic silhouettes, dark blue
  logo              160x40  1 frame: "aasssMASTER" chunky pixel logo with a butt in it

Style: NES/Genesis palette, hard outlines, 2-3 shade shading, hair = short dark strokes/dots on pink.
Butts must read as butts (two round cheeks, vertical crack, mouth in the crack).

## sfx.js  →  global `SFX`
Procedural Web Audio (oscillators + noise, no files). Must be silent & non-throwing until SFX.init() is
called from a user gesture (touch/click/key). Must not throw if AudioContext is unavailable.

API:
  SFX.init()                  -> creates/resumes AudioContext (idempotent, call on every user gesture)
  SFX.play(name, opts)        -> opts: {volume (0..1), pitch (multiplier)}
  SFX.setMuted(bool) / SFX.muted
  SFX.music.start(track)      -> track: 'title' | 'stage' | 'boss' | 'gameover'. Looping chiptune (arpeggios, bass, drums)
  SFX.music.stop()
  SFX.music.setIntensity(0..1)  -> optional layer control (e.g. boss adds a lead)

Required sound names:
  shoot, shoot_charged, charge (looping rising tone while charging; returns handle with .stop()),
  hit, enemy_die, enemy_die_big, player_die, boss_hit, boss_die, boss_roar, swallow (wet gulp),
  powerup, shield_up, shield_break, option_get, wave_warning, menu_move, menu_select, pause, extra_life,
  fart (comedic, short, used when butt enemies spawn/spit)

## levels.js  →  global `Levels`
Pure data + helpers, no DOM. Wave scripting.

API:
  Levels.enemyTypes   -> { type: { sprite, hp, speed, score, w, h, behavior, fire?, hairy?: true } }
       behavior ∈ 'sine' | 'straight' | 'charge' | 'hover_spit' | 'bounce' | 'swoop' | 'drift' | 'boss'
  Levels.stages       -> array of stages. Each stage: { name, length (seconds), music, bg: {speedFar, speedMid, speedNear, palette},
                         waves: [ { t (seconds), type, count, y (0..1 of playfield or 'rand'), spacing (sec), pattern, path? } ],
                         boss: { type:'boss_butt', hp, phases:[...] } }
  Levels.getWaves(stageIndex, fromT, toT) -> waves whose spawn time t ∈ [fromT, toT)
  Levels.powerupDrop(enemyType, rng)      -> null | 'pu_power'|'pu_speed'|'pu_shield'|'pu_option'

## game.js  →  global `Game`
Everything else: loop, entities, input, collision, rendering, raster FX, shadows, HUD, title, game over.
Boots itself on DOMContentLoaded using #game canvas. Must tolerate a missing sprite gracefully
(draw a magenta rect) and must call SFX.init() on first user gesture.

Features required:
  - Touch (primary): left 60% of screen = drag anywhere to move ship relative to finger (not absolute),
    right 40% = fire zone (tap = shot, hold = autofire, hold ≥0.6s then release = charged shot).
    Also keyboard: arrows/WASD move, Z/space/ctrl fire, X = charged, P/Esc = pause, M = mute.
  - Landscape lock UX: if portrait, show overlay "ROTATE YOUR DEVICE". Fullscreen on first tap where allowed.
  - Raster effects: parallax 3-layer scroll, per-scanline sine distortion on far layer ("heat wave"),
    copper-bar style gradient sky bands, scanline overlay, screen shake, hit-flash, boss-approach red strobe.
  - Shadows: every airborne entity casts a squashed shadow on the floor line (y=196) with alpha that
    fades with altitude (Sprites.drawShadow).
  - Entities: player (3 lives, i-frames after respawn), options (up to 2 orbiting orbs that mirror fire),
    shield, powerups, bullets, charged beam (pierces), enemy bullets, hairballs, 6 enemy types, boss with
    phases + swallow attack (boss lunges, if it touches player → "SWALLOWED" death with SFX.swallow).
  - Score, hi-score (localStorage), combo multiplier, stage progression, game over + restart, pause.
  - 60fps fixed timestep, delta-clamped. Object pooling for bullets/particles.
