# ROUND 2 - SOUND (js/sfx.js). Read all four round1 files. COMMITTED = I build it, IF TIME = cut first.

## A. play() opts + handles (answers director 4 and 5; MECH code against this)
`SFX.play(name, {volume 0..1.5, pitch 0.25..4 (multiplier), x 0..384 (logical px, centre of the source; omitted = centre, no pan), variant: string|number})`
- pan = clamp((x-192)/220, -0.8, 0.8). Unknown variant falls back to the default timbre, unknown `name` is a silent no-op (as v1). `kind` is dropped: use `variant`.
- **Variants (COMMITTED):** `enemy_die`/`hit` = small|mid|spitter|charger|eye|squid|armored|turret|worm|mine|midboss (pass the enemy type name; I map unknown ones to the nearest by prefix, `butt_*` -> mid). `shoot` = main|opt|force|wheeze (wheeze = quieter + lowpassed, for the throttled gun while charging). `shoot_charged` = t1|t2|t3. `powerup` = power|speed|shield|force|spread|laser|wave|bomb|life|bonus. `chain_up` = 2..8 (the multiplier, rising pitch+notes). `graze`: use `pitch` (MECH: 1 + 0.04*chain).
- **Handles (COMMITTED):** `charge`, `laser`, `gas_loop` return ONE shape, never null/undefined (a no-op handle when muted/uninitialised): `{stop(fadeSec=0.05), setLevel(n), setVolume(v), setX(x)}`. Methods a sound does not use are no-ops; `stop()` is idempotent. Safety auto-stop: charge 15s, laser 30s, gas_loop 60s. I kill all handles on mute, on `music.pause()`, and on `SFX.stopLoops()`. MECH must still `stop()` on death/pause/stage change.
- Voice policy inside sfx.js (so MECH can relax throttles): per-name voice caps (shoot 3, hit 3, enemy_die 4, fart 2), priority stealing (boss/player > big die > pickup > shoot > hit), auto pitch jitter (shoot +-6%, hit +-10%, die +-8%). MECH: keep `sfxGap` for `fart` (12) and `boss dying` (enemy_die every 15f, volume 0.5); the rest can go back to v1 values or lower.

## B. CHARGE: one timeline (director 1)
All times are **gauge seconds** counted from the moment `charge` starts (= CHARGE_START, 0.35s after the press). Gauge hold = 1.6s to full.
| gauge t | tier | MECH | PIXEL charge_orb frame | SOUND |
|---|---|---|---|---|
| 0.00 | 0 | `h = SFX.play('charge')` | 0 (0-0.25s), 1 (0.25-0.5s) | quiet triangle glide 200->480Hz |
| 0.50 | 1 | `h.setLevel(1)`, beam 8 dmg | 2 | blip (E5) + pitch step |
| 1.00 | 2 | `h.setLevel(2)`, beam 16 | 3 | blip (A5), vibrato deepens |
| 1.60 | 3 | `h.setLevel(3)`, beam 30 | 4/5 flicker (alternate every 4 ticks) | full chord ping + shimmer hold (LFO 14Hz) |
- Release: `h.stop()` then `play('shoot_charged', {variant:'t'+tier, x:P.x})` (tier 0 = nothing). Level changes are driven ONLY by the engine (one source of truth); between tiers I glide continuously, so no per-frame stepping (PIXEL: I decline 5 pitch steps, the 6 orb frames map to tiers as in the table; that matches your 4 growth + 2 flicker idea).
- This DROPS my round1 `charge_ready` and the 0.35s rise; MECH's `charge_tier` blip is built into `setLevel` (do not play it separately). MECH: please confirm tier times are gauge time (0.85/1.35/1.95s after press), not press time.

## C. Music (director 2)
**Final tracks (COMMITTED):** `title`, `stage` (stage 1; `stage1` accepted as alias), `stage2`, `stage3`, `stage4`, `midboss`, `boss`, `gameover`. Dropped from my round1: `stageclear` and `bossintro` tracks (replaced by stingers). Unknown name: warn once in console and play `stage` (LEVELS: yes). `SFX.tracks()` -> array of names and `SFX.hasTrack(n)` for `Levels.validate()`.
Feel (LEVELS asked bass-heavy 120-140): `stage` 150 bpm A minor (as v1), `stage2` 138 D minor/phrygian bass drive, `stage3` 126 darker, tunnel-claustrophobic (sparse arp, big bass), `stage4` 134 gassy/wobbly detuned lead (IF TIME: if cut, `stage4` = `stage3` transposed +3 with different drums, still a separate name). `midboss` 160 bpm 8-bar loop, no key change from stage. `boss` stays one track (MECH P1 boss is one fight); layers come from `setPhase`; stage-specific boss key is IF TIME (`stage.bossMusic` optional, I only guarantee `'boss'`).
**API (COMMITTED all):**
- `start(name, {fade: sec=0.05, restart: false})` (same track = no-op unless restart), `stop({fade})`.
- `pause()` / `resume()`: suspend the sequencer keeping position, bus lowpass ~600Hz while paused. (MECH: use these in setPause, never stop/start.)
- `setIntensity(0..1)`: now fades layers (hat, arp, 2nd lead, fill, bass-octave) at the next bar line instead of only the lead gain.
- `setPhase(1..3)`: boss/midboss extra layers (2 = fast arp + double-time hat, 3 = detuned lead, +2 semitones at next loop).
- `setDanger(bool)`: music lowpass ~1.8kHz and lub-dub heartbeat (sub sine; lub at 0, dub at +10 frames, period 36 frames = 100 bpm). PIXEL/MECH: sync the red vignette to that 36-frame period from the tick `setDanger(true)` is called. This replaces my round1 `lowhp_beat` sound.
- `stinger('warning'|'clear'|'midboss_clear'|'title')`: `warning` 2.8s alarm riser, ducks music, music keeps going (MECH: play it once at phase 'warn' start and REMOVE the three `wave_warning` calls, v1 had three). `clear` ~4s fanfare, fades the music out itself (MECH: do not call musicStop; call `start(next)` in beginStage as now). `midboss_clear` 1.5s tag, music keeps playing under a 1s duck (engine then `start('stage')`). `title` = the formant voice "AAASSS MASTER!" (formants /a/ -> /e/, hiss tail, stab chord), fire on first title tap right before `menu_select`.
- `duck(ms, depth=0.45)`: ducks the music bus for ms and releases over 0.5s. These auto-duck, MECH does NOT call duck for them: `bomb`, `boss_die`, `boss_roar`, `swallow`, `player_die`, `enemy_die_big` (light), `shield_break` (light), every stinger.
- `setRate(0.5..1)`: tempo multiplier for the sequencer (new notes only) plus a slight lowpass; MECH calls `setRate(0.5)` for the slow-mo on death/boss kill and `setRate(1)` after. Does not change SFX.
- Also commit: auto `ctx.resume()` on visibilitychange and in `play()` when suspended; `SFX.setVolume({master,music,sfx})`; `SFX.stopLoops()`.

## D. FINAL new sound list (director 3, merged round1: SOUND + MECH + LEVELS + PIXEL)
**COMMITTED:** `charge_tier` (inside setLevel only), `laser` (loop handle), `gas_loop` (loop handle), `shoot_spread`, `shoot_wave`, `force_throw`, `force_recall`, `force_attach` (clunk), `bomb` (1.2s wet blast), `bomb_ready`, `bomb_drop` (LEVELS wet plop), `graze`, `chain_up`, `chain_break`, `bullet_ping` (<60ms), `rock_thud` (ship/rock), `turret_fire`, `midboss_warn` (short two-tone siren, distinct from the `warning` stinger), `boss_phase` (3-note descending klaxon + roar; replaces the repeated `boss_roar`), `swallow_tele` (0.8s gurgle + rumble, matches MECH's 0.8s lane telegraph; MECH's "lane telegraph" = this, one sound), `struggle` (per mash tick, pitch +3% per tap via opts.pitch), `spit_out` (blech), `respawn`, `stage_intro`, `checkpoint` (chime), `continue_ok` (short fanfare), `hiscore` (jingle), powerup `variant` timbres. `stage_clear` (LEVELS' name) stays as an alias of `stinger('clear')` so either call works.
**IF TIME:** `spit_windup` (0.33s gurgle, fire 20 frames before volley; needs PIXEL's spitter mouth frame), `pu_appear` (soft chime), `hitstop_thud` (60ms sub thump; `enemy_die_big` already thumps, MECH: skip unless you want more), `logo_wink` (tiny blip, PIXEL's title wink every ~3s), per-stage `boss_roar` voices via `pitch` (1 / 0.85 / 0.7 needs no code from me).
**Dropped/merged:** my `swallow_tele` = MECH lane telegraph; my `combo_up` = MECH `chain_up`; my `stage_clear` = LEVELS `stage_clear` = stinger; LEVELS `continue_ok`/`checkpoint` kept as above; my `charge_ready` removed; `shield_pop` visual uses `shield_break`; `fart` fires with every `fart_puff` (MECH same tick); `player_die` front-loads the boom into the first 0.5s (PIXEL's 6x5-tick anim), the crackle tail stays to 1.3s.

## E. Pushback / disagreements
- MECH: do not play `wave_warning` for the boss tele/lunge or stage-end any more; it stays only as a generic alert. MECH's per-mash `struggle` + `spit_out` is fine, but cap taps at 14/s on your side so I do not eat 14 voices (I also cap `struggle` at 2 voices).
- MECH: bomb 1.2s plus auto-duck is enough; do not add your own `duck` calls on top (double-duck pumps).
- LEVELS: `rock_thud` is the ship-vs-rock/terrain hit; `bullet_ping` is the bullet-vs-rock hit. Two sounds, not one.
- PIXEL: I will not follow a 5-step charge pitch (see B). I cannot match your `muzzle`/`bullet_hit` frame-exact; I fire on the tick MECH calls `play`.

## F. Follow-up asks
- MECH: always pass `x` (centre of the entity) for die/hit/turret_fire/spit/fart, and `variant` = `e.name`. For `shoot` pass `variant:'opt'`/`'force'` per source and `'wheeze'` while past tier 1 charge.
- MECH: boss states -> `boss_phase` on phase change, `swallow_tele` at `tele` start, `boss_roar` only on `enter` + `lunge`, `struggle`/`spit_out` in `gulp`; midboss: `midboss_warn` at spawn, `setPhase(n)` when it phases, `stinger('midboss_clear')` on kill.
- MECH: call `setIntensity` at most every 30 frames (as proposed); I smooth it.
- LEVELS: keep `music` per stage = `'stage'|'stage2'|'stage3'|'stage4'`, add `midboss: {music?:'midboss'}` default `'midboss'`; call `SFX.hasTrack` in `Levels.validate()` (guard if SFX missing).
- PIXEL: spitter hold-open frame >= 20 ticks before volley; confirm `charge_orb` 6 frames use the table in B (frames 4/5 = tier 3 flicker); confirm `fart_puff` has a visible start tick so `fart` is not late.
- DIRECTOR: confirm B (gauge-time tiers 0.5/1.0/1.6) and the single-shape handle in A; I need both before round 3.
