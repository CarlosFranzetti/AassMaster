# DIRECTOR RULINGS after round 2 (binding for round 3 and the build)

Rounds 1-2 crossed twice: PIXEL conceded to MECH's round-1 names while MECH conceded to PIXEL's; LEVELS withdrew its
formation asks just as MECH committed to them. These rulings end that. Round 3 commits to THESE, not to earlier files.

## R1. Terrain: FLAT. No height arrays, no tunnel, no terrainAt, no ter_* tiles, no mounts. Not even IF TIME.
    Stage 3 is flat with tunnel-feel waves and the mid-boss (LEVELS said nothing else depends on it).
## R2. Set-pieces: CUT. No stage.sets, no getSets, no rock_field, no butt_rock. hair_storm = a `from:'top'` wave.
## R3. Formations: COMMITTED (MECH). `spacing: 0` spawns the whole wave on ONE tick with the pattern's relative offsets
    (line/column/v/wave/burst/stagger/ring). Optional explicit `wave.offsets: [[dx,dy],...]` overrides the pattern.
    `wave.path` {bezier|sine}: IF TIME (MECH). `wave.from`: right|left|top|bottom COMMITTED; left flips spawn x and vx sign.
## R4. Final enemy/boss names, sizes, frames (PIXEL draws exactly these; LEVELS keys == sprite names):
    butt_armored 24x24 3f (crack levels by hp, behavior 'armored'), gas_cloud 20x16 4f (behavior 'drift', an enemy, not a hazard),
    tooth_mine 14x14 3f (behavior 'mine'), butt_turret 16x16 3f closed/open/firing (behavior 'turret', floor; ceiling via flipY IF TIME),
    midboss_butt 56x48 4f (0-1 idle, 2 mouth open = fire telegraph, 3 hurt), hp 60, in stages 2 and 3,
    boss_butt / boss_crack / boss_god 96x80 7f (+ <name>_dmg 7f): 0-3 closed→swallow as v1, 4 wind-up, 5 blast, 6 flinch.
    CUT: worm_*, mine_hair, turret, gas_puff, butt_baron, butt_bomber, hair_mite, butt_rock, ambush type, pu_bomb, pu_life(IF TIME).
## R5. Weapons/beam art (PIXEL COMMITTED): force 16x16 6f, pu_force/pu_spread/pu_laser/pu_wave 12x12 2f, bullet_spread 6x6 1f,
    bullet_wave 8x6 2f, bullet_laser 16x3 1f, beam_t1 24x10 / beam_t2 40x16 / beam_t3 64x24 2f each (bullet_charged becomes an
    alias of beam_t1 frame 0), charge_orb 16x16 6f (0-1 growth, 2 = tier 1, 3 = tier 2, 4-5 = tier-3 flicker), muzzle 8x8 3f,
    player_die 32x32 6f, bullet_hit 8x8 3f, shield_pop 32x24 4f, pu_flash 24x24 5f, fart_puff 12x12 5f, boss_gib 64x64 8f,
    icon_life 12x8, enemy_bullet/hair_ball/bullet readability recolours, butt_spitter gets a 5th wind-up frame (held ≥ 20 ticks).
## R6. Charge timeline, frames after the PRESS: 21 = orb appears + play('charge'); 30 = tier 1 (h.setLevel(1), fire rate drops to 60%);
    60 = tier 2 (setLevel(2)); 96 = tier 3 (setLevel(3)). Release fires beam_t<tier>. Handle shape for charge/laser/gas_loop:
    {stop(fadeSec), setLevel(n), setVolume(v), setX(x)}, never null. gas_loop itself is IF TIME (gas_cloud makes no loop sound).
## R7. Stages: 3 COMMITTED, 60/70/80 s, bg.theme 0/1/2, bosses boss_butt 240 / boss_crack 360 / boss_god 440, checkpoints as LEVELS
    round 2, 3 continues. Loop with LEVELS.getStage(rawIdx).mods. Stage 4 + theme 3 + boss_stink: IF TIME for PIXEL and LEVELS;
    engine must accept any stage count. No difficulty menu this pass.
## R8. Backgrounds: Sprites.theme(i) -> {far, mid, ceiling, ground, fore} sprite names, tiles 128 wide (fore 192), i mod themeCount.
    palette.tint / palette.far / palette.fog DELETED from levels; sky[] stays (dark tops, lightest stop ≤ 45% luminance).
## R9. Sprites.meta(name, frame) -> {hit:{x,y,w,h}, mouth:{x,y,w,h,open}, muzzle:{x,y}} COMMITTED; engine hitboxes use meta.hit;
    boss mouth open on frames 2,3,5 only; damage x1 on mouth when open, x0.25 on body. Sprites.draw opts {frame, flipX, flipY, flash, alpha};
    drawShadow opts {squash, alpha, flipX}; Sprites.text(ctx, str, x, y, color, scale, style) style plain|shadow|outline|banner.
## R10. Music: title, stage1 (alias 'stage'), stage2, stage3, midboss, boss, gameover COMMITTED; stage4 IF TIME. API: start(name,{fade,restart}),
    stop, pause, resume, setIntensity, setPhase(1..3), setDanger(bool), stinger('warning'|'clear'|'midboss_clear'|'title'), duck(ms,depth), setRate.
    play(name, {volume, pitch, x, variant}); variant = enemy type key / shoot kind / beam tier. Sound list = SOUND round 2 COMMITTED list.
## R11. Engine COMMITTED (MECH): Force pod (throw/recall, front/rear), spread/laser/wave weapons, charge rework (R6), boss v2 (mouth weak
    point, fan/spiral/lunge/spawn/rain from the stage's attack dictionary, shield→spat out, mash to escape), mid-boss slot (clock freezes,
    flees after 25 s), chain+graze scoring, rank + recovery drop, checkpoints/continues, formations (R3), thumb-stick ghost + smoothing,
    haptics, behaviors turret/mine/armored, js/render.js split, perf pass, fx RNG split, raw stage index + mods, pool 64, all cue wiring
    from SOUND round 2. IF TIME: bomb, hit-stop/slow-mo, ceiling turret, wave.path, water reflection.
## R12. Load order: sprites.js, sfx.js, levels.js, render.js, game.js. Director updates index.html. v1 stays tagged `v1`.
