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
  Burst and an always-on scent. Sexton Science wanders the map with a gift for each survivor,
  Shane Jeans tails anyone who bothers him, and Chris Zelley waits by his ambulance to save a life.
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
| E | Start generators, pick up, heal, revive, unstake, hide, open and close doors, talk to Sexton or Chris Zelley |
| Left mouse | Use the selected item (hold it for night vision goggles) |
| G | Drop one of the selected item on the ground for a teammate (JARVIS and duck confit can't be dropped or taken in hand) |
| Mouse wheel / 1–5 / click a slot | Select an inventory slot |
| Tab | Rearrange your inventory slots (drag and drop) |
| Q | JARVIS, once you have Sexton's tablet: for 10 s every player's whole screen is visible; your own map is fully revealed and shows Zach |
| Space | Slam a barricade down · skill checks · hold breath while hidden |
| M | Full map (only the parts you've explored) |

**Items** (at most 2 of each; you start with nothing):

| Item | |
|---|---|
| Bottle (20 on the map) | Throw it toward the cursor. It flies on until it hits something: a wall, a tree, a closed door or window, Zach, another survivor, or an NPC. A hit stuns Zach; on a survivor it takes a fifth of their health. |
| Night vision goggles (3) | Hold left click to look through them. A 15 s meter that never refills; your whole beam passes through walls and the cone is 20% wider. |
| Shotgun (2) | 3 shells, 2 s reload. 8 pellets with random bloom in the same cone; each flies until it hits something solid or someone, shattering windows and flying on through. Any pellet on Zach stuns him for 0.8 s and blasts him back; each pellet on a survivor takes 15% of their health (enough can down them outright). |
| Golden pump (from Plasma.TTV) | A gold tactical shotgun: 5 shells, 1 s reload. It takes the shotgun slot on its own: getting one drops your shotguns, picking up a shotgun drops it. |
| Energy drink (8) | Fills your sprint meter at once. For 20 s it refills 1.5× faster, holds 2 s more, and you walk and run up to 15% faster, all fading over the 20 s. |
| Galaxy gas trap (8) | A Galaxy Gas canister. Planting takes 2 s (moving cancels it). It's hard for Zach to spot. When Zach, an alerted Shane Jeans or a raging Plasma.TTV comes near it bursts into gas that slows Zach a lot, makes Shane give up his chase, slows Sexton, and blinds and slows Plasma. |
| Duck confit (6) | Not a slot (it shows on the HUD). Revive a downed teammate, or free a staked one, instantly. |

| Zach Branch | |
|---|---|
| WASD / mouse | Move / look (walk 10% slower than survivors, sprint 20% faster) |
| Shift | Sprint (6 s meter, refills in 6 s) |
| Left mouse | Machete swipe. Hold to charge, release to strike (after 3 s it strikes by itself). A swipe takes a third of a survivor's health; a full charge takes two thirds (in between, proportionally) and is a heavy swipe that reaches 30% farther and sweeps wider. Two swipes smash a closed door (it stays open) or a dropped barricade; one smashes a window, which you can then climb through (slowly). Survivors can't use smashed windows. A whiff recovers in 0.2 s; any hit that lands (on a survivor, an NPC, a door, a barricade or a window) locks the machete for 0.8 s. |
| Right mouse | Lunge: an instant dash that slows quickly. 2 charges, 7 s each. Touching a survivor hits them. Swipe mid-lunge, or lunge mid-charge, for a combo: the lunge and the swipe can both land. |
| F | Soundcloud Burst (12 s): aim a purple wave of sound (a slightly concave lens of fixed width) that flies across the whole map through every wall at 1700 u/s. Every survivor it passes is jump-scared for 2.5 s (the image and a snippet of the song fade in and out). Only you hear it go out: a very quiet snippet of GMajor from a random point in the song. |
| Q | Hemp Battery (drops when you slay Sexton Science): for 8 s, a wider view, light through walls and +10% speed |
| E | Pick up, stake, search a hiding spot (instant), damage a generator, open and close doors, talk to Plasma.TTV |
| Golden pump | From Plasma.TTV: it replaces your machete (left click fires it) for 10 shots. Each pellet takes 9% of a survivor's health, stuns them for 0.1 s and shoves them away from the blast. |
| M | Full map. Zach knows the whole map and every stake. |

Zach always sees a red scent trail left by anyone sprinting: an unbroken, rippling ribbon like a thin strip of red aurora. Bleeding survivors leave red puffs too.

**Health.** Everyone has a health bar over their head. Survivors are down at zero; each machete
swipe takes a third (a full charge two thirds), a lunge a third, a bottle a fifth, a shotgun
pellet 15%, a Hemp Beam a third and a Plasma punch a quarter. Anyone hit flinches. Lost health
stays lost until a teammate heals you (or Marc Cortez does); a revive, unstake or struggle-free
leaves you on a third. The sprint meter is the wide bar above your inventory.

**NPCs.** There is exactly one **Sexton Science**; once Zach slays him he never comes back.
Talk to him and he says *"I'm working on something big"*; press E again and he says *"This is
powerful tech, (your name). Be careful with it type shi"*, hands over the JARVIS tablet and
walks away, mysteriously. Using JARVIS also widens your minimap's view by 20% for the rest of
the match. Survivors can't kill him: hit him with a bottle or shotgun and he defends himself
against every survivor. He walks away from you, turning back (stepping in to aim) to fire a
**Hemp Beam**: a glowing white beam that lights its surroundings, sparks where it hits and
stops at walls, trees and glass. It lasts 3 s with 3 s between, and takes a third of your
health if it touches you (three down you). After three beams he just flees; once no survivor
has been near him for 10 s he calms down and can be talked to again. While defending, a bottle
stuns him for 0.1 s and a shotgun blast for 0.3 s, and galaxy gas slows him.
**Shane Jeans** (one, unkillable) wanders from a random spot with a faint light. A survivor
who comes within 80 u of him, or keeps a flashlight on him for 2 s in total (the meter drains
slowly while he's out of the beam), alerts him: everyone is told, and he tails that survivor
as closely as he can at 200 u/s (Sexton's panic speed) while Zach gets an arrow pointing
toward him. Zach never alerts him. He gives up after 20 s, when Zach comes within 260 u of
him, or when the survivor gets 1100 u away; 2 bottles or 1 shotgun blast shake him off (he
runs away for 4 s). He can't open doors or break barricades, and after a chase he can't be
alerted again for 10 s. While he's alerted you can hear his soft, quick footsteps pitter-patter
after you.

**Chris Zelley** (one) is a paramedic who paces around his **ambulance**, a 300 × 150 u
structure parked at a random spot in the woods with medical gear around it and a faint glow of
its own (he carries no light). Until a survivor talks to him (E) he never leaves it. Talk to
him and he says *"I'll be there when you need me."* and starts wandering the map. The first
time a survivor has been downed for 15 s, or on a stake for 12 s, he runs to them from wherever
he is at Zach's sprint speed, opening doors on the way, and revives them (8 s) or cuts them
down (1.6 s), just as long as a survivor would take. Then he sprouts wings and flies to the
heavens, never to be seen again: he helps once. Zach can kill him in two hits at any time,
before or after he's activated, or mid-rescue; when he's hit he flees, much slower than
Sexton does. A survivor's bottle or pellets just make him flinch.

**Marc Cortez** starts in the warehouse and wanders, through doors and out into the woods. He
has a very faint light. Talk to him and he heals you to full health; the first time, he also
hands you duck confit. Nothing hurts him: slashed by Zach he says *"Hey man, what the heck?"*
or *"Cut it out"* and just stands there; hit by a survivor he flinches.

**Plasma.TTV** looks like a regular guy wandering around. Hit him (a survivor's bottle or
shotgun, or Zach's machete) and he goes into **GAMER RAGE**: he transforms into a hulking beast
over 2 s, then chases whoever hit him and punches them until they're down (Zach is knocked out
for 6 s, then gets back up), then turns back into a human and walks off. Escape him for 10 s and
he calms down too. Bottles stun him for 0.1 s, shotgun blasts for 0.3 s and the machete for
0.1 s; galaxy gas blinds and slows him. He can't be killed. Talk to him (either side) and he
says *"ggs"* and hands you a golden pump, once each.

**Distances** are in world units (u); at normal zoom 1 u is one screen pixel. A survivor is
30 u across and Zach 38 u. A warehouse door is 72 u long and a cabin door 76 u. The map is
6000 × 6000 u, and the swipe reaches 124 u.

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
- **Sounds:** the jump scare lasts 2.5 s; its image and a snippet of the song fade in and out.
  Sexton's reel is barely audible at the edge of its range and swells very gradually to full
  volume as you get close. The game plays the two supplied files, plus spoken "Jarvis online" and
  "Hemp battery activated" announcements: a fading 2.6 s snippet of GMajor (`burst`, from a
  random point, half volume) that only Zach hears when he fires a Soundcloud Burst, and Sexton's
  reel (`sexton.reel`, a positional loop that gets louder the closer you are). Shane Jeans's
  footsteps (`shane.steps`) are synthesized in the browser (`"procedural": "pitterPatter"`);
  point the id at a file to replace them. Sounds may set
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
Battery turn the whole beam into x-ray light that passes through walls; it fades in over 0.75 s
and out in 1/6 s. While JARVIS runs, every player's whole screen counts as lit.

**Testing mode.** Press **Testing mode** on the landing page to play alone. You get every item
and ability with infinite uses (Zach's Hemp Battery toggles on and off), there's no win
condition, and **T** switches you between Zach and a
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
