# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The repo has no package.json, no build step and no linter. The game is plain browser JS that loads as globals.

- Serve the folder over HTTP: `python3 -m http.server 8000`, then open `http://localhost:8000/`.
- Game data check: `Levels.validate()` runs at load and logs its warnings with console.warn. The engine never reads its result (CONTRACT.md C8).
- There is no automated test. CONTRACT.md C8 describes a Playwright run for the game. No such script is committed, so don't assume one exists.

## Architecture

- Load order matters: `sprites.js` → `sfx.js` → `levels.js` → `render.js` → `game.js`. The globals are `Sprites`, `SFX`, `Levels`, `GameRender` and `Game`. `game.js` boots itself on DOMContentLoaded.
- Logical canvas 384×216, floor at y=196. There are no image, audio or font files: sprites are built from character grids at load and every sound is synthesised.
- `levels.js` is data only (enemy types, wave scripts, boss phases that name attack ids). Behaviour and attack defaults live in the engine.
- Specs conflict in a fixed order, stated at the top of CONTRACT.md: `team/DIRECTOR-RULINGS.md`, then the round-3 files in `team/`, then CONTRACT.md's FINAL CORRECTIONS, then its v1 sections. Read those before changing an API.
- `SFX` must stay silent and non-throwing until `SFX.init()` is called from a user gesture.
