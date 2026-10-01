# Les Chasseurs de Primes Ultimes

A French listening-comprehension chase game set in Bellevue City. Listen to the police scanner, follow spoken French directions and catch the suspect.

Web-first, offline-capable, built with TypeScript and Phaser.

**Play:** https://churchtim8-cpu.github.io/les-chasseurs-de-primes-ultimes/ (published automatically from `main`)

## How the game is built

- `src/engine/`: the scenario engine in plain TypeScript (seeded randomness, map, routes, suspect, French instructions, validation). No graphics code, so it runs in tests and on a server.
- `src/game/`: the Phaser layer that draws and plays what the engine decides. The town is drawn in code from the map data (`src/game/render/`): roads and paths from the graph, each of the 30 places with its own look on its footprint (`landmarks.ts`), and trees only on ground no route uses. It is drawn once into image tiles when a chase starts. On top, `townLife.ts` adds movement: traffic in colours the scanner never names, people walking, waves, boats, the fountain and seagulls (`?life=0` turns it off).
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
| ← / A, → / D | ◀ ▶ | Turn left / right at the next junction: the driver's left and right, as in "à gauche". The arrow above the player turns with them, so it points the way they will go. At a roundabout the exits are numbered on the map (1 = la première sortie): ◀ ▶ choose the exit and the car goes round and takes it |
| ↑ / W | ▲ | Straight on at the next junction; hold to speed up |
| ↓ / S (hold) | ▼ | Slow down and stop |
| Space / U | ⟲ | Turn around (faire demi-tour) |
| E | ⇄ | Get out of the car / back in (next to it) |
| R | ⟳ RÉPÉTER | Play the last scanner call again straight away; the officer's "Répétez, s'il vous plaît !" shows as text only (after a chase: replay the same chase). Easy: unlimited; Intermediate: 3 per chase; Hard: costs 5 s; Expert: once. |
| 1 to 4 | Tap a card | Answer a sighting (on the title screen: choose the level) |
| M | | Whole-town overview (debug mode) |
| Esc | | Back to the title screen |

Touch buttons appear on touch screens (or add `?touch=1` to the address). The title screen has a level picker (Facile, Intermédiaire, Difficile, Expert); the level is remembered for the next chase and the next visit.

## The pursuit

The suspect never stops or waits. The police are only slightly faster (the suspect drives at 80% of the player's cruising speed at Easy, 84% at Intermediate, 86% at Hard and 88% at Expert), so a player who follows the directions closes in steadily and every wrong turn lets the suspect pull away. If it reaches its destination first, it escapes ("Il est arrivé avant vous."). In a chase with changes of transport it keeps pace with the police until its last stage, and the police close in on that one. The suspect only shows on the map when very close (80 m at Easy down to 50 m at Expert). The listener bot, which hears only the French, still catches it in at least 95% of chases at every level and chase type.

## Chase types

A chase can change transport, as in the blueprint: the suspect drives or runs, and may get out of a car (or into one) mid-chase. The scanner says so ("Le suspect est sorti de la voiture. Il est à pied !", "Il monte dans une voiture !"); the player is told "Descendez de la voiture !" on reaching the spot, or "Montez dans la voiture !" when a colleague brings the police car to the nearest road. After changing, the player follows the suspect's tracks to where it changed, and directions start again from there. Each change adds 12 s to the clock.

| Level | Chase types |
|---|---|
| Easy | Car → Car (mostly), Foot → Foot |
| Intermediate | adds Car → Foot |
| Hard | adds Foot → Car |
| Expert | adds Car → Foot → Car and Foot → Car → Foot |

The weights, stage lengths and timings live in `src/engine/chase/settings.ts`. With debug on, `?type=CAR_FOOT` (with or without `?seed=`) forces a chase type.

### Changes of direction

From Intermediate up (30% of chases at Intermediate, 50% at Hard, 70% at Expert), the scanner first guides the player along the route it predicts for the suspect. In the last stage the suspect then turns off it elsewhere: "Attention ! Le suspect a changé de direction." is followed straight away by corrected directions from where the player is ("Faites demi-tour." first if needed). This is template X3. The predicted route is checked as carefully as the real one, and the correction waits until the player is not about to reach a junction. With debug on, `?turnoff=1` or `?turnoff=0` forces it on or off.

### Sightings

The scanner names the suspect's vehicle when a driving stage starts ("Le suspect est dans une voiture verte."): a blue, black, white or green car, a taxi, or a van (never the van, nor the car it left, when it gets into one mid-chase). As the suspect passes a place, the scanner reports it ("La voiture verte est près de la bibliothèque.", or "Le suspect est près de …" on foot) and the chase pauses while the player picks the matching card, each a vehicle and a place (click, tap, or 1 to 4). The question sits in a strip at the top so the car stays in view; R repeats the call. From Intermediate up one card is the right vehicle at the wrong place and another the wrong vehicle at the right place, so both must be understood. At Expert the sighting only says "Le suspect est près de …": the player has to remember the vehicle. The right card adds 4 seconds and shows the suspect on the map for a moment; a wrong card, or none in time, costs 6 seconds. Sightings are off at every level since the 2026-10-01 playtest (the questions interrupted the chase); `?sightings=1` still forces one for testing. The vehicle line is still said when a driving stage starts.

### Lost signal

At Expert (90% of chases, when the route allows), right after a call with two or three turns the scanner says "Nous avons perdu le signal." It goes quiet, the suspect is hidden and repeats are blocked until the player has used those directions (or goes wrong); then directions resume, with the usual correction after a wrong turn. This is the memory event: the call is heard once and must be remembered. `?lost=1` or `?lost=0` forces it.

## French audio

The scanner plays pre-recorded ElevenLabs clips. `npm run audio:script` writes every line the game can say to `docs/audio/script.csv` for review. Recordings go in `public/audio/dispatcher/` and `public/audio/officer/`, named by audio ID (for example `dir.turn.left.mp3`); `npm run audio:manifest` then lists them in `public/audio/manifest.json`. Once the library has any clips, the scanner only chooses directions whose clips are all recorded, so new sentence types appear in play as soon as their clips are added. Event lines with no recording yet are shown as text, with the radio beep and static. Add `?radio=0` to hear the clips without the radio filter. `audio/review.html` on the site lists every recording with a play button, for checking pronunciation.

The current library (334 lines) was recorded with ElevenLabs Eleven v4: Christophe for the dispatcher and Alain for the officer. Not recorded yet: the 8 lines for transport changes and on-foot sentences, the 2 direction-change lines, the Hard and Expert sentences and clauses (see below), and the 140 vehicle, sighting and lost-signal lines. Alain (male) and Geneviève (female) are the chosen dispatcher voices and will replace Christophe; new recordings go to them. The clips keep ElevenLabs' content-credential tag.

### Hard and Expert instructions

Two-step instructions are recorded as full sentences. Three-step and Expert instructions are whole clauses recorded with their linking word, played back to back (never single words):

| Template | Example | Clips |
|---|---|---|
| H1 / H2 | Tournez à gauche devant la banque, puis prenez la deuxième rue à gauche. | one full sentence |
| H3 | Tournez à gauche, puis tournez à droite. Ensuite, prenez la deuxième rue à gauche. | "…, puis …" sentence + "Ensuite, …" |
| H4 | Prenez la troisième rue à droite. | one sentence |
| X1 | D'abord, tournez à gauche. Ensuite, prenez la première rue à droite. Enfin, … | "D'abord, …" + "Ensuite, …" (+ "Enfin, …") |
| X2 | D'abord, tournez à gauche devant la banque. Ensuite, tournez à droite après le cinéma. | the same, with two or more landmarks |

Each clause is checked from just after the turn before it, so the whole call is true and unambiguous. Weights and distances are in `src/engine/language/settings.ts`. X3 (corrections) is described under Changes of direction above.

## Debug mode

Add `?debug=1` to the address, or press the backtick key (`` ` ``) or F2 in game. It shows the chase seed code and other developer information, and later the navigation graph, suspect route and instruction data.

## Chase seeds

Every chase has a seed code such as `BV-E-7K3Q-M2PX` (`E`, `I`, `H`, `X` = Easy, Intermediate, Hard, Expert). The same code always recreates the same chase. The last character is a check character, so a mistyped code is rejected rather than loading a different chase.
