# aasssMaster

A pixel-art horizontal shoot-'em-up in the spirit of R-Type, with a comedic twist:
the enemies are hairy butt-aliens, and they want to swallow your ship whole.

Fly left to right, blast the hairy invaders, grab power-ups, and survive three
stages (HAIRY NEBULA, THE CRACK OF DOOM, RECTUM OF THE GODS), each ending in a
giant hairy boss with a very large mouth.

## How to play

**Goal:** shoot everything, dodge the hairballs, and don't get swallowed.

**Touch (phone or tablet, the primary way to play):**

- Left side of the screen: drag anywhere to move the ship. It follows your finger relative to where you started, not to an absolute spot.
- Right side of the screen: tap to fire, hold for autofire.
- Charged shot: hold for at least 0.6 seconds, then release for a big piercing beam.

**Keyboard:**

- Arrow keys or WASD: move
- Z, Space or Ctrl: fire
- X: charged shot
- P or Esc: pause
- M: mute

Rotate your device to landscape. Portrait mode shows a "rotate your device" prompt.

## How to run

Easiest: open `index.html` in a browser.

For proper audio autoplay behaviour, serve the folder over HTTP instead:

```sh
cd AassMaster
python3 -m http.server
```

Then visit http://localhost:8000 in your browser.

No install, no build step, no npm.

## File layout

```
index.html        page shell, loads the scripts in order
CONTRACT.md       the module contract between the source files
js/
  sprites.js      pixel art, every sprite drawn procedurally from character grids
  sfx.js          sound effects and chiptune music, synthesised with Web Audio
  levels.js       stage data: enemy types, wave scripts, boss phases, power-up drops
  game.js         the engine: loop, input, collision, raster FX, HUD, title and game over
```

## Everything is generated

There are no image, audio or font files in this project. All the pixel art is
built in code, all the sounds and music are synthesised in the browser, and the
levels are plain data. Clone it, poke at it, change a number in `levels.js` and
reload.
