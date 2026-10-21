# aasssMaster — module contract v2 (READ THIS FIRST)

v1 is tagged `v1`. v2 was designed by the four roles in three discussion rounds; the binding spec is:
  1. team/DIRECTOR-RULINGS.md  (R1-R12: overrides everything below and in rounds 1-2)
  2. team/round3-PIXEL.md, team/round3-SOUND.md, team/round3-MECH.md, team/round3-LEVELS.md  (each role's COMMITTED API)
  3. The FINAL CORRECTIONS section below (fixes the last mismatches between round-3 files; wins over the round-3 files)
  4. This file's v1 sections (kept for anything the above does not mention)

Plain browser JS, NO build step, NO modules. Load order (index.html): sprites.js → sfx.js → levels.js → render.js → game.js.
Internal resolution W=384, H=216, FLOOR=196, CEIL=20. Flat terrain only (R1).

## FINAL CORRECTIONS (binding)
C1. Boss / mid-boss phases use LEVELS' shape: `phases:[{hpAbove, attacks:[ id | {id, ...overrides} ], interval}]`.
    MECH keeps its own default parameters per attack id (fan, spiral, lunge, spawn, rain) and merges per-item overrides
    (`n, arms, dur, type, speed, gapRotate, every, tele, count`) over them. `boss.attacks` dictionary is OPTIONAL: if present
    it overrides the defaults for that boss. MECH also accepts `seq` as an alias of `attacks` for safety. Unknown id → console.warn once.
C2. Charge tiers are frames after the PRESS (R6 literal): 21 = orb + play('charge'); 30 = tier 1; 60 = tier 2; 96 = tier 3.
    MECH's "press+51/81/117" reading is wrong and is replaced by this. SOUND's +0.15/+0.65/+1.25 s after play('charge') is right.
C3. `butt_armored`: LEVELS authors `behavior:'armored', armor:true`; MECH registers 'armored' (and treats the name as armored anyway).
C4. midboss_butt is 56x48 everywhere. LEVELS keys == sprite names for every enemy and boss.
C5. `getStage(raw).boss.hp` and `.midboss.hp` are returned ALREADY loop-scaled by Levels (mods.boss applied inside getStage);
    MECH applies `mods.hp/count/speed/fire` to regular enemies only. All speeds are px/s (`pxps`); MECH drops the >8 heuristic
    but warns on values < 20 in attack params.
C6. SOUND does not provide charge_ready / charge_tier / rock_thud / bullet_ping / bomb_drop; MECH must not call them.
C7. The engine must boot with zero console errors when every module is present, and must not crash if an IF-TIME sprite/sound/track is missing.
C8. Every role ships a self-check: PIXEL (size/frame table assertion), SOUND (fake-AudioContext smoke), LEVELS (`Levels.validate()` → {errors:[], warnings}),
    MECH (Playwright headless run reaching the stage-2 mid-boss and the stage-1 boss kill with no page errors).

## v1 sections (unchanged unless superseded above)
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
