# Product requirements: aasssMaster

Status: written from the code as it stands on `claude/song-synths-sequencer-processors-e79zyb`, 2026-10-23. Where a
requirement describes what the code already does, it says so. Anything not built yet lives in `future.md`.

## 1. Purpose

aasssMaster is a vertical shoot-'em-up played in the browser, with a hairy-butt alien theme. All art and sound are
generated in code.

## 2. Users

- **Players** open `index.html` on a phone or desktop and play a three-stage run.
- **Developers and coding agents** change the level data in `js/levels.js` and reload. They need no toolchain.

## 3. Constraints

- **C1. No build step, no package manager, no external assets.** Plain JS globals loaded by `<script>` tags. Every sprite, sound and impulse response is generated at runtime.
- **C2. No network at runtime.** The game fetches nothing after load.
- **C3. Runs from a static HTTP server.** The README says to use `python3 -m http.server`.
- **C4. Silent until a gesture.** Web Audio starts only after a user tap or key press.
- **C5. Never throws on missing pieces.** A missing sprite draws a magenta box (per CONTRACT.md); a missing track falls back with one console warning.

## 4. Game requirements

| ID | Requirement | Status |
|----|-------------|--------|
| G1 | Fixed 384×216 logical canvas, scaled to the screen with pixelated rendering. | Built |
| G2 | Three stages (HAIRY NEBULA, THE CRACK OF DOOM, RECTUM OF THE GODS) with a boss at the end of each. | Built |
| G3 | Stages 2 and 3 have a mid-boss (at 40 s and 45 s). Stage 1 has none. | Built |
| G4 | Ten regular enemy types, one mid-boss, three bosses, all defined as data in `js/levels.js`. | Built |
| G5 | Keyboard controls (arrows or WASD to move, Z/Space/Ctrl to fire, X to charge a beam, C/Shift for Force, B for bomb, P/Esc to pause, M to mute, V for haptics). | Built |
| G6 | Touch controls: drag on the left side to move, tap to throw Force, hold on the right side to fire, hold longer for the beam. | Built |
| G7 | Power-ups (power, speed, shield, option), a Force pod, lives, continues and a hi-score. | Built |
| G8 | After the third stage the run loops with scaled boss HP and loop modifiers or mutators. | Built |
| G9 | Music per stage and per boss, sound effects, all synthesised. | Built |
| G10 | The engine boots with zero console errors when every module is present, and keeps running when a sprite or sound is missing (CONTRACT.md C7). | Built, checked by hand |
| G11 | `Levels.validate()` reports unknown names, budget overruns and quiet gaps as warnings at load. | Built |
| G12 | A committed automated test that drives a headless run of the game. | **Not built** (CONTRACT.md C8 describes one) |

## 5. Acceptance criteria

- Opening `/` and pressing Space starts the stage with no page errors in the browser console.
- `Levels.validate()` returns no errors at load.

## 6. Out of scope

- Saving scores to a server, leaderboards, and accounts.
- Multiplayer.
- Any server-side component.

## 7. Open questions

- Stage 1 has no mid-boss while stages 2 and 3 do. Is that intended?
