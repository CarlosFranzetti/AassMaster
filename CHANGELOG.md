# Changelog

## v2 (tag `v2`)
Built by four parallel role agents from a three-round design discussion (`team/`).

### Gameplay
- Force pod: tap the left side to throw or recall, attaches front or rear, levels 1–3.
- Three weapons from capsules: spread, laser, wave. Power level carries over when you switch.
- Charge rework: three beam tiers at 0.5, 1.0 and 1.6 s; gun fires more slowly once charging.
- Boss rework: mouth is the weak point (body hits do a quarter damage); fan, spiral, lunge, spawn and rain attacks;
  lunge telegraphs with a lane band; shield turns a swallow into a spit-out; mashing fire escapes a gulp.
- Mid-bosses in stages 2 and 3: stage clock freezes while alive, drops a weapon on death, flees after 25 s.
- Chain and graze scoring, hidden rank, recovery drops after a death.
- Checkpoints (stage 2 at 35 s, stage 3 at 40 s) and three continues.
- Formations that spawn on one tick; waves enter from left, top and bottom; floor and ceiling turrets; mines; armored butts.
- Bomb ("BLAST") meter, filled by score, clears enemy shots.
- Stages are 60, 70 and 80 seconds, each with its own theme and boss. The loop restarts with harder enemies.

### Controls
- Left thumb drag moves relative to the finger, with a stick ghost and smoothing.
- Keyboard: C throws or recalls the Force pod, X holds for charge, B blasts, V toggles haptics.
- Haptics on hits and death, saved between sessions.

### Art and sound
- 76 procedural sprites, including three bosses with wind-up, blast and flinch frames and damaged variants.
- Three stage themes with five parallax layers each, and a heat-wave effect on the far layer.
- Readable hostile shots: white and yellow with a red edge.
- Sound: per-enemy death and hit variants, stereo panning, auto-ducking, layered music per stage with boss phases,
  a heartbeat when on your last life, stingers for warnings, clears and titles.

### Engineering
- Simulation (`game.js`) and rendering (`render.js`) split. Separate random streams for each.
- Speeds are one unit everywhere (px/s). The v1 heuristic that guessed the unit is gone.
- Level data validator: `Levels.validate()`.
- Sprite self-check: `Sprites._selfCheck()`.
- Draw-call budget under 120 per frame in a busy wave.

### Known gaps
- Stage 4, water reflection, gib particles, volume menu and difficulty select are not built.
- Audio has not been listened to by anyone.

## v1 (tag `v1`)
- Three stages (75, 90 and 105 seconds), each ending in a boss with a swallow attack.
- Hairy butt enemies, three power-up types, a shield, options and a chain of kills.
- Procedural pixel art, procedural sound, touch and keyboard controls, and a local hi-score.
- Touch and keyboard controls, pause, mute, hi-score in local storage.
