# Guidance-style studio: synths, sequencer, processors (design)

Date: 2026-10-21. Status: implemented in `studio/`.

## Goal

Recreate the sound of the reference track "Guidance (Original Mix)" (electro, 126 BPM,
6:28) with code only: one synth per element of the track, a step sequencer that plays
them through a full arrangement, and a processor rack (per-track inserts, sends, master
chain) that gives the mix its character. Plain browser JS, no build step, no files,
same constraints as the game (`CONTRACT.md`): nothing throws, everything is a no-op
until the AudioContext exists.

## What the analysis of the reference found

Measured with numpy/scipy on the decoded MP3 (scripts kept outside the repo):

| Property | Finding |
|---|---|
| Tempo | 126.0 BPM, straight 4/4, first downbeat at 0.58 s |
| Key / bass | bass root B1 (~62 Hz) throughout; upper partials on B major / G# minor notes |
| Kick | 4-on-the-floor, pitch sweep ~130 Hz to ~43 Hz in ~60 ms, click on top |
| Sub | plucked sine on every beat, peaks ~35 ms after the kick, ~300 ms decay, mono |
| Bass | mid bass hits on steps 3, 7, 10, 14 (syncopated against the kick) |
| Stabs | short chord stabs on steps 2, 6, 7, 10, 14, 15; wide stereo (L/R correlation 0.41) |
| Clap | beats 2 and 4, centroid ~2.7 kHz, short body plus reverb tail |
| Open hat | off-beat 8ths (steps 2, 6, 10, 14), centroid ~5.9 kHz, ~250 ms, metallic ring ~1.5 kHz |
| Closed hat | 16th pickups (steps 7, 15 in the main groove, pairs in the build, busier in part two) |
| Breakdown | lighter kick, 16th shaker, a percussion pattern, chord pad, 8th-note lead on F#4 G#4 C#5 D#5 |
| Form | intro 0:00, build 0:44, main 1:16, break 3:16, drop 4:20, outro 5:52, end 6:28 |

Lower confidence: the exact chord progression (chosen: Bmaj9, Bmaj9, G#m7, Emaj7 over a
static B bass) and the exact lead melody (an 8-bar melody written from the measured
note contour, not a note-for-note transcription).

Tuning decisions made while comparing offline renders against the reference with the same
analysis: the sub is not sidechained (kick and sub are one event in the reference, a ducked
sub recovered audibly between beats), the mid bass plays B2 rather than B1 so its energy
lands in the 120 to 300 Hz band like the reference instead of bleeding into the sub band,
and the kick click is kept low because the reference intro has almost no energy above 4 kHz.
After tuning, the renders match the reference on tempo (126.0), low tone (B1), the sub
pluck shape, and the 20 to 300 Hz balance within about 1 dB; the 300 Hz to 1 kHz band
still sits several dB hotter than the reference in every section.

## Architecture

```
studio/
  index.html      the studio page (transport, sections, channel strips, master rack, WAV export)
  core.js         global Kit: AudioParam helpers, note/chord parsing, noise + IR + shaper curves
  synths.js       global Synths: one instrument factory per element
  processors.js   global Processors: insert / send / master effects, chain(), channel()
  sequencer.js    global Sequencer: transport, patterns, arrangement, mixer, offline render
  song.js         global Song: the Guidance-style song data and Song.build(seq)
  studio.js       the page logic (DOM only; no audio code of its own)
  selfcheck.js    node smoke test with a fake AudioContext (mirrors CONTRACT.md C8)
```

Load order: core → synths → processors → sequencer → song → studio.

### Instruments (`Synths.create(ctx, type, opts)`)

Every instrument returns `{type, out, params, set(name, v), get(name), trigger(t, ev), dispose()}`.
`ev = {midi | notes:[midi], vel 0..1, dur seconds, accent}`. Voices are built per trigger
from oscillators / noise buffers and clean themselves up on `onended`.

kick, sub, bass, stab, clap, hat_closed, hat_open, shaker, perc, lead, pad, riser, impact.

### Processors (`Processors.create(ctx, type, opts)`)

Every processor returns `{type, input, output, params, set, get, bypass(b), dispose()}`.
filter, saturator, delay (tempo-synced ping-pong), reverb (generated IR), eq3,
compressor, limiter, sidechain (ducker with `trigger(t)`), widener (mid/side), chorus.
`Processors.chain(ctx, specs)` wires a list in series; `Processors.channel(ctx)` is a
gain + pan + mute strip; `Processors.master(ctx)` is eq3 → glue compressor → saturator →
limiter.

### Sequencer (`Sequencer.create(ctx, {bpm, swing})`)

- 16 steps per bar, lookahead scheduler (25 ms timer, 120 ms lookahead), swing on
  even-numbered 16ths, tempo and swing changeable while playing.
- Tracks: `seq.addTrack(name, {inst, patterns, note | notes | melody | chords, octave,
  gate, chain, sends, duck, gain, pan})`. Pattern strings: `x` hit, `X` accent, `o` soft,
  `.` rest, 16 chars per bar (multi-bar patterns are arrays). Melodies use the game's
  notation (8 or 16 tokens per bar, `-` sustains, `.` rests).
- Arrangement: `seq.setArrangement([{name, bars, play:{track: pattern}, set:{param: v},
  ramp:[{param, from, to}], fx:[{bar, track, bars}]}])`. A track not listed in a section
  is silent in it. `ramp` automates a parameter across the section.
- Mixer: inst → inserts → sidechain → channel → master; channel → sends (delay, reverb).
  A kick track with `duck: [...]` triggers the listed tracks' sidechain processors.
- Transport: play, stop, pause, jump(section), loop(section), mute, solo, events
  (`step`, `section`, `stop`).
- `Sequencer.render(buildFn, opts)` builds the same song on an OfflineAudioContext,
  schedules every step at once and resolves with an AudioBuffer (WAV export in the page).

### Song (`Song.GUIDANCE`, `Song.build(seq)`)

200 bars at 126 BPM (6:20): intro 16, intro2 8, build 16, mainA 32, mainA2 32,
break 24, breakEnd 8, mainB 48, outro 16. Patterns per element as measured above.

## Testing

- `node studio/selfcheck.js`: fake AudioContext; builds the song, schedules all 200 bars,
  asserts every track plays, chord/pattern/melody parsing, section math, ducking
  triggers, no throws when the context is missing.
- Playwright (Chromium): opens `studio/index.html`, starts playback, checks the
  transport advances with zero page errors, renders bars offline to a WAV and the
  rendered audio is analysed with the same scripts used on the reference (tempo, sub
  pitch, hat placement).
