# Putting Territory Siege online

These steps put the game on a public web address (like `https://territory-siege-ab12.onrender.com`)
so friends can play from a link, without your computer running. It uses **Render**, which has a free
plan that supports the live connections (WebSockets) the game needs. It takes about 10 minutes.

## Before you start

The game's code must be on GitHub. It already is: the `jesahowl/test` repository.
Render can only build a branch, so either:

- **merge the game branch into `main`** (easiest to keep track of): on GitHub, open a pull request from
  `claude/determined-johnson-hion2w` into `main` and merge it, or
- use the branch `claude/determined-johnson-hion2w` directly. Step 3 shows where to pick it.

## Step 1: Create a Render account

1. Go to **https://render.com** and click **Get Started**.
2. Choose **Sign up with GitHub** and allow access. (No credit card is needed for the free plan.)

## Step 2: Let Render see the repository

1. In Render, click **New +** (top right), then **Blueprint**.
2. Under *Connect a repository*, click **Configure account** (or *Connect GitHub*) if `jesahowl/test` isn't listed.
3. On the GitHub page that opens, choose **Only select repositories**, pick **test**, and click **Save**.
4. Back on Render, `jesahowl/test` now appears in the list. Click **Connect** next to it.

## Step 3: Create the game server

1. Render reads the `render.yaml` file in the project and shows one service: **territory-siege** (Free, Node).
2. Give the Blueprint any name (e.g. `territory-siege`).
3. Set **Branch** to `main` (if you merged) or `claude/determined-johnson-hion2w`.
4. Click **Apply** (or **Deploy Blueprint**).

Render now installs and starts the game. Watch the log: after a minute or two you'll see
`Territory Siege running at http://localhost:10000` and the status turns **Live**.

## Step 4: Play

1. Click the **territory-siege** service. Its address is at the top, e.g. `https://territory-siege-ab12.onrender.com`.
2. Open it, type a name, press **Play**.
3. Send the same link to friends: everyone who opens it joins the same game.

## Good to know

- **The free server sleeps.** After 15 minutes with nobody connected, Render pauses it. The next visitor
  waits about a minute while it wakes up (the page shows "Connecting…" then works). A paid instance
  (about $7/month, in the service's *Settings → Instance type*) stays awake.
- **Updates deploy themselves.** Every time new code is pushed to the branch you picked, Render rebuilds and
  restarts the game automatically (players get disconnected and reconnect to a fresh round).
- **One server = one game.** Up to 24 players share a map; bots fill it up to 6. For several separate
  games you'd need rooms (not built yet).
- **Something went wrong?** Open the service, then **Logs**. A failed build usually shows the error
  there. *Manual Deploy → Deploy latest commit* tries again.

## Running it yourself instead

Any host that can run Node.js 18+ works: install with `npm ci`, start with `npm start`. The server listens on
the port in the `PORT` environment variable (default 3000) and serves both the page and the game connection
on it, so no other setup is needed. If you put it behind HTTPS, the game automatically connects with `wss://`.
