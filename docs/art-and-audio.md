# Art and audio

Nothing is loaded from disk. Every sprite is a grid of characters with a palette, rasterised to a canvas once.
Every sound is synthesised with Web Audio when it plays.

## Sprites (`js/sprites.js`)
76 named sprites. Frame counts and sizes are in `Sprites._spec` and checked by `Sprites._selfCheck()`.

Groups:
- **Ship and FX**: `player`, `thruster`, `shield`, `force`, `muzzle`, `charge_orb`, `bullet_hit`, `player_die`, `shield_pop`, `explosion`, `fart_puff`, `smoke`, `boss_gib`.
- **Shots**: `bullet`, `bullet_opt`, `bullet_spread`, `bullet_wave`, `bullet_laser`, `beam_t1`, `beam_t2`, `beam_t3`, `enemy_bullet`, `hair_ball`.
- **Pickups**: `pu_power`, `pu_speed`, `pu_shield`, `pu_option`, `pu_force`, `pu_spread`, `pu_laser`, `pu_wave`, `pu_life`, `pu_flash`, `icon_life`.
- **Enemies**: the sprites named in `level-design.md`, plus `butt_spitter` (5 frames, frame 4 is the wind-up).
- **Bosses**: `boss_butt`, `boss_crack`, `boss_god`, each 96x80 with 7 frames and a 7-frame `_dmg` variant. Frames: 0–3 mouth closed to wide open, 4 wind-up, 5 blast, 6 flinch.
- **Backgrounds**: three themes (`Sprites.theme(i)` returns `{far, mid, ceiling, ground, fore}`), each with five layers, all tileable.
- **Logo and title**: `logo` (224x56, two frames, frame 1 winks), `title_planet`.

`Sprites.meta(name, frame)` returns hit boxes and anchors:
- `hit`: the box used for collision.
- `mouth.open`: true only on boss frames 2, 3 and 5 (and midboss frame 2). Damage in the open mouth is full; on the body it is a quarter.
- `muzzle`: where shots leave the sprite.

Text: `Sprites.text(ctx, str, x, y, color, scale, style)` with styles `plain`, `shadow`, `outline`, `banner`. Uppercase bitmap font.

## Sound (`js/sfx.js`)
`SFX.play(name, {volume, pitch, x, variant})`:
- `volume` 0 to 1, `pitch` 0.25 to 4, `x` 0 to 384 for stereo pan, `variant` picks a timbre (for example an enemy type for `hit` and `enemy_die`, `t1` to `t3` for `shoot_charged`).
- Voices are capped; the lowest priority is dropped first when the cap is reached.
- Big sounds duck the music automatically: `boss_die`, `boss_roar`, `boss_phase`, `swallow`, `player_die`, `enemy_die_big`, `shield_break`, `bomb`, and every stinger.

Looping sounds return a handle `{stop(fadeSec), setLevel(n), setVolume(v), setX(x)}`, never null:
- `charge`: rises through three tiers, one `setLevel` call per tier.
- `laser`
- `gas_loop`

Sound names exist for every event the engine raises: shots, hits, deaths, boss phases and warnings, swallow and spit-out, Force throw and recall, power-up pickups, chain, graze, respawn, checkpoints, continues and the high score. See `js/sfx.js` for the list; `SFX.tracks()` lists the music tracks.

Music: `SFX.music.start(track, {fade, restart})` with tracks `title`, `stage1` (alias `stage`), `stage2`, `stage3`, `stage4`, `midboss`, `boss`, `gameover`.
- `setIntensity(0..1)` adds layers at bar lines.
- `setPhase(1..3)` changes the boss feel.
- `setDanger(bool)` adds a lowpass and a heartbeat on a 36-frame period.
- `stinger('warning' | 'clear' | 'midboss_clear' | 'title')`.
- `pause()` and `resume()` keep the position. `setRate(0.5..1)` slows the music for slow motion.

An unknown sound or track name warns once and falls back to a safe default. Check the console when adding names.

## Known limits
- Nobody has listened to the audio. Mix, timbre and loudness are unverified.
- The formant-synthesised `title_sting` and the logo wink are the least certain sounds.
- The pixel art was checked by rendering sheets and looking at them. It has not been reviewed on a real phone screen.
