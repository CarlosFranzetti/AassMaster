# LEVELS round 1: v1 critique and v2 level proposal

Checked against js/game.js (not just CONTRACT.md). Wave counts measured from js/levels.js with a read-only script.

## 1. Critique of v1

- **Formations never form.** `queueWave` spawns enemy i at `tick + i*spacing`, so every pattern arrives as a time-staggered stream. `line` is a single-file convoy, `column` a diagonal sweep, `v` a staircase. Only `spacing: 0` forms a real formation, and no v1 wave uses it (min spacing is 0.1 s).
- **Dead or ignored fields.** `palette.far` and `palette.fog` are never read (only `palette.sky`). `Levels.getStage` and `Levels.stageCount` are never called. `enemyTypes.boss_butt.hp/speed` are shadowed by `stage.boss.hp`. `boss.type` only sets name and score; boss art and the boss `spawn` minion (`spawnEnemy('butt_small')`) are hard-coded. `wave.path` is in CONTRACT but not implemented.
- **Silent failures.** Boss attacks are matched by regex (`atkId`); unknown names are dropped with no warning, and `burst` quietly means `spread`. An unknown music track makes `startMusic` return early, so the previous track keeps playing. `getWaves` receives `stageIdx % stageCount()`, so Levels never sees the loop number.
- **Units cliffs.** `speed` > 8 means px/s, <= 8 means px/frame (8 and 9 differ 60x). `phases[].interval` > 12 means frames, else seconds.
- **Boss phases work** (I traced `hpAbove` to `at`; the thresholds are right). But all bosses use the same three attacks, so each phase differs only in interval. Spread count (3+phase) and speed (1.8) are not data.
- **Difficulty is count and spacing only.** Stage 1 has 91 enemies (peak 22 per 10 s, in its first 13 s, which is not tutorial pace), stage 2 has 153, stage 3 has 376 (peak 64 per 10 s). All six types are introduced by 52.5 s of stage 1; stages 2 and 3 add no behaviour. Enemy hp never changes within a run.
- **Pacing is a metronome:** a wave every 2-3 s with 3-6 enemies. The only real breather is the 11 s before each boss.
- **Pool risk.** `enemies` pool is 44 and `alloc` returns null silently. Stage 3 at 6.4 enemies/s will likely hit the cap, and nothing reports it.
- **Economy.** One drop table in every stage. Power, speed and option caps (3, 3, 2) mean late drops become a 1000-point bonus. A killing hit removes a life, all options, the shield and one power level. Game over restarts at stage 1 (`startGame` sets `stageIdx = 0`).
- **Stage identity is one sky gradient.** bg_far, bg_rocks and bg_ceiling are identical in all stages, and "THE CRACK OF DOOM" has no crack.
- **Length is wrong for phones.** 75+90+105 s of stage time, three bosses, no checkpoints: one bad stage 3 costs 5-7 minutes. Shorter stages with checkpoints beat long ones.

## 2. v2 proposal (LEVELS)

Rules: plain objects in levels.js; every new key is additive and v1 keeps working; speeds in px/s and intervals in seconds everywhere (`pxps` and `intervalSec` accepted explicitly).

**2a. Wave v2.** `{ t, type, count, y, spacing, pattern, formation, path, hp, pxps }`
- `formation`: name (`'v5'`, `'chevron7'`, `'diamond4'`, `'wall6'`) or `[[dx,dy],...]` px offsets from anchor (x = W+6, y from `y`). Levels resolves names to offsets.
- `path`: `{kind:'bezier', pts:[[dx,dy]x4], dur}` (px from spawn; after `dur` the enemy continues at its speed) or `{kind:'sine', amp, period}`.

**2b. Set pieces.** New `stage.sets: [{ t, set, dur, params }]`, engine-owned routines, data picks parameters.
- `hair_storm` {density 0.5, angle 15}: hair_ball sheet from top right; hair_tufts drop.
- `rock_field` {count 6, gapY 0.5, gapH 44}: indestructible butt_rock obstacles at speedNear; fly through the gap.
- `gas_cloud` {alpha 0.5, drift 20}: palette.fog overlay that dims the screen, plus slow gas_puff hazards.

**2c. Mid-boss.** `stage.midboss: { t, type:'butt_baron', hp, score, phases }`. No warn phase, no stage end, own hp bar. Killing it is a bonus, not a stage clear. No swallow.

**2d. Enemy additions** (speeds in px/s):
- `butt_bomber`: sprite 24x16, hp 3, pxps 70, score 350, w 24, h 16, behavior 'straight', fire `{rate 0.6, type 'enemy_bullet', spread 1, angle 90}`. From stage 2.
- `hair_mite`: sprite `'hair_tuft'` (no new art), hp 1, pxps 120, score 25, w 8, h 8, behavior 'sine', hairy. Stage 4 swarm.
- `butt_baron`: sprite 48x40, hp 120, score 2000, w 48, h 40, behavior 'boss'.
- `butt_rock`: sprite 24x24, hp 0 (indestructible), behavior 'straight', obstacle true.

**2e. Stage plan** (265 s stage time, v1 was 270 s, plus a 4th stage)

| # | Name | Len | New in this stage | Sets | Midboss | Checkpoints | Drop x |
|---|---|---|---|---|---|---|---|
| 1 | HAIRY NEBULA | 55 | six types taught, formations | none | none | 0 | 1.2 |
| 2 | THE CRACK OF DOOM | 65 | butt_bomber | hair_storm @30 | none | 0, 30 | 1.0 |
| 3 | RECTUM OF THE GODS | 75 | bezier swoopers | rock_field @20 | butt_baron @45 | 0, 40 | 0.9 |
| 4 | THE GREAT STINKHOLE | 70 | hair_mite swarm | gas_cloud @15 | none | 0, 35 | 0.8 |

Boss hp: 240 / 360 / 440 / 520, read only from `stage.boss.hp`. Stage 4 boss adds attack `'gas'` (drops three drifting gas_puffs).

**2f. Checkpoints.** `stage.checkpoints` in seconds. A death with a continue left resumes at the latest checkpoint; `getWaves` from that t skips earlier waves. Three continues per run.

**2g. Loop and endless.** One table in levels.js, applied by Levels, not by game.js:
`loopMods = [{hp:1, boss:1, count:1, speed:1}, {hp:1.35, boss:1.5, count:1.25, speed:1.1}, {hp:1.7, boss:2, count:1.5, speed:1.2}]`, last row repeats. Mutators rotate per loop: `swarm` (count x1.5), `armored` (butt_mid hp +2), `fast` (pxps x1.3), `fog` (palette.fog alpha +0.2). `Levels.getStage(rawIdx)` returns `{..., loop, mods, mutator}`. Wave count cap goes from 14 to 20.

**2h. Difficulty.** `Levels.difficulty`: easy `{hp .7, count .8, boss .8, lives 5}`, normal `{1,1,1,3}`, hard `{1.3,1.2,1.25,2}`, chosen on the title screen. Relief: after two deaths at the same checkpoint, the retry runs with count x0.85.

**2i. Palette and raster keys.** `bg.palette: {sky:[5 hex], tint:'#hex', fog:'#hex'}` (tint multiplies bg_far, bg_rocks, bg_ceiling). `bg.raster: {heatAmp px, heatPeriod frames, copper 0..1, scan 0..0.3}`. Heat 1 / 2 / 1 / 1.5 across stages 1-4, tint red / green / ochre per stage.

**2j. Powerups.** `stage.drops` multiplies DROP_CHANCE (see 2e). Catch-up: if powerLv < 2 at stage start, the first two butt_mid kills drop pu_power. Stretch, cut first: `pu_bomb` (wipes enemy bullets and small butts).

**2k. `Levels.validate()`.** Returns warnings for unknown type, pattern, formation, set, attack or track names; count > 20; wave t > length; 10 s density over budget (24 in stages 1-2, 40 in 3-4); quiet gaps > 20 s; non-monotone hpAbove. Callable from the console, no build step.

## 3. Asks

**MECH** (P0 = needed for v2 identity)
1. P0 `wave.offsets` (array of [dx,dy]): if present, queueWave spawns all entries on the same tick at x = W+6+dx, y = anchorY+dy, ignoring spacing and pattern. Levels does name-to-offset.
2. P0 `wave.path`: `{kind:'bezier', pts:[[dx,dy]x4], dur}` and `{kind:'sine', amp, period}`, px relative to spawn; continue at e.spd after dur.
3. P0 `stage.sets` runs in phase 'stage' via `Levels.getSets(rawIdx, from, to)`. Implement hair_storm, rock_field, gas_cloud with the params in 2b.
4. P0 pass the RAW stage index (not `% stageCount()`) to Levels.getWaves and getStage; delete the duplicate loop maths; take hp mods from getStage().mods.
5. P0 boss attacks as strings or `{id, n, gap}`; add `'gas'`; unknown id logs console.warn. Boss hp only from `stage.boss.hp`.
6. P1 `stage.midboss` as a second boss slot with no warn phase and no stage end.
7. P1 read `palette.tint`, `palette.fog`, `bg.raster`; either read `palette.far` or delete it.
8. P1 `fire.angle` (degrees, 0 = left, 90 = down) for butt_bomber.
9. P1 checkpoints with three continues (store stageIdx, stageT, lives); title difficulty choice.
10. P1 enemies pool 44 to 64; count alloc failures and expose them in `Game` stats.
11. P1 honour `pxps` and `intervalSec` when present, falling back to the v1 heuristics.

**PIXEL**
1. P0 `butt_bomber` 24x16, 4 frames: flying butt with a hairy dangling underside, reads as a dropper, faces left.
2. P0 `butt_baron` 48x40, 4 frames (midboss): bigger than butt_mid, hair crown, angry cheeks, mouth closed to open (frame 3 = swallowing).
3. P0 `butt_rock` 24x24, 1 frame: hairy brown boulder with a crack; must read as "do not touch".
4. P0 `gas_puff` 16x16, 3 frames: yellow-green cloud with bubbles, wobbling.
5. P1 `bg_far`, `bg_rocks`, `bg_ceiling` in mid-grey tones so the tint works (keep current colours as a variant if you want).
6. P2 stretch: `pu_bomb` 12x12, 2 frames, orange X.

**SOUND**
1. P0 music tracks `'stage2'`, `'stage3'`, `'stage4'`, `'midboss'`: loops, 120-140 BPM, bass-heavy; `'stage'` stays for stage 1. Same intensity API.
2. P0 sfx: `bomb_drop` (wet plop), `gas_loop` (looping, returns a `.stop()` handle like `charge`), `rock_thud`, `checkpoint` (chime), `continue_ok` (short fanfare), `stage_clear`.
3. P1 unknown track name plays `'stage'` and warns, not silence. This matters because the engine passes `stage.music` straight through.

DEPENDS ON: MECH P0 1-5, PIXEL P0 1-4, SOUND P0 1-2. Round 2 will confirm these.
