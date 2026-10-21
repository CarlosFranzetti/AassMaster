# ROUND 3 - SOUND (js/sfx.js). Read DIRECTOR-RULINGS + all four round2 files. This file is binding for what I build.

## A. Open questions, resolved
1. **Charge = R6 exactly.** Frame 21 after press: `h = play('charge', {x: P.x})`; frames 30 / 60 / 96: `h.setLevel(1|2|3)`. Inside sfx.js that is +0.15s / +0.65s / +1.25s after creation. I glide 200Hz up with breakpoints at those offsets and each `setLevel(n)` adds the tier blip (E5, A5, full chord + 14Hz shimmer hold) and a pitch step. Release: `h.stop()` then `play('shoot_charged', {variant:'t1'|'t2'|'t3', x})`; tier 0 = no sound. NOT provided (MECH, do not call): `charge_ready`, `charge_tier`, opts `{rise}`. Unknown sound names are a no-op plus ONE `console.warn` per name, so a typo is visible.
2. **Cut by R1/R2/R4, so I do not build them:** `rock_thud`, `bullet_ping`, `bomb_drop`, powerup variants `bomb`/`option`, track `stageclear`/`bossintro`. Bullets hitting things use `hit`; terrain and rocks are gone.
3. **One-line aliases so MECH/LEVELS/director names all work:** `combo_up` = `chain_up` (variant 1|2|3 -> x2|x4|x8); `stage_clear` and `title_sting` = `stinger('clear')` / `stinger('title')`; track `'stage'` = `'stage1'`; `option_get` stays (unused, v1 compat).
4. **Unknown track -> warn once + play `stage1`**, never silence. `SFX.hasTrack(n)` / `SFX.tracks()` exist for `Levels.validate()`.
5. **`wave.sfx` (LEVELS):** only sound names from the list below, MECH calls `play(w.sfx)` on the wave's spawn tick; I suggest `'wave_warning'` only (storm + stage 3 carriers).
6. **midboss intro:** MECH reuses `boss_phase`+`boss_roar` (round 2); I ask for `midboss_warn` instead (it is committed, shorter siren), then `boss_roar` vol 0.6 is optional.
7. **Boss death flow:** `damageBoss` kill -> `SFX.music.stop({fade:0.4})` (not instant); `bossFinish` -> `stinger('clear')` (it stops anything left); `beginStage` -> `start(track,{fade:0.3})` as today. Midboss kill -> `stinger('midboss_clear')` AND immediately `start('stageN',{fade:0.5})` (the stinger ducks 1s, no gap).
8. **Danger/slow-mo:** `setDanger` persists across `start()` until the engine sets it false; the heartbeat only runs while a track plays and is not paused. `setRate` is API-committed even though MECH's slow-mo is IF TIME.

## B. COMMITTED API CHANGES

### B1. SFX.* functions (all never throw, all no-op before init/after unavailable)
- `SFX.init()` idempotent; also auto `ctx.resume()` on visibilitychange and inside `play()` while suspended.
- `SFX.play(name, opts?) -> handle | undefined`. opts: `{volume 0..1.5 (def 1), pitch 0.25..4 (def 1), x 0..384 logical px (pan = clamp((x-192)/220,-0.8,0.8); omitted = centre), variant string|number}`. `kind`/`tier` are NOT read. Returns a handle ONLY for `charge`, `laser` (and IF TIME `gas_loop`), else undefined.
- **Handle shape (R6), never null, no-op object when muted/uninitialised:** `{stop(fadeSec=0.05), setLevel(n), setVolume(v), setX(x)}`. stop idempotent; unused methods no-op. Auto-stop: charge 15s, laser 120s. A second `play('laser')` stops the first.
- `SFX.setMuted(bool)`, `SFX.muted` (get/set), `SFX.stopLoops()` (stops all handles), `SFX.setVolume({master?,music?,sfx?} 0..1)`, `SFX.hasTrack(name)->bool`, `SFX.tracks()->string[]`, `SFX._tracks`.
- Internal (no API): per-name voice caps (shoot 3, hit 3, enemy_die 4, fart 2, struggle 2, graze 2), priority stealing, pitch jitter (shoot +-6%, hit +-10%, die +-8%), auto-ducking of music (see duck).

### B2. SFX.music.* (exact signatures)
- `start(name, opts?)`: `{fade: sec = 0.05, restart: bool = false}`; same track = no-op unless restart. `stop(opts?)`: `{fade: sec = 0.1}`. `pause()` / `resume()` (keep position, 600Hz lowpass while paused, kills handles).
- `setIntensity(x 0..1)`: layers fade at the next bar line. Layer thresholds: <0.3 bass+kick+hat; 0.3 arp; 0.5 lead; 0.75 2nd lead + double hat; 0.9 fill + bass octave.
- `setPhase(n 1..3)`: boss/midboss layers (2 = fast arp + double-time hat, 3 = detuned lead, +2 semitones next loop). Reset to 1 by `start()`.
- `setDanger(bool)`: music lowpass 1.8kHz + heartbeat sub-sine, lub at 0, dub at +10 frames, period 36 frames (MECH/vignette sync from the tick you call true).
- `stinger('warning'|'clear'|'midboss_clear'|'title')`: warning 2.8s alarm riser over ducked music; clear ~4s fanfare, fades the current music out itself; midboss_clear 1.5s tag; title 1.6s formant voice "AAASSS MASTER!" + stab chord (ducks music). Unknown = no-op.
- `duck(ms, depth = 0.45)`: music bus to depth for ms, release 0.5s. Auto-ducked internally (MECH does NOT call duck for these): `boss_die`, `boss_roar`, `boss_phase`, `swallow`, `player_die`, `enemy_die_big` (light), `shield_break` (light), `bomb`, every stinger.
- `setRate(r 0.5..1)`: sequencer tempo multiplier (new notes) + mild lowpass; 1 restores.
- **Tracks (R10):** `title` (76bpm Dm, v1), `stage1` (alias `stage`, 150 Am, v1 music), `stage2` (138 Dm phrygian, bass drive), `stage3` (126 dark, sparse arp, big bass), `midboss` (160, 8-bar loop), `boss` (165 Em, v1 + phase layers), `gameover` (non-looping, v1). `stage4`: IF TIME.

### B3. Sound names (v1 names kept; variants listed; "handle" only where stated)
- `shoot` variant main|opt|force|wheeze (wheeze = quieter, lowpassed, for the throttled gun while charging). `shoot_spread`, `shoot_wave`: no variants. `shoot_charged` variant t1|t2|t3 (default t1).
- `charge` HANDLE (levels 1..3). `laser` HANDLE (setLevel 1..3 = weapon level pitch/brightness).
- `hit` and `enemy_die` and `enemy_die_big` variant = enemy type key verbatim: butt_small, butt_mid, butt_charger, butt_spitter, alien_eye, alien_squid, butt_armored, gas_cloud, tooth_mine, butt_turret, midboss_butt (unknown `butt_*` -> mid, other -> default).
- `boss_hit` variant mouth|body (default mouth; body = dull tick for the x0.25 body hits). `boss_die`, `boss_roar` (use `pitch` 1 / 0.85 / 0.7 for boss_butt / boss_crack / boss_god), `boss_phase`, `swallow_tele` (0.8s gurgle + rumble), `swallow`, `struggle` (per mash tap, `pitch` +3% per tap), `spit_out`, `midboss_warn`.
- `player_die` (boom in the first 0.5s to match the 6x5-tick anim, crackle tail to 1.3s), `respawn`, `shield_up`, `shield_break` (also used for shield_pop), `extra_life`, `hiscore`.
- `powerup` variant power|speed|shield|force|spread|laser|wave|life|bonus (default bonus). `force_throw`, `force_recall`, `force_attach` (clunk): pass x of the pod.
- `chain_up` variant 2..8 (the multiplier; also alias `combo_up` 1..3), `chain_break`, `graze` (use `pitch` = 1 + 0.04*chain, I cap at 2.5), `turret_fire`, `spit_windup` (0.33s gurgle; promoted from IF TIME because PIXEL committed the spitter wind-up frame; fire at frame-4 start, 20 ticks before the volley).
- `fart` (as v1), `wave_warning`, `stage_intro`, `checkpoint`, `continue_ok`, `menu_move`, `menu_select`, `pause`.
- Aliases: `combo_up`, `stage_clear`, `title_sting` (see A3).

### B4. IF TIME (engine must not depend on them; calling them is a safe no-op until built)
`pu_appear` (soft chime), `bomb` (1.2s blast), `bomb_ready`, `hitstop_thud`, `gas_loop` (HANDLE), `logo_wink`, track `stage4`, per-stage boss key (`stage.bossMusic`, I only guarantee `'boss'`).

## C. DEPENDS ON (the calls I expect from MECH, and when)
- **Wrapper:** `sfx(name, opts)` forwards `{volume,pitch,x,variant}` unchanged and returns the handle; keep `sfxGap` shoot 5, fart 12, nothing else needed. `x` = entity centre in logical px; `variant` = `e.name` for hit/die.
- **Player:** `shoot` variant main (opt/force per source, wheeze past tier 1), `shoot_spread`/`shoot_wave` by weapon, `laser` handle on fire press / `stop()` on release, death, pause, stage change; charge as in A1; `player_die` + `setDanger` update in `killPlayer`; `respawn` in `respawnPlayer`; `shield_up/shield_break`; `powerup` variant by capsule; `force_*` at pod throw/recall/attach.
- **Scoring:** `chain_up {variant: mult}` when the multiplier steps up (x2..x8), `chain_break` on a chain of >=4 ending, `graze` throttled by you at 4 frames.
- **Enemies:** `fart` same tick as `fart_puff` (`quiet` waves skip it), `spit_windup` 20f before spitter volley, `turret_fire` per burst start, `hit`/`enemy_die(_big)` with x+variant.
- **Boss:** `boss_phase` on phase change; `swallow_tele` at tele start; `boss_roar` at enter and lunge only; `swallow` at gulp; `struggle` per tap, `spit_out` on escape; `boss_hit` variant mouth|body; dying: `enemy_die` variant butt_mid every 15f vol 0.5; `boss_die` + `music.stop({fade:0.4})`; `stinger('clear')` at bossFinish.
- **Midboss:** `midboss_warn` + `start('midboss',{fade:0.2})` at spawn, `setPhase(n)` on its phase, kill = A7.
- **Flow:** `stage_intro` + `start(stageTrack,{fade:0.3})` + `setIntensity(0.3)` at beginStage; `setIntensity(f)` every 30f (`0.2 + 0.5*stageT/len + min(0.3, enemies/20)`); `stinger('warning')` once when phase 'warn' starts, REMOVE the three `wave_warning` calls; `start('boss',{fade:0.05})`+`setIntensity(1)`+`setPhase(1)` at bossStart; `setDanger(lives===1 && P.alive)`; `checkpoint` on checkpoint pass, `continue_ok` on continue; `hiscore` in gameOver if newHi; `start('gameover')` as today and `start('title')` after >8s idle there.
- **Title/pause:** `stinger('title')` on the first title tap just before `menu_select`; setPause -> `music.pause()` + `SFX.stopLoops()`, resume -> `music.resume()`; `SFX.init()` on pointerdown, touchstart, pointerup and keydown; `SFX.stopLoops()` on nextStage and gameOver.
- **LEVELS:** stage `music` in `'stage1'|'stage2'|'stage3'` (midboss uses `'midboss'`, boss `'boss'`), `wave.sfx` only a name from B3; `Levels.validate()` may call `SFX.hasTrack` guarded.
- **PIXEL:** spitter frame 4 held >= 20 ticks before the volley; `fart_puff` visible from its first tick; `charge_orb` frames per R5 (0-1 growth, 2 = tier 1, 3 = tier 2, 4-5 = tier-3 flicker); danger vignette 36-frame period; no art dependency otherwise.
