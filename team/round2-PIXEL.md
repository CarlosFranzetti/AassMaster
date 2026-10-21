# ROUND 2 - PIXEL (reactions). Read all four round1 files. C = COMMITTED (engine may wire it), T = IF TIME ALLOWS (engine must NOT depend on it).
Delivery order so partial delivery is still usable: WAVE A (API + gameplay sprites + FX) first, WAVE B (themes, bosses, logo, terrain tiles) second.

## DIRECTOR CONFLICTS - my settlement (I concede on names; one name per thing, no aliases except v1 names that are free)
1. MID-BOSS: `midboss_butt` 48x40, 4f: 0 idle, 1 idle2, 2 mouth open/firing, 3 hurt. (I concede 56x48; LEVELS' `butt_baron` is the same sprite - LEVELS, use `type:'midboss_butt'`. No swallow pose.) C
2. TURRET/MINE/GAS: `turret` 16x16 4f (closed, open, firing, hit; base at bottom, MECH flipY for ceiling) C, ENEMY. `mine_hair` 14x14 3f C, ENEMY (hairy mine, MECH splits it into 4 shots).
   `gas_puff` 16x16 3f C, HAZARD (yellow-green cloud with bubbles; LEVELS/MECH decide damage). My `butt_turret`, `tooth_mine`, `gas_cloud`, `butt_armored` are DROPPED.
   `worm_head` 14x14 4f + `worm_seg` 12x12 2f C (MECH P2; cheap). Ambush enemies (from left) reuse `butt_charger` + flipX: no new art.
3. BEAM: MECH's set wins. `beam_t1` 24x10, `beam_t2` 40x16, `beam_t3` 64x24, 2f each (pulsing), all C. My `beam_full` is dropped; `bullet_charged` (v1, 24x8) stays untouched as a free fallback, nothing new uses it.
   `charge_orb` 16x16 = 6f (counter to 4f): frames 0-3 = growth by gauge (floor(g*4)), 4-5 = full-charge flicker. MECH may just use 0-3. C. Tier-up feedback: `pu_flash` (below) at the nose.
4. BACKGROUNDS: my `Sprites.theme(i)` wins, tint is dropped (it would force grey art and muddy every palette). I bake palette/fog into each theme, so LEVELS can delete `palette.far`/`fog`/`tint`.
   `Sprites.theme(i)` -> `{far, mid, ceiling, ground, fore, fog, sky, ter}` (names of sprites, plus `fog` css colour, `sky` = 5-hex ramp suggestion, `ter` see below). i is taken mod 4. Sprite names are `bg_far_0..3`, `bg_mid_0..3`, `bg_rocks_0..3`, `bg_ceiling_0..3`, `bg_fore_0..3`.
   v1 names `bg_far/bg_rocks/bg_ceiling` = free aliases of theme 0. Tile widths: far/mid/rocks/ceiling 128, fore 192 (all C).
5. STAGES: 4 themes + 4 bosses are realistic in one pass because both are parameterised generators (palette + seed + 2-3 feature switches), not hand art.
   Theme 0 flesh/violet, 1 lava-red crack, 2 green/gold temple, 3 ochre/olive stinkhole. Bosses `boss_butt`, `boss_crack`, `boss_god`, `boss_stink` (stage 4, LEVELS: boss.type per stage), all 96x80.
   Risk call: theme 3 and boss_stink differ from 1/2 mainly by palette + a feature or two (stink lines, flies); if I run out of time they ship as palette-shifted variants, same names.
6. SCOPE - see the lists below.

## 4. ANSWERS TO EVERY ASK ADDRESSED TO PIXEL
MECH
- `Sprites.meta(name, frame=0)` -> `{hit:{x,y,w,h}, mouth:{x,y,w,h,open}, muzzle:{x,y}}` or null; coords relative to the sprite top-left. YES, C. `hit` defaults to the opaque bbox inset 2px (1px if sprite <=12px), so you get sane hitboxes for free;
  overrides: player core 8x6, boss, midboss. `mouth.open` is true only on poses where the mouth is the weak point, so what the player sees = what takes damage: boss frames 2,3,5 open; 0,1,4,6 closed. `muzzle`: player nose (23,8), turret, butt_bomber (12,15, fires down).
- `flipY` in `Sprites.draw` opts: YES, C (also `alpha`, which I asked for earlier). `drawShadow` opts `{squash, alpha, flipX}`: C.
- v1 names/sizes all kept, except `logo` (below). Boss 96x80 stays, so your boss hit code is unchanged.
- Force + weapons, all C: `force` 16x16 6f (0-3 spin, 4-5 flash; flipX for rear mode), `pu_force`, `pu_spread`, `pu_laser`, `pu_wave`, `pu_bomb` 12x12 2f. `pu_option` and `pu_speed` stay as they are (unused ones are free).
  Capsule glyphs are icons not letters (spread = 3-ray fan, laser = line, wave = sine, force = pod, bomb = orange X) with distinct hues so you can tell them apart at 12px.
  `bullet_spread` 6x6 1f, `bullet_wave` 8x6 2f, `bullet_laser` 16x3 1f (stretch it horizontally, fine): C.
- Terrain tiles: T-with-condition. If terrain survives your own round 2, I deliver per theme `ter` = `{floorTop, floorFill, ceilBot, ceilFill}`, each 8x8 with 4 variant frames, palette-matched to that theme's ground/ceiling, `Sprites.theme(i).ter.floorTop` etc. If terrain is cut, I skip it. PIXEL VOTE: terrain is the costliest item for all three of us and it fights `bg_rocks` (which then only shows as flat ground);
  I would cut it, or limit it to stage 3 with a gentle gap. Either way tell me in your round 2.
- Not wired by me, procedural on your side: stick ghost, bomb ring, water, copper bars, buttons, the danger vignette (3-line radial gradient).
SOUND
- `butt_spitter` gets a 5th frame = wind-up (mouth stretched wide, cheeks puffed, hairball swelling in the throat). MECH: play frame 4 for ~20 frames before the volley, then 2/3 as today. Idle must stay `(t>>4)&1` (not `%nframes`). C.
- Visual sync points I commit to: `player_die` 6f at 5 ticks = 30 ticks (0.5s); `charge_orb` has 4 growth + full flicker; `fart_puff` 5f x 4 ticks = 20 ticks; `shield_pop` 4f x 3 ticks; `pu_flash` 5f x 3 ticks. Boss frame 4 (wind-up) is held 0.8s by MECH, so `swallow_tele` can match it. Logo frame 1 (wink) shows ~25 ticks on the title: MECH, trigger it with SOUND's `title_sting`.
- Danger vignette: MECH draws it (see above); SOUND's heartbeat is 2 beats/s, so pulse alpha at 2Hz.
LEVELS
- `butt_bomber` 24x16 4f: flying butt, dangling hairy underside, mouth at the left, muzzle (12,15) pointing down. C
- `midboss_butt`: see 1. `butt_rock` 24x24 1f: hairy brown boulder with a crack and bright bone-white spikes ("do not touch"). C. `gas_puff` 16x16 3f: C.
- Grey bg tiles for tint: NO, use `Sprites.theme`. `pu_bomb` 12x12 2f: C (trivial, MECH wires bomb). `hair_mite` reuses `hair_tuft` (no art, agreed).

## MY FULL LIST, MARKED
C, WAVE A: API (`meta`, `flipY`, `alpha`, `drawShadow` opts, `text` style `plain|shadow|outline|banner`, new glyphs `+ % x ( ) * < > = _ "`, `theme()`, `prewarm(names)`); readability pass (enemy_bullet, hair_ball, bullet, `bullet_opt` 6x3, enemy accent tints, squid recolour, rim); `icon_life` 12x8;
  beams t1-t3; `charge_orb`; `muzzle` 8x8 3f; `bullet_hit` 8x8 3f; `player_die` 32x32 6f; `shield_pop` 32x24 4f; `pu_flash` 24x24 5f; `fart_puff` 12x12 5f; `force`, 5 capsules, 3 weapon bullets; `turret`, `mine_hair`, `worm_head`, `worm_seg`, `butt_bomber`, `butt_rock`, `gas_puff`, `midboss_butt`; spitter frame 4.
C, WAVE B: 4 themes x 5 layers; 4 bosses x 7f + `_dmg` x 7f (generated lazily on first `get`, call `Sprites.prewarm(['boss_crack','boss_crack_dmg'])` during the stage intro to avoid a hitch); `boss_gib` 64x64 8f; `logo` 224x56 2f (v2 size, was 160x40; MECH centre it with `size()`).
T: `gib` 4x4 4f (chunk particles), `smoke` 8x8 4f, `pu_life` 12x12 2f, `title_planet` 128x112, lowercase font, terrain tiles (see above).

## ASKS / FOLLOW-UPS
- MECH: (1) is terrain in or out? (2) draw `fore` after particles and before HUD, ONE `drawImage` per layer; no per-scanline loops except the existing heat wave on `far`. (3) Please use `Sprites.meta().hit` for hitboxes instead of hardcoding, or tell me the rule you want.
  (4) boss mouth weak point: use `meta(name, frame).mouth` only when `.open`. (5) `Sprites.get` already returns a ready canvas with no per-call allocation, so you can cache that and drop the `hasSpr` checks per draw.
- LEVELS: theme index = stage index mod 4 unless you pass `bg.theme`; `sky` ramp from `Sprites.theme(i).sky` is only a suggestion, keep your own if you like it (keep lightest stop dark). Is the stage 3 boss still the baron-style midboss + boss_god? Tell me if any boss attack needs its own frame (I have: fan/spiral = frame 5, lunge/swallow = 3, wind-up = 4).
- SOUND: nothing blocking. If you want a tell for `butt_bomber` dropping, the muzzle point is given by `meta`.
- DIRECTOR: loading order unchanged on my side (sprites.js stays first); a new `render.js` is fine with me as long as it calls only the `Sprites` API.
