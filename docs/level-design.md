# Level design

Everything here lives in `js/levels.js`. Edit the data, reload, then run `Levels.validate()` in the console.

## Enemies (`Levels.enemyTypes`)
Keys equal sprite names. Speeds are px/s.

| Type | Size | HP | Speed | Behaviour | Score | Fires |
|------|------|----|-------|-----------|-------|-------|
| butt_small | 16x16 | 1 | 90 | sine | 100 | — |
| butt_mid | 24x24 | 3 | 60 | bounce | 300 | enemy bullet, 0.5/s |
| butt_charger | 20x16 | 2 | 140 | charge | 250 | — |
| butt_spitter | 24x20 | 4 | 50 | hover_spit | 400 | hairball, 0.7/s |
| alien_eye | 16x16 | 2 | 75 | drift | 200 | enemy bullet, 0.8/s |
| alien_squid | 20x24 | 3 | 60 | swoop | 350 | — |
| butt_armored | 24x24 | 6 | 45 | armored | 500 | — |
| gas_cloud | 20x16 | 2 | 40 | drift | 150 | — |
| tooth_mine | 14x14 | 2 | 50 | mine | 200 | hairball, 0.3/s |
| butt_turret | 16x16 | 3 | 0 | turret (floor or ceiling) | 250 | enemy bullet, 0.6/s |
| midboss_butt | 56x48 | 60 | 0 | boss | 2000 | per phase |
| boss_butt, boss_crack, boss_god | 96x80 | per stage | 0 | boss | 5000 | per phase |

Boss and mid-boss hp is set on the stage, not here.

## Stages (`Levels.stages`)

| # | Name | Length | Theme | Music | Mid-boss | Boss (hp) | Checkpoints |
|---|------|--------|-------|-------|----------|-----------|-------------|
| 1 | HAIRY NEBULA | 60 s | 0 | stage1 | none | boss_butt (240) | 0 |
| 2 | THE CRACK OF DOOM | 70 s | 1 | stage2 | t 40 s | boss_crack (360) | 0, 35 |
| 3 | RECTUM OF THE GODS | 80 s | 2 | stage3 | t 45 s | boss_god (440) | 0, 40 |

Stage 1 has no mid-boss and spawns only butt_small for the first 20 seconds.

## Waves
A wave is one object in `stage.waves`:

| Field | Meaning |
|-------|---------|
| `t` | Seconds into the stage when the wave starts |
| `type` | Key in `enemyTypes` |
| `count` | How many enemies |
| `y` | Vertical position, 0 to 1 of the play area, or `'rand'` |
| `spacing` | Seconds between enemies. `0` spawns the whole wave on one tick, so formations hold their shape |
| `pattern` | `line`, `column`, `v`, `wave`, `burst`, `stagger`, `ring` |
| `from` | `right` (default), `left`, `top`, `bottom`. For `top` and `bottom`, `y` is the horizontal position |
| `side` | `floor` or `ceil`, for turrets |
| `offsets` | Optional explicit `[[dx, dy], ...]` that overrides the pattern |
| `drop` | Carrier flag: `pu_force` or `weapon`. The last enemy in the wave drops it |
| `sfx` | A sound cue to play when the wave starts |
| `quiet` | Set by Levels, not authored. True when a wave starts within 3 s of the last one, so the spawn sound is suppressed |

## Bosses and mid-bosses
A boss has `type`, `hp`, and `phases`. Each phase:

```js
{ hpAbove: 0.4, attacks: ['fan', { id: 'spawn', type: 'butt_charger', n: 3 }], interval: 1.6 }
```

- `hpAbove` is the hp fraction above which this phase starts to end. Phases run in strictly descending order, and the last one must have `hpAbove: 0`.
- `attacks` holds attack ids, or objects that override an attack's defaults.
- `interval` is in seconds between attacks.

Attack ids: `fan` (aimed fan with a rotating gap), `spiral` (arms that rotate), `lunge` (telegraphed swoop across a lane), `spawn` (summons enemies of a type), `rain` (drops shots from above).

Mid-bosses also have `t`, `flee` (seconds before they leave without a bonus), and `drop`. While one is alive the stage clock is frozen.

## Loop and difficulty
After stage 3 the loop restarts with harder numbers. `Levels.getStage(rawIdx)` returns the stage plus a `mods` object.

| Loop | hp | boss hp | count | speed | fire |
|------|----|---------|-------|-------|------|
| 0 | 1.00 | 1.0 | 1.00 | 1.0 | 1.0 |
| 1 | 1.35 | 1.5 | 1.25 | 1.1 | 1.1 |
| 2 and up | 1.70 | 2.0 | 1.50 | 1.2 | 1.2 |

Mutators rotate by loop. Only two exist in the data: `swarm` (count ×1.5) and `fast` (speed ×1.3).
`hp`, `count`, `speed` and `fire` are applied to regular enemies by the engine. Boss and mid-boss hp is already scaled by `getStage`.

Relief: after two deaths at one checkpoint, the retry runs with counts ×0.85. Counts are clamped to 20 per wave.

## Drops
`Levels.powerupDrop(type, rng, ctx)` returns a capsule name or null. Chances are per enemy type, multiplied by the stage's `drops.mult` (1.2, 1.0, 0.9 across the three stages). Capsules the player has maxed are never returned. Bosses never drop from the table.

## Validation
`Levels.validate()` returns `{errors, warnings}`. Errors break a stage. Warnings are design notes.
Checked: unknown types, behaviours, patterns, `from` values, attack ids, fire types, aims, drop names, music keys,
sprite names; sizes matching the sprites; wave times inside the stage length; sorted waves; spawn density per 10 s against a
budget per stage (12, 22, 30); quiet gaps over 20 s; strictly descending `hpAbove`; checkpoints starting at 0 and ascending;
boss hp present; mid-boss only in stages 2 and 3; sky colours dark enough that sprites stand out.
