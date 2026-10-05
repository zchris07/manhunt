/**
 * Every tunable number in MANHUNT lives in this file. Nothing gameplay-relevant is
 * hardcoded elsewhere. Units: world units (u), seconds (s), radians unless noted as Deg.
 *
 * Balance target: about a 60% hunter win rate at 1 hunter vs 4 survivors, with the
 * auto-balance formula (`resolveBalance`) keeping other lobby shapes near that target.
 */

export const DEG = Math.PI / 180;

const SURVIVOR_RADIUS = 15;
const HUNTER_RADIUS = 19;
/** Zach's body width (diameter). Several ranges are defined as multiples of it. */
const HUNTER_WIDTH = HUNTER_RADIUS * 2;
/** Base speeds were raised 20% across the board. */
const SPEED_UP = 1.2;
const SURVIVOR_WALK = 120 * SPEED_UP;
const SURVIVOR_RUN = 190 * SPEED_UP;
/** Flashlight beams run on until they hit something; this is only a practical cap. */
const BEAM_RANGE = 2600;

export const BALANCE = {
  world: {
    size: 6000,
    warehouseSize: 1200,
    matchTimeLimit: 15 * 60,
    /**
     * The match runs until every survivor has escaped, is incapacitated (downed, carried or
     * staked) or is eliminated. The survivors win if at least this fraction escaped.
     */
    escapeFraction: 0.5,
    /** Fraction of the woods' tree positions that are kept (25% fewer trees). */
    treeKeep: 0.75,
  },

  net: {
    tickHz: 30,
    /** Snapshots go out on 2 of every 3 ticks (20 Hz). */
    snapshotEvery: [true, true, false] as readonly boolean[],
    interpolationDelayMs: 100,
    maxRewindMs: 120,
    hunterHitTolerance: 8,
    /** Host input handicap: fraction of the average measured guest RTT. */
    hostHandicapRttFraction: 0.5,
    hostHandicapMaxMs: 120,
    maxInputQueue: 6,
    reconnectGraceSec: 30,
    pingIntervalMs: 1000,
    maxPlayers: 10,
    maxReliableBytes: 2048,
    maxUnreliableBytes: 512,
    reliableRatePerSec: 20,
    reliableBurst: 40,
    unreliableRatePerSec: 120,
    unreliableBurst: 200,
    snapshotHistory: 32,
    /** Everything farther than this from a viewer is never sent to them. */
    maxSensingRadius: BEAM_RANGE + 100,
  },

  survivor: {
    radius: SURVIVOR_RADIUS,
    walk: SURVIVOR_WALK,
    run: SURVIVOR_RUN,
    crouch: 70 * SPEED_UP,
    crawl: 32 * SPEED_UP,
    /** Sprint meter: seconds of sprinting when full, seconds to refill from empty. */
    stamina: { max: 8, refill: 10 },
    /** Speed burst after being hit (DBD-style), multiplier and duration. */
    hitHasteMul: 1.3,
    hitHasteTime: 1.8,
    vision: { coneHalfAngleDeg: 50, range: BEAM_RANGE, proximity: 95 },
    downedVisionMul: 0.6,
    /**
     * Teammates on your screen carry a faint light (and are seen by it): `radius` of ground glow
     * at `intensity`, and a small `body` disc that shows the teammate itself. Downed and staked
     * survivors also see where every teammate's flashlight points (`coneAlpha`).
     */
    allyLight: { radius: 150, intensity: 0.3, body: 40, bodyIntensity: 0.55, coneAlpha: 0.11 },
    /** How far away others notice you moving (bots and hiding only; there is no audio for it). */
    noise: { idle: 0, crouch: 45, walk: 170, run: 430 },
    wiggleTime: 16,
    /** Health left after being revived, cut down or dropped by Zach. */
    reviveHp: 1 / 3,
    healTime: 12,
    reviveTime: 8,
    unstakeTime: 1.6,
    /** Vaulting through a smashed window. */
    windowClimbMul: 0.4,
  },

  hunter: {
    radius: HUNTER_RADIUS,
    /**
   * Zach walks 10% slower than a survivor walks and sprints 20% faster than they do, both then
   * cut by 5%. A 6 s sprint meter that takes 10 s to refill.
   */
    walk: SURVIVOR_WALK * 0.9 * 0.95,
    sprint: SURVIVOR_RUN * 1.2 * 0.95,
    stamina: { max: 6, refill: 10 },
    carrySpeedMul: 0.9,
    vision: { coneHalfAngleDeg: 65, range: BEAM_RANGE, proximity: 125 },
    attack: {
      /** The swipe covers twice the old 62 u reach, in a 100 degree arc in front of him. */
      range: 124,
      arcDeg: 100,
      windup: 0.15,
      /** Length of the visible swing animation. */
      swingTime: 0.32,
      /** Any landed hit (swipe or lunge, on anyone) locks the machete this long; a whiff only `missCooldown`. */
      hitCooldown: 0.8,
      hitSlowMul: 0.45,
      missCooldown: 0.2,
      missSlowMul: 0.7,
      /** Two melee hits break a dropped barricade or a door. */
      barricadeHits: 2,
      doorHits: 2,
      /**
       * Hold left click to charge the swing, release to strike. A full charge (`max` s) is a
       * heavy swipe: longer reach, wider arc, and it counts as two hits (downs a healthy
       * survivor, breaks a door or barricade outright). Holding past `autoRelease` s strikes.
       */
      charge: { max: 0.9, heavyAt: 0.85, rangeMul: 1.3, arcMul: 1.25, slowMul: 0.65, autoRelease: 3 },
      /** Health a swipe takes: `base` uncharged, `full` fully charged, proportional in between. */
      damage: { base: 1 / 3, full: 2 / 3, tapGrace: 0.1 },
    },
    /**
     * Lunge (right click): a League-of-Legends-style dash. Speed starts at `peak` and eases out to zero
     * over `duration` ((1 - t/T)^2 curve). Two charges; each recharges in `recharge` seconds,
     * one at a time, starting as soon as one is spent.
     */
    lunge: { charges: 2, recharge: 7, duration: 0.5, peak: 1150, hitboxMul: 1.5, damage: 1 / 3 },
    /**
     * Soundcloud Burst (F): an aimed wave of sound, a slightly concave purple lens of fixed
     * `width` that flies across the whole map through everything. `thickness` is its depth.
     */
    burst: {
      cooldown: 12,
      speed: 1700,
      width: HUNTER_WIDTH * 6,
      thickness: 36,
      /** The jump scare: image and sound fade in and out over `scareFade` s, `scareTime` s in all. */
      scareTime: 2.5,
      scareFade: 0.6,
      scareVolume: 0.7,
      /** How loud the release snippet is for Zach. */
      zachVolume: 0.25,
    },
    /**
     * Zach's health: `max` hp. At 0 he's down for `downTime` s, then up again at
     * `recoverFraction`. While up he regenerates the whole bar in `regenTime` s. Every
     * `speedStep` of the bar lost takes `speedPerStep` off his walk and sprint, and every time
     * he's put down (not counting Plasma) takes `downPenalty` more, permanently, up to
     * `downPenaltyMax`.
     */
    health: { max: 100, downTime: 10, recoverFraction: 0.5, regenTime: 360, speedStep: 0.25, speedPerStep: 0.1, downPenalty: 0.05, downPenaltyMax: 0.2 },
    /** Every survivor he puts on a stake buffs his move speed and field of view this much, for good. */
    stakeBuff: 0.05,
    /** Each survivor staked also speeds his health regeneration by this much. */
    stakeRegen: 0.05,
    /** Scent trail (always on): survivors walking, running or bleeding leave scent. */
    scent: { radius: 1300, sendEvery: 0.5 },
    /**
     * Penjamin (Space): a narrow cone of yellow vape gas. It reaches `reachMul` times the distance
     * from Zach to the corner of his screen (so it never visibly stops on screen), grows out to
     * that over `growTime` s, hangs for `lingerTime` s and thins out over `fadeTime` s. Through
     * walls, like the Soundcloud Burst. A survivor with at least `coverage` of their body in it
     * is slowed (`slow`, down to `slowFar` at the far end), loses `dps` of their health a second
     * (down to `dpsFar`), both for as long as they're in it and `afterTime` s more, and their
     * flashlight cone narrows by `coneCut` with the darkness outside it going pitch black, while
     * in it and `darkAfter` s more.
     */
    vape: {
      cooldown: 20,
      halfAngleDeg: 10,
      reachMul: 1.1,
      /** Used if the client hasn't told the host how big its screen is. */
      defaultView: 760,
      minView: 400,
      maxView: 2200,
      growTime: 0.6,
      lingerTime: 4,
      fadeTime: 1,
      coverage: 0.5,
      slow: 0.2,
      slowFar: 0.01,
      dps: 0.05,
      dpsFar: 0.01,
      afterTime: 2,
      coneCut: 0.6,
      darkAfter: 6,
      /** How fast the narrowing and darkening ease in and out (client), seconds. */
      darkEase: 0.6,
    },
    /** Hemp Battery (hold Q, dropped by Sexton Science): `duration` s of use in all; the zoom is `zoomRate` times as fast as 1 s. */
    hemp: { sprintDrainMul: 0.8, sprintRefillMul: 1.2, duration: 16, zoomOut: 1.2, speedMul: 1.1, zoomRate: 1.5, grace: 0.3 },
    /** Speed multiplier while climbing through a smashed window (one swipe smashes it). */
    windowClimbMul: 0.35,
    breakBarricadeTime: 2.2,
    damageGenTime: 2.0,
    pickupTime: 1.0,
    stakeTime: 1.2,
    windupSlowMul: 0.85,
    hitSlowFraction: 0.75,
    missSlowTime: 0.45,
    wiggleStun: 1.5,
    /** Hunters only learn generator progress within this distance. */
    genKnownRadius: 750,
  },

  /** Sprinting (everyone): after the meter empties you must wait this long to sprint again. */
  sprintLockout: 1.5,
  /** Speed while wading through the lake. */
  wadeMul: 0.45,

  hiding: {
    enterTime: 0.6,
    exitTime: 0.5,
    breathMax: 6,
    breathRegen: 0.6,
    breathingHearRadius: 130,
    peek: { coneHalfAngleDeg: 28, range: 420, proximity: 40 },
    grassPeek: { coneHalfAngleDeg: 180, range: 150, proximity: 150 },
    breathingIntervalSec: 1.5,
    gaspCooldown: 2,
  },

  items: {
    /** Items spread over the whole map. */
    counts: { bottle: 20, goggles: 3, confit: 6, shotgun: 2, energy: 8, trap: 8, book: 4, beastbar: 15, shield: 20 },
    /** Set out in a row beside Chris Zelley's ambulance (on top of `counts`). */
    ambulanceKit: ['shield', 'shield', 'beastbar', 'beastbar', 'confit'] as readonly ('shield' | 'beastbar' | 'confit')[],
    /** Mr Beast bar: eating it gives back this fraction of your health. */
    beastBar: { heal: 0.2 },
    /**
     * Mini shield: drinking takes `drinkTime` s (moving cancels it) and adds `amount` of a full
     * health bar to a blue shield bar, up to `max`. Damage takes the shield first.
     */
    shield: { drinkTime: 2, amount: 0.25, max: 1 },
    /** The picture a Grapes of Wrath hit or slaying Waz flashes up: fades in and out within this. */
    flashTime: 0.8,
    /** Share of `flashTime` each of the fade in and the fade out takes. */
    flashFade: 0.3,
    /** Bottles fly on until they hit a wall, Zach or an NPC. `zachDamage` is in Zach's hp. */
    bottle: { speed: 760, stun: 1.4, hitRadius: 10, damage: 0.2, zachDamage: 5 },
    /**
     * The Grapes of Wrath: thrown like a bottle. On Zach it stuns him for `stun` s and flashes a
     * picture over his screen (for `flashTime`, whatever the stun).
     */
    book: { speed: 700, stun: 3, hitRadius: 12, damage: 0.2, zachDamage: 5, images: 4 },
    /** Night vision goggles: hold left click to look through them. A 15 s meter that never refills. */
    goggles: { meter: 15, coneMul: 1.2 },
    /**
     * Shotgun: 8 pellets with random bloom inside the cone, each flying on until it hits
     * something solid or someone (windows shatter and let it through). Each pellet takes
     * `pelletDamage` of a survivor's health; any pellet on Zach stuns him and blasts him back.
     */
    shotgun: { shells: 3, reload: 2, range: BEAM_RANGE, spreadDeg: 9, pellets: 8, pelletDamage: 0.15, stun: 2.1, kbPeak: 520, kbDuration: 0.3, zachBlastDamage: 25 },
    /** Jaden's P250, once he's dead: one bullet a click, `zachDamage` hp on Zach. */
    pistol: { shots: 10, reload: 0.35, range: BEAM_RANGE, spreadDeg: 1.5, damage: 0.1, zachDamage: 10 },
    /** Plasma's golden pump: a survivor's takes the shotgun slot, 5 shells and half the reload. */
    golden: { shells: 5, reload: 1 },
    /**
     * Zach's golden pump replaces his machete until its 10 shots are spent. Each pellet takes
     * `pelletDamage`; a survivor it hits is stunned briefly and pushed away from the blast.
     */
    zachPump: { shots: 10, reload: 1, pelletDamage: 0.09, stun: 0.1, kbPeak: 380, kbDuration: 0.2 },
    /**
     * Doctor Pepper: fills the (extended) sprint meter at once; for 20 s it refills 1.5x faster,
     * holds 2 s more, and walking and running are up to 15% faster, all fading over the 20 s.
     */
    energy: { duration: 20, refillMul: 1.5, bonusSec: 2, speedMul: 0.15 },
    /** Galaxy gas trap: triggers within 5 Zach-widths, gas covers 10 Zach-widths. */
    trap: { plantTime: 2, triggerRadius: HUNTER_WIDTH * 5, gasRadius: HUNTER_WIDTH * 10, armTime: 1, gasTime: 7, spreadTime: 0.5, slowMul: 0.5, zachDps: 2 },
    /** After a stun ends Zach can't be stunned again for this long (no chain-stuns). */
    stunImmunity: 2.5,
    barricade: { stun: 3, slamRadius: 60, dropTime: 0.2 },
  },

  /**
   * Penetrating light (goggles, Hemp Battery): the whole cone sees through everything, at `brightness`. It grows in over `fadeIn` s and fades out over `fadeOut` s.
   */
  xray: { range: BEAM_RANGE, brightness: 0.7, fadeIn: 0.75, fadeOut: 1 / 6 },

  sexton: {
    /** Faint light of his own (client only). */
    light: { radius: 110, intensity: 0.28 },
    radius: 15,
    walk: 70,
    flee: 200,
    fleeTime: 6,
    hp: 3,
    talkTime: 1.6,
    handTime: 0.45,
    reach: 72,
    /** Reel audio: full volume within `near`, silent past `far`. */
    audio: { near: 60, far: 950, curve: 3 },
    jarvisRadarSec: 10,
    /** Second line, after the survivor presses E again ("NAME" is their name). */
    secondLine: "This is powerful tech, NAME. Be careful with it type shi",
    secondTalkTime: 2.4,
    /** After the handoff he walks away, mysteriously, for this long. */
    leaveTime: 7,
    /** JARVIS permanently widens its user's minimap view by this factor. */
    jarvisMinimapMul: 1.2,
    /**
     * Self-defense when a survivor hits him with a bottle or shotgun (he can't die to their
     * items): against every survivor he walks away, turning back to fire a Hemp Beam
     * (`beamTime` s, then `cooldown` s), `attacks` times, then just flees. `resetAfter` s with
     * no survivor within `vicinity` and he's back to normal. Items stun him while defending.
     */
    defense: {
      beamTime: 3,
      cooldown: 3,
      attacks: 3,
      approachTime: 0.9,
      beamRange: 950,
      beamWidth: 10,
      beamDamage: 1 / 3,
      turnRate: 1.3,
      walk: 85,
      vicinity: 750,
      resetAfter: 10,
      bottleStun: 0.1,
      shotStun: 0.3,
      gasSlowMul: 0.5,
      light: { radius: 170, intensity: 0.85 },
    },
  },

  /**
   * Shane Jeans: an unkillable wanderer. Each survivor builds an alert meter on him, which
   * every survivor can see over his head: standing within `alertRadius` fills it in
   * `proxAlertSec` (faster the closer they are), a flashlight on him in `flashAlertSec`; it
   * drains at `alertDecay` a second otherwise. Full, he's alerted. He then chases that survivor at Sexton's
   * flee speed (Zach sees an arrow toward him) until `chaseTime` passes, Zach comes within
   * `hunterBreakRadius` of him, the survivor gets farther than `loseRadius`, or he is hit by
   * `bottlesToShake` bottles or one shotgun blast (then he runs off for `fleeTime`). After a
   * chase he can't be alerted for `cooldown` seconds. He can't open doors.
   */
  shane: {
    radius: 15,
    walk: 65,
    chase: 200,
    alertRadius: 130,
    proxAlertSec: 2,
    flashAlertSec: 3.5,
    alertDecay: 0.2,
    chaseTime: 20,
    hunterBreakRadius: 260,
    loseRadius: 1100,
    bottlesToShake: 2,
    fleeTime: 4,
    cooldown: 10,
    /** His faint light (client only). */
    light: { radius: 150, intensity: 0.4 },
    /** Soft pitter-patter footsteps while he's alerted (client only): full within `near`, silent past `far`. */
    steps: { volume: 0.55, near: 70, far: 750 },
  },

  /**
   * Jaden Nguyen: wanders and gets alerted just like Shane Jeans (crowd him or keep a light on
   * him), but he carries a pistol: he keeps his distance and shoots the survivor who set him
   * off until they get farther than `loseRadius` or have lost `stopAfter` of the health they
   * had when he started, whichever comes first. Any survivor item or attack stuns him for
   * `stun` s; `hp` of them kill him, and he drops his pistol.
   */
  jaden: {
    radius: 15,
    walk: 62,
    chase: 175,
    alertRadius: 130,
    proxAlertSec: 2,
    flashAlertSec: 3.5,
    alertDecay: 0.2,
    chaseTime: 20,
    hunterBreakRadius: 260,
    loseRadius: 600,
    stun: 1.2,
    hp: 3,
    /** Zach's machete: each hit shoves him back `kb` px and stuns him `meleeStun` s; `zachHp` points kill him (light 1, heavy 2). */
    zachHp: 6,
    kb: 46,
    meleeStun: 0.2,
    bottlesToShake: 2,
    fleeTime: 4,
    cooldown: 12,
    light: { radius: 150, intensity: 0.4 },
    steps: { volume: 0.55, near: 70, far: 750 },
    pistol: {
      /** He opens fire inside this range (with a clear line), and closes in to `keep`. */
      range: 420,
      keep: 220,
      cooldown: 0.9,
      damage: 0.125,
      spreadDeg: 5,
      /** He stops once his target has lost this fraction of the health they had when he started. */
      stopAfter: 0.5,
    },
  },

  /**
   * Marc Cortez wanders the warehouse (and beyond: he opens doors). Talk to him and he hands
   * you duck confit (once each). Nothing kills him: slashed he protests, hit by a survivor he
   * flinches. A very faint light.
   */
  marc: {
    radius: 15,
    walk: 62,
    reach: 72,
    talkCooldown: 3,
    light: { radius: 110, intensity: 0.28 },
  },

  /**
   * Plasma.TTV: an ordinary guy. Hit him (survivor item or Zach's machete) and GAMER RAGE:
   * he transforms over `transformTime` s, then chases his attacker and punches them until
   * they're down (Zach goes down like any other time, but it costs him no speed), then turns
   * back. Losing him for `escapeTime` s also calms him, and he always turns back `rageTime` s
   * after transforming if he hasn't put anyone down. Stuns: bottle, shotgun, machete; gas blinds and slows him.
   * He never dies. Talk to him for a golden pump (once each).
   */
  plasma: {
    /** Faint light of his own (client only). */
    light: { radius: 110, intensity: 0.28 },
    radius: 15,
    beastRadius: 24,
    walk: 64,
    chase: 212,
    transformTime: 2,
    punchRange: 34,
    punchCooldown: 0.85,
    punchDamage: 0.25,
    zachPunchDamage: 20,
    escapeTime: 10,
    rageTime: 10,
    /**
     * In beast form only, he can be slain: `survivorHits` survivor item hits, or `zachHits` of
     * Zach's (a light swing or lunge 1, a heavy swing 2). The two counts are separate and stay
     * when he turns back. Slain, he drops a golden pump.
     */
    survivorHits: 6,
    zachHits: 6,
    loseRadius: 900,
    bottleStun: 0.1,
    shotStun: 0.3,
    slashStun: 0.1,
    gasSlowMul: 0.45,
    reach: 72,
  },

  /**
   * Chris Zelley, the paramedic. He paces around his ambulance until a survivor talks to him;
   * then he wanders the map. Once a survivor has been downed for `downedAfter` s or staked for
   * `stakedAfter` s he runs to them at Zach's sprint speed, revives or unstakes them in the
   * same time a survivor would, then flies to the heavens (`ascendTime`), gone for good.
   * Zach kills him in `hp` hits; hit, he flees at `flee` (well below Sexton's) for `fleeTime`.
   */
  /**
   * Waz wanders. A survivor who talks to him hears "lemme take a looksie" and sees `fovBonus`
   * more of the map for good (once each). Zach slays him in `hp` hits (he runs off like Sexton
   * in between) and gains the same; a survivor slays him in one hit and sees `fovPenalty` less.
   * Whoever slays him gets a picture flashed across their screen (`items.flashTime`).
   */
  waz: {
    radius: 15,
    walk: 60,
    flee: 200,
    fleeTime: 6,
    hp: 3,
    reach: 72,
    fovBonus: 0.1,
    fovPenalty: 0.1,
    line: 'lemme take a looksie',
  },

  /** Every NPC carries a faint light (client only). Shane, Jaden and Marc have their own, below. */
  npcLight: { radius: 120, intensity: 0.3 },

  chris: {
    radius: 15,
    hp: 2,
    walk: 60,
    wander: 70,
    run: SURVIVOR_RUN * 1.2,
    flee: 125,
    fleeTime: 5,
    reach: 72,
    /** How far from the ambulance's sides he paces before he's activated. */
    pace: 42,
    downedAfter: 4,
    stakedAfter: 4,
    ascendTime: 3,
    /** Faint light of his own (client only). */
    light: { radius: 110, intensity: 0.28 },
    ambulance: { length: 300, width: 150, lightRadius: 230, lightIntensity: 0.35 },
  },

  objectives: {
    /** Seconds for one survivor to repair a generator from 0 to 100%. */
    repairTime: 70,
    /** Speed multiplier for 1, 2, 3, 4+ survivors on the same generator. */
    coopMul: [1, 1.7, 2.3, 2.8] as readonly number[],
    repairNoise: 520,
    regressPerSec: 0.25 / 60,
    damageRegressInstant: 0.08,
    skillCheck: {
      chancePerSec: 0.1,
      warnMs: 650,
      needleTime: 1.1,
      zoneStart: [0.4, 0.82] as readonly [number, number],
      zoneSize: 0.14,
      greatSize: 0.04,
      greatBonus: 0.02,
      failPenalty: 0.1,
      failNoise: 1100,
      responseGraceMs: 1500,
      /** Answers faster than this fraction of the needle sweep (minus latency slack) are rejected. */
      minAnswerFraction: 0.3,
      latencySlackMs: 250,
    },
    gateOpenTime: 20,
    stakeStageTime: 60,
  },

  /** Notes: creepy photos lying in the world, `count` of them at least `spacing` apart. */
  notes: { count: 4, spacing: 900 },

  /** Interaction reach (centre-to-centre distance). */
  reach: {
    note: 64,
    teammate: 70,
    generator: 78,
    gate: 58,
    loot: 48,
    hide: 58,
    barricade: 80,
    door: 62,
    stake: 78,
    pickup: 68,
    /** Zach sees an NPC's name this close. */
    npcName: 110,
  },

  trails: {
    scentEvery: 0.12,
    /** Walking leaves scent too, but it fades out this many seconds sooner than a runner's. */
    walkHeadStart: 4,
    bloodEvery: 0.4,
    maxAgeSec: 10,
  },

  lights: {
    maxPolygonsPerFrame: 6,
    campfireRadius: 360,
    generatorRadius: 260,
    lampRadius: 300,
    flickerSpeed: 7,
    losRange: 1400,
  },

  scaling: {
    /** Reference pressure: survivors per hunter. */
    p0: 4,
    minScale: 0.5,
    maxScale: 2,
    repairTimeClamp: [0.75, 1.35] as readonly [number, number],
    hunterSpeedSlope: 0.06,
    hunterSpeedClamp: [0.95, 1.08] as readonly [number, number],
    stunClamp: [0.75, 1.3] as readonly [number, number],
    requiredGenClamp: [3, 7] as readonly [number, number],
  },
} as const;

export interface LobbyShape {
  hunters: number;
  survivors: number;
}

/** Match-specific numbers derived from the lobby shape by the auto-balance formula. */
export interface ResolvedBalance {
  hunters: number;
  survivors: number;
  pressure: number;
  scale: number;
  /** Every generator on the map must be started; this is how many there are. */
  requiredGenerators: number;
  totalGenerators: number;
  repairTime: number;
  /** Multiplier on Zach's walk and sprint speed. */
  hunterSpeedMul: number;
  /** Zach's walk speed after scaling (for display). */
  hunterSpeed: number;
  stunMul: number;
  escapeNeeded: number;
  timeLimit: number;
}

function clampRange(v: number, r: readonly [number, number]): number {
  return Math.min(r[1], Math.max(r[0], v));
}

/**
 * Auto-balance: pressure P = survivors / hunters, reference P0 = 4.
 * scale = sqrt(P / P0), clamped. Higher pressure (more survivors per hunter) makes each
 * survivor's job harder: longer repairs, a slightly faster hunter, shorter stuns.
 */
export function resolveBalance(shape: LobbyShape): ResolvedBalance {
  const S = Math.max(1, Math.floor(shape.survivors));
  const H = Math.max(1, Math.floor(shape.hunters));
  const sc = BALANCE.scaling;
  const pressure = S / H;
  const scale = Math.min(sc.maxScale, Math.max(sc.minScale, Math.sqrt(pressure / sc.p0)));

  const required = clampRange(Math.ceil(S / Math.sqrt(H)) + 1, sc.requiredGenClamp);
  const repairTime = BALANCE.objectives.repairTime * clampRange(scale, sc.repairTimeClamp);
  const hunterSpeedMul = clampRange(1 + sc.hunterSpeedSlope * (scale - 1), sc.hunterSpeedClamp);
  const stunMul = clampRange(1 / scale, sc.stunClamp);
  const escapeNeeded = Math.max(1, Math.ceil(S * BALANCE.world.escapeFraction - 1e-9));

  return {
    hunters: H,
    survivors: S,
    pressure,
    scale,
    requiredGenerators: required,
    totalGenerators: required,
    repairTime,
    hunterSpeedMul,
    hunterSpeed: BALANCE.hunter.walk * hunterSpeedMul,
    stunMul,
    escapeNeeded,
    timeLimit: BALANCE.world.matchTimeLimit,
  };
}

export const TICK_DT = 1 / BALANCE.net.tickHz;

/**
 * Zach's speed multiplier from his health: 10% slower for every 25% of the bar gone, and 5%
 * slower for good per time he's been put down (at most 20%).
 */
/** Zach's permanent speed bonus from the survivors he has staked. */
export function hunterStakeMul(stakes: number): number {
  return 1 + stakes * BALANCE.hunter.stakeBuff;
}

export function hunterHealthMul(hp: number, downs: number): number {
  const Hh = BALANCE.hunter.health;
  const steps = Math.floor((1 - Math.max(0, Math.min(1, hp))) / Hh.speedStep + 1e-6);
  return Math.max(0.1, 1 - steps * Hh.speedPerStep - Math.min(Hh.downPenaltyMax, downs * Hh.downPenalty));
}

/**
 * Soundcloud Burst lens curvature at lateral offset `s` from its centre line: the wave is a
 * slightly concave lens, thinnest in the middle, so each face bows out toward the edges by
 * this much (the edges lead, the middle trails).
 */
export function burstSag(s: number): number {
  const half = BALANCE.hunter.burst.width / 2;
  return 0.12 * half * (Math.min(Math.abs(s), half) / half) ** 2;
}
