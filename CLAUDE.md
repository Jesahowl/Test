# Territory Siege: working notes

A multiplayer hex RTS in the browser. Node + `ws` server (authoritative simulation), plain ES-module
canvas client (no build step), and code shared by both. Rounds of up to 8 players (bots fill seats).

## Commands

| What | Command |
|---|---|
| Run the game | `npm start` (http://localhost:3000; test-mode button on unless `TEST_MODE=0`) |
| Restart the dev server | `pkill -f "node server/index.js"; (setsid nohup node server/index.js > /tmp/server.log 2>&1 &)` |
| All tests (~2–4 min) | `npm test` |
| One test file | `node --test test/walls.test.js` (`--test-name-pattern="worker counts"` for one test) |
| Bot rounds (balance, errors, slow ticks) | `npm run sim -- --seeds=4` |
| Map generation stats over 60 seeds | `npm run mapstats` |
| Server tick profile | `npm run prof -- --marks=3,9,15` (`--detail` for functions inside troops/workers/bots) |
| Client fps profile (Playwright) | `npm run prof:client` |
| Screenshots into `shots/` (git-ignored) | `npm run shots -- map --seeds=777` · `npm run shots -- live --mins=7` |

Playwright and Chromium are preinstalled in the cloud container (`require('playwright')` works anywhere).

## Where things live

**shared/** (server `require` and browser `window.TD_*`, UMD style)
- `config.js`: every tunable number (`C.*`) and small rules helpers (`hexPrice`, `squadCapFor`, `barracksTop`, `income`).
- `hex.js`: hex grid over the 200×100 tile map (`HEX_R` 3.5 tiles; `tileHex`, `at`, `corners`, `across`).
- `terrain.js`: the map from its seed: climate/biomes, sea, lakes, rivers (on hex edges), mountain ridges, forests, iron, gold veins, then the fairness pass (forest + iron within reach of every possible base). Cached per seed. Server and client must agree, so any change here changes both.
- `pathfinding.js`: flow fields with cached edge tables. `vision.js`: fog of war shapes.

**server/**
- `index.js`: HTTP + WebSocket, lobby matchmaking, message routing. `room.js`: a room's lifecycle (lobby → playing → over), per-client snapshots, bots count.
- `game.js`: the `Game` class: `update(dt)` order of systems, snapshots (`personal()`), mixes in `game/*.js`.
- `game/troops.js` (largest): movement, targeting (`pickTarget`), formations (`assignSlots`, `rankSpots`, `frontFoe`), medics, scouts.
- `game/army.js` squads and waves · `workers.js` jobs and resources · `bots.js` AI · `combat.js` damage · `structures.js` building · `territory.js` hexes owned · `walls.js` · `trade.js` · `diplomacy.js` · `jungle.js` camps · `fog.js` · `players.js` joining, spawning, round end.

**public/js/** (one module per concern; `state.js` holds shared state `S`, the camera `cam`, `ctx`)
- `main.js` loop · `net.js` messages + interpolation · `render.js` basics · `terrain.js` ground (cached in chunks, see below) · `territory.js` borders · `structures.js` `cores.js` `troops.js` `chibi.js` `camps.js` `trade.js` `walls.js` sprites · `overlay.js` previews, order lines, minimap · `hud.js` `bar.js` `dock.js` `workforce.js` `screens.js` `lobby.js` `tutorial.js` `tips.js` UI · `input.js` `touch.js` controls · `audio.js` synthesised sound.

## How the client draws terrain
`public/js/terrain.js` builds a map once per seed (`build()`): a smooth ground picture (`buildGround`, 4 px per tile, soft biome edges, rocky bases round mountains), sea, lakes, rivers, peaks, scree, ore and vein patches, and forest trees. Everything static is painted into 16×16-tile chunks at fixed zoom buckets (`paintStatic`, `chunkAt`) and copied each frame. Trees, ore rocks, props and river flow are drawn live on top. All terrain colours go through `lift()` (the brighter palette).

## Conventions
- Comments explain *why* in plain words, matching the existing style; keep file header comments current.
- Tunables go in `shared/config.js`, not inline.
- After a server or shared change: run the related test file, then `npm test` before committing. After a gameplay change: `npm run sim` too. After a visual change: `npm run shots` and look at the result.
- Tests: `test/helpers.js` (`duel`, `run`, `troops`, `seeded`). Many tests use real maps, so map-generation changes can shift them: fix the test setup, not the game, when the game is right.
- Restart the dev server after server changes (the user plays on it).
- Branch: commit and push to the working branch after each change. Never put model names in commits or code.
