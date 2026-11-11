# Territory Siege

A multiplayer **.io tower defence** game. Every player has a core on one shared map.
Defend it with roaming units, grow your land with beacons, and send creeps to siege your neighbours.

![concept](https://img.shields.io/badge/status-prototype-yellow)

## Run it

```bash
npm install
npm start          # http://localhost:3000  (set PORT to change)
npm test
```

Open the URL in a few browser tabs (or share it on your LAN) to play against each other.
AI bots fill the server up to 6 players, so it's playable alone too.

## How to play

| Goal | How |
|---|---|
| **Survive** | Your core has 1000 HP. If creeps destroy it, you're out. Respawn instantly with a new base. |
| **Defend** | Buy **units** (Bolt / Frost / Mortar). Each one guards your core or one of your beacons, patrolling around it and chasing off creeps. |
| **Grow** | You can only build on your own land. **Beacons** claim more land. More land = more gold per second. |
| **Attack** | Send creeps (Grunt / Runner / Brute) at another player. Click an enemy core to target it, otherwise they go for the nearest one. Destroying a core pays **200g + half the victim's gold**. |
| **Scavenge** | Fallen bases leave **ruins**. Grow your land over them and capture them for 25g. |

Neutral waves also hit every player every ~22s, and they get stronger the longer you survive.

### Units and guarding

- Every unit has an **anchor**: your core or one of your beacons. It patrols inside a leash circle around
  that anchor (radius 4.5 for the core, 3.5 for a beacon) and **never leaves your land**.
- When an enemy creep comes within reach of its patch, the unit chases it (staying on the leash),
  stops and shoots. Mortars back off from creeps that get too close.
- A new unit guards whichever of your anchors is nearest to where you placed it. To move units, select
  them and click one of your beacons or your core. While a unit button is selected, all your anchors'
  patrol circles are shown, with a line to the one the new unit will join.
- **Beacons need guards.** Creeps divert to attack any enemy beacon they pass within 2.5 tiles. Lose a
  beacon and you lose its land; its guards fall back to your core.
- Units **body-block**: a creep that bumps into an enemy unit stops to fight it.
- Up to 14 units per player. Units cost no upkeep and can be upgraded (max level 3) or sold.
- Creeps still **pathfind** around cores and beacons to reach their target.

### Controls

| Key | Action |
|---|---|
| `1` `2` `3` | Buy a Bolt / Frost / Mortar unit: click your land to place it |
| `4` | Place a Beacon |
| Click a unit | Select it (`Shift`-click to add more, `Q` selects all your units) |
| Click your beacon / core | With units selected, send them to guard it. Otherwise selects the beacon. |
| `Esc` / right-click | Cancel build / deselect |
| `Z` `X` `C` | Send Grunt / Runner / Brute (hold `Shift` for ×5) |
| Click enemy core | Set it as your attack target |
| `U` / `Del` | Upgrade / sell the selected unit or beacon (60% refund) |
| `WASD` / arrows / right-drag | Pan camera. Mouse wheel zooms. `Space` jumps home. Click the minimap to jump. |

## Units, structures & creeps

| Unit | Cost | Role |
|---|---|---|
| Bolt | 55 | Fast single-target shots, quick on its feet |
| Frost | 75 | Area pulse that damages and slows |
| Mortar | 115 | Long-range splash, slow, can't hit adjacent targets |

| Structure | Cost | Role |
|---|---|---|
| Beacon | 90 | Claims land (radius 5, +1 per level). Anchor for guards. |

| Creep | Cost | Notes |
|---|---|---|
| Grunt | 10 | Balanced |
| Runner | 15 | Fast, fragile |
| Brute | 45 | Slow tank, hits hard |

All numbers live in [`shared/config.js`](shared/config.js) and are shared by server and client, so tuning happens in one place.

## Architecture

```
shared/config.js   game constants + stat helpers (used by Node and the browser)
shared/pathfinding.js  flow-field Dijkstra for creep movement
server/game.js     authoritative simulation: territory, units, beacons, creeps, bots, waves
server/index.js    HTTP static server + WebSocket, 20 Hz tick, state broadcast
public/            canvas client (index.html, client.js, style.css)
test/              node:test suite (game logic, units, pathfinding, server smoke test)
```

- **Authoritative server.** Clients only send intents (`build`, `upgrade`, `sell`, `assign`, `capture`, `send`). The server validates everything.
- **State sync.** The full state (players, beacons, units, creeps, effects) is broadcast every tick as compact arrays. Territory is sent run-length encoded, and only when it changes.
- **Territory.** Each tile belongs to whichever core/beacon claims it most strongly. Cores hold nearby land twice as strongly as beacons.
- **Pathfinding.** One flow field per targeted core (Dijkstra from the core outward, binary heap, 8-way moves).
  Every creep heading to that core just steps downhill, so cost doesn't grow with creep count. Fields
  are rebuilt lazily when structures change, at most every 0.25s per target.
- **Units** aren't on the grid, so moving them never invalidates creep flow fields. Each unit plans its
  own short path with a BFS restricted to its owner's open land, re-planned at most every 0.4s while chasing.
- **Territory rendering.** Region outlines are traced along tile edges, smoothed (moving average + Chaikin
  corner cutting) and drawn as vector paths, so borders are curved and crisp at any zoom. The tile grid
  still decides ownership; the build-cursor highlight shows exactly which tile you're on.
- **Bots** expand, buy units for whichever anchor is least guarded, upgrade, and periodically launch attacks.

## Ideas for next steps

- Team / clan mode and alliances
- More unit branches at level 3 (e.g. Bolt → Sniper or Gatling)
- Box-select and control groups for units
- Mobile touch controls
- Delta-compressed snapshots and interest management for large servers
