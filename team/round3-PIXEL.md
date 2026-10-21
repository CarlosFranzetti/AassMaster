# ROUND 3 - PIXEL (commitments). Binding: DIRECTOR-RULINGS.md R1-R12. I follow it exactly: my round-2 names turret/mine_hair/gas_puff/48x40 are withdrawn.
## RESOLVED
- Names/sizes = R4: butt_armored, gas_cloud, tooth_mine, butt_turret, midboss_butt 56x48. No terrain, no ter_*, no butt_rock, no worm, no pu_bomb, no butt_bomber (R1/R2/R4).
- charge_orb frames = R5/SOUND table: 0-1 growth, 2 = tier 1, 3 = tier 2, 4-5 = tier-3 flicker (alternate every 4 ticks). fart_puff frame 0 is the biggest, brightest burst, so the `fart` sfx is never late.
- butt_spitter: frame 4 = wind-up (single static pose, mouth stretched, cheeks puffed, hairball swelling). MECH holds it >= 20 ticks before the volley; idle stays `(t>>4)&1`; frames 2/3 = spit as v1.
- Mouth weak point: MECH's default rect was too small; the real rects are in meta below. Danger vignette = MECH procedural (pulse period 36 ticks from `setDanger(true)`); not an art asset.
- Stage 4 / theme 3 / boss_stink = IF TIME. Engine uses `i mod Sprites.themeCount` (3 now, 4 if I finish theme 3).
- Boss `_dmg` and the 56x48 midboss are built lazily on first `get`/`draw` (no load hitch); `Sprites.prewarm` exists for the stage intro.

## COMMITTED API CHANGES - js/sprites.js (v1 API stays valid; all additions optional)
- `Sprites.draw(ctx, name, x, y, opts)` opts `{frame, flipX, flipY, flash, alpha}` (alpha 0..1 multiplies globalAlpha; flipX+flipY may combine).
- `Sprites.drawShadow(ctx, name, x, y, opts)` opts `{frame, flipX, squash=0.4, alpha=1}` (alpha multiplies the old fixed 0.45; boss: squash 0.15).
- `Sprites.meta(name, frame=0)` -> `{hit:{x,y,w,h}, mouth:{x,y,w,h,open}|null, muzzle:{x,y}|null}` or `null` for unknown names. Coords are px from the sprite top-left, UNFLIPPED (engine mirrors with `w-1-x` / `w-x-w`). Default `hit` = opaque bbox of that frame inset 2px (1px if sprite <= 12px). Cached, no allocation after the first call.
- `Sprites.theme(i)` -> `{far, mid, ceiling, ground, fore, fog}` (5 sprite names + a css fog colour), `i` taken mod `Sprites.themeCount`. `Sprites.themeCount` = 3 (4 if IF TIME lands).
- `Sprites.prewarm(namesArray)` -> builds lazy sprites now (no return value). `Sprites.get/frames/size` work on lazy sprites without prewarm (size/frames are declared up front).
- `Sprites.text(ctx, str, x, y, color='#fff', scale=1, style='plain')`, style `'plain'|'shadow'|'outline'|'banner'`; returns `textWidth(str, scale)` as before (glyph box only). shadow = 1*scale dark px down-right; outline = 1*scale dark ring all sides (#1a0a1f); banner = outline + shadow + 3-band vertical gradient derived from `color` (light top, dark bottom). Draw origin stays the glyph top-left; effects spill 1*scale px outside it. New glyphs `+ % ( ) * < > = _ "`; input is still uppercased.
- Kept free aliases: `bg_far`, `bg_rocks`, `bg_ceiling` = theme 0 (now 128 wide); `bullet_charged` = `beam_t1` frame 0 (24x10 1f, R5). Unchanged: pu_power/speed/shield/option, hair_tuft, explosion*, thruster, option, shield, alien_eye (colour kept), butt_small/charger/mid/spitter sizes.

## COMMITTED SPRITES (name, w x h, frames, description)
WAVE A (gameplay + FX):
- `bullet` 8x3 1f (same size, white core + glow rim); `bullet_opt` 6x3 1f (orange, Force/option shots); `enemy_bullet` 6x6 2f (white core, red-orange ring, dark outline, pulses); `hair_ball` 10x10 2f (lighter tan + bright 1px rim).
- `beam_t1` 24x10, `beam_t2` 40x16, `beam_t3` 64x24, each 2f pulsing (cyan/white core, blue edge; t3 has crackle sparks). `charge_orb` 16x16 6f. `muzzle` 8x8 3f. `bullet_hit` 8x8 3f. `bullet_spread` 6x6 1f, `bullet_wave` 8x6 2f, `bullet_laser` 16x3 1f.
- `force` 16x16 6f (0-3 spin, 4-5 flash; faces right, flipX for rear). `pu_force`, `pu_spread` (3-ray fan icon), `pu_laser` (line icon), `pu_wave` (sine icon) 12x12 2f each, distinct hues from the red/green/blue/orange of v1.
- `player_die` 32x32 6f (ship splits, fireball, debris). `shield_pop` 32x24 4f. `pu_flash` 24x24 5f (ring burst). `fart_puff` 12x12 5f (green). `smoke` 8x8 4f (MECH wires it on boss < 30%). `icon_life` 12x8 1f (native mini-ship). `boss_gib` 64x64 8f (big death explosion with chunks).
- `butt_mid` 24x24 4f (red-flushed cheeks, brow ridge), `butt_spitter` 24x20 now 5f (yellow-green, nozzle lip, +wind-up), `alien_squid` 20x24 4f (teal recolour). All enemies get a 1px lighter rim.
- `butt_armored` 24x24 3f (hairy butt in white briefs with metal plates; 0 intact, 1 cracked, 2 heavily cracked - MECH picks by hp fraction >0.66 / >0.33 / else). `gas_cloud` 20x16 4f (green fart cloud, angry eyes, loops). `tooth_mine` 14x14 3f (hairy toothed ball, loops). `butt_turret` 16x16 3f (0 closed, 1 open/aim, 2 firing; base on the bottom row, flipY-safe).
- `midboss_butt` 56x48 4f (0-1 idle wobble, 2 mouth open = fire telegraph, 3 hurt flinch). `logo` 224x56 2f (frame 1 = butt winks + mouth opens; centre with `size()`).
WAVE B (stage art): 15 theme sprites: `bg_far_N` 128x60, `bg_mid_N` 128x48 (y~128), `bg_rocks_N` 128x40, `bg_ceiling_N` 128x20, `bg_fore_N` 192x24 (bottom-edge silhouettes, draw at y = 192; never above y 190), N = 0 flesh/violet, 1 lava-red crack, 2 green/gold temple; all tile seamlessly in x. Bosses 96x80, 7 frames each, plus `_dmg` x 7: `boss_butt`, `boss_crack` (red, horns, sweat band), `boss_god` (green/gold, crown + halo within the top 9 rows): 0-3 closed -> swallow, 4 wind-up (clenched, veins), 5 blast (mouth wide, cheeks flared), 6 flinch. Body keeps v1 position so shadows/hit code stay.

## META RECTS (px from sprite top-left; same for boss_butt/boss_crack/boss_god and their _dmg)
- `player` (24x16) f0 hit {8,5,8,6}, muzzle {23,8}; f1 (nose up) hit {8,4,8,6}, muzzle {23,6}; f2 (nose down) hit {8,6,8,6}, muzzle {23,10}.
- `force` hit {1,1,14,14}, muzzle {15,8} (also valid on all 6 frames).
- boss body hit {6,8,84,66} on every frame; muzzle {36,41}. mouth rects {x,y,w,h,open}: f0 {45,28,6,26,false}; f1 {42,25,13,32,false}; f2 {38,22,20,38,true}; f3 {35,19,26,44,true}; f4 {45,28,6,26,false}; f5 {36,20,24,42,true}; f6 {45,28,6,26,false}. Open only on 2,3,5 (R9).
- `midboss_butt` body hit {4,5,48,40}, muzzle {20,25}; mouth f0/f1/f3 {26,17,4,16,false}, f2 {22,14,12,22,true}.
- `butt_turret` hit {2,2,12,14}, muzzle {3,4} on frames 1 and 2 (aims upper-left). Other sprites: default hit.
## ANCHORS + SUGGESTED TIMINGS (so MECH/SOUND sync)
muzzle: top-left = (P.x+m.x-1, P.y+m.y-4), 2 ticks/frame. charge_orb: top-left = (P.x+m.x-4, P.y+m.y-8) (centre 4px ahead of the nose). bullet_hit/smoke/fart_puff/pu_flash/boss_gib/player_die: centre on the event point; bullet_hit 2 ticks/frame, fart_puff 4, pu_flash 3, shield_pop 3 (drawn at P.x-4,P.y-4), smoke 6, player_die 5 (30 ticks total, ship hidden), boss_gib 6.

## IF TIME (few; the engine must not depend on them)
1. Theme 3 (`*_3`, ochre/olive stinkhole) + `boss_stink` (+`_dmg`) for stage 4. 2. `gib` 4x4 4f chunk particles. 3. `pu_life` 12x12 2f. 4. `title_planet` 128x112.

## DEPENDS ON
- MECH: hitboxes from `Sprites.meta(name, frame).hit`; weak point only when `meta(...).mouth.open`; frame choice rules above (armored by hp, spitter 4 held >= 20 ticks, boss 4 tele / 5 blast / 6 phase-change flinch, turret 1 held 20 ticks, charge_orb table); flip handling of meta; theme index = `stage.bg.theme ?? stageIdx`; `fore` drawn after particles and before HUD, one drawImage; fog colour is optional.
- LEVELS: enemyTypes keys == sprite names exactly as R4; `bg.theme` 0..2 (0..3 only if I announce theme 3); `boss.type` in {boss_butt, boss_crack, boss_god}; midboss type `midboss_butt` with w 56 h 48; sky[] lightest stop <= 45% luminance (R8).
- SOUND: nothing blocking; fire sounds on the tick MECH calls `play`.
- DIRECTOR: R12 load order is fine; sprites.js stays standalone and first.
