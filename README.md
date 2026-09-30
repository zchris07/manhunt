# MANHUNT

A browser-based, top-down 2D, asymmetric multiplayer horror game for up to 10 friends.

Zach Branch plays the masked killer on the upcoming TV series *Crystal Lake*. Tonight he stopped
acting. Survivors start every generator in the woods and an abandoned studio warehouse, power
the exit gate and escape before he finds them. They can stun him with bottles and shotguns,
slow him with gas traps and outsmart him, but they can never kill him.

- **Feel:** Darkwood. A dark, desaturated, realistic top-down world where every sprite casts a
  soft shadow, so the flat art reads like a 3D scene seen from above. Your flashlight beam runs
  on until it hits something. Outside your light the world is a faint grey fog: you can make
  out the layout, but people, items and objectives in it are invisible, even right next to you.
  Buildings have windows you can see (and shine your light) through. A minimap fills in only
  what you've actually seen (**M** opens the full map). The UI is a grimy, clinical,
  Outlast Trials-inspired one.
- **Structure:** Dead by Daylight-style asymmetric play. Loops, doors, barricades, hooks
  (scarecrow stakes) and skill checks. Survivors carry items; Zach has a lunge, the Soundcloud
  Burst and an always-on scent. Sexton Science wanders the map with a gift for each survivor.
- **Hiding:** Outlast-style lockers, wardrobes, beds, barrels and tall grass, with a slatted
  peek view and breath holding.
- **Play like a .io game:** no accounts. Pick a name, share a 4-letter code, play.

---

## Quick start (local development)

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:5173 (uses the public PeerJS signaling broker)
```

To host from one tab and join from another on the same machine, open the page twice and use
the room code. Other entry points:

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server for the client. Signaling goes through the free public PeerJS broker. |
| `npm run dev:local` | Starts a local signaling server on :9000 plus Vite on your LAN (`--host`). Use this offline, or for LAN parties: friends open `http://<your-ip>:5173`. |
| `npm run build` | Static production build into `client/dist/`. |
| `npm run preview` | Serves the production build. |
| `npm test` | Unit and integration tests (Vitest), including the 200-seed map sweep. |
| `npm run test:e2e` | Playwright end-to-end tests: real WebRTC between several browsers, with a local signaling server. |
| `npm run balance` | Dev-only bot harness: plays many headless matches per lobby shape and prints win rates. |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript. |

The vision sandbox is at `/sandbox/`: a generated map (or `?arena=1` for a small test arena)
with a controllable player, FPS counter, polygon debug (`V`), mask view (`B`) and map overview
(`M`).

---

## Hosting a game

1. Open the site, type a name and press **Create lobby**. You get a room code like `KQWR`
   and an invite link (`https://…/?room=KQWR`).
2. Friends open the link (or type the code), enter a name and press **Join**.
3. Everyone picks a preference (Survivor / Zach / Either) and presses **Ready**.
4. As the lobby owner you set:
   - **Hunters** (at least 1) and **max survivors** (at least 1, total up to 10). Extra
     players spectate. You can also assign each player's role or **Shuffle roles**.
   - **Map seed**: blank means random. The same seed gives the same map.
   - **Difficulty for survivors** (0.5×–1.5×) and **survivors needed to escape** (default
     50%). The auto-balance preview shows what the next match will look like.
5. Press **Start the night**. After the match everyone sees the results. Press **Back to lobby**
   to rematch.

**Important for the host:** your browser *is* the server. The game simulation runs in a Web
Worker in your tab and everyone connects to you directly.

- Keep the tab open and in the foreground. The game warns you if it was backgrounded, and asks
  the browser to keep the screen awake.
- If you close the tab, the match ends for everyone ("The host left").
- You are slightly handicapped on purpose: your own inputs are delayed by about half your
  guests' average ping (capped at 120 ms), so you don't get a 0 ms advantage. Override it with
  `?handicap=0` or `?handicap=80` on your URL.
- A guest who disconnects can rejoin within 30 s and gets their character back. Players who
  join mid-match spectate until the next one.

**Connectivity.** Players connect peer to peer over WebRTC. The free public signaling broker
only introduces peers; no game traffic goes through it. Public STUN servers are used for NAT
traversal. Roughly 10–20% of home networks (strict NATs, some mobile hotspots) can't connect
directly and need a **TURN relay**. If a friend can't join, add a TURN server at build time:

```bash
VITE_TURN_URL=turn:your.turn.host:3478 VITE_TURN_USERNAME=user VITE_TURN_CREDENTIAL=secret npm run build
```

Other build-time options: `VITE_ICE_SERVERS` (a JSON array replacing the default STUN list) and
`VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH` and `VITE_PEER_SECURE` (use your own PeerJS
server, for example `node scripts/signal-server.mjs --port 9000`).

### Controls

| Survivor | |
|---|---|
| WASD / mouse | Move / aim your flashlight |
| Shift | Sprint (8 s meter, refills in 10 s; after it runs dry you wait 1.5 s) |
| C or Ctrl | Crouch (quiet, slow) |
| E | Start generators, pick up, heal, revive, unstake, hide, open and close doors, talk to Sexton |
| Left mouse | Use the selected item (hold it for night vision goggles) |
| Mouse wheel / 1–5 / click a slot | Select an inventory slot |
| Tab | Rearrange your inventory slots (drag and drop) |
| Q | JARVIS, once you have Sexton's tablet: reveals the whole map for you and shows Zach for 10 s |
| Space | Slam a barricade down · skill checks · hold breath while hidden |
| M | Full map (only the parts you've explored) |

**Items** (at most 2 of each; you start with nothing):

| Item | |
|---|---|
| Bottle (20 on the map) | Throw it at the cursor. A hit stuns Zach. |
| Night vision goggles (3) | Hold left click to look through them. A 15 s meter that never refills; within 650 u your light passes through walls and the cone is 20% wider. |
| Shotgun (2) | 3 shells, 2 s reload. Stuns Zach for 0.8 s and blasts him back. |
| Energy drink (8) | For 20 s your sprint refills 1.5× faster and the meter holds 2 s more. |
| Galaxy gas trap (8) | Plant it. It's hard for Zach to spot. When he comes near it bursts into gas that slows him a lot. |
| Duck confit (6) | Not a slot (it shows on the HUD). Revive a downed teammate, or free a staked one, instantly. |

| Zach Branch | |
|---|---|
| WASD / mouse | Move / look (walk 10% slower than survivors, sprint 20% faster) |
| Shift | Sprint (6 s meter, refills in 6 s) |
| Left mouse | Machete swipe. Hold to charge, release to strike: a full charge is a heavy swipe that reaches 30% farther, sweeps wider and counts as two hits. Two swipes smash a closed door (it stays open) or a dropped barricade. |
| Right mouse | Lunge: an instant dash that slows quickly. 2 charges, 7 s each. Touching a survivor hits them. |
| F | Soundcloud Burst (12 s): aim a purple wave of sound (a slightly concave lens of fixed width) that flies across the whole map through every wall. Every survivor it passes is jump-scared. Everyone hears a snippet of GMajor when it goes out. |
| Q | Hemp Battery (drops when you slay Sexton Science): for 8 s, a wider view, light through walls and +10% speed |
| E | Pick up, stake, search a hiding spot (instant), damage a generator, open and close doors |
| M | Full map. Zach knows the whole map and every stake. |

Zach always sees a red scent trail left by anyone sprinting or bleeding.

Press **Esc** for settings (volume, controls, leave). The game keeps running while it's open.

---

## Deploying (static site)

The client is a plain static site (`client/dist`). No server is needed.

- **GitHub Pages:** enable *Settings → Pages → Source: GitHub Actions*. The workflow in
  `.github/workflows/deploy.yml` builds and publishes on every push to `main`. TURN and signaling
  options can be set as repository variables (and a secret for the TURN credential); see the
  comments in the workflow.
- **Netlify:** import the repo; `netlify.toml` sets the build command and output directory.
- **Cloudflare Pages:** build command `npm run build`, output directory `client/dist`,
  environment variable `NODE_VERSION=22`.

The build uses relative paths, so it works under a sub-path such as
`https://you.github.io/manhunt/`. Serve it over HTTPS: browsers require a secure context for
WebRTC and WebAudio.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, the build and the Playwright
suite on every push.

---

## Adding real art and audio

Every texture and sound has a slot in `client/public/assets/manifest.json`. Out of the box each
texture slot points at a procedural generator (canvas drawing). Sounds are always files: the
game has no synthesized audio at all. To use a real file, replace the slot:

```jsonc
"textures": {
  "tree.pine":    { "file": "sprites/pine_{v}.png", "variants": 4 },   // {v} = 0..3
  "char.hunter":  { "file": "sprites/zach.png" }
},
"sounds": {
  "burst":        { "file": "audio/gmajor.mp3", "offset": 17, "duration": 2.6 }
}
```

- Paths are relative to the manifest, so put files in `client/public/assets/sprites/…` and
  `client/public/assets/audio/…`. No code changes or rebuild of game logic are needed; editing the
  manifest is enough, even on a deployed site.
- If a file fails to load, the procedural version is used and a warning is logged.
- **Sprites** are drawn top-down, **facing right (+x)**, centred, at 1 px per world unit. Sizes
  that match the current art: survivor 64×64, Zach 84×84, trees 256×256 (a canopy seen from
  straight above, radius 100 px, with its shadow baked in down and to the right), generator
  84×68, locker 48×40, loot icons 40×40. Procedural sprites are graded (desaturated and dimmed)
  when they're generated; a file is used as it is.
- Textures may set `"anchor": [x, y]` (the pivot as fractions of the image). Trees and rocks are
  anchored at the centre of the crown.
- **Sounds:** the game plays only the two supplied files: a fading 2.6 s snippet of GMajor
  (`burst`, from 17 s in) that everyone hears when Zach fires a Soundcloud Burst, and Sexton's
  reel (`sexton.reel`, a positional loop that gets louder the closer you are). Sounds may set
  `offset` and `duration` in seconds. Loops should loop seamlessly.
- The jump-scare image is `images.ui.scare` (`client/public/assets/images/scare.webp`).
- The full list of ids is in the manifest. Everything under `client/public/assets/` is public
  once the site is deployed, including the supplied music and image.

---

## Balance and telemetry

All tunable numbers live in [`shared/src/balance.ts`](shared/src/balance.ts): speeds, vision
cones, stamina, cooldowns, item counts and effects, and objective counts.

**Target:** Zach wins about 60% of matches at 1 hunter vs 4 survivors. Other lobby shapes are
auto-balanced by pressure `P = survivors / hunters` against a reference `P0 = 4`:
`scale = sqrt(P / P0)`, clamped, drives repair time, Zach's speed and stun length. Item
counts are fixed.
The required generator count is `clamp(ceil(S / sqrt(H)) + 1, 3, 7)`. The lobby's difficulty
slider multiplies on top.

**Match logs.** The host records every match (lobby shape, seed, resolved balance, winner and
reason, duration, generators, escapes and eliminations, and per-player stats) in the host's
`localStorage`. Use **Download match log** (landing page, lobby, results or settings) to get a
JSON file with a per-shape summary of hunter win rates. Collect logs from game nights, then
adjust `balance.ts`.

`npm run balance` runs the dev-only bot harness (`host/src/dev/bots.ts`) across lobby shapes.
Bots are not humans, so it doesn't measure the 60% target. It's a regression signal for
changes that swing outcomes dramatically.

---

## Architecture

```
shared/   Pure, deterministic, DOM-free and Node-free: math, visibility polygons, collision,
          seeded map generation (woods + BSP/backtracker warehouse), movement (used for client
          prediction and by the host), balance, binary/JSON protocol and message validation.
host/     GameHost (lobby, match lifecycle, snapshots, interest management, rate limits) and the
          authoritative World simulation. Talks only to the Transport interface. Also: in-memory,
          latency-simulating, WebRTC (PeerJS) and Web Worker bridge transports, and dev-only bots.
client/   Vite + PixiJS v8 (WebGL2). DOM UI, GameClient (prediction, reconciliation,
          interpolation), vision renderer and GLSL shaders, procedural art and audio.
server/   Reserved for the future Node WebSocket server (see docs/NODE_SERVER_MIGRATION.md).
```

**Networking.** The host's Web Worker ticks the simulation at 30 Hz and sends each player a
20 Hz binary snapshot, delta-compressed against the last snapshot that player acknowledged.
Snapshots go over an unordered, no-retransmit WebRTC data channel; lobby messages and events go
over a reliable one. Clients send inputs only, redundantly. They predict their own movement with
the same code the host runs, reconcile against the host's state, and draw everyone else about
100 ms in the past, interpolated. Zach's hits use lag compensation (rewind capped at 120 ms).

**Anti-cheat against guests.** Each player is sent only what they could plausibly see (their
cone, plus lit areas in line of sight) or hear (within the noise radius of the source). Hidden
survivors are never sent to anyone. Everything outside a 1400-unit sensing radius is dropped.
The host itself is trusted.

**Vision.** Each frame the client computes visibility polygons with an angular sweep: rays are
cast at ±ε around wall endpoints and tree silhouettes, and 256 angular bins keep ray tests cheap.
It computes the flashlight cone (which runs until it hits something, clipped to the screen), a
proximity circle, a 360° line of sight and up to 6 light polygons. These are drawn into a
half-resolution three-channel mask and blurred. A GLSL filter grades lit areas in warm, flat
colour and renders everything else as a colourless fog at low brightness, so the layout stays
readable. Lamps and campfires light the scene, but only your own light (cone, proximity circle,
x-ray) reveals characters, items and objectives: a second filter hides them everywhere else
with a hard threshold, and the host never sends what you can't see. Night vision and the Hemp
Battery add an x-ray cone (650 u) that passes through walls; it fades in over 0.75 s and out
in 1/6 s.

**Testing mode.** Press **Testing mode** on the landing page to play alone. You get every item
and ability with infinite uses (Zach's Hemp Battery toggles on and off), there's no win
condition, Sexton comes back 10 s after he's slain, and **T** switches you between Zach and a
survivor. Open the full map (**M**) and click anywhere to teleport there. Survivors see their
own scent trail. A lobby owner can also tick **Testing mode** in the lobby settings to test with
friends.

Dev URL flags: `?lag=100` simulates 100 ms of latency on your connection, `?handicap=N`
overrides the host handicap, and `?dev=1` (host only) enables test commands used by the e2e
suite (`tp`, `tpTo`, `give [item, count]`, `confit`, `jarvis`, `hemp`, `sexton`, `gens`, `gate`,
`time`, `heal`…; see `host/src/dev/devCommands.ts`). Never use `?dev=1` for real games.

## Moving to a dedicated server later

v1 is player-hosted by design (free, nothing to run). Moving `GameHost` to a Node + `ws` server
means writing two transports and a small room registry; no game code changes. See
[`docs/NODE_SERVER_MIGRATION.md`](docs/NODE_SERVER_MIGRATION.md).
