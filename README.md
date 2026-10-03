# Les Chasseurs de Primes Ultimes

A French listening-comprehension chase game set in Bellevue City. Listen to the police scanner, follow spoken French directions and catch the suspect.

Web-first, offline-capable, built with TypeScript and Phaser.

**Play:** https://churchtim8-cpu.github.io/les-chasseurs-de-primes-ultimes/ (published automatically from `main`)

## How the game is built

- `src/engine/`: the scenario engine in plain TypeScript (seeded randomness, map, routes, suspect, French instructions, validation). No graphics code, so it runs in tests and on a server.
- `src/game/`: the Phaser layer that draws and plays what the engine decides. The town is drawn in code from the map data (`src/game/render/`): roads and paths from the graph, each of the 30 places with its own look on its footprint (`landmarks.ts`), and trees only on ground no route uses. The look matches the title picture's late-afternoon light: a faint golden wash, long warm shadows to the east, lawn-green ground with soft patches, mown stripes in the park, paving slabs and kerbs, and tiled roofs with chimneys. It is drawn once into image tiles when a chase starts. On top, `townLife.ts` adds movement: traffic in colours the scanner never names, people walking, waves, boats, the fountain and seagulls (`?life=0` turns it off).
- `public/images/title.jpg`: the title screen picture, generated once with ElevenLabs (gpt-image-2, 1280×720, about 185 credits) and saved as a 155 KB JPEG. The only AI image in the game; if it fails to load, the drawn backdrop shows.
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
| B | ♪ MUSIQUE | Music on or off |
| V | 🧭 CARTE | Which way the map faces: TOURNE À PIED (default: on foot the map turns so the officer always runs up the screen and "à gauche" is the screen's left; in the car north stays up), TOURNE TOUJOURS (turns in the car too) or FIXE (north always up). Remembered on this device; `?facing=north` (or `foot`, `always`) in the address sets it |
| Esc | | Back to the title screen |

Touch buttons appear on touch screens (or add `?touch=1` to the address). The title screen has a level picker (Facile, Intermédiaire, Difficile, Expert); the level is remembered for the next chase and the next visit.

## The pursuit

The suspect starts well ahead (350 m at Easy up to 480 m at Expert in a car; 115 to 160 m on foot) and never stops or waits. The police car is only slightly faster (the suspect drives at 74% of the player's cruising speed at Easy, 80% at Intermediate, 82% at Hard and 84% at Expert), so a player who follows the directions closes in steadily and every wrong turn lets the suspect pull away. On foot the officer is fitter (the suspect runs at 70% to 76%), so a foot chase is a short sprint. If the suspect reaches its destination first, it escapes ("Il est arrivé avant vous."). In a chase with changes of transport it keeps pace with the police until its last stage, and the police close in on that one. The suspect only shows on the map when very close (45 m at Easy down to 30 m at Expert). The listener bot, which hears only the French, still catches it in at least 95% of chases at every level and chase type.

Driving and running look and sound different: the car has a flashing siren glow, speed streaks, a wide view, an engine hum that rises with speed and a short tyre screech at every corner; on foot the view is close and steady (no camera shake), and the officer, drawn smaller than a passing car, runs with arms and legs swinging, keeping to the pavement rather than the middle of the road. The suspect on foot runs the same way, in a red hoodie. "À PIED !" or "EN VOITURE !" flashes when the player changes.

On foot the map turns with the officer (heading-up view), the way ahead fills the screen and place names stay upright; past the town's edge there is countryside and sea.

Directions come in time to act on them. In the car each call comes as soon as the last turn is passed; if it still comes late (two junctions close together, or a long sentence), the whole chase, police, suspect and clock, slows a little until the call has been heard, so the player can react before the junction without losing ground. On foot, where running is slow, each call waits until the runner is a few seconds from the turn (6 s at Easy up to 9.5 s at Expert), so there is no long wait after "Prenez la troisième rue", and calls only ever come just after a junction, never mid-street. Settings: `CALL_TIMING` in `src/engine/chase/settings.ts`.

On foot the suspect takes shortcuts a car cannot: paths through the park and the square, the two alleys (Passage du Marché, Passage des Rails), the Passerelle du Port footbridge over the canal, and the seafront promenade. Before running to a car it sticks to streets, so the police car is never left far behind.

### Music

Dramatic chase music is made live in the browser with Web Audio (no audio files, no ElevenLabs credits): a driving D minor groove with drums and string stabs in the car, a faster, lighter heartbeat-and-shaker groove on foot. It gets brighter and busier as the player closes in, and drops right down whenever the French is spoken. The engine and screech sounds are made the same way and also drop down under the French; they stay on when the music is off. B or the ♪ MUSIQUE button turns the music off (remembered on this device); `?music=0` starts with it off.

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

The current library (586 lines) was recorded with ElevenLabs Eleven v4 in Alain's voice, with the tags "[urgent] [very slowly]", then slowed a further 15% in software (ffmpeg `atempo=0.85`, pitch unchanged), the speed the owner chose. It covers every event, outcome, vehicle and sighting line, the one- and two-step directions, and the D'abord / Ensuite / Enfin clauses Expert uses most. Not recorded: the two-step sentences with a landmark (H1/H2) and about 160 rarer clauses; the scanner simply never chooses them. Christophe's earlier recordings were replaced. The officer's repeat lines are shown as text only. The clips keep ElevenLabs' content-credential tag.

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
