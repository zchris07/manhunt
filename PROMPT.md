You are building **MANHUNT**, a browser-based, top-down 2D, real-time multiplayer asymmetric horror game.

**Fiction.** Zach Branch is the actor who plays the masked killer in the upcoming TV series *Crystal Lake*. Deep into a method-acting spiral, he is hunting the show's crew through the woods and an abandoned studio warehouse. Survivors have to repair the set's generators, power the exit gate, and escape before he finds them. Survivors can stun and disrupt Zach, but they can never kill him.

**Feel.** Darkwood (Acid Wizard Studio, 2017): oppressive darkness, limited flashlight-cone vision, grimy hand-painted look, dread from what you can't see. Structure from Dead by Daylight: objective-driven survivors vs a hunter, loops, hiding, terror radius. Hiding from Outlast: lockers and slat-peeking. Play like a .io game: no accounts, name, code, play.

## 1. Stack and structure
- TypeScript everywhere. npm-workspaces monorepo: `shared/` (pure deterministic simulation and protocol), `host/` (the `GameHost` runtime plus the `Transport` interface and WebRTC implementation; runs in a Web Worker in the host's browser), `client/` (Vite + PixiJS v8, WebGL2). A `server/` package (Node + `ws`) is a future refactor: leave a stub README only.
- `shared/` holds movement, collision, map generation, visibility geometry, balance config, and message schemas, so the client can run prediction with the same code the host runs. No DOM, no Node APIs, and no transport code in `shared/` or in `GameHost`.
- All tunable numbers live in `shared/src/balance.ts`. Nothing is hardcoded elsewhere.
- Tests: Vitest for `shared/`; Playwright (Chromium is preinstalled; do not download browsers) for a multi-client end-to-end smoke test.

## 2. Networking (decided; don't re-litigate)
- **v1 is player-hosted.** The lobby owner's browser runs a host-authoritative `GameHost` in a Web Worker. Guests connect in a star topology over WebRTC data channels: unreliable/unordered for inputs and snapshots, reliable/ordered for events (lobby, chat, state changes). The host also plays as a normal client through a local loopback transport.
- All game code talks to a `Transport` interface (`connect`, `send`, `onMessage`, `onPeerJoin/Leave`). Implement `WebRtcHostTransport` and `WebRtcGuestTransport` now. Keep the protocol and `GameHost` free of any WebRTC types, so a Node WebSocket server can be added later by writing two more transports and running `GameHost` in Node. Add a test that runs `GameHost` under Node with an in-memory transport to prove it stays environment-agnostic.
- Signaling via a free hosted PeerJS-style broker. The room code is the peer ID. ICE config: public STUN plus an optional TURN slot in config.
- Clients send inputs only. The host simulates everything and never trusts guest positions.
- Host tick 30 Hz; snapshots to guests at 20 Hz, delta-compressed, binary-encoded (compact custom format or msgpack).
- Client: 60 fps render, prediction plus reconciliation for the local player, about 100 ms snapshot interpolation for remote entities.
- **Host handicap:** the host's inputs go through the same input queue as guests, delayed by a configurable amount (default about half the average measured guest RTT). Measure RTT with pings.
- Hunter attacks are validated by the host sim with limited lag compensation: rewind at most 120 ms and give the hunter a small tolerance. Never rewind survivors' stuns against him.
- **Interest management (anti-cheat against guests):** the host sim sends each peer only entities within a max sensing radius. It also excludes hidden survivors and the hunter, unless they are inside that peer's actual visibility polygon or hearing radius. Guests cannot learn hidden positions from the network. The host itself is trusted.
- Lobbies:
  - No accounts. The landing page asks for a username (2–16 chars, sanitized, remembered in localStorage).
  - **Create Lobby** returns a 4-letter room code plus a shareable link (`/?room=ABCD`). **Join** takes a code or a link.
  - The lobby creator is the **lobby owner**. They set: hunters (≥1), survivors (≥1), total ≤10, map seed or random, and a difficulty scaler. Players can toggle a role preference, and the owner can assign or shuffle roles. The server enforces at least 1 hunter and 1 survivor.
  - The lobby owner is also the network host. If the host leaves, the match ends and all guests see a "host left" screen (no host migration in v1). A guest who disconnects can rejoin within 30 s using a session token. A late joiner becomes a spectator.
  - After the match: results screen, then back to the lobby (rematch).
  - Rate-limit messages, cap payload size, and validate every message against the schema.
- Deploy the client as a static site (GitHub Pages, Netlify, or Cloudflare Pages) over HTTPS. Add the GitHub Actions workflow. Document `npm run dev` for local play too. Add a host-side warning to keep the tab in the foreground.
- Write `docs/NODE_SERVER_MIGRATION.md` (no code): the steps to add a `server/` package, `WsServerTransport`/`WsClientTransport`, Dockerfile/Fly.io deploy, and lobby-code handling.

## 3. Vision and lighting system (the core feel; build and validate this first)
Adapt this browser-based spec for the Darkwood vision system:

1. **Visibility polygon.** Each frame, for each vision source (the player's flashlight cone plus a small 360° proximity circle, and light sources like campfires and lit generators), compute a 2D visibility polygon by raycasting to the endpoints of nearby occluder segments (angular sweep, each endpoint cast at ±ε). Walls are segments. Trees and props are circles approximated by 8–10-gon segments. Use a spatial hash so only nearby segments are tested. Cap at about 6 light polygons per frame. The result must cut off at, and wrap around, corners in real time.
2. **Mask.** Draw all polygons into an offscreen half-resolution `RenderTexture` (white = visible, black = hidden). Apply a blur pass for a soft edge and add a distance falloff.
3. **Post-process shader (GLSL ES 3.0 fragment shader, a PixiJS `Filter` on the world layer).** Sample the scene and the mask. `out = mix(desaturate(scene) * dim, scene, mask)`, plus vignette, film grain, and a slow flicker. Inside the cone: full color. Outside: grayscale and darkened.
4. **Entity occlusion.** Render dynamic entities (survivors, hunters, loot, interactables, hiding spots' occupants) on a separate layer that is multiplied by the mask with a hard threshold. They are **fully invisible** outside the visibility mask, even when physically close. Static terrain stays visible in grayscale. Do the same in the host sim: see interest management in section 2.
5. Tune vision per role. Survivor: about 100° flashlight cone, long range, small proximity circle. Zach: wider cone, shorter range, plus his senses (section 5). A hiding survivor peeking through a locker slit gets a thin horizontal slit cone (Outlast style).
6. Deliver as a standalone `/sandbox` page: a controllable player, walls, trees, a loot item and an "enemy" that vanishes outside the cone, plus an FPS counter. Acceptance: 60 fps on a mid laptop with 6 lights in a dense forest.

## 4. Map
- Server-generated from a seed, so every client builds the identical map. About 6000×6000 world units.
- **Woods:** Poisson-disc tree placement with winding paths and clearings. Include a few cabins and props such as logs, fences, and boulders. Add tall-grass patches (hiding spots), a lake edge and dock, and distant ambient fog.
- **Central warehouse:** about 1200×1200, maze-like, generated with BSP rooms plus a recursive-backtracker corridor pass. Include multiple loops, doors, windows to vault, dead ends, and lockers. The exit gate sits on the far side of the warehouse and needs power to open.
- Generators (machines) are spread across woods and warehouse. Loot spawns in the woods and warehouse (parts, fuel, wire, flares, bottles). Layout must guarantee reachable objectives, at least 2 loops per machine area, and no unwinnable seeds. Add a Vitest that checks reachability across 200 seeds.

## 5. Roles and abilities
**Survivors (crew).** Walk, run (loud), and crouch (quiet, slow). Health states are Healthy → Wounded → Downed. A downed survivor can be revived by a teammate (about 8 s), or carried by Zach to a scarecrow stake. Stakes have 2 stages, and a survivor can be unstaked by a teammate. Stage 2 is elimination.

Survivors get **disruption tools** (found as loot, limited use). They can stun Zach and never kill him, and stun immunity follows each stun, to prevent chain-stunning:
- *Flare*: blinds him and shrinks his vision for about 3 s.
- *Flashlight flash*: a held-beam stun that takes about 2 s of sustained aim.
- *Barricade* (drop or slam a door or gate): a delay of about 4 s.
- *Bottle throw*: creates a noise decoy that lures him.
- *Locker slam* while he is searching: a short stun.

**Zach Branch (hunter).** Base speed slightly above survivor running speed, so chases are decided by loops and vaults rather than raw speed. Abilities (server-validated cooldowns):
- **Lunge**: short speed burst, with a recovery penalty on a miss.
- **Stalker's Pulse**: a radial noise-map ping shows recent survivor activity (repairing, running, breaking hides) as fading echoes, not exact positions.
- **Bloodhound**: survivors' footprints and blood trails are visible to him for about 8 s.
- **Vault Smash**: breaks through windows and barricades faster than survivors can vault.
- **Terror radius**: survivors hear a heartbeat and see the lighting darken as he closes in.

Give every hunter in a multi-hunter lobby the same kit.

## 6. Hiding (Outlast / DBD)
- Hiding spots: lockers, beds and wardrobes in cabins, tall grass, and barrels in the warehouse. Entering takes about 0.6 s and is noisy if Zach is within about 300 units.
- While hidden the player is invisible to others and shows no marker in snapshots to anyone who can't see the hiding spot.
- Zach can **search** a hiding spot: an interaction of about 1.5 s. If it is occupied, the survivor is exposed and takes a wounded hit.
- Peeking through slats gives the slit vision cone. Leaving is interruptible. Holding your breath (a resource that recharges) reduces sound radius.

## 7. Objectives and win conditions
**Phase A: Repair.** Survivors scavenge parts (fuel, wire) from the woods and warehouse and repair generators, each of which takes about 60–75 s solo. Repair is loud (radius around the generator) and produces skill-check-style minigames that spike noise if failed. Zach can damage generators to regress progress.

**Phase B: Escape.** When the required number of generators are repaired, the warehouse exit gate powers up. Survivors open it (about 20 s, loud) and escape. Zach can guard it.

**Match end:**
- The survivor team wins if at least 50% of survivors escape (configurable).
- Hunters win if enough survivors are eliminated that this can no longer happen, or if time runs out.
- Show per-player stats and a team result.

## 8. Balance target (about 60% hunter win rate at 1 hunter vs 4 survivors)
- The game is harder for survivors than for the hunter by design. Machines are tuned so an optimally coordinated team wins about 40% of the time.
- Auto-balance for any lobby: `pressure P = survivors / hunters`, reference `P0 = 4`. Scale required generators, repair speed, hunter speed, stun duration, and loot density from `P/P0` using `sqrt` scaling with clamps. Put the formula and defaults in `balance.ts`.
- Suggested starting values (tune in playtests): survivor walk 120 u/s, run 190, crouch 70; Zach 205; Lunge ×2 for 0.6 s (cooldown 12 s); required generators `clamp(ceil(S / sqrt(H)) + 1, 3, 7)`; stun 1.5–4 s with 6 s immunity.
- Telemetry: the host logs each match outcome, duration, generator count and eliminations as JSON, kept in the host's localStorage with a "download match log" button, so friends can share logs for tuning. Optional dev-only headless bot harness for regression balance tests. It is not a gameplay feature.

## 9. Art and audio (procedural now, swappable slots later)
- Drawing: an `assets/manifest.json` maps asset ids to either a file or a procedural generator. `getTexture(id)` and `getSound(id)` return the file if the manifest overrides it, otherwise the procedural fallback. Adding real sprites or audio later means editing the manifest only.
- Art: canvas-generated textures with noise-based dirt, top-down sprites drawn with code (characters, trees, cabins, lockers), and a desaturated murky palette. The lighting shader carries most of the look.
- Audio: fully procedural via WebAudio. Wind, crickets, and forest ambience; footsteps that vary by surface (dirt, grass, warehouse concrete); positional audio with `PannerNode` and low-pass muffling through walls; heartbeat scaling with terror radius; stingers on chase start; generator hum. Every sound has a manifest slot.

## 10. UX
- Landing page: username, Create Lobby, Join. Lobby screen: player list, role toggles, owner settings, ready-check.
- HUD is minimal: health state, held item, objective progress, and a subtle noise indicator. Include a pause-free settings panel for volume and mouse/keyboard hints.
- Spectate after elimination. Post-match screen with stats and a rematch button.

## 11. Milestones (each ends with a working, testable build; do not skip ahead)
| # | Milestone | Acceptance |
|---|---|---|
| 0 | Monorepo scaffold, lint, CI | `npm run dev` serves a blank canvas; tests run |
| 1 | `/sandbox` vision system (section 3) | 60 fps, corners occlude, entities cull, grayscale outside cone |
| 2 | Map generation and collision | Reachability test passes on 200 seeds; visible in sandbox |
| 3 | `Transport` interface, `GameHost` in a Web Worker, WebRTC host/guest transports, lobby, prediction/interpolation | 2+ browsers on different machines move in a shared room by code; simulated 100 ms latency plays smoothly; `GameHost` also passes the Node in-memory-transport test |
| 4 | Roles, health states, stakes, objectives, win conditions | A full match can be played to a result |
| 5 | Hiding, disruption tools, Zach abilities | Each has a test and works over the network |
| 6 | Horror layer: audio, terror radius, flicker, effects | Playtest feels tense |
| 7 | Balance scaling and telemetry | Formula in place; logs match outcomes |
| 8 | Static-site deploy, docs | A friend can join by link from another machine |
| 9 | Migration doc only (`docs/NODE_SERVER_MIGRATION.md`); Node server is not built | Doc lists the exact steps and the files that change |

## 12. Definition of done
- 10 players can join by link and finish a match with hunters and survivors set by the lobby owner.
- Vision, occlusion, and interest management verified: a modified guest client cannot see hidden players.
- Swapping the transport requires no changes to `shared/` or `GameHost`.
- Balance config is centralized and telemetry works.
- README covers dev, deploy, hosting a game, and how to add real art and audio through the manifest.

## Working rules
- Work milestone by milestone. Commit after each with a clear message. Ask before adding anything outside this scope.
- Prefer simple, readable code. Keep `shared/` deterministic and side-effect free.
- Do not open a PR unless asked.

