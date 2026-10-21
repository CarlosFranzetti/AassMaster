# ROUND 1 - PIXEL (art, js/sprites.js)
Seen: sheet.png + title/combat/boss screenshots at 1:1 (384x216), all of sprites.js, the draw code in game.js.

## 1. CRITIQUE OF v1 (honest)
- Sprites themselves are good (butt anatomy, boss, explosions read well). The weakness is GAMEPLAY READABILITY and VARIETY.
- Hostile projectiles are the worst offender: `enemy_bullet` is 6x6 pink on a pink/magenta sky and next to pink butts; `hair_ball` is
  brown on purple/brown ground. In shot_boss.png the hairballs nearly vanish. Dodging needs hostile = brightest, highest-contrast thing on screen.
- `bullet` (8x3, pale yellow) looks like faint ovals in combat. Beam is drawn through `SS()` at 24x12 from a 24x8 sprite: 1.5x non-integer
  vertical scale = uneven pixel rows. Life icons are `SS('player',..,12,8)` = 0.5x nearest = mush. (MECH: use native-size art, I'll supply it.)
- Silhouettes: butt_small / butt_mid / butt_spitter are all "pink circle with a slit"; at speed you tell them apart only by size.
  alien_squid is purple on a purple sky (title screenshot: it nearly disappears). Dark outline 'K' = same as the dark ground, so no edge there.
- Palette: flesh pink + NES yellow + pastel violet/green is not one family. The three stages share the SAME art: only the sky gradient changes.
  Stage 3 = green sky + pink flesh ground + blue far mountains. `palette.far` and `palette.fog` from levels.js are never read by game.js.
- Background depth: only 3 strips (far/ceiling/ground), each tiling every 64px = a visible 6x repeat across the screen, and there is
  NOTHING between far (y~126) and the player: a big empty sky band. No mid layer, no foreground layer.
- Boss: great sprite, but (a) same boss for all 3 stages, (b) `boss_butt_dmg` has 1 frame so under 30% hp the mouth is frozen
  (frame wraps), (c) no wind-up/hurt/blast frames, so the telegraph is only a mouth size, (d) `drawShadow` squashes 96x80 to a 32px black
  blob that covers half the ground. (e) death = just flashing; no gib/explosion art.
- Logo 160x40 is small for a title screen; the butt on the M reads as an eyeball; lowercase pink merges with the pink sky.
- Text: single flat 5x7 font, no outline/shadow, uppercase only, no '+', '%', 'x', '(' ')'. Banners at scale 3 look like debug text.
  HUD = black 50% bar + flat text; combo/popups have no outline so they are hard to read over explosions.
- Player feedback is thin: no muzzle flash, charge indicator is a plain square, death uses a generic explosion, shield break has no art,
  pickup = no flash. Charger/eye/squid have no spawn cue (SFX has `fart`, nothing visual).

## 2. v2 PROPOSAL (all procedural, one pass, still no external images)
A. Readability pass (same names/sizes unless noted):
   - `enemy_bullet` 6x6 x2: white core, red-orange ring, 1px dark outline, 2-frame pulse. `hair_ball` 10x10 x2: lighter tan + bright 1px rim.
   - `bullet` stays 8x3 (collision) but thicker white core + glow rim; NEW `bullet_opt` 6x3 (orange) so option shots read as theirs.
   - `bullet_charged` becomes NATIVE 24x12 x2 (no SS stretch); NEW `beam_full` 32x16 x2 for a full charge.
   - Per-type accent so silhouettes differ: mid = flushed red cheeks + brow ridge + horns; spitter = bloated sickly yellow-green with a nozzle lip;
     squid recoloured to teal/cyan (contrast with purple sky); 1px lighter "rim" colour on all enemies so they separate from dark ground.
   - NEW `icon_life` 12x8 x1 native (replaces the scaled ship).
B. New enemies (LEVELS, take these exact names/sizes): `butt_armored` 24x24 x3 (briefs plating, cracks on hit);
   `gas_cloud` 20x16 x4 (green fart cloud, drifts); `tooth_mine` 14x14 x3 (floating toothed mine, bursts into hairballs);
   `butt_turret` 16x16 x3 (stalk growing from the floor, aims up/left; sprite base sits ON y=196).
C. Mid-boss + bosses: `midboss_butt` 56x48 x4 (twin cheeks, chomp, fire frame). Boss 96x80, one per stage:
   `boss_butt` (stage 1, as is), `boss_crack` (stage 2: red/lava, horns, sweat-band), `boss_god` (stage 3: green/gold, crown + halo).
   ALL THREE get 7 frames: 0-3 as v1 (closed -> wide open/swallow), 4 = wind-up (clenched, veins, eyes squint), 5 = blast (cheeks flare,
   green puff), 6 = hurt flinch. Each has `<name>_dmg` x7 (same 7 poses, bruised). NEW `boss_gib` 64x64 x8 big death explosion.
D. Player/FX: `player_die` 32x32 x6 (ship splits, fireball, debris); `muzzle` 8x8 x3; `charge_orb` 16x16 x6 (4 growth stages + 2 full
   flicker); `bullet_hit` 8x8 x3 (spark, non-lethal hit); `shield_pop` 32x24 x4; `pu_flash` 24x24 x5 (pickup ring burst); `fart_puff` 12x12 x5
   (green puff at butt spawn); `gib` 4x4 x4 (flesh/metal chunks); `smoke` 8x8 x4 (damage trail); `pu_life` 12x12 x2 (golden butt "1UP", matches SFX extra_life).
E. Backgrounds - 3 THEMES (0 pink flesh/violet, 1 lava-red crack, 2 green/gold temple), tiles widened to 128 to kill the repeat:
   `bg_far_N` 128x60, NEW `bg_mid_N` 128x48 (silhouette tentacles/stalagmites, y~128), `bg_rocks_N` 128x40, `bg_ceiling_N` 128x20, NEW `bg_fore_N`
   192x24 (sparse dark foreground hair blades / silhouettes at the very bottom + top edge, drawn IN FRONT of entities, never over y 24..190).
   Old names `bg_far/bg_rocks/bg_ceiling` stay as aliases of theme 0. Rule: bg luminance < sprite luminance everywhere.
F. UI: `logo` -> 224x56 x2 (frame 1 = the big hairy butt winks and opens its mouth), cream/gold letters with dark extrusion, readable on pink sky;
   NEW `title_planet` 128x112 x1 (butt-shaped planet behind the logo). Text: new chars `+ % x ( ) * < > = _ "`; optional lowercase later.

## 3. ASKS
- MECH: read `Sprites.theme(i)` -> `{far, mid, ceiling, ground, fore}` (sprite names, tile w=128); use `stage.bg.theme` (fallback `stageIdx % 3`).
  Draw mid between far and ceiling, `fore` AFTER entities/particles but BEFORE HUD at 1.5x near speed. Keep the sky LUT; ignore `palette.far/fog`.
- MECH: `Sprites.text(ctx, str, x, y, color, scale, style)`: style = 'plain'|'shadow'|'outline'|'banner' (banner = gradient+outline); use
  'outline' for HUD/popups, 'banner' for STAGE/WARNING/CLEAR. Drop the 50% black HUD bar if you like it, or keep it - your call.
- MECH: `Sprites.drawShadow(..., {squash: 0.4, alpha: 1})`: pass `squash:0.15` for bosses so they do not blot the ground. Also new `opts.alpha` on draw.
- MECH: draw `bullet_charged` and `icon_life` at native size (no SS). Wire FX: `player_die` on death (not generic boom), `muzzle` at nose on
  each shot (3 ticks), `charge_orb` stage = floor((chargeT-START)/(FULL-START)*5), `bullet_hit`, `shield_pop`, `pu_flash` on pickup,
  `fart_puff` at enemy spawn edge (same tick as SFX fart), `smoke` when P/boss low hp, `boss_gib` on boss death. Boss frame map: 4 tele, 5 spread/spawn blast, 6 flinch on hit.
- MECH: a 'ground' behavior for `butt_turret` (anchored y = 196 - h, fires aimed `enemy_bullet`), and use the boss sprite named in the stage.
- LEVELS: add `bg.theme: 0|1|2` per stage; per-stage `boss.type` = boss_butt / boss_crack / boss_god (+ hp); a `midboss` entry (type `midboss_butt`,
  t, hp~70) in stages 1-3; put the 4 new types in `enemyTypes` with the exact sizes above and spawn each at least in stage 2/3. Keep sky[] dark
  at the top, lightest stop <= ~45% luminance, so sprites pop. Tell me NOW if you want another enemy so I can size it.
- SOUND: visual sync points: `player_die` anim = 6 frames x 5 ticks (0.5s) - match player_die length; `boss_roar` fires on boss frame 4 (wind-up);
  charge_orb has 6 stages, so step `charge` pitch 5 times; `fart` on every `fart_puff`; shield_pop = shield_break; logo wink (title, ~every 3s) deserves a tiny fart/blip.
