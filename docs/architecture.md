# Architecture

## Modules and load order
Plain scripts, loaded in this order by `index.html`. Each file is an IIFE that attaches one global.

| Order | File | Global | Responsibility |
|-------|------|--------|----------------|
| 1 | `js/sprites.js` | `Sprites` | Procedural pixel art, bitmap font, background themes |
| 2 | `js/sfx.js` | `SFX` | Web Audio sound effects, chiptune music, stingers |
| 3 | `js/levels.js` | `Levels` | All stage, wave, enemy and boss data, plus `validate()` |
| 4 | `js/render.js` | `GameRender` | Everything drawn: backdrop, HUD, overlays, screens |
| 5 | `js/game.js` | `Game` | Simulation: state, input, collisions, scoring, flow |

`game.js` reads the other four, so it loads last. `render.js` reads `Sprites` and nothing else in the engine.

## Simulation and rendering
- `game.js` runs a fixed 60 Hz step with a delta clamp. It calls `update()` once per step and `sync()` after.
- Rendering happens once per animation frame, and only after at least one simulation step ran.
- `game.js` builds a view object `V` each frame. `GameRender.draw(V)` reads it and never writes back.
- Simulation randomness is `rng()` (mulberry32, seeded). Visual randomness is `rf()`, which `render.js` owns. The two never share state, so a seeded simulation stays reproducible whatever the frame rate.

## Object pools
Allocated once, reused with an `on` flag:

| Pool | Size |
|------|------|
| Player bullets | 96 |
| Enemy bullets | 160 |
| Particles | 320 |
| Enemies | 64 |
| Power-ups | 12 |
| Popups | 20 |

`allocFails` counts pool misses. `Game.info().allocFails` shows it.

## Game modes and phases
- `mode`: `title`, `playing`, `continue` (offered after the last life while continues remain), `gameover`.
- `phase` inside `playing`: `intro` (stage banner), `stage` (waves), `warn` (boss warning), `boss`, `clear` (stage cleared).
- `midState` tracks the mid-boss: not yet spawned, active (freezes the stage clock), done.

## The boss engine
One engine drives both the stage boss (`B`) and the mid-boss (`M`).
Boss modes: `idle`, `enter`, `tele`, `lunge`, `gulp`, `fan`, `spiral`, `spawn`, `rain`, `return`, `recover`, `dying`, `dead`. The mid-boss also uses `flee`.
Phases are chosen by hp fraction. Each phase has a list of attacks and an interval. See `level-design.md`.

## Input
- Pointer Events on the `#wrap` element, with `setPointerCapture`, one tracked pointer per finger.
- Left 55% of the canvas rectangle: relative drag, with a stick ghost and smoothing. A tap throws or recalls the Force pod.
- Right side: fire. Hold for autofire, keep holding for a charged beam.
- Keyboard handled alongside; see README for the map.
- Auto-pause on hidden tab, lost focus or portrait orientation.

## Scaling
The canvas stays 384x216. CSS scales it to the wrapper element. The integer scale is used unless it wastes more than 15% of the space, in which case a fractional fill scale is used. Pixelated rendering keeps the edges crisp.

## Persistence
Browser `localStorage` only: the hi-score and the haptics setting. Both fail silently if storage is blocked.

## Audio start
`SFX.init()` runs on the first gesture, from pointer, touch or key. Until then every sound call is a silent no-op.
