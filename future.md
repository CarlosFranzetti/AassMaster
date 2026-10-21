# aasssMaster — future work

Ordered roughly by value to a player. Nothing here is committed. Each item says what exists already.

## Next up (highest value first)
1. **Listen to the audio and fix what is wrong.** Nobody has heard the v2 sound or music. Start with the boss
   tracks, the charge sound and the mix against the bass. This is the largest unknown in the project.
2. **Playtest on real phones.** Stage 3 and the loop are the most likely to be unfair. Count deaths per checkpoint and
   which boss attack kills most. The relief rule (count x0.85 after two deaths at one checkpoint) is untested.
3. **Stage 4.** Exists in data as a plan only. Needs: a theme (theme index 3 in `Sprites.theme`, currently `i mod 3` for
   stages), a boss sprite (`boss_stink` was if-time and was not drawn), a stage entry in `levels.js`, and a `stage4` music
   key (the track exists in `sfx.js`). Check the loop math still holds with a fourth stage.
4. **Mutators.** Add `armored` (mid butts gain hp) and `fog` (darker palette) to the loop rotation. Both were proposed in round 2 and never built.
5. **Difficulty select** on the title screen (easy/normal/hard as LEVELS proposed). The relief rule is the only difficulty knob today.

## Polish (cheap, visible)
- **Water reflection** on stage 2. Proposed by MECH, not built; LEVELS did not author the `raster.water` field.
- **Gib particles** on enemy death, using the `gib` sprite (4x4, 4 frames), already drawn.
- **Volume menu.** `SFX.setVolume({master, music, sfx})` exists; there is no UI for it.
- **Boss-3 music track**, so the final boss is not the same loop as the other two.
- **Turret on the ceiling.** `side: 'ceil'` is implemented; check the art with flipY on the turret sprite.
- **Lowercase in the bitmap font.** The font is uppercase only.
- **Title planet.** `title_planet` sprite (128x112) exists but is not placed on the title screen.
- **Recovery drop tuning.** Found and fixed during testing; worth a second look once real players reach it.

## Maybe later
- **Bomb balance.** The BLAST meter fills from score (6000 points). Untuned.
- **Pause menu.** Currently the pause overlay only resumes.
- **Stage select** for practice, using `Game.skipTo` as the basis.
- **Localisation.** Text is in the bitmap font; glyph coverage would need extending.

## Rejected (do not revisit without a reason)
- **Full replay recording.** Round 2 MECH advised against: high cost, low phone value. Hit-stop and slow-motion were built instead.
- **Terrain height arrays and tunnels.** Director ruling R1. Could return as a separate project after v2 is stable.
- **Set-pieces** (storm, rock field, gas overlay) as engine routines. Director ruling R2. Formations cover the same ground.

## Infrastructure
- **Commit the MECH test suites** into `tests/`, with repo-relative paths. Only the smoke test is committed.
- **A one-command check script** that runs `node --check`, the smoke test and the validator.
- **Stop hook noise.** The stop hook pushes everything, including in-progress files. Commit only parseable work.
