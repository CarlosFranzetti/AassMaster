# aasssMaster v2 — team round-table protocol

Four roles: PIXEL (art, js/sprites.js), SOUND (audio, js/sfx.js), MECH (engine, js/game.js), LEVELS (data, js/levels.js + README.md).
The director (lead session) moderates. v1 is tagged `v1` and is fully playable; v2 must be strictly better and must stay
plain browser JS with no build step. CONTRACT.md is the v1 contract and stays valid unless this discussion changes it.

Discussion happens in files in this folder so everyone can read everyone:
  round1-<ROLE>.md   Proposal: what you'd change/add in YOUR area for v2, what you've seen in the v1 code that bothers you
                     (in any file), and concrete ASKS of each other role ("MECH: I need X", "PIXEL: can you give me Y").
  round2-<ROLE>.md   Reactions: read ALL four round1 files. Answer every ask addressed to you (yes / no / counter-proposal,
                     with the exact API you'd expose). Push back on anything you think is a bad idea. Ask follow-ups.
  round3-<ROLE>.md   Commitments: read ALL round2 files. Resolve open questions. End with a "COMMITTED API CHANGES" section
                     listing exactly what you will add/change in your file (names, signatures, sizes), and a
                     "DEPENDS ON" section listing what you rely on from others, verbatim from their round3.
Then the director merges round3 commitments into CONTRACT.md (v2) and gives the build go.

Rules: be concrete (names, numbers, signatures), be brief (≤ 80 lines per file), disagree openly, and keep scope realistic
for one implementation pass per role. Address people by role in caps. Write in English.
