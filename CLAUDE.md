# CLAUDE.md — working in the aasssMaster repo

Read this before changing anything. It is the short list of rules and where things live.
Deeper docs: `README.md` (player view), `prd.md` (what and why), `memory.md` (decisions and history),
`future.md` (backlog), `CHANGELOG.md`, and `docs/` (architecture, level design, art and audio, testing).

## What this is
A pixel-art horizontal shmup for landscape touchscreens (keyboard too), with comedic hairy butt-aliens.
Plain browser JavaScript. No build step, no npm, no modules, no external assets. Everything is generated in code.

## Hard rules
1. **No build step, no npm, no ES modules.** Each file is one IIFE that attaches one global.
2. **Load order is fixed** in `index.html`: `sprites.js` → `sfx.js` → `levels.js` → `render.js` → `game.js`.
   `game.js` reads the others, so it must come last. Do not reorder.
3. **Tuning numbers live in `CFG`** (top of `js/game.js`), and stage/enemy/boss numbers live in `js/levels.js`.
   Do not scatter magic numbers through the engine.
4. **Level data is data.** Adding or changing a wave, enemy or stage means editing `levels.js`, then running
   `Levels.validate()` in the browser console. Keep it at zero errors.
5. **Changes to the data format are additive.** Existing keys keep their meaning. Speeds are px/s, intervals are seconds.
6. **Sim and render are separate.** `game.js` owns state and never draws; `render.js` only reads the view object.
   The simulation uses `rng()`; visual effects use the separate fx RNG (`rf`). Do not mix them, or replays break.
7. **Never commit a file that does not parse.** Run `node --check <file>` first.
8. **Commits and PRs:** do not put model names in commit messages, PR titles, PR bodies or code comments.
   Do not open a PR unless the user asks.

## Where things are
- `js/sprites.js` — 76 procedural sprites, the bitmap font, theme tiles. API: `get, frames, size, draw, drawShadow, text, textWidth, meta, theme, prewarm, names`.
- `js/sfx.js` — Web Audio synthesis and chiptune music. API: `init, play, setMuted, setVolume, stopLoops, hasTrack, tracks`, and `music.{start,stop,pause,resume,setIntensity,setPhase,setDanger,stinger,duck,setRate}`.
- `js/levels.js` — enemy catalogue, 3 stages, mid-bosses, loop modifiers, relief, drops. API: `enemyTypes, stages, getStage, getWaves, powerupDrop, validate`.
- `js/render.js` — `GameRender`: backdrop, raster effects, HUD, title and overlays.
- `js/game.js` — `Game`: loop, input, collisions, weapons, Force pod, bosses, scoring, checkpoints. Debug hooks: `Game.info()`, `skipTo`, `skipToBoss`, `skipToMid`, `give`, `giveWeapon`, `damageBoss`, `kill`, `step`, `seed`, `debug`.
- `team/` — the four-role design discussion (rounds 1–3) and the binding `DIRECTOR-RULINGS.md`. Historical; read for reasons, not for current API.
- `CONTRACT.md` — the v2 contract. Its FINAL CORRECTIONS section wins over the round files.

## Checks to run after a change
```sh
node --check js/*.js                       # every file parses
node tests/smoke.js                        # headless play, zero page errors (needs playwright)
```
In the browser console after loading the page: `Levels.validate()` (expect `errors` empty) and `Sprites._selfCheck()` (expect no problems).

## Gotchas (learned the hard way)
- Charge tiers are measured in frames from the **press**: orb at 21, tier 1 at 30, tier 2 at 60, tier 3 at 96.
- `getStage(raw).boss.hp` and `.midboss.hp` are already loop-scaled. Do not scale them again in the engine.
- For `from: 'top' | 'bottom'` waves, `y` is the horizontal position (see `docs/level-design.md`).
- `drawShadow` multiplies the current `globalAlpha`; it does not replace it.
- `Sprites.has` does not exist. Use `Sprites.names()`.
- Unknown sound, stinger or track names warn once and fall back. Check the console after adding a name.
- Touch split: the left 55% of the canvas rect is movement, the right side fires. Taps on the left throw or recall the Force pod.
