# LEVELS round 2: decisions and reactions
Read all four round 1 files. Tags: **COMMITTED** = I author it this pass; **IF TIME** = only after COMMITTED lands.

## 1. Decisions on the director's points
1. **Terrain vs set pieces: one plan.** Terrain is the only feature that changes what a stage feels like, and it costs one lookup plus one collision rule. The set pieces cost three new engine routines, so they are dropped. hair_storm becomes a `from:'top'` wave, rock_field becomes tunnel terrain, gas_cloud becomes an enemy plus `palette.fog`. **COMMITTED:** terrain on stage 3 only, as `terrain:{kind:'tunnel', seed:7, step:8, minGap:72, maxH:48}`. Levels generates ceil/floor from these five numbers and exposes `Levels.terrainAt(rawIdx, worldX)` (MECH's API). I author the parameters, not 600-column arrays. **IF TIME:** stage 2 `kind:'waves'`, maxH 24. Turrets are waves with `side`, not `mounts[]`. Worms and the ambush type are cut.
2. **Enemies:** FINAL list in section 2, 14 entries, 4 new. Dropped from my round 1 list: butt_bomber, hair_mite, butt_baron, butt_rock, gas_puff. Dropped from MECH's: worm, mine_hair, turret, ambush (PIXEL already drew butt_turret and tooth_mine, so those names win).
3. **Stages: 3 COMMITTED**, 60/70/80 s (210 s stage time, v1 was 270). After stage 3 the loop restarts at stage 1 with loopMods, so endless play exists without a fourth theme. **IF TIME:** stage 4 "THE GREAT STINKHOLE" reusing bg.theme 0 with boss_butt. Bosses boss_butt / boss_crack / boss_god: accepted.
4. **Music:** accept SOUND's keys `stage1`, `stage2`, `stage3`, `midboss`. Every boss uses `'boss'`; a separate boss3 track is IF TIME.

## 2. Final enemyTypes (COMMITTED; speeds px/s; boss hp lives only in `stage.boss.hp`)
| type | sprite | w x h | hp | pxps | behavior | fire: rate/s, type, spread, speed, aim | score |
|---|---|---|---|---|---|---|---|
| butt_small | butt_small | 16x16 | 1 | 90 | sine | none | 100 |
| butt_mid | butt_mid | 24x24 | 3 | 60 | bounce | 0.5, enemy_bullet, 1, 110, player | 300 |
| butt_charger | butt_charger | 20x16 | 2 | 140 | charge | none | 250 |
| butt_spitter | butt_spitter | 24x20 | 4 | 50 | hover_spit | 0.7, hair_ball, 1, 80, player | 400 |
| alien_eye | alien_eye | 16x16 | 2 | 75 | drift | 0.8, enemy_bullet, 1, 100, player | 200 |
| alien_squid | alien_squid | 20x24 | 3 | 60 | swoop | none | 350 |
| butt_armored (new) | butt_armored | 24x24 | 6 | 45 | straight | none | 500 |
| gas_cloud (new) | gas_cloud | 20x16 | 2 | 40 | drift | none | 150 |
| tooth_mine (new) | tooth_mine | 14x14 | 2 | 50 | mine | 0.3, hair_ball, 4, 90, player | 200 |
| butt_turret (new) | butt_turret | 16x16 | 3 | 0 | turret | 0.6, enemy_bullet, 1, 120, player, burst 3 | 250 |
| midboss_butt | midboss_butt | 56x48 | 60 | 0 | boss | per entry (section 3) | 2000 |
| boss_butt / boss_crack / boss_god | same name | 96x80 | - | 0 | boss | per stage (section 3) | 5000 |

Hairy flag kept on the four v1 butt types and on butt_armored. No per-type `hit` boxes this pass (sprite box is used).

## 3. Field shapes I will author
- **Wave:** `{t, type, count, y, spacing, pattern, from, side, drop, sfx}`. Patterns: v1 names plus `stagger` and `ring`. `from`: right (default), left, top, bottom. `side`: floor | ceil (turrets only). `drop`: pu_force | weapon | random. `sfx`: a SOUND cue name. `quiet` is set by Levels, not me.
- **Stage:** `{name, intro, length, music, bg:{theme, speedFar, speedMid, speedNear, palette:{sky:[5 hex], fog}, raster:{copper, heat}}, scroll, terrain, checkpoints, drops:{mult}, boss:{type, attacks, phases}, midboss, waves}`. bg speeds stay v1 numbers in px/s.
- **Attack dictionary** (per boss): `fan:{n:5, gapRotate, speed:1.8, every:0.7}`, `spiral:{arms:2, dur:3, rate:0.1}`, `lunge:{tele:0.8, speed:4}`, `spawn:{type, n:3}`, `rain:{count:6}`. Phases: `{hpAbove, seq, interval}`, interval in seconds.
- **boss_butt** (240 hp, spawn type butt_small): 0.6 fan 2.2s; 0.3 fan+spawn 1.8s; 0 fan+spawn+fan 1.3s.
- **boss_crack** (360 hp, spawn butt_charger): 0.7 fan+spawn 2.0s; 0.4 fan+spiral 1.6s; 0.15 spiral+spawn 1.3s; 0 all 1.0s.
- **boss_god** (440 hp, spawn tooth_mine): 0.75 fan+spawn 1.8s; 0.5 fan+spiral+lunge 1.5s; 0.25 spiral+lunge 1.2s; 0.1 fan+spawn+lunge 1.0s; 0 fan+spiral+rain+lunge 0.8s.
- **midboss_butt** (60 hp, drop 'weapon'): S2 at t=40, attacks fan+spawn(butt_charger), phases 0.5 / 0. S3 at t=45, fan+spiral. The stage clock freezes while it lives and it flees after 25 s.

## 4. Stages (COMMITTED unless marked)
| # | Name | Len | Theme / music | Boss | Checkpoints | Terrain | New in this stage |
|---|---|---|---|---|---|---|---|
| 1 | HAIRY NEBULA | 60 | 0 / stage1 | boss_butt | 0 | flat | six v1 types; only butt_small for 0-20 s, <=5 alive; Force carrier t=12; weapon carrier t=30 |
| 2 | THE CRACK OF DOOM | 70 | 1 / stage2 | boss_crack | 0, 35 | flat (IF TIME waves) | butt_armored, gas_cloud, floor butt_turret, `from:'top'` storm at t=25, one `ring` wave, one `from:'left'` charger wave |
| 3 | RECTUM OF THE GODS | 80 | 2 / stage3 | boss_god | 0, 40 | tunnel, scroll 60 px/s | tooth_mine, ceiling butt_turret, swoop waves, `wave.sfx` on carriers |

Stage 1 tutorial rule: no spawns other than butt_small before 20 s. Stage 1 has no midboss.

## 5. Loop, relief, drops, validation (COMMITTED)
- **loopMods** (in levels.js, read through `Levels.getStage(rawIdx)`, which returns `{mods, loop, mutator}`): loop 0 `{hp 1, boss 1, count 1, speed 1, fire 1}`; loop 1 `{1.35, 1.5, 1.25, 1.1, 1.1}`; loop 2+ `{1.7, 2, 1.5, 1.2, 1.2}`. Mutators rotate per loop: `swarm` (count x1.5), `fast` (speed x1.3), `fog` (palette.fog +0.2 alpha).
- **Relief:** after two deaths at one checkpoint, that retry runs at count x0.85. No title difficulty menu this pass.
- **Drops:** `Levels.powerupDrop(type, rng, ctx)`. Base chance is v1 (butt_mid 0.25, spitter 0.3, squid 0.3, default 0.08), plus armored 0.4, turret 0.35, mine 0.2, gas 0.15, times `stage.drops.mult` (1.2 / 1.0 / 0.9). Capsule weights: power 0.35, weapon 0.25 (spread/laser/wave at random, skipping maxed), speed 0.10, shield 0.10, force 0.15 (only if !hasForce), life 0.05 (only if lives < 3). If `ctx.rank < 0.3`, power and shield weights double. It never returns a maxed capsule. It never returns pu_option or pu_bomb.
- **Levels.validate()** (COMMITTED): unknown type, pattern, `from`, behavior, attack id, track key or sprite name; spawns per 10 s over budget (S1 12, S2 22, S3 30); wave count over 10 (20 for a storm); quiet gaps over 20 s; non-monotone hpAbove; sky stop luminance over 45%.

## 6. Reactions to asks
**MECH**
- YES: `stage.scroll`; `midboss{t,type,hp,attacks,phases}` with the freeze and flee rule; `wave.from`, `wave.drop`, patterns `stagger` and `ring`; `fire{rate,type,spread,speed,aim,burst}`, with `aim:'fixed'` plus `angle` (deg, 0 = left, 90 = down); boss attack dictionary and `seq` phases; speeds always px/s; stage 1 pacing; `powerupDrop(type, rng, ctx)`; raster `copper` and `heat`.
- COUNTER: terrain arrays become `terrain:{kind, seed, ...}` plus `Levels.terrainAt(rawIdx, worldX) -> {ceil, floor}` in px (step 8, ceil+floor <= 104 so the gap is >= 72). Mounts: NO, turrets are waves with `side`. Water and waterline: NO this pass (IF TIME). spriteSuffix: NO, PIXEL's `bg.theme` replaces it.
- TYPES: turret becomes butt_turret (behavior 'turret'); mine becomes tooth_mine (behavior 'mine'); worm: NO, a sine wave of butt_small reads as a worm; ambush: `from:'left'`, not a type. `pu_bomb`: NO capsule; bomb stays a meter.
- WITHDRAWN from my round 1: `wave.offsets` (use patterns), `wave.path` (IF TIME; S3 uses `swoop`), `stage.sets` / `Levels.getSets`, the `gas` boss attack.
- STILL NEEDED: pass the RAW stage index to Levels and delete the duplicate loop maths (use `getStage().mods`); enemy pool 44 to 64 with an alloc-failure counter.

**PIXEL**
- YES: `bg.theme` 0 / 1 / 2 for stages 1 / 2 / 3; `boss.type` per stage; the four new types at your exact sizes, placed as in section 4 (every type spawns in stage 2 or 3); dark sky tops with lightest stop at or below 45% luminance (validated).
- COUNTER: midboss hp 60, not 70 or 45 (25% of the stage 2 boss, about 8 s with the default gun). Frame map: 0-1 idle, 2 mouth open (fire telegraph), 3 hurt. butt_bomber is gone, so no art request.
- NO: any further enemy. The list is fixed at 14.

**SOUND**
- YES: `music` keys `stage1` / `stage2` / `stage3` (stage 1 is no longer `stage`) and `midboss`; `intro` string per stage (a subtitle, while `name` stays the banner); `wave.sfx` on the storm and the stage 3 carrier waves only; unknown track falls back to `stage1`, and validate catches it.
- COUNTER: `wave.quiet` is set by Levels to true when a wave starts within 3 s of the previous one, so nothing to author. `sfxVariant`: pass `e.type` verbatim, no authoring. `bossMusic`: all bosses use `'boss'`; boss3 is IF TIME.

## 7. Follow-ups
- MECH: confirm `spacing:0` with `v`, `column`, `ring`, `stagger` spawns on one tick, a true formation. The stage 2 ring depends on it.
- MECH: confirm `from:'left'` flips spawn x and the sign of velocity.
- PIXEL: round 1 has pu_life only, but MECH asked for pu_force, pu_spread, pu_laser, pu_wave and pu_bomb art. Are those in your queue? `butt_turret` needs 3 frames (closed, open, firing) with flipY for the ceiling; `butt_armored` needs 3 crack levels by hp.
- DIRECTOR: MECH's terrain and weapons plus PIXEL's art and SOUND's layers are a lot for one pass. If terrain slips, stage 3 falls back to flat with the tunnel waves and midboss; nothing else depends on it.
