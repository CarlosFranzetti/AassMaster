# aasssMaster — project memory

This file records what happened, what was decided, and why. It is the memory of the project, written so a
future session can pick it up without the chat history. For rules, read `CLAUDE.md`. For the backlog, read `future.md`.

## Who asked for what
- The owner (Carlos Franzetti) asked for a pixel-art shmup with hairy butt-aliens, landscape and touch first,
  sounds and shadows and raster effects, and "lots of agents" working in parallel: art, sound and mechanics first.
- Then asked for v2 done as a real design discussion: the same four roles, each with its own memory, debating in files
  and rebuilding from what they agreed. Then asked for this documentation set.
- The owner asked for honest uncertainty in every answer, no invented sources, and flagged statistics.

## How the project was built
1. **v1 (tag `v1`).** One scaffold commit (HTML shell plus module contract), then four parallel agents: art (sprites),
   sound (Web Audio), mechanics (engine) and level data (Haiku). Engine integration and a Playwright smoke test followed.
2. **v2 discussion.** Four roles (PIXEL art, SOUND audio, MECH engine, LEVELS data) ran three rounds, written to `team/`:
   - Round 1: each role critiqued v1 and proposed its scope.
   - Round 2: each role answered every ask. Names crossed: PIXEL and MECH each conceded to the other's names, and LEVELS
     withdrew the formation asks MECH had just committed to. The director had to rule.
   - Director rulings (`team/DIRECTOR-RULINGS.md`, R1–R12): binding after round 2.
   - Round 3: each role committed to an exact API list.
3. **v2 build.** Contract v2 (`CONTRACT.md`) merged the rulings and round 3, with a FINAL CORRECTIONS section that
   fixed the last mismatches. Then each role built its own file in parallel. Each ran its own self-check.
4. **Integration.** Smoke test, MECH's 56-check suite, a screenshot review, then tag `v2` and publish.

## Decisions and their reasons
| Decision | Reason |
|----------|--------|
| No build step, no npm, no modules | Open `index.html` and play. Low friction for tinkerers and for publishing as one page. |
| All art procedural, all audio synthesised | No asset pipeline; everything is code and data, so every change is diffable. |
| Flat terrain only (R1) | One pass could not carry terrain alongside Force, weapons, boss rework and the render split. |
| Set-pieces cut (R2) | Three new engine routines for three features that were not core. Formations kept instead. |
| Three stages, not four (R7) | Stage 4 has no theme art and no boss art yet. The engine accepts any stage count, so stage 4 can come later. |
| Charge tiers from the press (R6) | One reference point for the player and for the sound. Round 3 had it wrong; corrected in CONTRACT.md. |
| Boss hp read as loop-scaled from `getStage` (C5) | One place does the loop maths. Engine applies mods only to regular enemies. |
| Speeds always px/s | v1 mixed px/frame and px/s. A heuristic guessed which. Removed; there is one unit now. |
| Render split into `render.js` | Simulation stays testable without drawing; render can be optimised separately. |
| Commit only parseable files | The stop hook pushes everything; a broken file on master would break the live page for anyone who pulls. |
| No model names in commit messages | Repo convention from the system guidance. Trailers name the session only. |

## Verification record (what was actually run)
| Check | Result on the last run |
|-------|------------------------|
| `node --check` on every JS file | Passes |
| Smoke test (`tests/smoke.js` style, 960x540) | No page errors; about 61 fps; one level warning, expected |
| MECH suite (`mech_test.js`, 56 checks) | 56 pass, zero page or console errors, also at 844x390 |
| MECH second suite (haptics, formations, behaviours, if-time items) | Passes, zero errors |
| SOUND fake-AudioContext test (1639 checks) | 0 failures, run with and without StereoPanner |
| LEVELS data checks | Pass, validator returns zero errors |
| PIXEL sprite self-check (76 names, sizes, frames, meta rects) | No problems |
| Draw calls in a busy wave (12 enemies, 18+ enemy shots, spread, Force) | Average 94.6, max 106, under the 120 budget |

## What has NOT been verified
- **Audio.** Nobody heard any of it. Timbres, mix, ducking balance and the music are reasoned from the code only.
- **Real phones.** Headless Chromium at phone-sized viewports only. No real device, no real touch latency.
- **Real players.** No playtest. Difficulty, pacing and boss fairness are guesses until someone plays.
- **Fullscreen and haptics on real devices.** Fallbacks are coded; not checked on hardware.

## Known issues and rough edges
- `Levels.validate()` warns that stage 1 loop 1 wave at t=25 asks for 26 enemies; the engine clamps to 20.
- LEVELS and MECH disagreed on `from:'top'|'bottom'`. Adopted LEVELS' version: `y` is the horizontal position.
- Two stage 1 waves (t10 and t18) were cut from five and four enemies to three, to meet the spawn budget.
- Boss music: every boss plays the same `boss` track. A separate boss-3 track was if-time and was not built.
- `GameRender` is internal to the render file; the public surface is `draw`, `setStage`, `step`, `stats` and `init`.
- Water reflection, gib particles and the volume menu were if-time and were not built.
- The two MECH suites and the other scratch tests live in a session scratch folder, not in the repo. `tests/smoke.js` is the only committed test.
- Mutator list in data is `swarm` and `fast` only. Round 2 proposed `armored` and `fog`, which were never added.
- `Sprites.has` was assumed by LEVELS' validator but does not exist; the engine uses `Sprites.names()`.

## Where the bodies are buried
- Old commit `1f4d29f` says "Add stage/wave data and README": the first version of the README. Superseded.
- `team/round1-LEVELS.md` was first committed in `3bc179d` as an early draft. The final version is in `506e141`.
- The `v2` tag is the final engine. Intermediate "work in progress" commits sit between `ffa15f6` and `a5ffe7d`.
