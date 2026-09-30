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
| R | | Repeat the last scanner call (after a chase: replay the same chase) |
| M | | Whole-town overview (debug mode) |
| Esc | | Back to the title screen |

Touch buttons appear on touch screens (or add `?touch=1` to the address).

## Debug mode

Add `?debug=1` to the address, or press the backtick key (`` ` ``) or F2 in game. It shows the chase seed code and other developer information, and later the navigation graph, suspect route and instruction data.

## Chase seeds

Every chase has a seed code such as `BV-E-7K3Q-M2PX` (`E`, `I`, `H`, `X` = Easy, Intermediate, Hard, Expert). The same code always recreates the same chase. The last character is a check character, so a mistyped code is rejected rather than loading a different chase.
