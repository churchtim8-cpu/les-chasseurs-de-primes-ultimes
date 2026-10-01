# Les Chasseurs de Primes Ultimes

A French listening-comprehension chase game set in Bellevue City. Listen to the police scanner, follow spoken French directions and catch the suspect.

Web-first, offline-capable, built with TypeScript and Phaser.

**Play:** https://churchtim8-cpu.github.io/les-chasseurs-de-primes-ultimes/ (published automatically from `main`)

## How the game is built

- `src/engine/`: the scenario engine in plain TypeScript (seeded randomness, map, routes, suspect, French instructions, validation). No graphics code, so it runs in tests and on a server.
- `src/game/`: the Phaser layer that draws and plays what the engine decides.
- `docs/plan.md`: the approved feasibility and architecture plan and milestone list.

## Development

Requires Node 22 or newer.

```sh
npm install
npm run dev        # local dev server
npm run check      # typecheck, unit tests and production build
npm run test:e2e   # browser smoke test (Playwright)
```

## Controls

The police car drives forward on its own; you choose where it goes. Choices are held until the next junction where they are possible.

| Keyboard | Touch | Action |
|---|---|---|
| ← / A, → / D | ◀ ▶ | Turn left / right at the next junction |
| ↑ / W | ▲ | Straight on at the next junction; hold to speed up |
| ↓ / S (hold) | ▼ | Slow down and stop |
| Space / U | ⟲ | Turn around (faire demi-tour) |
| E | ⇄ | Get out of the car / back in (next to it) |
| R | ⟳ RÉPÉTER | Ask for the last scanner call again (after a chase: replay the same chase). Easy: unlimited; Intermediate: 3 per chase; Hard: costs 5 s; Expert: once. |
| M | | Whole-town overview (debug mode) |
| Esc | | Back to the title screen |

Touch buttons appear on touch screens (or add `?touch=1` to the address).

## Chase types

A chase can change transport, as in the blueprint: the suspect drives or runs, and may get out of a car (or into one) mid-chase. The scanner says so ("Le suspect est sorti de la voiture. Il est à pied !", "Il monte dans une voiture !"); the player is told "Descendez de la voiture !" on reaching the spot, or "Montez dans la voiture !" when a colleague brings the police car to the nearest road. After changing, the player follows the suspect's tracks to where it changed, and directions start again from there. Each change adds 12 s to the clock.

| Level | Chase types |
|---|---|
| Easy | Car → Car (mostly), Foot → Foot |
| Intermediate | adds Car → Foot |
| Hard | adds Foot → Car |
| Expert | adds Car → Foot → Car and Foot → Car → Foot |

The weights, stage lengths and timings live in `src/engine/chase/settings.ts`. With debug on, `?type=CAR_FOOT` (with or without `?seed=`) forces a chase type.

## French audio

The scanner plays pre-recorded ElevenLabs clips. `npm run audio:script` writes every line the game can say to `docs/audio/script.csv` for review. Recordings go in `public/audio/dispatcher/` and `public/audio/officer/`, named by audio ID (for example `dir.turn.left.mp3`); `npm run audio:manifest` then lists them in `public/audio/manifest.json`. Once the library has any clips, the scanner only chooses directions whose clips are all recorded, so new sentence types appear in play as soon as their clips are added. Event lines with no recording yet are shown as text, with the radio beep and static. Add `?radio=0` to hear the clips without the radio filter. `audio/review.html` on the site lists every recording with a play button, for checking pronunciation.

The current library (334 lines) was recorded with ElevenLabs Eleven v4: Christophe for the dispatcher and Alain for the officer. Not recorded yet: the 8 lines for transport changes and on-foot sentences, and the 382 clause clips for Hard and Expert (see below). Alain (male) and Geneviève (female) are the chosen dispatcher voices and will replace Christophe; new recordings go to them. The clips keep ElevenLabs' content-credential tag.

### Hard and Expert instructions

Longer instructions are built from recordings that already exist plus whole clauses recorded with their linking word, played back to back (never single words):

| Template | Example | Clips |
|---|---|---|
| H1 / H2 | Tournez à gauche devant la banque. Puis prenez la deuxième rue à gauche. | landmark sentence + "Puis …" |
| H3 | Tournez à gauche, puis tournez à droite. Ensuite, prenez la deuxième rue à gauche. | "…, puis …" sentence + "Ensuite, …" |
| H4 | Prenez la troisième rue à droite. | one sentence |
| X1 | D'abord, tournez à gauche. Ensuite, prenez la première rue à droite. Enfin, … | "D'abord, …" + "Ensuite, …" (+ "Enfin, …") |
| X2 | D'abord, tournez à gauche devant la banque. Ensuite, tournez à droite après le cinéma. | the same, with two or more landmarks |

Each clause is checked from just after the turn before it, so the whole call is true and unambiguous. Weights and distances are in `src/engine/language/settings.ts`. X3 (corrections) comes with the chase events.

## Debug mode

Add `?debug=1` to the address, or press the backtick key (`` ` ``) or F2 in game. It shows the chase seed code and other developer information, and later the navigation graph, suspect route and instruction data.

## Chase seeds

Every chase has a seed code such as `BV-E-7K3Q-M2PX` (`E`, `I`, `H`, `X` = Easy, Intermediate, Hard, Expert). The same code always recreates the same chase. The last character is a check character, so a mistyped code is rejected rather than loading a different chase.
