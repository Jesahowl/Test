# Territory Siege

A multiplayer **.io strategy game with a League-of-Legends feel**. Every player has a core on one shared map
that sends out **waves of troops** every 20 seconds. Point your waves at a rival's towers to push, or pull
them home to defend. Towers claim land and shoot; more land means more gold and a bigger army.

![concept](https://img.shields.io/badge/status-prototype-yellow)

## Run it

```bash
npm install
npm start          # http://localhost:3000  (set PORT to change)
npm test
```

Open the URL in a few browser tabs (or share it on your LAN) to play against each other.
To put it online for friends, follow **[HOSTING.md](HOSTING.md)** (free, about 10 minutes, on Render).
AI bots fill the server up to 6 players, so it's playable alone too.

## How to play

| | |
|---|---|
| **Waves** | Your core sends out a free wave every 20s, built from your **army plan**. Start: 2 Guards + 2 Archers. Spend gold to add troops to every wave, or level a troop type up. |
| **Orders** | **Right-click** an enemy tower or core to attack it, or one of your own towers or your core to defend there. Who goes depends on the **Send slider** in the bar (5% steps; it shows how many of your troops that is, e.g. "12 of 20"): at 100% every troop goes and every future wave follows; below 100% only that share of your current troops goes (nearest to the target first, keeping your army's mix of types) and new waves keep their orders, so you can split your forces. Select specific troops first (click, Shift-click, `Q` = all) to command exactly those. `H` brings everyone home. |
| **The push** | Troops march across the map (pathfinding around structures), fight whatever they meet, then hit the target. When a tower falls, the push rolls on to that player's next tower, then their core. |
| **Towers** | Claim land and shoot enemy troops. Your core shoots too. Place them on your land, or **leapfrog** up to 3 tiles past your border onto unclaimed ground. |
| **Taking towers** | **Destroy** one and it becomes yours (+120g): it keeps its level, comes back at 70% health, and its land switches to you. Or **capture** it without a fight: troops standing near an enemy tower with none of its owner's troops around flip it in ~10s (faster with more troops). Either way the attackers stay on as its garrison and your waves push on to that player's next tower. Towers only become ruins when their owner's core falls. |
| **Gold** | Land only pays a trickle (1.5g/s + a little per tile). **Most gold comes from fighting**: 14g per enemy troop killed (+6 per troop level), 55g per raptor and 250g per golem in the jungle, 250g for a tower, and 250g plus all of their gold for a core. Each bounty pops up where you earned it, and the death screen breaks down where your gold came from. |
| **Jungle** | Neutral camps sit around the map. They're passive until attacked, then the whole camp fights back. Clearing them pays well; they respawn after 45s. Right-click a camp to send troops. |
| **Jungle buff** | Clearing a **golem camp** (marked 🔥 buff) empowers all your troops for 60s: **+30% damage and 25% less damage taken**. Buffed troops glow orange and a 🔥 shows next to your name. |
| **Rounds** | **Last core standing wins.** Joining is open for the first 60s of a round (bots fill in during that time too). After that, newcomers watch and join the next round automatically. After **10 minutes, sudden death** starts: no home-turf bonus, troops deal double damage to towers and cores, and cores slowly crumble, so every round ends. Then a scoreboard shows everyone's placing and a new round starts on a fresh map 15s later. If only bots are left, pressing *New round* starts one straight away. |
| **Home turf** | Troops on their own land heal 2% HP/s and deal +30% damage, so defending is cheaper than attacking. |
| **Army size** | You can have 1 troop alive per 10 tiles of land (min 10, max 30). Waves stop spawning at the cap. |
| **Spawn protection** | For 90s after spawning your core and towers can't be damaged. |
| **Losing** | If your core falls you're **out of the round**. Whoever destroyed it takes the spoils: **all your gold** (plus a 250g bounty), **every troop you still had standing**, and your core site, which becomes **one of their towers** garrisoned by your former troops. Your other towers become ruins. You can then **spectate** (follow any player with Tab, free camera with WASD, Space to follow again) and you join the next round automatically. If you disconnect instead, your troops vanish and nobody gets anything. |

### Troops

| Key | Troop | Add to waves | HP | Role |
|---|---|---|---|---|
| `1` | Guard | 42g+ | 420 | Melee tank. Enemy troops nearby are taunted into fighting it first |
| `2` | Archer | 36g+ | 120 | Ranged damage, fragile |
| `3` | Frost | 54g+ | 160 | Pulses damage and slows every enemy around it |
| `4` | Mortar | 78g+ | 170 | Long-range splash, **double damage to towers and cores** |
| `5` | Medic | 54g+ | 130 | Heals nearby troops, never attacks |

Adding a troop gets pricier the more of that type you already have. `Shift`+number levels a type up
(+50% HP, +60% damage, +0.5 range per level, **max 5**); levels apply to troops spawned after.
Levels 4 and 5 (for troops and towers) cost a lot more: a late-game place to spend gold. Towers stop gaining land after level 3,
and get a turning gold rune ring at level 4 and a radiant aura at level 5.
A wave holds at most 12 troops.

### Controls

| Key | Action |
|---|---|
| Right-click target | Order troops: attack an enemy tower/core/camp, or defend your own tower/core |
| Send slider | How many of your troops each order sends: drag it, or scroll the wheel over it. `Z` `X` `C` `V` jump to 25% / 50% / 75% / 100% |
| Left-click | Select a troop (`Shift` adds), or a tower / ruin |
| `Q` / `Esc` | Select all troops / clear selection |
| `H` | All troops and new waves defend your core |
| `1`–`5` (`Shift` = level up) | Add a troop type to every wave |
| `B` | Place a tower (shows where you can leap, and the land you'd gain or take) |
| `U` / `Del` | Upgrade / sell the selected tower |
| `WASD` / arrows / right-drag | Pan. Wheel zooms. `Space` jumps home. Click the minimap to jump. `?` toggles help. |

All numbers live in [`shared/config.js`](shared/config.js), shared by server and client, so tuning happens in one place.
The most useful knobs: economy (`BASE_INCOME`, `INCOME_PER_TILE`, `TROOP_BOUNTY`, `TOWER_BOUNTY`, `CORE_KILL_BOUNTY`,
monster `bounty`, `CAMP_RESPAWN`), `WAVE_INTERVAL`, `START_ARMY`, `ARMY_MAX_PER_WAVE`, `LAND_PER_UNIT`, troop and tower stats,
`CORE_DAMAGE`, `HOME_DAMAGE_BONUS`, `SPAWN_SHIELD`, `CAPTURE_TIME`, `TOWER_CLAIM_HP`, `CAMP_*`, jungle buff (`BUFF_CAMPS`, `JUNGLE_BUFF_*`),
rounds (`ROUND_JOIN_WINDOW`, `ROUND_SUDDEN_DEATH`, `SUDDEN_DEATH_*`, `ROUND_RESET_DELAY`).

## Architecture

```
shared/config.js       game constants + stat/cost helpers (used by Node and the browser)
shared/pathfinding.js  flow-field Dijkstra used by marching troops
server/game.js         authoritative simulation: territory, waves, troops, towers, jungle, captures, bots
server/index.js        HTTP static server + WebSocket, 20 Hz tick, state broadcast
public/                canvas client (index.html, client.js, style.css)
test/                  node:test suite (game rules, waves & orders, jungle, pathfinding, server smoke test)
```

- **Authoritative server.** Clients only send intents (`build`, `upgrade`, `sell`, `capture`, `army`, `order` with optional `ids` or `share`). The server validates everything.
- **State sync.** Shared state (players, towers, troops, monsters, camps, effects) is broadcast every tick as compact arrays; each player
  also gets their own gold, army plan, standing order and wave timer. Territory is sent run-length encoded, only when it changes.
- **Territory.** Each tile belongs to whichever core/tower claims it most strongly; cores hold nearby land twice as strongly.
  Borders are traced, smoothed and drawn as vector paths on the client.
- **Troop movement.** Attacking troops follow a flow field toward their target (Dijkstra from the goal tile, one per
  active goal, rebuilt lazily when structures change). Defending troops plan short BFS paths within their own land and
  patrol around the structure they guard.
- **Smooth movement.** Each snapshot carries the server tick number; the client draws troops and monsters 100 ms in the
  past, interpolating between snapshots on that steady clock, so movement stays smooth despite network jitter.
- **Bots** leapfrog towers outward, grow and level their army plan, defend when invaded, keep a squad farming jungle camps, and launch
  strike forces (60% of their home troops) at the nearest rival's towers while new waves stay home.

## Ideas for next steps

- Champions: one hero unit per player with abilities, leveling from kills
- Lanes or rally points, and attack-move orders
- Team mode (2v2 / 3v3) and alliances
- Mobile touch controls
