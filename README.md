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

## Private rooms

On the menu, **Create private room** gives you a 5-letter room code and an invite link
(`…/?room=K7QXM`). Friends join by typing the code or opening the link. In the lobby the host
(👑) chooses how many bots to add (0–10) and presses **Start round**; anyone who arrives mid-round
watches and joins the next one. After each round's scoreboard everyone returns to the lobby. A round
also ends early if no humans are left. If the host leaves, someone else becomes host; an empty room
closes after a minute. **Play** still drops you into the always-running public game.

## How to play

| | |
|---|---|
| **Waves** | Every 20s your core sends out a free wave of **5 troops**. |
| **Barracks** | Build **barracks** (`R`, on your own land) for **+5 troops in every wave**. Each barracks' 5 march out from the barracks itself and guard it while your standing order is "defend home". Up to 5 barracks (30 troops per wave). They cost 250g, then 150g more for each one you own. They don't shoot or level up, and like towers they can be destroyed: whoever destroys one takes it over, with its +5. |
| **Army mix** | The army panel decides **which troops fill your wave slots**, for free (`1`–`4` / `+`). A giant takes 3 slots. Unassigned slots are filled with soldiers. Gold goes into **levelling troop types** (`Shift`+number), barracks and towers. |
| **Orders** | **Right-click** an enemy tower or core to attack it, or one of your own towers or your core to defend there. Who goes depends on the **Send slider** in the bar (5% steps; it shows how many of your troops that is, e.g. "12 of 20"): at 100% every troop goes; below 100% only that share of your current troops goes (nearest to the target first, keeping your army's mix of types), so you can split your forces. The **New waves follow** toggle (`F`) decides whether an order also sends your *future* waves to the same target. Select specific troops first (click, Shift-click, `Q` = all) to command exactly those. `H` brings everyone home. |
| **Fog of war** | The map starts dark except your own land and what your core (9 tiles), towers (range + 2), barracks and troops can see; scouts see furthest. **Once an area has been explored, the fog there is cleared for good**: you keep seeing everything that happens there (troops, fights, buildings, camps), even after your troops leave. Enemy troops in unexplored fog aren't even sent to your browser. Spectators see everything. |
| **Troop types** | The four toggles under the Send slider pick **which troop types** your orders send: click to switch a type on/off, **Shift-click or right-click** to send *only* that type (again for all). The Send % then applies to those types, e.g. "50% of my giants". Works with selections too. |
| **Moving** | **Right-click empty ground** to send troops there. They hold the spot, fight enemies that come within 6 tiles of it, and come back to it afterwards. With *New waves follow* on, new waves rally there too. |
| **Hunting** | **Right-click an enemy troop** to send your troops after it. They chase it down and focus it, ignoring other enemies on the way. When it dies they go after its squadmates within 6 tiles, then head home once the squad is gone. A red crosshair marks troops you're hunting. Hunts use the Send slider (or your selection) like other orders, but never redirect new waves. |
| **The push** | Troops march across the map (pathfinding around structures), fight whatever they meet, then hit the target. When a tower falls, the push rolls on to that player's next tower, then their core. |
| **Towers** | Claim land and shoot enemy troops. Your core shoots too. Place them on your land, or **leapfrog** up to 3 tiles past your border onto unclaimed ground. |
| **Taking towers** | **Destroy** one and it becomes yours (+250g): it keeps its level, comes back at 70% health, and its land switches to you. The attackers stay on as its garrison and your waves push on to that player's next tower. Towers only become ruins when their owner's core falls. |
| **Gold** | Land only pays a trickle (1.5g/s + a little per tile). **Most gold comes from fighting**: 14g per enemy troop killed (+6 per troop level), 40–250g per barbarian (a whole camp pays 120–370g), 250g for a tower, and 250g plus all of their gold for a core. Each bounty pops up where you earned it, and the death screen breaks down where your gold came from. |
| **Barbarian camps** | 12 neutral barbarian camps in three sizes: **Raider Camp** (3 axe raiders, 120g), **Barbarian Outpost** (a club-wielding brute + 2 raiders, 190g) and **Warlord's Fort** (a crowned warlord + 2 spearmen, 370g + buff). Barbarians are red-rimmed tokens with horned helmets; the weapon tells you the type. They're passive until attacked, then the whole camp fights back. Hover a camp to see what it pays; right-click it to send troops. They come back after 45s (the Warlord's Fort after 90s) **in a new random spot**, shown on the map and minimap with a countdown ring. |
| **Jungle buff** | Defeating a **Warlord's Fort** (marked 🔥 buff) empowers all your troops for 60s: **+30% damage and 25% less damage taken**. Buffed troops glow orange and a 🔥 shows next to your name. |
| **Rounds** | **Last core standing wins.** Joining is open for the first 60s of a round (bots fill in during that time too). After that, newcomers watch and join the next round automatically. Cores are **fortified for the first 7 minutes** (they take 70% less damage), and from minute 8 troops hit buildings **10% harder every minute**, so early rushes can't knock anyone out but pushes keep getting stronger. After **19 minutes, sudden death** starts: no home-turf bonus, troops deal double damage to towers and cores, and cores slowly crumble, so every round ends. Then a scoreboard shows everyone's placing and a new round starts on a fresh map 15s later. If only bots are left, pressing *New round* starts one straight away. |
| **Home turf** | Troops on their own land heal 2% HP/s and deal +30% damage, so defending is cheaper than attacking. |
| **Army size** | You can have 1 troop alive per 10 tiles of land (min 10, max 45), and always at least one full wave. Waves stop spawning at the cap. |
| **Spawning** | Each base spawns at a random spot, as far as possible from everyone already playing (and their buildings), so bases spread evenly over the map with a different layout every game. |
| **Spawn protection** | For 2 minutes after spawning your core and towers can't be damaged. |
| **Losing** | If your core falls you're **out of the round**. Whoever destroyed it takes the spoils: **all your gold** (plus a 250g bounty), **every troop you still had standing**, and your core site, which becomes **one of their towers** garrisoned by your former troops. Your other towers become ruins. You can then **spectate** (follow any player with Tab, free camera with WASD, Space to follow again) and you join the next round automatically. If you disconnect instead, your troops vanish and nobody gets anything. |

### Troops

| Key | Troop | Wave slots | Level 2 | HP | Role |
|---|---|---|---|---|---|
| `1` | Soldier | 1 | 120g | 300 | Sword and shield: the backbone of every wave. Unassigned slots are filled with soldiers |
| `2` | Scout | 1 | 100g | 110 | Very fast, sees 11 tiles, **never fights**. While your troops defend, scouts **explore on their own**, heading for ground you haven't seen and staying clear of enemy guns |
| `3` | Medic | 1 | 180g | 150 | Heals nearby troops, never attacks |
| `4` | Giant | **3** | 400g | 1800 | Huge and slow. **Smashes everything around its target**, knocks troops back, double damage to buildings |

`Shift`+number levels a type up
(+50% HP, +60% damage, +0.5 range per level, **max 5**); levels apply to troops spawned after.
Levels 4 and 5 (for troops and towers) cost a lot more: a late-game place to spend gold. Towers stop gaining land after level 3,
and get a turning gold rune ring at level 4 and a radiant aura at level 5.

### Controls

| Key | Action |
|---|---|
| Right-click target | Order troops: attack an enemy tower/core/camp, hunt an enemy troop, or defend your own tower/core |
| Send slider | How many of your troops each order sends: drag it, or scroll the wheel over it. `Z` `X` `C` `V` jump to 25% / 50% / 75% / 100% |
| `F` | New waves follow on/off: whether orders also redirect future waves |
| Left-click | Select a troop (`Shift` adds), or a tower / ruin |
| `Q` / `Esc` | Select all troops / clear selection |
| `H` | All troops and new waves defend your core |
| `1`–`4` (`Shift` = level up) | Put a troop type in one more wave slot (free) |
| `R` | Place a barracks (your own land only): +5 troops per wave |
| `B` | Place a tower (shows where you can leap, and the land you'd gain or take) |
| `U` / `Del` | Upgrade / sell the selected tower |
| `WASD` / arrows / right-drag | Pan. Wheel zooms. `Space` jumps home. Click the minimap to jump. `?` opens the controls & how-to-play window. |

### Interface

- **Player card** (top left): gold and income, land, kills, spawn protection / jungle buff, and your core's health.
- **Command bar** (bottom): *Build* (tower, barracks), *Your wave* (countdown ring, a slot strip showing how the next wave is made up, one card per troop type with +/− and level-up), and *Orders* (Send slider, Defend home, troops alive).
- **Hover anything** for a tooltip explaining it, with costs and what an upgrade would change.
- **First-game tips** walk you through attacking, towers, barracks, the wave mix, the Send slider and the jungle; each ticks off when you do it. `?` shows the controls and can bring the tips back.

All numbers live in [`shared/config.js`](shared/config.js), shared by server and client, so tuning happens in one place.
The most useful knobs: economy (`BASE_INCOME`, `INCOME_PER_TILE`, `TROOP_BOUNTY`, `TOWER_BOUNTY`, `CORE_KILL_BOUNTY`,
monster `bounty`, `CAMP_RESPAWN`, `CAMP_RELOCATE`), `WAVE_INTERVAL`, `BASE_WAVE`, `BARRACKS_TROOPS`, `MAX_BARRACKS`, `BARRACKS_COST_STEP`, `LAND_PER_UNIT`, troop and tower stats,
`CORE_DAMAGE`, `HOME_DAMAGE_BONUS`, `SPAWN_SHIELD`, `CAPTURE_TIME`, `TOWER_CLAIM_HP`, `CAMP_*`, jungle buff (`BUFF_CAMPS`, `JUNGLE_BUFF_*`),
rounds (`ROUND_JOIN_WINDOW`, `ROUND_SUDDEN_DEATH`, `SUDDEN_DEATH_*`, `CORE_FORTIFY*`, `SIEGE_RAMP_*`, `ROUND_RESET_DELAY`).

## Architecture

```
shared/config.js        game constants + stat/cost helpers (used by Node and the browser)
shared/pathfinding.js   flow-field Dijkstra used by marching troops
shared/vision.js        fog of war: who can see which tiles (server filtering + client drawing)
server/index.js         HTTP static server + WebSocket, routes players to rooms, 20 Hz tick
server/room.js          a room: its game, rounds/lobby, and the 10 Hz per-player state broadcast
server/game.js          the Game class core: state, spatial grid, tick, snapshots
server/game/*.js        Game methods by topic, mixed into Game.prototype:
                          players (joining, rounds, pacing, gold) · territory · structures (build,
                          upgrade, sell) · army (wave mix, orders, waves) · jungle · combat (damage,
                          towers/cores shooting) · troops (movement, targeting, pathfinding) · fog · bots
                          common.js holds the shared constants and helpers
public/index.html, style.css
public/js/*.js          the browser client as ES modules (entry: main.js):
                          state (shared data; values several modules reassign live on S) · net
                          (WebSocket, interpolation) · fog · targets · territory · render · structures ·
                          troops · camps · cores · effects · overlay (build preview, markers, minimap) ·
                          ui (icons, tooltips) · bar (command bar) · hud · tips · screens · input · main
test/                   node:test suite (game rules, waves & orders, jungle, rounds, pathfinding, server)
```

- **Authoritative server.** Clients only send intents (`build`, `upgrade`, `sell`, `capture`, `army`, `order` with optional `ids`, `share`, `kinds`, `follow`). The server validates everything.
- **State sync.** The game simulates 20 times a second and sends state 10 times a second. Entity lists (players, towers, troops,
  monsters, camps) go out as compact arrays containing only the rows that changed since the last update, plus removed ids; a
  client that just joined gets everything once. Positions are sent in tenths of a tile, and WebSocket compression
  (permessage-deflate) shrinks the rest about 7x: roughly 7 KB/s per player with 12 players. Each player also gets their own
  gold, army plan, standing order and wave timer. Territory is sent run-length encoded, only when it changes.
- **Spatial grid.** Troops are bucketed into 4x4-tile cells each tick, so targeting, tower fire, splash, healing and
  healing only look at nearby troops (24 players: about 4 ms per tick).
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
