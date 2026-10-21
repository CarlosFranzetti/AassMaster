# aasssMaster

A pixel-art horizontal shoot-'em-up in the spirit of R-Type, with a comedic twist:
the enemies are hairy butt-aliens, and they want to swallow your ship whole.

Fly left to right, blast the hairy invaders, grab power-ups, and survive three
stages (HAIRY NEBULA, THE CRACK OF DOOM, RECTUM OF THE GODS). Each stage ends in a
giant hairy boss with a very large mouth, and stages 2 and 3 have a mid-boss on the way.
Beat all three and the loop starts again, with tougher enemies.

## How to play

**Goal:** shoot everything, dodge the hairballs, and don't get swallowed.

**Touch (phone or tablet, the primary way to play):**

- Left side of the screen: drag to move the ship. It follows your finger relative to where you touched, not to an absolute spot.
- Left side, tap without dragging: throws the Force pod if it is attached to your ship. Tap again to recall it.
- Right side: tap to fire, hold for autofire.
- Charged beam: hold fire to charge. The beam gets stronger at 0.5 s, 1.0 s and 1.6 s. Release to fire the beam at the tier you reached. The gun fires more slowly while you charge.

**Keyboard:**

- Arrow keys or WASD: move
- Z, Space or Ctrl: fire (hold for autofire)
- X: hold to charge, release for the beam
- C: throw or recall the Force pod
- P or Esc: pause
- M: mute

Rotate your device to landscape. Portrait mode shows a "rotate your device" prompt.

**Power-ups:**

- P (red): raises the power level of your current gun, up to 3.
- S (green): raises your ship speed, up to 3.
- B (blue): shield, absorbs one hit.
- F (pod): the Force pod. It attaches to the front of your ship, blocks enemy shots and adds forward fire. A second and third pod raise its level.
- Weapon capsules: spread (five-way fan), laser (piercing beam) and wave (sine shots that pierce). Picking up a different weapon keeps your power level.

A hit that kills you costs a life, your shield and one power level.

**Chains and grazing:** kill enemies in quick succession to build a chain multiplier.
Flying close past enemy shots without touching them (grazing) adds bonus points.

**Checkpoints and continues:** each stage start is a checkpoint, and stages 2 and 3
have more at 35 s and 40 s. When you run out of lives you can continue from the last
checkpoint you passed. You get 3 continues per run. Power-ups reset, your score is kept.

## How to run

Easiest: open `index.html` in a browser.

For proper audio autoplay behaviour, serve the folder over HTTP instead:

```sh
cd AassMaster
python3 -m http.server
```

Then visit http://localhost:8000 in your browser.

No install, no build step, no npm.

To check the level data, open the browser console and run `Levels.validate()`.
It returns `{errors, warnings}`. Errors mean a broken stage. Warnings are design notes.

## File layout

```
index.html        page shell, loads the scripts in order
CONTRACT.md       the module contract between the source files (v2)
team/             the four-role design discussion (PROTOCOL.md, DIRECTOR-RULINGS.md, round files)
js/
  sprites.js      pixel art, every sprite drawn procedurally from character grids
  sfx.js          sound effects and chiptune music, synthesised with Web Audio
  levels.js       stage data: enemy catalogue, wave scripts, boss and mid-boss phases,
                  loop modifiers, power-up drops, checkpoints and validate()
  render.js       backdrop, raster effects, HUD, title and overlays
  game.js         the engine: loop, input, collision, bosses, scoring, checkpoints
```

## Everything is generated

There are no image, audio or font files in this project. All the pixel art is
built in code, all the sounds and music are synthesised in the browser, and the
levels are plain data. Clone it, poke at it, change a number in `levels.js` and
reload. `Levels.validate()` tells you if the change broke a stage.
