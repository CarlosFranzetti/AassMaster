# aasssMaster — Product Requirements

Status: v2 shipped and tagged `v2`. Last reviewed against the code on the `v2` tag.

## 1. Summary
aasssMaster is a pixel-art horizontal shoot-'em-up in the spirit of R-Type. It is built for
landscape touchscreens first, with keyboard support. The comedy is the premise: the enemies are
hairy butt-aliens, and they try to swallow your ship. The game has three stages, each ending in a
giant boss, and a loop that makes the second pass harder.

## 2. Goals
- Playable on a phone in landscape with one thumb on movement and one on fire.
- Feels like a shmup, not a demo: distinct enemies, a boss with a readable weak point, power-up choices.
- Funny on purpose. Art, sound and boss attacks carry the joke without getting crude.
- Zero install and zero assets: open the page and play. Everything is generated in code.

## 3. Users
- **Phone players** on a short break. Sessions of a few minutes, restarts are frequent, checkpoints matter.
- **Desktop players** who want the keyboard controls.
- **Hackers and tinkerers** who read the source, change `levels.js`, and reload. The data-driven design is for them.

## 4. Platform constraints
- Browsers with Pointer Events, Canvas 2D and Web Audio. No WebGL.
- Internal resolution 384x216, scaled to the screen with pixelated rendering.
- Portrait shows a "rotate your device" overlay and auto-pauses.
- Audio starts only after a user gesture. The game calls `SFX.init()` on the first tap or key.
- No external network requests. No images, audio files or fonts are loaded.

## 5. Requirements and status

| ID | Requirement | Status |
|----|-------------|--------|
| R1 | Touch: drag left side to move relative to the finger | Shipped |
| R2 | Touch: hold right side to autofire; keep holding for a charged beam (first tier at 0.5 s) | Shipped |
| R3 | Keyboard controls (arrows/WASD, Z, X, C, P, M, B, V) | Shipped |
| R4 | Force pod: throw and recall, front and rear attach, levels 1–3 | Shipped |
| R5 | Three weapons (spread, laser, wave) that keep power level on switch | Shipped |
| R6 | Charge rework: three beam tiers, fire rate drops while charging | Shipped |
| R7 | Boss with a mouth weak point, three attack families, shield turns swallow into spit-out | Shipped |
| R8 | Mid-bosses in stages 2 and 3 that freeze the stage clock | Shipped |
| R9 | Chain and graze scoring, hidden rank, recovery drops after death | Shipped |
| R10 | Checkpoints and three continues | Shipped |
| R11 | Formations (spacing 0 spawns one tick), entries from left, top and bottom | Shipped |
| R12 | Three stage themes with parallax layers | Shipped |
| R13 | Layered music per stage, boss phase layers, danger heartbeat, pause keeps position | Shipped (not heard by the authors; see memory.md) |
| R14 | Haptics on hits and death, toggle with V, saved | Shipped |
| R15 | Bomb ("BLAST") meter filled by score, clears enemy shots | Shipped |
| R16 | Fourth stage with its own theme and boss | Not built (data and art partly exist; see future.md) |
| R17 | Difficulty select on the title screen | Not built |
| R18 | Volume menu | Not built |
| R19 | Terrain (height arrays, tunnels) | Cut by director ruling |

## 6. Non-goals
- Accounts, leaderboards, a server, or any backend.
- A level editor UI. Levels are edited as data in `levels.js`.
- Replay recording. Rejected in round 2 as costly for the value.
- Rendering with external art or audio files.

## 7. Success criteria
- Engine stays at the 60 Hz simulation rate on desktop Chromium in headless tests: met (about 61 fps in the smoke run).
- Zero page or console errors across the headless suites at 960x540 and 844x390: met on the last run.
- `Levels.validate()` returns zero errors: met (one warning, see memory.md).
- A real phone player finishes stage 1 without a bug report: **not measured.** No playtest has been done.

## 8. Open questions
- Does the mix work on phone speakers? Nobody has listened to the audio; the authors reasoned it from the code.
- Is a three-stage game long enough? Stage times are 60, 70 and 80 seconds. Loop 2 is the only long-run content.
- Should the loop mutators grow beyond `swarm` and `fast`? Only those two exist in the data.
