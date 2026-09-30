# Les Chasseurs de Primes Ultimes: notes for Claude

A French listening-comprehension chase game (web-first, TypeScript + Phaser). The design source of truth is the owner's blueprint; the approved plan is `docs/plan.md`. Build milestone by milestone; do not jump ahead to large content generation.

## Architecture rules

- `src/engine/` is pure TypeScript: no Phaser, no DOM, no `Math.random`. `tests/unit/enginePurity.test.ts` enforces this.
- All randomness goes through `Rng` (seeded). Use `rng.fork('label')` for independent streams (route, events, language) so changing one system does not reshuffle another for the same seed.
- The map data is the navigation source of truth. Artwork never defines roads.
- Generation order is fixed: map → route → transport stages → events → validate chase → analyse route → French → validate French (true and unambiguous) → match audio → validate audio → start.
- Tunable numbers (timers, repeat rules, distances) live in engine config such as `src/engine/difficulty.ts`, never inline in gameplay code.

## French content rules

- Only vocabulary and templates approved in the blueprint (plus "la sortie" for roundabouts, approved). No conditional structures.
- Never concatenate words. Audio is pre-generated ElevenLabs clips: full sentences for one- and two-step instructions, whole-clause clips for Expert three-step and longer instructions.
- Instructions are structured clauses (`src/engine/language/instructions.ts`); the sentence and audio ID are derived from them. Every instruction must pass the interpreter (`interpret.ts`): its single reading must be the real junction and exit. Street counting counts only openings on that side the current mode can enter; roundabouts use "la sortie".
- `tests/unit/listenerBot.ts` plays chases hearing only the French; it must keep capturing (≥95%) without ever being corrected.
- Expert difficulty comes from length, memory, landmarks, corrections and less assistance, never faster speech.

## Checks before pushing

`npm run check` (typecheck, unit tests, build) and `npm run test:e2e`. In the Claude cloud container, run browser tests with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.
