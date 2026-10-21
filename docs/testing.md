# Testing

There is no test framework. Checks are scripts you run by hand, plus console calls in the browser.

## Quick checks (no browser)
```sh
node --check js/sprites.js js/sfx.js js/levels.js js/render.js js/game.js
```
Every file must parse before you commit.

## Level data
In the browser console, after loading the page:
```js
Levels.validate()           // expect errors: []
```
One warning is currently expected: stage 1 loop 1 wave at t=25 asks for 26 enemies, which the engine clamps to 20.

## Sprite table
```js
Sprites._selfCheck()        // expect []
```
Checks every sprite's size, frame count and palette characters against `Sprites._spec`.

## Headless play-through
`tests/smoke.js` serves the repo, opens it in headless Chromium at 960x540, starts the game, moves, fires, and reports page errors and frame rate. It saves screenshots to `tests/out/` (ignored by git).

Requirements: Node, Python 3 for the static server, and Playwright with Chromium. The script looks for Playwright through normal Node module resolution.

```sh
node tests/smoke.js
```

Expected: no `PAGEERROR` lines, about 60 fps, and at most the one level warning above.

## Debug hooks for manual testing
Available on `window.Game` (see `CLAUDE.md`): `info()`, `skipToBoss()`, `skipToMid()`, `skipTo(stage, t)`, `give(power, forceLv, shield)`, `giveWeapon(name)`, `giveBomb()`, `damageBoss(n)`, `kill()`, `seed(n)` for reproducible runs, `step(n)` to advance the simulation without rendering.

## Suites from the v2 build
The v2 build used more thorough headless suites: 56 checks for the engine and a second suite for haptics, formations, behaviours and the if-time items. Their results are recorded in `memory.md`. They lived in a session scratch folder and are not committed. Moving them into `tests/` is in `future.md`.

## What testing does not cover
- Audio quality. Nobody has listened to it.
- Real touch hardware, haptics and fullscreen behaviour.
- Game balance and fun. Only a playtest answers those.
