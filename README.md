# aasssMaster

- **aasssMaster**, a vertical shoot-'em-up with a hairy-butt alien theme. Every sprite is drawn in code and every sound
  is synthesised in the browser.

A pixel-art horizontal shoot-'em-up in the spirit of R-Type, with a comedic twist:
the enemies are hairy butt-aliens, and they want to swallow your ship whole.

Fly left to right, blast the hairy invaders, grab power-ups, and survive three
stages (HAIRY NEBULA, THE CRACK OF DOOM, RECTUM OF THE GODS). Each stage ends in a
giant hairy boss with a very large mouth. Stages 2 and 3 have a mid-boss on the way.
Beat all three and the loop starts again, with tougher enemies.

## How to play

**Goal:** shoot everything, dodge the hairballs, and don't get swallowed.

**Touch (phone or tablet, the primary way to play):**

- Left side of the screen: drag to move the ship. It follows your finger relative to where you touched, not to an absolute spot.
- Left side, tap without dragging: throws the Force pod if it is attached to your ship. Tap again to recall it.
- Right side: tap to fire, hold for autofire.
- Charged beam: keep holding fire. The beam gets stronger at 0.5 s, 1.0 s and 1.6 s. Release to fire the beam at the tier you reached. The gun fires more slowly while you charge.
- BLAST button (bottom right, appears when full): clears enemy shots and damages everything on screen.

## The game

Stages 1 to 3 each end in a boss, and stages 2 and 3 have a mid-boss part way through. After stage 3 the run loops with
higher boss HP and loop modifiers.

| Stage | Name | Length | Boss |
|-------|------|--------|------|
| 1 | HAIRY NEBULA | 60 s | `boss_butt` |
| 2 | THE CRACK OF DOOM | 70 s | `boss_crack` (mid-boss at 40 s) |
| 3 | RECTUM OF THE GODS | 80 s | `boss_god` (mid-boss at 45 s) |

![Stage 1 in play](docs/screenshots/game-stage1.png)

![The stage 1 boss](docs/screenshots/game-boss.png)

### Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Move | Arrows or WASD | Drag on the left side. The ship follows the finger, not an absolute position. |
| Fire | Z, Space or Ctrl (hold) | Hold on the right side |
| Charged beam | Hold X | Hold longer on the right side |
| Force pod | C or Shift (toggle) | Tap on the left side to throw the Force |
| Bomb | B | |
| Pause | P or Esc | |
| Mute | M | |
| Haptics | V | |

### Components

| File | What it does |
|------|--------------|
| `index.html` | The page shell. Loads the scripts in order and sizes the canvas. |
| `js/sprites.js` | Global `Sprites`. Builds every sprite from character grids at load, plus a small pixel font. |
| `js/sfx.js` | Global `SFX`. Synthesises sound effects and the chiptune tracks for the title, the stages, mid-bosses, bosses and game over. |
| `js/levels.js` | Global `Levels`. Pure data: ten regular enemy types, one mid-boss and three bosses, wave scripts, boss phases, loop modifiers, power-up drops, and `validate()`. |
| `js/render.js` | Global `GameRender`. Everything drawn to the canvas: backdrop, raster effects, HUD, banners and the title, continue and game-over screens. |
| `js/game.js` | Global `Game`. The engine: the loop, input, collision, weapons, the Force pod, bosses, scoring, checkpoints and the debug hooks. |

Debug hooks on `Game` (`info()`, `skipTo(stage, t)`, `skipToBoss()`, `give(power, force, shield)`, `step(n)`) make it
possible to reach any point in a run from the console.


**Keyboard:**

- Arrow keys or WASD: move
- Z, Space or Ctrl: fire (hold for autofire)
- X: hold to charge, release for the beam
- C: throw or recall the Force pod
- B: blast, once the meter is full
- P or Esc: pause
- M: mute
- V: haptics on or off (saved)

Rotate your device to landscape. Portrait mode shows a "rotate your device" prompt and pauses the game.

**Power-ups:**

- P (red): raises the power level of your current gun, up to 3.
- S (green): raises your ship speed, up to 3.
- B (blue): shield, absorbs one hit.
- F (pod): the Force pod. It attaches to the front of your ship, blocks enemy shots and adds forward fire. Higher pod levels hit harder.
- Weapon capsules: spread (five-way fan), laser (piercing beam) and wave (sine shots that pierce). Picking up a different weapon keeps your power level.

A hit that kills you costs a life, your shield and one power level.

**Chains and grazing:** kill enemies in quick succession to build a chain multiplier.
Flying close past enemy shots without touching them (grazing) adds bonus points.

**Checkpoints and continues:** each stage start is a checkpoint, and stages 2 and 3
have more at 35 s and 40 s. When you run out of lives you can continue from the last
checkpoint you passed. You get 3 continues per run. Power-ups reset, your score is kept.

## Everything is generated

There are no image, audio or font files in this project. All the pixel art is
built in code, all the sounds and music are synthesised in the browser, and the
levels are plain data. Clone it, poke at it, change a number in `levels.js` and
reload. `Levels.validate()` tells you if the change broke a stage.
