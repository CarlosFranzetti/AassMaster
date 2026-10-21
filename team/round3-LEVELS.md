# LEVELS round 3: committed data API
Binding: team/DIRECTOR-RULINGS.md. Tags: **C** = I author it this pass; **IT** = IF TIME, engine must not depend on it.

## 1. Open questions resolved
- Terrain, mounts, sets, rock_field, butt_rock: CUT. Stage 3 is flat; its tunnel feel is `column` pincer waves from top and bottom.
- Formations (R3): C. `spacing:0` = whole wave on one tick. `offsets` is accepted; I author none this pass. `path`: IT, not authored.
- Phases use MECH's round 2 shape: `{hpAbove, attacks, interval}`. My `seq` and boss attack dictionary are withdrawn. Attack defaults are MECH's; I override only `n`, `arms`, `dur`, `type`.
- `rain` and `gas` attacks: IT, not authored (MECH round 2 triage). `ground` behaviour name: adopted as `turret` (R4), MECH registers it as an alias.
- `from:'top'|'bottom'` was undefined by MECH, so I define it (DEPENDS ON MECH): spawn on that playfield edge, `y` = horizontal position (0 left to 1 right), pattern offsets have dx and dy swapped, enemies move vertically at pxps.
- Midboss: hp 60 in stages 2 and 3 (R4), drop `'weapon'`, clock freezes while alive, flees after 25 s (no bonus).
- Relief rule (data C, applied by MECH): after 2 deaths at one checkpoint, count x0.85. Difficulty menu cut, so `Levels.difficulty` is removed.
- Mutator `fog` and all palette fog/tint/far keys: removed (R8). Mutators are `swarm` and `fast`.
- `wave.quiet`: Levels computes it once at load (true when another wave started within 3 s before). MECH only reads it.
- `pu_bomb`, `pu_life`, `pu_option`: never returned by `powerupDrop`.

## 2. COMMITTED API CHANGES (js/levels.js, global `window.Levels`)
Exports: `enemyTypes, stages, loopMods, mutators, relief, getStage, getWaves, powerupDrop, validate`. Removed: `difficulty`, `stageCount` (use `stages.length`).

**EnemyType** `{sprite, w, h, hp, pxps, behavior, hairy?, armor?, drop?, score, fire?}`; w,h = sprite size; `hp:null` for bosses (stage owns hp).
- `butt_armored: {sprite:'butt_armored', w:24, h:24, hp:6, pxps:45, behavior:'armored', hairy:true, armor:0.5, drop:0.4, score:500}`
- `butt_mid: {sprite:'butt_mid', w:24, h:24, hp:3, pxps:60, behavior:'bounce', hairy:true, drop:0.25, score:300, fire:{rate:0.5, type:'enemy_bullet', spread:1, speed:110, aim:'player'}}`
- `butt_turret: {sprite:'butt_turret', w:16, h:16, hp:3, pxps:0, behavior:'turret', drop:0.35, score:250, fire:{rate:0.6, type:'enemy_bullet', spread:1, burst:3, speed:120, aim:'player'}}`
- `tooth_mine: {sprite:'tooth_mine', w:14, h:14, hp:2, pxps:50, behavior:'mine', drop:0.2, score:200, fire:{rate:0.3, type:'hair_ball', spread:4, speed:90, aim:'player'}}`
- Also: butt_small (sine, 16x16, hp1, 90), butt_charger (charge, 20x16, hp2, 140), butt_spitter (hover_spit, 24x20, hp4, 50, hair_ball 0.7), alien_eye (drift, 16x16, hp2, 75, enemy_bullet 0.8), alien_squid (swoop, 20x24, hp3, 60), gas_cloud (drift, 20x16, hp2, 40, drop 0.15, score 150), midboss_butt (boss, 56x48, hp 60, score 2000), boss_butt / boss_crack / boss_god (boss, 96x80, hp null, score 5000). v1 hairy flags kept. Every key is `pxps`, never `speed`.

**Stage** `{name, intro, length, music, bg, checkpoints, drops, boss, midboss, waves}`; `midboss: null` in stage 1.
- `bg: {theme:0|1|2, speedFar, speedMid, speedNear, palette:{sky:[5 hex]}, raster:{heatAmp, heatPeriod, copper, scan}}`. Speeds in px/s. Example: `{theme:1, speedFar:10, speedMid:30, speedNear:60, palette:{sky:['#3a0a1a','#5a0f22','#7a1a2a','#9a2a30','#b84a38']}, raster:{heatAmp:2, heatPeriod:60, copper:0.8, scan:0.18}}`
- `drops: {mult}` (1.2 / 1.0 / 0.9). `checkpoints: [0, 35]` ascending seconds starting at 0.
- `boss: {type, hp, phases}`. Example: `{type:'boss_crack', hp:360, phases:[{hpAbove:0.7, attacks:['fan', {id:'spawn', type:'butt_charger', n:3}], interval:2.0}, {hpAbove:0.4, attacks:['fan', {id:'spiral', arms:2, dur:3}], interval:1.6}, {hpAbove:0.15, attacks:[{id:'spiral', arms:2, dur:3}, {id:'spawn', type:'butt_charger', n:3}], interval:1.3}, {hpAbove:0, attacks:['fan', {id:'spiral', arms:2, dur:3}, {id:'spawn', type:'butt_charger', n:3}], interval:1.0}]}`
- `midboss: {t, type:'midboss_butt', hp:60, flee:25, drop:'weapon', music:'midboss', phases}`. Example: `{t:40, type:'midboss_butt', hp:60, flee:25, drop:'weapon', music:'midboss', phases:[{hpAbove:0.5, attacks:['fan'], interval:2.0}, {hpAbove:0, attacks:['fan', {id:'spawn', type:'butt_charger', n:3}], interval:1.5}]}`

**Wave** `{t, type, count, y, spacing, pattern, from?, offsets?, drop?, sfx?, quiet (set by Levels), path? (IT)}`
- `y`: `'rand'` or 0..1. `spacing`: seconds; 0 = whole wave on one tick. `pattern`: line | column | v | wave | burst | stagger | ring. `from`: right (default) | left | top | bottom. `drop`: 'pu_force' | 'weapon' | 'random'. `sfx`: a SFX name.
- Example: `{t:12, type:'butt_small', count:3, y:0.5, spacing:0, pattern:'v', drop:'pu_force'}`
- Storm example: `{t:25, type:'butt_small', count:14, y:0.5, spacing:0.08, pattern:'burst', from:'top', sfx:'wave_warning'}`

**Phase** `{hpAbove, attacks, interval}`; `attacks` items are a string id or `{id, ...overrides}`; `interval` in seconds; phase k runs while hp fraction is at or below phase k-1's `hpAbove` and above its own (phase 0 starts at 1.0, last phase ends at 0). Ids I author: fan, spiral, spawn (lunge where stage 3 needs it). `rain` and `gas` are not authored.

**LoopMod** `loopMods[i] = {hp, boss, count, speed, fire}`, last row repeats:
`[{hp:1, boss:1, count:1, speed:1, fire:1}, {hp:1.35, boss:1.5, count:1.25, speed:1.1, fire:1.1}, {hp:1.7, boss:2, count:1.5, speed:1.2, fire:1.2}]`
**Mutators** `{swarm:{count:1.5}, fast:{speed:1.3}}`. Loop n>=1 gets `['swarm','fast'][(n-1) % 2]`.
**Relief** `{after:2, count:0.85}`.

**Functions**
- `getStage(rawIdx) -> {...stage, loop, mutator, mods:{hp, boss, count, speed, fire}}`. Wraps rawIdx by `stages.length`. `mods` = loop row times mutator.
- `getWaves(rawIdx, fromT, toT) -> Wave[]`: shallow copies with `t` in [fromT, toT), `quiet` precomputed. Counts are raw; the engine applies `mods.count`.
- `powerupDrop(type, rng, ctx) -> 'pu_force'|'pu_spread'|'pu_laser'|'pu_wave'|'pu_power'|'pu_speed'|'pu_shield'|null`. `ctx = {power, speed, shield, weapon, hasForce, forceLv, lives, rank}` (power and speed 0..3). Excluded: power when power>=3, speed when speed>=3, shield when held, force when hasForce and forceLv>=3. `ctx.rank<0.3` doubles power and shield weights. Base chance = `enemyType.drop` or 0.08, times `stage.drops.mult`. Weights: power 0.35, weapon 0.25 (one of spread/laser/wave at random), speed 0.10, shield 0.10, force 0.15 (only if !hasForce).
- `validate() -> {errors:[], warnings:[]}`: runs once at load and console.warn's each message. The engine never reads its result.
  - Errors: unknown type, behavior, pattern, `from`, attack id, `fire.type`, `aim`, `drop`, `sfx`, music key (`SFX.hasTrack` when present), sprite (`Sprites.has` when present); `t` outside [0, length); mid t >= length; `hpAbove` not strictly decreasing; checkpoints not ascending from 0; `bg.theme` not 0..3; midboss in stage 1.
  - Warnings: spawns per 10 s over budget (stage 1 12, stage 2 22, stage 3 30); wave count over 10 (over 20 for a storm); quiet gap over 20 s; sky stop luminance over 0.45.

## 3. Stage content (C)
- **1 HAIRY NEBULA**, 60 s, theme 0, music `stage1`, checkpoints [0], no midboss, boss_butt 240 (fan; fan+spawn butt_small; fan+spawn+fan). Waves: t1.5 small3 line; t4 small3 wave; t7 small3 v; t10 small5 column; t12 small3 v `drop:'pu_force'`; t15 small3 burst; t18 small4 line (butt_small only before 20 s); t20.5 charger2 line; t24 mid2 column; t27 eye3 line; t30 mid2 column `drop:'weapon'`; t34 spitter2 column; t38 squid3 wave; t42 eye4 v; t46 charger4 burst; t50 squid4 column; t53 small6 burst (breather before boss).
- **2 THE CRACK OF DOOM**, 70 s, theme 1, music `stage2`, checkpoints [0, 35], midboss t40, boss_crack 360. Waves: t8 armored2 line; t12 small8 ring; t16 gas_cloud3 wave; t21 charger3 line `from:'left'`; t25 small14 burst `from:'top'` `sfx:'wave_warning'`; t30 turret2 column (floor); t34 spitter2 column; t37 eye3 v; [midboss t40, clock frozen while alive]; t44 squid3 wave; t48 armored3 line; t52 mid3 v; t56 charger4 burst; t60 gas_cloud4 wave; t64 small5 v; t67 turret2 column.
- **3 RECTUM OF THE GODS**, 80 s, theme 2, music `stage3`, checkpoints [0, 40], midboss t45 (fan; fan+spiral), boss_god 440 (fan+spawn tooth_mine; fan+spiral+lunge; spiral+lunge; fan+spawn+lunge; fan+spiral+lunge). Flat terrain. Waves: t3 small6 column `from:'top'`; t6 small6 column `from:'bottom'`; t9 mine3 burst; t12 charger3 line `from:'left'`; t15 armored3 v; t18 turret2 column; t22 gas_cloud4 wave; t26 mine4 stagger; t30 eye4 wave; t34 spitter3 column; t38 charger4 burst; t42 armored3 line; [midboss t45]; t50 armored4 column `from:'top'`; t54 mine4 v; t58 squid4 wave; t62 charger5 burst `from:'left'`; t66 turret3 column; t70 eye5 burst; t74 mine5 stagger; t77 small8 burst (last wave before boss).
- Budgets are tuned to `validate()`; wave lists are final, exact counts may move by one during the build.

## 4. IF TIME (IT)
- Stage 4 "THE GREAT STINKHOLE": theme 3, music `stage4`, boss_stink. Engine must accept any count, so this is additive.
- `wave.path`: stage 3 swoopers as `{kind:'sine', amp:24, period:2.5}`.
- Ceiling turret in stage 3: `side:'ceil'` with flipY.
- `rain` attack in boss_god phase 5. `bossMusic` `boss3` for boss_god. Raster `water:y`.

## 5. DEPENDS ON
- MECH: `from:top|bottom` semantics as in section 1; `spacing:0` whole-wave tick; `offsets` override; honour `quiet` and `wave.sfx`; apply `mods` to enemy hp, boss hp (boss and midboss), count (clamp 20), speed, fire rate; relief count x0.85; `armor` on non-pierce bullets; `ctx` extended with `speed` and `shield`; `'turret'` behaviour (alias of `ground`); `mine`, `armored`, `drift`, `bounce`, `hover_spit`, `charge`, `swoop`, `sine`, `straight`, `boss` behaviours; attack defaults and ids fan/spiral/spawn/lunge.
- PIXEL: sprite names and frames per R4 (butt_turret 3f, midboss_butt 4f, butt_armored 3f, gas_cloud 4f, tooth_mine 3f, bosses 7f); `Sprites.theme(i)` for theme 0-2; `Sprites.has(name)`.
- SOUND: track keys `stage1`, `stage2`, `stage3`, `midboss`, `boss` (stage alias accepted); `SFX.hasTrack(name)`; `wave_warning` exists.
