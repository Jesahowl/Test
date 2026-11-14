# Territory Siege

A multiplayer **.io strategy game with a League-of-Legends feel**. Every player has a core on one shared map
that commands up to **four squads of troops**; any that fall respawn every 20 seconds. Point your squads at a
rival's towers to push, or pull them home to defend. **Buy land** with gold along your border; more land means more gold and a bigger army. Towers defend it.

![A battle at an enemy core](screenshots/1-battle.jpg)

| | |
|---|---|
| ![Raiding a Warlord's Fort](screenshots/2-camp-raid.jpg) | ![Your base](screenshots/3-base.jpg) |
| ![The interface](screenshots/4-interface.jpg) | ![The map](screenshots/5-map.jpg) |

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


### Updating automatically (Windows)

Download the game once with **Git** instead of a ZIP; after that, every start fetches the latest version.

1. Install Git once: `winget install --id Git.Git` (then open a new Command Prompt).
2. Download the game once (it goes into a folder called `territory-siege`):
   ```
   git clone -b claude/determined-johnson-hion2w https://github.com/jesahowl/test.git territory-siege
   ```
3. From then on, just double-click a file in that folder:
   - **`play.bat`**: updates, installs and starts the game, and opens http://localhost:3000.
   - **`play-online.bat`**: the same, plus a Cloudflare link (`https://....trycloudflare.com`) friends can join from.
     Needs `winget install --id Cloudflare.cloudflared` once.

Each start shows which version you had and which you have now ("Was" / "Now"), and stops a game
server still running from last time so the new version loads. Then press **F5** in the browser
(friends too). To update without starting the game, double-click **`update.bat`**.

If an update is ever blocked (it says files in the folder were changed), run this in the folder to
throw those changes away and get the latest version:
```
git fetch origin claude/determined-johnson-hion2w
git reset --hard origin/claude/determined-johnson-hion2w
```

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
| **Squads** | You command up to **4 lasting squads**, and you **start with no troops**: each squad is raised by a **barracks**. In the **Squads** drawer (`C`) each squad has a card: what it's doing, its troops alive, a health bar, its barracks level and slots, a **+ / −** for each troop type and its **stance**. New slots join the squad as soldiers; with the squad full, **+** swaps soldiers for the troop you pick, and **−** frees a slot. |
| **Barracks** | Build a **barracks** (`R`, 200g + 80 wood, on your own land) to **raise a squad**: your 1st barracks raises squad 1, the 2nd squad 2, the 3rd squad 3 and the 4th squad 4 (lose one and the next you build fills that squad again). A barracks gives its squad **5 troops**; click it and **upgrade** it for **+5 more** each level (150g, 300g, 450g), up to **20 troops** at level 4. Troops respawn at the barracks as well as the core. Each barracks costs 150g more than the last; like towers they can be destroyed (the bounty goes to whoever does it). |
| **Alliances** | Offer an alliance with the **+🤝** button in the **Diplomacy** drawer (`P`); the other player accepts (bots weigh it up). Allies don't fight each other and can see each other's bases. Attacking an ally asks first and breaks the alliance. At most 2 allies; every alliance ends when sudden death starts. |
| **Trade** | Build a **Trade Post** (`T`, 220g, up to 2) and, with an ally who has one too, a **caravan** sets off for their post every 30s along a road that steers round hostile towers. When it arrives you **both** get its cargo (more for longer routes and higher post levels). Two guards ride with it and fight back; enemies who destroy it take half the cargo. Click a trade post or caravan to see its road; right-click your caravan to send a squad as **escort**. If the alliance ends, caravans on the road vanish. |
| **Walls** | Press `V` and **drag along your border** to wall it (15g a segment, on the edges between your hexes and land that isn't yours). Walls block **every** troop and caravan, yours too: click one and make it a **gate** (40g) to let your troops, caravans and allies through. Walls are your border lifted up into a see-through band of light in your colour, 600 HP each (no upgrades). Gates are the same band opened into a doorway. Troops and workers **path round walls** to an opening or a gate of their side however far it is (and never wedge in a wall's corner); attackers who can't get round hack through the weakest point; soldiers hit walls twice as hard and **siege rams** 25 times as hard. A broken wall can't be rebuilt for 45s, and you can't build with enemies right at it. Buying a hex beyond your walls moves them out with you: the walls it touched (1, 2 or 3) move onto its outer edges, joining up with the rest of the wall, gates staying gates. Losing the hex behind a wall makes it crumble. Bots wall the side facing their nearest enemy, with two gates. |
| **Workers & wood** | You have **3 workers** (hard hats), plus **2 per Workshop** (`K`, 150g + 30 wood, up to 3); they don't use army slots, and fallen ones respawn with your troops. **Buildings and walls cost wood as well as gold** (tower 40, barracks 80, trade post 60, workshop 30; walls cost gold only; you start with 120), and they go up as **building sites**: they rise behind scaffolding as workers build them, and do nothing until finished. Workers have four jobs, each set to **Off / Low / Medium / High** in the **Workers** drawer (`J`): 🔨 **build** sites and walls, 🔧 **repair** damaged buildings, walls and your core (a little gold per HP), 🪓 **chop wood** in forests anywhere on the map (the nearest first) and carry it home; with nothing to build they chop by default, so wood piles up for later (chopped forests thin to stumps and grow back), 🌾 **farm** open hexes of your land for gold, and 🔭 **scout**: up to 2 run off exploring the fog, fast and seeing 11 tiles, keeping clear of enemy guns. They take the highest-priority job that has work, sharing out jobs of equal priority (to start with, building and repairing are High and chopping is Medium, so with nothing to build they chop wood). **Click a worker** and **right-click** a site, damaged building, forest or hex to send it there. Workers never fight: enemies can kill them for 20g and the wood they carried. |
| **Respawning** | Every **20 seconds**, every troop that has fallen respawns (taking turns at the core and each barracks) and marches out to **rejoin its squad**, taking on the order of a living squadmate, or the squad's own order if none is left. The dock's ring counts down to it; the **Army** drawer (`X`) shows who's coming back and lets you **level up troop types** with gold (new levels apply to troops that respawn after). |
| **Stances** | Each squad has a stance (buttons on its card, or `G` to cycle the picked squads): **⚔ Aggressive** fights every enemy it meets on the way, and when guarding home it **goes out after enemy troops within 6 tiles of your border**, then comes back. **🛡 Defensive** (the default) **stays inside your land** and defends it, attacking intruders without ever stepping over the border; sending a defensive squad anywhere outside your land turns it aggressive. **✋ Hold** never chases: it marches past fights and only fights what comes within reach. **🏕 Pillage** hunts barbarian camps on its own: it heads for the nearest live camp **it has discovered** (camps under fog don't count until seen), clears it, then moves on to the next nearest; when a camp's timer runs out and it comes back **nearer home** than the camp the squad is heading for, the squad goes there first (unless it's already fighting). With no camp discovered it **goes searching**: it heads off into the unexplored fog (clear of enemy guns), picking new places to look until it finds a camp; sending it anywhere else sets it back to defensive. |
| **Orders** | A squad **sticks together**: on the march it moves at its slowest troop's pace and troops that run ahead wait for it, and **standing troops form up inside a hex**: on an even grid of spots a tile apart (about 18 to a hex), filled from the middle out and spilling into the next hexes (only onto your own land when at home). Once on their spots they stand perfectly still. At home each squad takes its own hex next to the core. **Troops at home defend automatically** (unless holding): any enemy troop (or angry barbarian) that comes onto your land or into a hex next to it, within 8 tiles of them, gets attacked, from their own side of the border. Each squad's number floats above it on the map. Friendly troops, workers and caravans **walk straight through each other** (only squads standing at their posts spread out into formation); enemies can't pass through each other, and nobody stands inside buildings. In a fight, **melee troops close right in** and **every sword swing is a quick lunge**. **Click any of a squad's troops** (or its card, or press `1`–`4`) to pick it, `Shift` to pick more, `Q` for all squads, then **right-click** a target. A squad keeps its order even with no troops left, so its reinforcements head there. `H` sends every squad home. |
| **Fog of war** | The map starts dark except your own land and what your core (9 tiles), towers (range + 2), barracks and troops can see; scouting workers see furthest. **Once an area has been explored, the fog there is cleared for good**: you keep seeing everything that happens there (troops, fights, buildings, camps), even after your troops leave. Enemy troops in unexplored fog aren't even sent to your browser. Spectators see everything. |
| **Moving** | **Right-click empty ground** to send the picked squads there. They hold the spot, fight enemies that come within 6 tiles of it, and come back to it afterwards. |
| **Hunting** | **Right-click an enemy troop** to send your troops after it. They chase it down and focus it, ignoring other enemies on the way. When it dies they go after its squadmates within 6 tiles, then head home once the squad is gone. A red crosshair marks troops you're hunting. Hunts use the picked squads (or picked troops) like other orders, but are a one-off: the squads keep their standing orders. |
| **The push** | Troops march across the map (pathfinding around structures), fight whatever they meet, then hit the target. When a tower falls, the push rolls on to that player's next tower, then their core. |
| **Land** | The map is a grid of **hexagons**, and land is owned hex by hex. The ground is muted **plains** with patches of **forest** (hexes of little pine trees), different every round. Forests don't affect troops; workers chop them for wood. You start with your core's hex and the six around it. **Claim more with gold**: press `L` (or the **Land** button), then click an empty hex touching your border, or **drag along it** to claim a strip. **Double-click anywhere outside your land** to grow it one hex outward all round (if your gold doesn't cover the whole ring, the hexes nearest where you clicked come first). A hex costs more the more land you own (about 140g each at the start). **Enemy land can't be claimed**: **destroying a core wins you all of that player's land** (a player who leaves is replaced by a bot, who keeps it). Open hexes can be claimed by anyone whose land touches them. A hex with a building in it always stays its owner's. |
| **Towers** | Zap enemy troops with **chain lightning** (58 damage; each bolt jumps on to up to 2 more enemies nearby, at 75% of the previous hit, so crowds suffer most). Cores zap the same way. A level 1 tower holds off one wave, two waves take it with heavy losses, and a level 3 tower needs a real army and **hold your land** (they claim none themselves). Each is a wizard tower whose top floats in pieces above its broken stump, held up by magic around a crystal. Your core (a great crystal over a rune circle) zaps too. Barracks are crystal halls: stone halls with crystals on the roof ridge and a doorway that flares as each wave marches out. Higher levels: a taller stump with a band, a spinning rune ring, gold runes and a glowing aura. Towers and barracks stand at the centre of one of your own hexes, one building per hex, and not in a hex next to an enemy building or core. |
| **Destroying buildings** | **Destroy** an enemy tower, barracks or trade post and it's simply gone (+150g): nobody takes it over and the land stays its owner's. Your attackers and waves push on to that player's next building. Buildings only become ruins when their owner's core falls with nobody to take them. |
| **Gold** | Land pays a steady income (1.5g/s + 0.015g/s per tile; tiles beyond 400 pay 40% of that, so a huge empire doesn't run away with the game). The rest comes from fighting: 14g per enemy troop killed (+6 per troop level), 40–250g per barbarian (a whole camp pays 120–370g), 150g for a tower, and 250g plus all of their gold for a core. Each bounty pops up where you earned it, and the death screen breaks down where your gold came from. |
| **Barbarian camps** | 12 neutral barbarian camps, spread out (each is placed as far as possible from the others, at least 18 tiles apart), in three sizes: **Raider Camp** (3 axe raiders, 120g), **Barbarian Outpost** (a club-wielding brute + 2 raiders, 190g) and **Warlord's Fort** (a crowned warlord + 2 spearmen, 370g + buff). Each camp is a **tent village** on trampled earth: 3 tents for a Raider Camp, 4 plus war banners for an Outpost, and 5 with a watchtower for the Warlord's Fort (its beacon fire marks the buff). Barbarians are red-rimmed tokens with horned helmets; the weapon tells you the type. They're passive until attacked, or until anyone's troops or workers **come within a tile of the camp**: then the whole camp turns on that player. Hover a camp to see what it pays; right-click it to send troops. They come back after 45s (the Warlord's Fort after 90s) **in a new random spot**, shown on the map and minimap with a countdown ring. |
| **Jungle buff** | Defeating a **Warlord's Fort** (marked 🔥 buff) empowers all your troops for 60s: **+30% damage and 25% less damage taken**. Buffed troops glow orange and a 🔥 shows next to your name. |
| **Rounds** | **Last core standing wins.** Joining is open for the first 60s of a round (bots fill in during that time too). After that, newcomers watch and join the next round automatically. Cores are **fortified for the first 8 minutes** (they take 80% less damage), and from minute 8 troops hit buildings **10% harder every minute**, so early rushes can't knock anyone out but pushes keep getting stronger. After **19 minutes, sudden death** starts: no home-turf bonus, troops deal double damage to towers and cores, and cores slowly crumble, so every round ends. Then a scoreboard shows everyone's placing and a new round starts on a fresh map 15s later. If only bots are left, pressing *New round* starts one straight away. |
| **Home turf** | Troops on their own land heal 2% HP/s and deal +30% damage, so defending is cheaper than attacking. |
| **Army size** | Your army is what your barracks give your squads: 5 troop slots per barracks level, up to 20 per squad and 80 in all (a siege ram takes 2 slots). Land no longer adds troops: it pays income. Respawns never take a squad past its slots. |
| **Spawning** | Each base spawns at a random spot, as far as possible from everyone already playing (and their buildings), so bases spread evenly over the map with a different layout every game. |
| **Spawn protection** | For 2 minutes after spawning your core and towers can't be damaged. |
| **Losing** | If your core falls you're **out of the round**. Whoever destroyed it takes the spoils: **all your gold** (plus a 250g bounty), **all your land**, **all your towers and barracks**, and your core site, which becomes **one of their towers**. Your troops, workers and caravans **all vanish** with your core (nobody takes them over). You can then **spectate** (follow any player with Tab, free camera with WASD, Space to follow again) and you join the next round automatically. If you leave mid-round, **a bot takes over your base** under your name (core, land, gold, buildings and troops) and plays on. |

### Troops

Troops are little big-headed figures dressed in their owner's colour (helmet, hood, cap or hat, plus a team-coloured belt), so you can tell them apart at a glance: **soldiers** wear a round steel helmet and carry a sword and round shield, **siege rams** a helmeted crew member pushing a log ram with an iron head, **medics** a white cap and tunic with crosses and a healing staff, and **archers** a feathered felt hat and a short bow. They face the way they walk and bob as they march. Caravans are an **open wagon of barrels pulled by an ox**, with two soldiers walking alongside.

| Troop | Army slots | Level 2 | HP | Role |
|---|---|---|---|---|
| Soldier | 1 | 120g | 340 | Sword and shield: the backbone of every squad. New army slots join squad 1 as soldiers |
| Siege Ram | 2 | 220g | 700 | A heavy battering ram: weak against troops (16 damage), but **×25 against walls** and **×8 against buildings and cores**, and it goes for walls and buildings in reach before anything else. Slow: a squad with a ram marches at its pace |
| Medic | 1 | 180g | 200 | Heals the **two most wounded** troops near it (15 HP/s each), never attacks |
| Archer | 1 | 160g | 170 | **Shoots arrows from range** (5 tiles). Fragile: keep soldiers in front of them |

The **Lv** button on each troop card levels that type up
(+50% HP, +60% damage, +0.5 range per level, **max 5**); levels apply to troops spawned after.
Levels 4 and 5 (for troops and towers) cost a lot more: a late-game place to spend gold. Towers stop gaining land after level 3,
and get a turning gold rune ring at level 4 and a radiant aura at level 5.

### Controls

| Key | Action |
|---|---|
| Right-click target | Order troops: attack an enemy tower/core/camp, hunt an enemy troop, or defend your own tower/core |
| Left-click a troop | Pick its squad (`Shift` adds another squad) |
| `1`–`4` | Pick that squad (press twice to find it) |
| `Q` | Orders go to all squads |
| `G` | Next stance for the picked squads (aggressive / defensive / hold / pillage) |
| `F` | Rectangle formation for the picked squads (or all): standing troops line up in an evenly spaced rectangle facing out, melee in front; press again to spread out. Also on each squad card |
| Left-click a tower | Select it |
| `Esc` | Clear picked troops / selected building / build mode; with nothing to clear, open the menu (Resume, How to play, Leave game). The ☰ button opens it too. The game keeps running while it is open. |
| `H` | Every squad defends your core |
| `R` | Place a barracks (your own land only): it raises your next squad |
| `K` | Place a workshop: +2 workers |
| `J` | Workers drawer: job priorities |
| Click a worker, right-click | Send it to build, repair, chop or farm there |
| `T` | Place a trade post (your own land only): sends caravans to an ally's trade post |
| `V` | Build walls: drag along your border. Click a wall to make it a gate, or knock it down (`Del`; the refund scales with its health) |
| `L` | Claim land: click empty hexes at your border, or drag along it (shows the price) |
| Double-click outside your land | Grow your land one hex outward all round |
| `B` | Place a tower in one of your hexes (it stands at the hex's centre) |
| `U` / `Del` | Upgrade / sell the selected tower (no selling for 5s after it's hit). Damaged buildings sell for less: the price scales with their health, shown live on the Sell button |
| `WASD` / arrows / right-drag | Pan. Wheel zooms. `Space` jumps home. Click the minimap to jump. `?` opens the controls & how-to-play window. |

### Interface

- **Top bar**: you (name, rank, wood, gold and income, land, kills, core health, spawn protection / jungle buff), the round in the middle (with what's coming next just under it), and the players by land on the right (you highlighted, allies marked 🤝; hover one for details), then `?` and the menu.
- **Minimap** (bottom left), with the first-game tips above it. The selected building's panel sits bottom right.
- **Dock** (bottom centre): **Build** `Z`, **Army** `X`, the respawn countdown, **Squads** `C`, **Workers** `J` and **Diplomacy** `P`. Each opens its drawer above the dock (the same button or `Esc` closes it), so the map stays clear: *Build* has the tower, barracks, trade post, wall and land tiles; *Army* who's respawning and one card per troop type with its level-up; *Squads* a card per squad (order, troops alive, health, + / − per troop type, stance) with All squads, All home and troops alive; *Diplomacy* every player with offer / accept / break alliance buttons and offers waiting for you. Squads shows a badge with your free army slots, Diplomacy one with new offers.
- **Hover anything** for a tooltip explaining it, with costs and what an upgrade would change.
- **First-game tips** walk you through attacking, towers, barracks, squad mixes, orders and the jungle; each ticks off when you do it. `?` shows the controls and can bring the tips back.

All numbers live in [`shared/config.js`](shared/config.js), shared by server and client, so tuning happens in one place.
The most useful knobs: economy (`BASE_INCOME`, `INCOME_PER_TILE`, `TROOP_BOUNTY`, `TOWER_BOUNTY`, `CORE_KILL_BOUNTY`,
monster `bounty`, `CAMP_RESPAWN`, `CAMP_RELOCATE`), `WAVE_INTERVAL`, `MAX_SQUADS`, `START_SQUAD`, `BARRACKS_TROOPS`, `MAX_BARRACKS`, `BARRACKS_COST_STEP`, `LAND_PER_UNIT`, troop and tower stats,
`CORE_DAMAGE`, `HOME_DAMAGE_BONUS`, `SPAWN_SHIELD`, `CAPTURE_TIME`, `TOWER_CLAIM_HP`, `CAMP_*`, jungle buff (`BUFF_CAMPS`, `JUNGLE_BUFF_*`),
rounds (`ROUND_JOIN_WINDOW`, `ROUND_SUDDEN_DEATH`, `SUDDEN_DEATH_*`, `CORE_FORTIFY*`, `SIEGE_RAMP_*`, `ROUND_RESET_DELAY`).

## Architecture

```
shared/config.js        game constants + stat/cost helpers (used by Node and the browser)
shared/pathfinding.js   flow-field Dijkstra used by marching troops
shared/vision.js        fog of war: who can see which tiles (server filtering + client drawing)
public/js/terrain.js    the ground: plains and forest patches (chopped ones thin to stumps), from the round's map seed
shared/terrain.js       which hexes are forest (shared by server and browser)
server/game/workers.js  workers and wood: building sites, repairs, chopping, farming, job priorities
shared/hex.js           the hex grid: which hex each tile is in, neighbours, corners (land, buildings, borders)
server/index.js         HTTP static server + WebSocket, routes players to rooms, 20 Hz tick
server/room.js          a room: its game, rounds/lobby, and the 10 Hz per-player state broadcast
server/game.js          the Game class core: state, spatial grid, tick, snapshots
server/game/*.js        Game methods by topic, mixed into Game.prototype:
                          players (joining, rounds, pacing, gold) · territory · structures (build,
                          upgrade, sell) · army (squads, mixes, stances, orders, respawns) · jungle · combat (damage,
                          towers/cores shooting) · troops (movement, targeting, pathfinding) · fog · bots
                          common.js holds the shared constants and helpers
public/index.html, style.css
public/js/*.js          the browser client as ES modules (entry: main.js):
                          state (shared data; values several modules reassign live on S) · net
                          (WebSocket, interpolation) · fog · targets · territory · render · structures ·
                          troops · camps · cores · effects · overlay (build preview, markers, minimap) ·
                          ui (icons, tooltips) · bar (drawer contents) · dock (dock and drawers) · hud · tips · screens · input · main
test/                   node:test suite (game rules, squads & orders, jungle, rounds, pathfinding, server)
```

- **Authoritative server.** Clients only send intents (`build`, `upgrade`, `sell`, `capture`, `army`, `order` with optional `ids` or `squads`, `squad` to change a squad's mix or stance). The server validates everything.
- **State sync.** The game simulates 20 times a second and sends state 10 times a second. Entity lists (players, towers, troops,
  monsters, camps) go out as compact arrays containing only the rows that changed since the last update, plus removed ids; a
  client that just joined gets everything once. Positions are sent in tenths of a tile, and WebSocket compression
  (permessage-deflate) shrinks the rest about 7x: roughly 7 KB/s per player with 12 players. Each player also gets their own
  gold, army size, squads (mix, stance, order), levels and respawn timer. Territory is sent run-length encoded, only when it changes.
- **Spatial grid.** Troops are bucketed into 4x4-tile cells each tick, so targeting, tower fire, splash, healing and
  healing only look at nearby troops (24 players: about 4 ms per tick).
- **Territory.** The map is a hex grid (`shared/hex.js`, shared by server and browser) laid over the fine
  tile grid that troop movement, pathfinding and fog use: every tile belongs to the hex its centre falls in.
  Land is owned per hex: a core starts with its hex and the six around it, players claim empty hexes touching
  their land, a taken tower opens up its old owner's hexes next to it, and a destroyed core's land all goes to the
  player who destroyed it. Each player's land is outlined along the hex edges where it meets other land (chained
  into closed loops and drawn as vector paths), with a see-through fill in their colour, a solid border just inside
  its own edge, and the owner's name written across it.
- **Troop movement.** Attacking troops follow a flow field toward their target (Dijkstra from the goal tile, one per
  active goal, rebuilt lazily when structures change). Defending troops plan short BFS paths within their own land and
  patrol around the structure they guard.
- **Smooth movement.** Each snapshot carries the server tick number; the client draws troops and monsters 100 ms in the
  past, interpolating between snapshots on that steady clock, so movement stays smooth despite network jitter.
- **Bots** build their first barracks straight away, then grow their army (upgrading barracks and adding more) before
  buying land at their border, build towers and workshops, and level their troops. Their squads have roles: squads 1
  and 4 strike the nearest rival's towers once mostly at strength (with siege rams once they're big enough) and fall
  back to regroup when worn down, squad 2 guards home and squad 3 is an aggressive jungle party farming camps.

## Ideas for next steps

- Champions: one hero unit per player with abilities, leveling from kills
- Lanes or rally points, and attack-move orders
- Team mode (2v2 / 3v3)
- Mobile touch controls
