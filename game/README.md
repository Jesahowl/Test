# Untitled Strategy Game (prototype)

A real-time territory strategy game for the browser, set on a fictional, modern-day continent.
Grow your nation pixel by pixel, push into your neighbours, and control **80% of the land** to win.

## Play

Open `game/index.html` in a browser. There is no build step or server.

- **Click / tap** free land or a nation that borders you to send troops in that direction
- **1–9, 0** or the slider set what share of your troops to send (10%–100%)
- **Scroll / pinch** to zoom, **drag** to move the map
- Use the **Retreat** button in the panel to bring an attack's troops home

## What's in this step (step 1 of the plan)

- A random continent made with noise, including bays, inland seas and peninsulas
- You and 3–13 AI nations, with borders that move pixel by pixel as troops push
- Troops grow with your land, and capturing land costs troops (more against well-defended nations)
- AI personalities: Expansionist, Aggressive, Defensive and Opportunist
- A leaderboard, incoming-attack warnings, and victory or defeat screens

## Roadmap

1. ~~Map and territory expansion~~ (this prototype)
2. Economy: gold, oil, steel and food, plus factories
3. Diplomacy: alliances, war, trade deals, AI memory, shared victory
4. Boats (oil), defences (steel), special units, and islands reachable by sea
5. Real-time multiplayer server

## Code

| File | Purpose |
|---|---|
| `js/mapgen.js` | Seeded map generation |
| `js/sim.js` | Simulation: nations, troop growth, attacks, AI, win check (no DOM) |
| `js/render.js` | Canvas rendering and camera |
| `js/main.js` | Menu, input, HUD and game loop |
| `test/sim.test.js` | Headless AI-only matches: `node game/test/sim.test.js` |

The simulation is kept separate from the DOM so the same code can later run on a multiplayer server.
