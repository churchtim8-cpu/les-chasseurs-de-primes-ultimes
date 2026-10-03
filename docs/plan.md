# Les Chasseurs de Primes Ultimes: Feasibility and Architecture Review

Prepared for Mr Henry · 30 September 2026 · Based on *Les_Chasseurs_de_Primes_Ultimes_Claude_Blueprint.docx* (read in full, sections 1 to 28)

No game code has been written yet. This document answers section 22 of your prompt (A to G), then lists the design decisions that need your approval before building starts.

---

## A. Feasibility assessment

**Verdict: realistic, as a web game built in milestones.** Nothing in the blueprint needs technology that doesn't exist or can't run in a normal browser. The game is essentially three things layered together:

1. A **town graph** (roads, paths, intersections, landmarks) with a simple top-down renderer on top.
2. A **deterministic "scenario engine"** that generates a route, a suspect, events and French instructions from a seed, and proves they are consistent with each other.
3. A **pre-recorded audio library** that the engine selects from.

Parts 1 and 3 are standard game work. Part 2 is where this project is unusual, and it is also where the educational value lives. It is very testable because it is pure logic: every chase can be generated and checked thousands of times automatically without anyone playing.

What makes it realistic:

- The **map is fixed** (only routes change), so the set of French instructions the game can ever say is **finite and can be listed in advance**. That turns "pre-generated audio for procedural instructions" from a contradiction into a solvable production task (see section D).
- Your French scope is deliberately controlled (fixed vocabulary, templates, no conditionals). That is exactly what makes automatic validation possible.

What makes it hard (details in section F): making instructions **unambiguous** as well as valid, the **number of audio clips**, keeping the art **aligned** with the data, and making sure players **can't win by ignoring the French**.

On "stylized 3D/top-down": I recommend **2D with a 2.5D look** (buildings drawn in a slight three-quarter view with visible fronts and soft shadows, so they read as 3D). True 3D would multiply art cost and hurt performance on school computers and phones without helping the listening goal. This is a technical choice that keeps the blueprint's look, so I've treated it as mine to make, but tell me if you had real 3D in mind.

---

## B. Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** | One language for game, tests, build tools and the future leaderboard server. Types catch mistakes in map data and instruction objects. |
| Game framework | **Phaser** (current stable major version at setup) | Mature 2D web framework with exactly the features the blueprint needs built in: smooth camera zoom/follow (car ↔ foot transition), keyboard and touch input, scenes (title, briefing, chase, results), tweens, sprite rendering on WebGL with Canvas fallback. Large community, strong browser compatibility. |
| Scenario engine | **Plain TypeScript, no Phaser dependency** | The graph, routing, suspect AI, distance model, French generator and validators run identically in the browser, in automated tests and (later) on a server that checks submitted scores. This separation is the most important architectural decision in the project. |
| Audio | **Custom mixer on the Web Audio API** | Five priority buses (scanner, alerts, movement, music, ambience), automatic music ducking while French plays, and a light "radio" filter applied live so clean recordings stay clean and the effect can be switched off. Phaser's built-in sound is fine for effects but too limited for ducking and priority. |
| Randomness | **Seeded PRNG** (small, dependency-free) | Every chase reproducible from a short seed code. Game logic never calls `Math.random`. |
| Build | **Vite** | Fast dev server, simple production builds, good PWA plugin. |
| Tests | **Vitest** (logic) and **Playwright** (browser smoke tests) | Thousands of generated chases validated per run; a real browser checks the game loads and plays. |
| Offline | **Progressive Web App** (service worker + IndexedDB) | Installable from the browser, plays with no connection, saves progress and queues scores locally. |
| Online | **Supabase** (hosted Postgres, auth, realtime) | Live leaderboard updates, row-level security, generous free tier. Firebase would also work; Supabase suits ranked tables better. Added late, and optional. |
| Hosting and CI | **GitHub** repo, **GitHub Actions** (tests on every change), **GitHub Pages** (free hosting) | You get a link that works on any computer or phone, updated automatically. |
| Future mobile/desktop | **Capacitor** (iOS/Android) and optionally **Tauri** (desktop) | Both wrap the same web build, so no rewrite. |

**Alternatives considered and rejected**

- **Godot 4 (web export)**: excellent engine, but its web builds are large and slow to start, have known audio and threading quirks in Safari, and its logic can't be shared with a web leaderboard server or run in fast headless tests as easily.
- **Unity WebGL**: heavy downloads and poor mobile-browser support. Wrong fit for web-first.
- **Three.js / Babylon.js**: real 3D, which I'm not recommending (see A).
- **PixiJS alone**: a great renderer, but we'd have to rebuild camera, input, scenes and more ourselves. Phaser uses a similar renderer underneath and includes them.

---

## C. Architecture

### C1. Project layout

```
les-chasseurs/
├─ src/
│  ├─ engine/                 ← pure TypeScript, no graphics, fully testable
│  │  ├─ rng/                 seeded random, seed codes ("BV-7K3Q-EXP")
│  │  ├─ world/               map schema, loader, spatial queries
│  │  │                       (what's on my left, which is the 2nd street, what's before the bank)
│  │  ├─ routing/             mode-aware pathfinding, route generator, transport stages
│  │  ├─ chase/               mission state machine, suspect AI, distance/signal model,
│  │  │                       capture/escape, events
│  │  ├─ language/            templates, instruction builder, validators,
│  │  │                       ambiguity checker, French interpreter (for tests)
│  │  ├─ audio-select/        manifest lookup: instruction → clip IDs
│  │  ├─ scoring/
│  │  └─ scenario.ts          generateScenario(seed, difficulty) → validated chase
│  ├─ game/                   ← Phaser layer: draws and plays what the engine decides
│  │  ├─ scenes/              Boot, Title, DifficultySelect, Briefing, Chase, Results, Final
│  │  ├─ render/              road renderer (drawn from map data), buildings, actors, labels
│  │  ├─ input/               keyboard, on-screen touch controls
│  │  ├─ camera/              car/foot profiles, smooth transitions
│  │  ├─ audio/               mixer buses, ducking, scanner sequencer, repeat mechanic
│  │  ├─ hud/
│  │  └─ debug/               overlays and cheat panel (section 15 of your prompt)
│  └─ platform/               save data (IndexedDB), score queue, leaderboard client, PWA
├─ content/
│  ├─ map/bellevue.map.json   the town: nodes, edges, locations (source of truth)
│  ├─ language/               templates.fr.json, lexicon.fr.json (article forms per place)
│  └─ audio/manifest.json     generated by the audio import tool
├─ assets/                    art and audio files
├─ tools/                     map validator, audio script export, audio import, chase simulator
└─ tests/
```

### C2. Map data is the source of truth

Coordinates are in metres on a flat plane. A simplified example:

```json
{
  "nodes": [
    { "id": "N12", "x": 480, "y": 220, "type": "INTERSECTION_4WAY", "trafficLight": true },
    { "id": "N13", "x": 620, "y": 220, "type": "T_JUNCTION" }
  ],
  "edges": [
    { "id": "E30", "from": "N12", "to": "N13", "kind": "STREET",
      "car": true, "foot": true, "oneWay": false, "bridge": false }
  ],
  "locations": [
    { "id": "BANK", "fr": "la banque", "en": "bank", "gender": "f",
      "forms": { "a": "à la banque", "de": "de la banque", "jusqua": "jusqu'à la banque" },
      "district": "TOWN_CENTRE", "footprint": [[500,180],[590,180],[590,205],[500,205]],
      "entrances": [{ "edge": "E30", "t": 0.4, "side": "LEFT" }] }
  ]
}
```

Every relationship the French uses ("after the bank", "the second street on the left", "in front of the museum") is **computed** from this data by the `world/` query functions, never typed in by hand. Pedestrian paths (park, beach promenade, passages) are separate edges with `car: false`.

### C3. The scenario pipeline (your section 5, made concrete)

```
generateScenario(seed, difficulty)
  1. pick chase type + stages     (Car→Car, Car→Foot, …, gated by difficulty)
  2. generate suspect route       (valid for each stage's mode; transfer points exist)
  3. place events                 (only where the map supports them)
  4. validate chase               (continuity, access, length vs timer, player start reachable)
  5. analyse route                (decision points, turns, ordinals, nearby landmarks)
  6. build instructions           (structured objects from allowed templates)
  7. validate French              (true on the map AND the only possible interpretation)
  8. match audio                  (every clause has an approved clip)
  9. validate audio exists
 10. set timer, start chase
Any failure → regenerate that part (with a retry cap and a known-good fallback).
```

One addition to your pipeline: **instructions are also generated during play**, because the player won't always be where the plan expects (wrong turn, recovery, correction events, suspect changing plans). Those runtime instructions go through the same steps 5 to 9 from the player's actual position, and there is always a guaranteed fallback ("Faites demi-tour." / "Revenez au carrefour.") so the scanner never goes silent.

### C4. Validity is not enough: the ambiguity check

"Tournez à gauche après la banque" can be *true* and still *unfair* if there are two left turns shortly after the bank. So step 7 checks two things:

- **Truth:** the structured instruction matches the real route.
- **Uniqueness:** a separate **interpreter** reads the instruction the way a listener would and lists every path it could mean. The instruction is accepted only if there is exactly one.

Tests also run a **"perfect listener" bot** (follows the instructions exactly and must always capture) and a **"not listening" bot** (drives randomly and should nearly always fail). The gap between the two is our automatic measure of whether the game really rewards comprehension.

### C5. Structured instructions and clauses

Your section 14 object becomes a list of clauses, because multi-step instructions are built from clauses (see D, French audio):

```json
{
  "instructionId": "I-7f3a",
  "difficulty": "INTERMEDIATE",
  "template": "I3",
  "clauses": [
    { "action": "TAKE_STREET", "side": "LEFT", "ordinal": 2, "atNode": "N12",
      "connector": null, "audioId": "dir.take_street.left.2" },
    { "action": "CONTINUE_UNTIL", "landmark": "MUSEUM", "connector": "PUIS",
      "audioId": "dir.continue_until.museum+puis" }
  ],
  "text": "Prenez la deuxième rue à gauche, puis continuez jusqu'au musée."
}
```

### C6. Movement and the distance model

- The player moves **along the road graph** (see Decision 2): in car mode the car cruises forward automatically, the player chooses turns with arrow keys (or on-screen arrows), can speed up, slow down, and turn around. A turn pressed early is held until the next junction where that turn is possible. No crashing, no steering physics. In foot mode, the same idea at walking pace on footpaths, with the closer camera.
- **Distance is measured along roads**, not in a straight line: the length of the shortest legal path from the player to the suspect. Correct moves close it (the suspect is slightly slower than a player who follows well). Wrong turns and hesitation open it. Warnings at thresholds; the suspect escapes only at time-out (decided 2026-10-03: a lost player can always recover, at the cost of time and points).
- **Capture** when the path distance is under a threshold *and* conditions fit (for example, you can't catch a moving car on foot; you catch it after it stops or the suspect gets out).

### C7. Mission state machine

`BRIEFING → STARTING → PURSUIT ⇄ EVENT → CAPTURED | ESCAPED → RESULTS → NEXT_MISSION → … → GAME_COMPLETE`, exactly as in blueprint section 23. The transport state (CAR / FOOT / TRANSITION) sits beside it and drives camera, controls, sounds, allowed roads and allowed instructions.

### C8. Online/offline

The game is fully playable offline. Scores go into a local queue in IndexedDB; when online, the queue is sent. Because the engine is deterministic, the server can later **re-run a submitted chase from its seed and input log** to reject faked scores, using the same engine code.

---

## D. Asset pipeline

### Map graphics: roads drawn from data

The **road layer is generated from the map data by code** (asphalt, kerbs, pavements, crossings, lane markings, the roundabout, the bridge, the beach promenade). It therefore can never disagree with the navigation graph. AI or hand-made art is used for **textures and decoration** (paving, grass, sand, water, trees, benches, market stalls), not for road layout. Changing a road in the data redraws the town automatically.

### Buildings

Each approved location is a **separate sprite** placed on its footprint from the map data, in the same three-quarter view and lighting. Recognition matters more than realism, so each landmark gets a strong visual signature (the mairie's clock and flag, the pharmacie's green cross, the gare's platform canopy, the stade's oval, the boulangerie's awning). Generic filler buildings (houses, apartments) come from a smaller set of reusable sprites in the town palette.

How to make them:

1. **Prototype:** simple shapes with labels and icons, drawn in code. Free CC0 placeholder packs (for example Kenney's top-down packs) can help for cars and props.
2. **Final art:** ChatGPT image generation, or ElevenLabs image generation (already connected to this project, so I can run it here with your go-ahead since it uses credits). I'll write a **style guide and prompt sheet** (camera angle, lighting direction, palette hex codes, transparent background, fixed size per building class) so all 30 buildings look like one town. Expect a cleanup pass: removing backgrounds, matching scale, fixing any text the image model invents on signs. Shop signs are added by the game in a clean font, not baked into the picture.
3. Labels on Easy are drawn by the game, so they can fade out on harder levels.

### Characters and vehicles

Top-down vehicles need eight or sixteen facing directions, which image generators do badly. Recommendation: vehicles as **single top-down sprites rotated by the game** (a car seen from directly above looks right when rotated), in the colours the French uses (rouge, bleue, noire, blanche, verte, plus taxi, camionnette, moto). People on foot are small, so a simple top-down figure with a short walk and run cycle is enough; the police officer and suspect are distinguished by colour and silhouette, not physical description (blueprint rule). Skins later are just alternative sprites.

### French audio (ElevenLabs, pre-generated, no live calls)

**The key idea:** because the map is fixed, a tool can **enumerate every clause the game could ever say** by running the generator across the whole map. That list is the recording script.

1. `npm run audio:script` produces **`audio-script.csv`**: one row per clip with its ID, exact French text, voice, category and minimum difficulty. You review it as the French teacher before anything is generated.
2. Generate the clips either in the ElevenLabs website (file name = ID), or with a batch tool using your ElevenLabs API key that skips clips already made. Same voice, model and settings for every take.
3. `npm run audio:import` trims silence, normalises loudness, converts to web formats, measures duration, optionally **transcribes each clip back with speech-to-text and flags any that don't match the script** (catches mispronunciations and mistakes), and writes `manifest.json`.
4. The generator only uses clips marked `approved`. Missing clips simply make those routes unavailable, so **the game stays playable while the audio library grows**, and an automated test reports coverage.

**Audio ID scheme:** IDs describe meaning, not a running number, so the same instruction always maps to the same file:

```
{category}.{action}.{parameters}[+{connector}]
dir.turn.left                       "Tournez à gauche."
dir.turn_after.left.bank            "Tournez à gauche après la banque."
dir.take_street.right.3             "Prenez la troisième rue à droite."
dir.continue_until.museum+ensuite   "Ensuite, continuez jusqu'au musée."
evt.lost_signal                     "Nous avons perdu le signal."
rep.urgent                          "Répétez, s'il vous plaît !"
res.captured.1                      "Vous avez capturé le suspect !"
```

**Manifest entry:**

```json
{
  "id": "dir.turn_after.left.bank",
  "text": "Tournez à gauche après la banque.",
  "category": "DIRECTIONS",
  "minDifficulty": "EASY",
  "voice": "dispatcher_calm",
  "urgency": "NORMAL",
  "connector": null,
  "file": "audio/dispatcher_calm/directions/dir.turn_after.left.bank.m4a",
  "durationMs": 1840,
  "take": 1,
  "sourceHash": "hash of text + voice + settings (detects stale clips)",
  "status": "approved"
}
```

**Voices:** a calm dispatcher for all route instructions (always clear, one consistent delivery, per blueprint section 16), and an urgent officer for alerts, events and repeat requests. Urgency variants (normal, urgent, critical) are recorded only for short event and alert lines and the three repeat phrases, not for every instruction, which keeps the library a manageable size and the instructions consistent.

**Scanner sequence:** beep → short static → clause clips back to back with natural gaps → click. The static and radio filter are added live.

**Rough size:** about 1,500 to 2,500 instruction clips for the full town, plus a few hundred event, repeat and result lines. That is roughly 150,000 to 250,000 characters of ElevenLabs generation (an estimate; I'll produce the exact count from the script tool). Voice-quality compression keeps the whole library to tens of megabytes, split into per-difficulty packs for offline download.

### Music and SFX

- **Music:** four loopable states (normal, tension, critical, final approach) as stems or short loops that crossfade. Sources: royalty-free libraries, or AI music generation if you have a tool you like. Music ducks automatically under French.
- **SFX:** scanner beeps and static, sirens, car idle/accelerate/brake/turn, footsteps walk and run, alerts, capture and escape stings, subtle town ambience. Free libraries (for example CC0 sound packs) are fine for the prototype; ElevenLabs sound-effects generation can fill gaps.

---

## E. Development milestones

Your 18 phases, grouped into milestones that each end with something you can open and try. Two changes to your order: the **navigation graph comes first** (movement rides on it), and **tests and debug tools start in milestone 0** rather than at phase 17.

| # | Milestone | Your phases | You can try |
|---|---|---|---|
| M0 | Project setup: repo, TypeScript, Phaser, Vite, tests, CI, auto-deploy, seeded random, debug toggle | 1, 17 | A link that opens a blank Bellevue screen |
| M1 | Prototype district map data, road renderer, map validator, graph overlay | 2, 5 | A drawn district with labelled places |
| M2 | Car and foot movement on the graph, keyboard and touch, camera profiles and smooth zoom | 3, 4 | Drive and walk around the district |
| M3 | Validated route generation, suspect movement, distance/signal, capture and escape | 6, 7, 8 | Chase a suspect (debug shows route) |
| M4 | French instruction generator: Easy and Intermediate templates, validator, ambiguity check, recovery instructions, test bots | 9 | Instructions shown as text and in debug |
| M5 | Audio manifest, mixer, scanner sequencer, ducking, repeat mechanic, first ~60 real clips | 10 | **Prototype complete: the full core loop with real French audio** |
| — | **Playtest with students and your adult class; tune** | | |
| M6 | Four difficulties, Hard and Expert templates, events, transport transitions, corrections, lost signal, memory | 11, 12 | All chase types |
| M7 | Full Bellevue City: all 30 locations, all districts, bridge, roundabout, beach; art pass | 18 (part) | The whole town |
| M8 | HUD polish, briefing and results, scoring, 8-mission campaign, cosmetics | 13, 14 | A complete game from title to case closed |
| M9 | Offline PWA, save system, audio packs | 15 | Install and play offline |
| M10 | Online leaderboard and score queue | 16 | Live leaderboard |
| M11 | Full audio production, content expansion, difficulty tuning, polish | 18 | Release candidate |

Automated validation (section 19 of your prompt) grows with every milestone and runs on every change.

---

## F. Biggest technical risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **1. Ambiguous or unfair instructions** | A true but ambiguous instruction teaches the wrong lesson and feels like cheating. | Precise counting and landmark rules, the uniqueness check (C4), the interpreter and listener bots, thousands of seeds tested on every change. |
| **2. Audio volume and coverage** | Whole-sentence recordings for every multi-step combination would run to tens of thousands of clips. | Clause-level recordings joined at runtime (Decision 1), enumeration from the map, coverage-limited generation. |
| **3. Players ignoring the French** | If the suspect is always visible, players just follow the dot and the game stops being a listening game. | Suspect hidden unless close or during a sighting event (Decision 3); the "not listening" bot must fail. |
| **4. Art out of step with data** | A generated picture with a road where the graph has none breaks trust. | Roads rendered from data; AI art only for buildings, textures and decoration. |
| **5. Driving skill creeping in** | Fiddly controls penalise the wrong skill, especially on touch screens. | Graph-based movement with buffered turns (Decision 2). |
| **6. Mobile browser audio** | iPhones and iPads block sound until a tap, and handle large audio poorly. | Unlock audio on the first tap (the Start button), load clips on demand, AAC/MP3 formats that play everywhere. |
| **7. Offline storage limits** | Browsers, especially Safari, can clear cached files; students may have little free space. | Installable PWA, compact voice encoding, per-difficulty packs, a "download for offline" button. |
| **8. French quality from TTS** | Wrong liaisons, stress or pronunciation of "gare routière", "station-service", "jusqu'au", and so on. | Your review of the script, speech-to-text check on import, easy per-clip regeneration. |
| **9. Difficulty tuning** | The provisional timers (1:00 at Expert with 3-step instructions) may be too tight. | All numbers in one config file; debug readouts; suggest timers scale with route length. |
| **10. Leaderboard cheating and student privacy** | Scores can be faked; your students are minors. | Replay verification from seed; nicknames and class codes only (Decision 6). |
| **11. Scope** | A big spec can stall before it's fun. | Prototype first; content expansion only after the loop is proven. |

---

## G. Prototype: what to build first

**Goal:** prove that a learner who understands the French catches the suspect, and a learner who doesn't, doesn't.

**Contents**

- **One district:** the town centre plus part of the commercial district, about 6 × 4 blocks and 20 to 25 intersections, including 4-way junctions, T-junctions, one traffic light, one dead end, and the park with footpaths. Eight or nine places: la mairie, la place, la banque, la poste, le café, le restaurant, la boulangerie, la pharmacie, le parc.
- **Placeholder art** drawn in code (roads from data, coloured building blocks with icons and labels).
- **Car mode only**, one suspect in a car, Car → Car chases. Keyboard plus on-screen arrows.
- **Templates:** E1 (direction), E2 (direction + place), E3 (direction + landmark), I2 (first / second / next street), plus the recovery lines "Ce n'est pas la bonne rue" and "Faites demi-tour".
- **Full generation and validation pipeline** from section C3, including the ambiguity check, with a visible seed code.
- **About 60 real ElevenLabs clips** (about 2,500 characters). I can generate them here through the ElevenLabs connector once you approve the voices and the script.
- **Scanner playback** with ducking and the Repeat button (calm version only).
- **Distance meter, capture and escape.**
- **Debug panel:** graph, suspect route, seed, instruction data, force capture and escape.
- **Automated proof:** the listener bot captures in at least 95% of 1,000 seeds; the not-listening bot captures in under 10%.
- **Deployed link** you can open on a school PC or a phone and play.

If this works and feels fun in your classroom, every later milestone is expansion rather than risk.

---

## Decisions needing your approval

Each one follows your section 20 format: the problem, why it matters, what I recommend, and its effect.

**Decision 1. Clause-level audio for multi-step instructions**

- *Problem:* the blueprint prefers complete-sentence recordings for complex instructions. A three-step Expert instruction combining any turn, street number and landmark has tens of thousands of possible combinations.
- *Why it matters:* recording them all would be impractical and very expensive.
- *Recommendation:* record each **clause as a complete, natural spoken phrase** with its linking word built in ("D'abord, tournez à gauche au carrefour." / "Ensuite, prenez la deuxième rue à droite." / "Enfin, continuez jusqu'à la gare.") and play them back to back inside one transmission. Never word by word; each clip is a real phrase. Single-clause instructions (most of Easy and Intermediate) are complete sentences as now.
- *Effect:* a library of a couple of thousand clips instead of tens of thousands. Very slightly less continuous intonation between steps, which the radio format makes natural. It also makes "lost signal" easy: the transmission cuts at a clause boundary.

**Decision 2. Graph-based movement (no free steering)**

- *Problem:* free driving with physics rewards steering skill, and is hard on touch screens.
- *Why it matters:* blueprint rule "do not let driving skill overwhelm listening skill".
- *Recommendation:* the car cruises along roads automatically; the player chooses turns (pressed early is fine), speeds up or slows down, and turns around. Foot mode works the same way on footpaths at walking pace.
- *Effect:* the challenge becomes "which turn, and when", which is exactly the French. Movement still feels direct. It is less of a "driving game".

**Decision 3. The suspect is not always shown on the map**

- *Problem:* if the suspect is always visible, players can follow the marker and ignore the scanner.
- *Why it matters:* it would defeat the whole educational purpose.
- *Recommendation:* the suspect appears only when close (final approach), during sighting events ("La voiture verte est près de la bibliothèque."), and briefly on Easy. Otherwise the HUD shows only the signal/distance strength.
- *Effect:* the French becomes the main source of information. Easy stays gentle through more frequent sightings and the on-screen text.

**Decision 4. Roundabout phrasing needs one new word**

- *Problem:* the vocabulary list includes "le rond-point" but no way to say which exit to take.
- *Why it matters:* "Au rond-point, tournez à droite" is ambiguous on a roundabout.
- *Recommendation:* add **"la sortie"**: "Au rond-point, prenez la deuxième sortie." (Hard and Expert only, reusing première / deuxième / troisième.)
- *Effect:* one new noun in the French scope, and the roundabout becomes fully usable.

**Decision 5. Campaign versus difficulty selection**

- *Problem:* the blueprint says a game is 8 suspects (2 Easy, 2 Intermediate, 2 Hard, 2 Expert) and also has a difficulty-selection screen.
- *Why it matters:* these describe two different game structures.
- *Recommendation:* **Campaign** plays the 8 suspects in rising difficulty; **Practice** lets the player pick one difficulty and play single chases (useful for Form 1 and your adult beginners).
- *Effect:* both uses are covered; the leaderboard ranks Campaign scores.

**Decision 6. Leaderboard privacy**

- *Problem:* most players will be secondary students, i.e. minors.
- *Why it matters:* collecting names or emails of children creates privacy obligations for you and the school.
- *Recommendation:* nickname plus an optional class code that you create; no email, no real names, and a nickname filter.
- *Effect:* you can run class leaderboards safely; no password accounts in the first version.

### Defaults I'm picking (no approval needed, but say if you disagree)

- **Counting streets:** "la deuxième rue à gauche" counts only openings on that side that the player's current mode can enter (a footpath doesn't count while driving), starting from the player's current position. Instructions are only issued far enough ahead that the count is clear.
- **Street names are not spoken.** Instructions use directions and landmarks only, as in your vocabulary list.
- **Traffic lights** are landmarks ("Tournez à gauche au feu") and can slow the suspect, but don't penalise the player (no driving-rules test).
- **Repeat** follows blueprint section 16 exactly; the numbers live in the config file for tuning.

---

## Next steps

1. You approve the plan and the six decisions (or tell me which to change).
2. **GitHub:** my tools here can't create a new repository on your account, so please create an **empty** repository (suggested name `les-chasseurs-de-primes-ultimes`) and tell me. I'll attach it and start M0 on a branch with a pull request.
3. I build M0 to M5 (the prototype) and send you a link to play at each milestone.
