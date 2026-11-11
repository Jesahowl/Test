# Territory Siege

A multiplayer **.io tower defence** game. Every player has a core on one shared map.
Defend it with towers, grow your land with beacons, and send creeps to siege your neighbours.

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
| **Grow** | You can only build on your own land. **Beacons** claim more land. More land = more gold per second. |
| **Attack** | Send creeps (Grunt / Runner / Brute) at another player. Click an enemy core to target it, otherwise they go for the nearest one. Destroying a core pays **200g + half the victim's gold**. |
| **Scavenge** | Fallen bases leave **ruins**. Grow your land over them and capture them for 25g. |

Neutral waves also hit every player every ~22s, and they get stronger the longer you survive.

### Mazing

Creeps **pathfind** to their target core. Every structure (yours or anyone else's) is an obstacle,
so cheap **Walls** let you build mazes that funnel creeps past your towers for longer.

- Structures aren't impassable, just *expensive* to path through: entering one costs
  `4 + maxHp × 0.08` tiles of walking (a fresh wall ≈ 44 tiles). Creeps take a detour up to that
  long, and beyond it they **break through** the cheapest point instead. Sealing your core completely
  doesn't make you invincible - it just tells creeps where to dig.
- While a build tool is selected, dashed lines show the routes neutral waves would take from 12 directions,
  including the effect of the tower under your cursor, and a readout shows the average route length
  (green `+N` = your placement lengthens the path).
- No diagonal corner-cutting between structures, so a diagonal line of walls is a real wall.

### Controls

| Key | Action |
|---|---|
| `1`–`5` | Pick a tower (Bolt, Frost, Mortar, Beacon, Wall), click your land to place. Shows the creep-route preview. |
| `Esc` / right-click | Cancel build / deselect |
| `Z` `X` `C` | Send Grunt / Runner / Brute (hold `Shift` for ×5) |
| Click enemy core | Set it as your attack target |
| Click your tower | Select it: `U` upgrade (max level 3), `Del` sell (60% refund) |
| `WASD` / arrows / right-drag | Pan camera. Mouse wheel zooms. `Space` jumps home. Click the minimap to jump. |

## Towers & creeps

| Tower | Cost | Role |
|---|---|---|
| Bolt | 50 | Fast single-target shots |
| Frost | 70 | Area pulse that damages and slows |
| Mortar | 110 | Long-range splash, can't hit adjacent targets |
| Beacon | 90 | Claims land (radius 5, +1 per level) |
| Wall | 15 | High-HP blocker |

| Creep | Cost | Notes |
|---|---|---|
| Grunt | 10 | Balanced |
| Runner | 15 | Fast, fragile |
| Brute | 45 | Slow tank, hits hard |

All numbers live in [`shared/config.js`](shared/config.js) and are shared by server and client, so tuning happens in one place.

## Architecture

```
shared/config.js   game constants + stat helpers (used by Node and the browser)
shared/pathfinding.js  flow-field Dijkstra (server creep movement + client route preview)
server/game.js     authoritative simulation: territory, towers, creeps, bots, waves
server/index.js    HTTP static server + WebSocket, 20 Hz tick, state broadcast
public/            canvas client (index.html, client.js, style.css)
test/              node:test suite (game logic + server smoke test)
```

- **Authoritative server.** Clients only send intents (`build`, `upgrade`, `sell`, `capture`, `send`). The server validates everything.
- **State sync.** The full state (players, towers, creeps, effects) is broadcast every tick as compact arrays. Territory is sent run-length encoded, and only when it changes.
- **Territory.** Each tile belongs to whichever core/beacon claims it most strongly. Cores hold nearby land twice as strongly as beacons.
- **Pathfinding.** One flow field per targeted core (Dijkstra from the core outward, binary heap, 8-way moves).
  Every creep heading to that core just steps downhill, so cost doesn't grow with creep count. Fields
  are rebuilt lazily when structures change, at most every 0.25s per target.
- **Bots** expand, build defences (facing their nearest rival), upgrade, and periodically launch attacks.

## Ideas for next steps

- Team / clan mode and alliances
- More tower branches at level 3 (e.g. Bolt → Sniper or Gatling)
- Mobile touch controls
- Delta-compressed snapshots and interest management for large servers
