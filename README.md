# MANHUNT

A browser-based, top-down 2D, asymmetric multiplayer horror game for up to 10 friends.

Zach Branch plays the masked killer on the upcoming TV series *Crystal Lake*. Tonight he stopped
acting. Survivors start every generator in the woods and an abandoned studio warehouse, power
the exit gate and escape before he finds them. They can hurt and stun him with bottles, books,
shotguns and a pistol, slow him with gas traps and put him down for a while, but they can never
kill him.

- **Feel:** Darkwood. A dark, desaturated, realistic top-down world where every sprite casts a
  soft shadow, so the flat art reads like a 3D scene seen from above. Your flashlight beam runs
  on until it hits something. Outside your light the world is a faint grey fog: you can make
  out the layout, but people, items and objectives in it are invisible, even right next to you.
  Buildings have windows you can see (and shine your light) through. A minimap fills in only
  what you've actually seen (**M** opens the full map). The UI is a grimy, clinical,
  Outlast Trials-inspired one.
- **Structure:** Dead by Daylight-style asymmetric play. Loops, doors, barricades, hooks
  (scarecrow stakes) and generators you just hold to repair. Survivors carry items; Zach has a lunge, the Soundcloud
  Burst and an always-on scent. Sexton Science wanders the map with a gift for each survivor,
  Shane Jeans tails anyone who bothers him, Jaden Nguyen shoots them, Chris Zelley waits by
  his ambulance to save a life, Waz takes a looksie, and Chacko watches Madden on the lounge couch.
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
   - The auto-balance preview shows what the next match will look like. There's no difficulty
     or escape setting: the night lasts until every survivor has escaped, is incapacitated
     (downed, carried or staked) or has been eliminated. The survivors win if at least half of
     them escaped; otherwise Zach wins. The 15-minute clock still ends the night for Zach.
5. Press **Start the night**. After the match everyone sees the results. Press **Back to lobby**
   to rematch.

**Important for the host:** your browser *is* the server. The game simulation runs in a Web
Worker in your tab and everyone connects to you directly.

- Keep the tab open and in the foreground. The game warns you if it was backgrounded, and asks
  the browser to keep the screen awake.
- If you close the tab, the match ends for everyone.
- You are slightly handicapped on purpose: your own inputs are delayed by about half your
  guests' average ping (capped at 120 ms), so you don't get a 0 ms advantage. Override it with
  `?handicap=0` or `?handicap=80` on your URL.
- A guest who disconnects can rejoin within 30 s and gets their character back. Losing the
  connection shows **Connection lost** with a **Rejoin** button (the host may still be playing:
  only the data connection counts, not hiccups on the signaling broker). Rejoining is a full
  reset of your connection: fresh input numbering on both ends and a fresh snapshot, so you can
  move freely straight away. Players who join mid-match spectate until the next one.

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
| E | Start generators, pick up, heal, revive, unstake, hide, open and close doors, talk to Sexton, Chris Zelley, Marc, Plasma or Waz |
| Left mouse | Use the selected item (hold it for night vision goggles) |
| G | Drop one of the selected item on the ground for a teammate (JARVIS can't be dropped or taken in hand) |
| Mouse wheel / 1–8 / click a slot | Select an inventory slot |
| Tab | Rearrange your inventory slots (drag and drop) |
| Q | JARVIS, once you have Sexton's tablet: for 10 s every survivor's whole screen is visible (never Zach's); your own map is fully revealed and shows Zach |
| Space | Slam a barricade down · hold breath while hidden |
| M | Full map (only the parts you've explored) |

**Inventory.** Eight free slots (you start with nothing). Identical items stack in one slot
with no limit, except weapons (shotgun, golden pump, pistol): you can carry several of the same
weapon, but each takes its own slot. You can't carry more than 8 different things: picking up a
ninth drops whatever is in the 8th slot (the whole stack) and puts the new item there. Pickups
are instant.

| Item | |
|---|---|
| Bottle (20 on the map) | Throw it toward the cursor. It flies on until it hits something: a wall, a tree, a closed door or window, Zach, another survivor, or an NPC. On Zach it takes 5 hp and stuns him; on a survivor it takes a fifth of their health. |
| The Grapes of Wrath (4) | A book, thrown like a bottle. On Zach it takes 5 hp, stuns him for 2.5 s (his stun immunity still applies) and switches off all of his abilities for 6 s, booms (the vine boom) and flashes one of four pictures over his screen for 0.8 s, fading in and out. The map stays visible around the picture. |
| Night vision goggles (3) | Hold left click to look through them. A 15 s meter that never refills; your whole beam passes through walls and the cone is 20% wider. |
| Shotgun (4) | 6 shells, 2 s reload. 8 pellets with random bloom in the same cone; each flies until it hits something solid or someone, shattering windows and flying on through. Any pellet on Zach stuns him for 2.1 s (1.5× a bottle) and blasts him back; a full blast (all 8 pellets) takes 25 hp, 3.125 hp a pellet. Each pellet on a survivor takes 15% of their health (enough can down them outright). |
| 0.50 cal (2, survivors only) | A sniper rifle: 3 shots. The bullet flies at twice the speed of a shotgun pellet through every material, with no range limit. It downs a survivor outright, takes 25% of Zach's health, shoves him back hard and switches off his sprint for 3 s, slays Jaden Nguyen, Waz and a raging Plasma.TTV, smashes windows, doors and barricades in its path and takes 30% off a generator's progress. While you hold it a faint red laser runs out from the muzzle that everyone, Zach included, can see. |
| Golden pump (from Plasma.TTV) | A gold tactical shotgun: 5 shells, 1 s reload. A weapon of its own, in its own slot. |
| P250 (from Jaden Nguyen's body) | 10 shots, one a click (0.35 s apart). 10 hp a shot on Zach, 10% of a survivor's health. |
| Doctor Pepper (8) | A red can. Fills your sprint meter at once. For 20 s it refills 1.5× faster, holds 2 s more, and you walk and run up to 15% faster, all fading over the 20 s. |
| Galaxy gas trap (8) | A Galaxy Gas canister. Planting takes 2 s (moving cancels it). It's hard for Zach to spot (the gas cloud is 35% smaller than it first was). When Zach, an alerted Shane Jeans or a raging Plasma.TTV comes near it bursts into gas that slows Zach a lot and burns 2 hp a second while he's in it, makes Shane give up his chase, stuns Jaden, slows Sexton, and blinds and slows Plasma. |
| Duck confit (6, plus 1 by the ambulance) | Eat it to heal to full health. It no longer revives anyone. |
| Mr Beast bar (15, plus 2 by the ambulance) | A chocolate bar. Eat it for a fifth of your health back. |
| Mini shield (20, plus 2 by the ambulance) | A small blue shield potion. Drinking takes 2 s (moving cancels it) and adds a quarter of a health bar to a blue shield bar shown above your green health bar, up to a full extra bar (four). Any damage takes the shield first. Zach can't drink them. |

Beside Chris Zelley's ambulance, 2 mini shields, 2 Mr Beast bars and a duck confit are set out in
a neat row.

| Zach Branch | |
|---|---|
| WASD / mouse | Move / look (walk about 15% slower than survivors, sprint about 14% faster: 10% slower and 20% faster, then both cut by 5%) |
| Shift | Sprint (6 s meter, refills in 10 s) |
| Left mouse | Machete swipe. Hold to charge, release to strike (after 3 s it strikes by itself). A swipe takes a third of a survivor's health; a full charge takes two thirds (in between, proportionally) and is a heavy swipe that reaches 30% farther and sweeps wider. Two swipes smash a closed door (it stays open) or a dropped barricade; one smashes a window, which anyone can then climb through (slowly), survivors included. There is no cooldown between swings. |
| Right mouse | Lunge: an instant dash that slows quickly. 2 charges, 7 s each. Touching a survivor hits them. Swipe mid-lunge, or lunge mid-charge, for a combo: the lunge and the swipe can both land. |
| F | Soundcloud Burst (12 s): aim a purple wave of sound (a slightly concave lens of fixed width) that flies across the whole map through every wall at 1700 u/s. Every survivor it passes is jump-scared for 2.5 s (the image and a snippet of the song fade in and out), and an aggressive NPC it passes (an alerted Jaden Nguyen, a raging Plasma.TTV, a defending Sexton Science) is stunned for 2.5 s. Only you hear it go out: a very quiet snippet of GMajor from a random point in the song. |
| Q | **Hemp Battery** (in your kit): toggle it on and off; while on, a wider view, light through walls and +10% speed. 10 s of use; it takes 40 s to refill from empty, and drained dry it can't be used for 5 s. Its announcement plays and shows only the very first time you ever use it |
| R | **Hemp Beam** (drops when you slay Sexton Science): charges for 1 s (an orb gathers at your hand, and a repulsor hum starts that everyone hears, fading with distance from you and lasting while the beam does), then channels Sexton's own beam (3 s) along your aim: a survivor it touches takes 3% of their full health ten times a second, and each NPC in its way takes a light swipe's hit every half second. 3 single-use charges (spend all three and it leaves your ability bar), 2 s between, no melee while it charges or fires but every other ability still works |
| Space | **Penjamin** (2 charges like the lunge, 25 s for each to come back): a narrow (10°) cone of translucent yellow vape gas toward the cursor. It rolls out in 0.6 s to 1.1× the distance from you to the corner of your screen (it never visibly stops on screen), widens naturally with distance, passes through walls, hangs for 4 s and fades over 1 s. A survivor with at least half their body in it hears a muffled loop (the first 4 seconds of a sound clip, fading in and out as they enter and leave the gas), and is slowed (60% close to the source, down to 30% at the far end; the strongest it got holds while they're in it, and for 3 s after, and walking toward the source raises it) and loses health (5% of the bar a second close up, down to 1%), for as long as they're in it and 2 s more, with a dizzy marker over their head. Their flashlight beam narrows by 60% and everything outside their light goes pitch black, easing in and out, while they're in it and for 6 s after. NPCs who react to being attacked react to the gas, and the ones that can be hurt are slowed by it (the same 60%-to-30% falloff) and take a light machete hit every 1.5 s they stand in it: Sexton, Chris Zelley and Waz run, Marc protests, Plasma.TTV rages at you and Jaden Nguyen turns his gun on you. |
| E | Pick up, stake, search a hiding spot (instant), damage a generator, open and close doors, talk to Plasma.TTV |
| Golden pump | From Plasma.TTV: it replaces your machete (left click fires it) for 10 shots. Each pellet takes 9% of a survivor's health, stuns them for 0.1 s and shoves them away from the blast. |
| M | Full map. Zach knows the whole map and every stake. |

Zach always has a scent trail left by anyone walking or running (crouching leaves none): thin wisps of red smoke curling along their path and thinning out as it ages. A walker's scent is fainter and fades 4 s sooner than a runner's. Bleeding survivors leave red puffs too. He only sees it where his own light falls. It's sent reliably: a Zach who joins or rejoins gets every recent point again.

**Zach's health.** Zach has a 100 hp bar (on the HUD and over his head). Bottles and books take
5 hp, a full shotgun blast 25, a pistol shot 10, galaxy gas 2 a second and a Plasma punch 20.
Hits that stunned him still do. While he's up he regenerates the whole bar in 6 minutes. At 0 he's
down for 10 s (he drops anyone he was carrying), then gets back up at half health. Every 25% of
the bar gone makes him 10% slower, walking and sprinting, and every time he's put down he gets
5% slower for good, up to 20% (being knocked out by Plasma doesn't count). Every survivor he
puts on a stake makes him 5% faster, his view 5% wider and his health regeneration 5% faster, for good.
While the Hemp Battery is in use his sprint drains 20% slower and refills 20% faster. A sprint meter keeps refilling during a sprint lockout (exhaustion, or a 0.50 cal hit). Slaying Jaden Nguyen gives him one more lunge charge and 20% more melee reach for good.

Next to an NPC or an item, Zach sees its name where survivors see their prompt.

**Health.** Everyone has a health bar over their head. Survivors are down at zero; each machete
swipe takes a third (a full charge two thirds), a lunge a third, a bottle a fifth, a shotgun
pellet 15%, a Hemp Beam a third and a Plasma punch a quarter. Anyone hit flinches. Lost health
stays lost until a teammate heals you (or you eat duck confit); a revive, unstake or struggle-free
leaves you on a third. The sprint meter is the wide bar above your inventory. Items are picked
up instantly. The lake can be waded into: everyone moves at under half speed in the water.

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
**Shane Jeans** (one, unkillable) wanders from a random spot with a faint light. Each survivor
builds an **alert meter** on him that everyone can see filling over his head: standing within
130 u fills it in about 2 to 4 s (faster the closer you are), keeping a flashlight on him fills
it in 3.5 s, and it slowly drains otherwise. Full, he's alerted: everyone is told, and he tails that survivor
as closely as he can at 200 u/s (Sexton's panic speed) while Zach gets an arrow pointing
toward him. Zach never alerts him. He gives up after 20 s, when Zach comes within 260 u of
him, or when the survivor gets 1100 u away; 2 bottles or 1 shotgun blast shake him off (he
runs away for 4 s). He can't open doors or break barricades, and after a chase he can't be
alerted again for 10 s. While he's alerted you can hear his soft, quick footsteps pitter-patter
after you.

**Jaden Nguyen** (one) can be slain by Zach: 3 fully charged swipes or 6 light ones (a lunge counts as light). Each hit makes him flinch, shoves him back and stuns him for 0.2 s. Nothing drops when Zach is the one who slays him, and Zach can't pick up a P250. He wanders and is alerted exactly like Shane Jeans (the same visible
meter), but he has a pistol. Alerted, he says *"Back up!"*, closes to about 220 u and fires every
0.9 s (each hit takes 12.5% of a survivor's health and 8% of Zach's full bar; a stray shot hits whoever is in the way). He stops
when you get more than 600 u away, or once you've lost half the health you had when he started,
whichever comes first. Any survivor item (bottle, book, shotgun, pistol) or galaxy gas stuns him
for 1.2 s, a chance to get away. Three survivor hits kill him: he drops his pistol (10 shots).
Whoever provokes him, survivor or Zach (an item, the machete or a lunge, Zach's golden pump, or
Penjamin), becomes his target: he goes after Zach too, 8 hp a shot. He trips gas traps while
alerted.

**Chris Zelley** (one) is a paramedic who paces around his **ambulance**, a 300 × 150 u
structure parked at a random spot in the woods with medical gear around it and a faint glow of
its own. Until a survivor talks to him (E) he never leaves it. Talk to
him and he says *"I'll be there when you need me."* and starts wandering the map. The first
time a survivor has been downed or staked for 4 s, he runs to them from wherever
he is at Zach's sprint speed, opening doors on the way, and revives them (8 s) or cuts them
down (1.6 s), just as long as a survivor would take. He can't rescue anyone Zach is carrying. Then he sprouts wings and flies to the
heavens, never to be seen again: he helps once. Zach can kill him in two hits at any time,
before or after he's activated, or mid-rescue; when he's hit he flees, much slower than
Sexton does. A survivor's bottle or pellets just make him flinch.

**Marc Cortez** starts in the warehouse and wanders, through doors and out into the woods. He
has a very faint light. Talk to him and he hands you duck confit (once each); he no longer
heals you himself. Nothing hurts him: slashed by Zach he says *"Hey man, what the heck?"*
or *"Cut it out"* and just stands there; hit by a survivor he flinches.

**Plasma.TTV** looks like a regular guy wandering around. Hit him (a survivor's bottle or
shotgun, or Zach's machete) and he goes into **GAMER RAGE**: he transforms into a hulking beast
over 2 s, then chases whoever hit him and punches them until they're down (each punch takes
20 hp off Zach; at 0 Zach is down for 10 s, without the lasting slowdown), then turns back into a
human and walks off. Escape him for 10 s and he calms down too, and 10 s after transforming he
always turns back on his own if he hasn't put anyone down. Bottles stun him for 0.1 s, shotgun blasts for 0.3 s and the machete for
0.1 s; galaxy gas blinds and slows him. Penjamin sets him off too, without hurting him. He can
only be hurt once he's fully a beast, and he keeps two separate health bars (shown over him):
6 survivor item hits slay him, or 6 of Zach's (a light swing, a lunge or a golden-pump blast is
1, a heavy swing 2). The damage stays when he turns back human. Slain, he drops a golden pump.
Talk to him (either side) and he says *"ggs"* and hands you a golden pump, once each.

**Chacko** (one, always in the lounge: a room in the warehouse with a TV on its north wall and a
couch facing it) sits watching Madden. Talk to him as a survivor and he gives you a Doctor Pepper
(once each). Talk to him as Zach and he hands over **50 Nic** (once), which replaces Penjamin: the
same ability and charges with 50% more reach (the same falloff, worked out over the longer range)
and a blue vapor instead of yellow. One hit of any item from a survivor kills him, and then Jaden
Nguyen and Plasma.TTV both hunt that survivor, wherever they are, until they are downed once; the
hunt ends early if either of the two is slain, and if anyone else attacks either of them they turn
on that player instead and go back to behaving normally. One hit from Zach (machete, lunge or beam)
kills him too, but he explodes in a bloody blast that takes half of Zach's health.
**Waz** (one) wanders the map with a faint light. Talk to him as a survivor and he says
*"lemme take a looksie"*: you see 10% more of the map for good (the camera pulls back and your
flashlight cone and the circle around you grow), once each. Zach slays him in three hits (he
bolts between them, like Sexton) and gets the same 10% boost. A survivor slays him with any
single item, and sees 10% less for it. Whoever slays him gets a picture flashed across their
screen for 0.8 s (with the vine boom), fading in and out, exactly like the Grapes of Wrath flash.

**Zach can't swing the machete while he's down.** **Teammates and notes.** Survivors on each other's screens emit a faint light, so teammates can
see one another through the dark (walls still block it). Downed and staked survivors also see
every nearby teammate and the cone of their flashlight. Four **notes** (creepy old photos on
yellowed paper) lie beside the paths; press **E** at one, as Zach or a survivor, to read it full
screen, then click to put it down. They can't be picked up and are still there for everyone else.

**Name tags.** Every NPC has one name tag under them, readable by everyone.

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
texture slot points at a procedural generator (canvas drawing). Most sounds are files; a few are
synthesized in the browser until a file is supplied. To use a real file, replace the slot:

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
  point the id at a file to replace them. The vine boom (`boom`, `audio/vine-boom.mp3`) plays when The Grapes of Wrath hits Zach (everyone nearby hears it) and for whoever slays Waz. Sounds may set
  `offset` and `duration` in seconds. Loops should loop seamlessly.
- The jump-scare image is `images.ui.scare` (`client/public/assets/images/scare.webp`). The four
  book pictures are `images.ui.book.0` to `ui.book.3`, and the Waz picture is `images.ui.wazSlain`.
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
The required generator count is `clamp(ceil(S / sqrt(H)) + 1, 3, 7)`.

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
and out in 1/6 s. While JARVIS runs, every survivor's whole screen counts as lit.

**Testing mode.** Press **Testing mode** on the landing page. It opens a room and drops you
straight into a match; its code is in the top-left panel, and anyone who joins with it lands
in the match as a survivor with the same permissions as the host (settings, start, back to
lobby). If no room can be opened it runs offline. You get every item and ability with infinite
uses (Zach's Hemp Battery toggles on and off), there's no win condition, and **T** switches you
between Zach and a survivor. Every NPC is shown on the map. Open the full map (**M**) and click
anywhere to teleport there. Survivors see their own scent trail. The **Test effects** buttons
(left side) play any stun or flash on yourself (Zach has no ability cooldowns in testing mode): the Soundcloud Burst scare, the Grapes of Wrath
flash (and its 3 s stun as Zach), the Waz flash, a stun, a shotgun blast, galaxy gas, and being
knocked down, and Penjamin gas (as Zach, a cloud from where you stand; as a survivor, its
effects at full strength). The testing kit holds 8 kinds of item (there are 10; pick the rest up on the map).
A lobby owner can also tick
**Testing mode** in the lobby settings.

Dev URL flags: `?lag=100` simulates 100 ms of latency on your connection, `?handicap=N`
overrides the host handicap, and `?dev=1` (host only) enables test commands used by the e2e
suite (`tp`, `tpTo`, `give [item, count]`, `confit`, `jarvis`, `hemp`, `sexton`, `shane`, `jaden`, `gens`, `gate`,
`time`, `heal`…; see `host/src/dev/devCommands.ts`). Never use `?dev=1` for real games.

## Moving to a dedicated server later

v1 is player-hosted by design (free, nothing to run). Moving `GameHost` to a Node + `ws` server
means writing two transports and a small room registry; no game code changes. See
[`docs/NODE_SERVER_MIGRATION.md`](docs/NODE_SERVER_MIGRATION.md).
