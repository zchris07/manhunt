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
    /** Survivor team wins if at least this fraction of survivors escape. */
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
    /** Zach walks 10% slower than a survivor walks and sprints 20% faster than they do. */
    walk: SURVIVOR_WALK * 0.9,
    sprint: SURVIVOR_RUN * 1.2,
    stamina: { max: 6, refill: 6 },
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
    /** Scent trail (always on): survivors running or bleeding leave red scent. */
    scent: { radius: 1300, sendEvery: 0.5 },
    /** Hemp Battery (Q, dropped by Sexton Science). */
    hemp: { duration: 8, zoomOut: 1.2, speedMul: 1.1 },
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
    /** Each item kind stacks to this many; a stack takes one inventory slot. */
    maxStack: 2,
    /** Items spread over the whole map. */
    counts: { bottle: 20, goggles: 3, confit: 6, shotgun: 2, energy: 8, trap: 8 },
    /** Bottles fly on until they hit a wall, Zach or an NPC. */
    bottle: { speed: 760, stun: 1.4, hitRadius: 10, damage: 0.2 },
    /** Night vision goggles: hold left click to look through them. A 15 s meter that never refills. */
    goggles: { meter: 15, coneMul: 1.2 },
    /**
     * Shotgun: 8 pellets with random bloom inside the cone, each flying on until it hits
     * something solid or someone (windows shatter and let it through). Each pellet takes
     * `pelletDamage` of a survivor's health; any pellet on Zach stuns him and blasts him back.
     */
    shotgun: { shells: 3, reload: 2, range: BEAM_RANGE, spreadDeg: 9, pellets: 8, pelletDamage: 0.15, stun: 0.8, kbPeak: 520, kbDuration: 0.3 },
    /** Plasma's golden pump: a survivor's takes the shotgun slot, 5 shells and half the reload. */
    golden: { shells: 5, reload: 1 },
    /**
     * Zach's golden pump replaces his machete until its 10 shots are spent. Each pellet takes
     * `pelletDamage`; a survivor it hits is stunned briefly and pushed away from the blast.
     */
    zachPump: { shots: 10, reload: 1, pelletDamage: 0.09, stun: 0.1, kbPeak: 380, kbDuration: 0.2 },
    /**
     * Energy drink: fills the (extended) sprint meter at once; for 20 s it refills 1.5x faster,
     * holds 2 s more, and walking and running are up to 15% faster, all fading over the 20 s.
     */
    energy: { duration: 20, refillMul: 1.5, bonusSec: 2, speedMul: 0.15 },
    /** Galaxy gas trap: triggers within 5 Zach-widths, gas covers 10 Zach-widths. */
    trap: { plantTime: 2, triggerRadius: HUNTER_WIDTH * 5, gasRadius: HUNTER_WIDTH * 10, armTime: 1, gasTime: 7, spreadTime: 0.5, slowMul: 0.5 },
    /** After a stun ends Zach can't be stunned again for this long (no chain-stuns). */
    stunImmunity: 2.5,
    barricade: { stun: 3, slamRadius: 60, dropTime: 0.2 },
  },

  /**
   * Penetrating light (goggles, Hemp Battery): the whole cone sees through everything, at `brightness`. It grows in over `fadeIn` s and fades out over `fadeOut` s.
   */
  xray: { range: BEAM_RANGE, brightness: 0.7, fadeIn: 0.75, fadeOut: 1 / 6 },

  sexton: {
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
   * Shane Jeans: an unkillable wanderer. A survivor who comes within `alertRadius`, or keeps
   * a flashlight on him for `flashAlertSec` in total (the meter drains at `alertDecay` per
   * second when he's out of the beam), alerts him. He then chases that survivor at Sexton's
   * flee speed (Zach sees an arrow toward him) until `chaseTime` passes, Zach comes within
   * `hunterBreakRadius` of him, the survivor gets farther than `loseRadius`, or he is hit by
   * `bottlesToShake` bottles or one shotgun blast (then he runs off for `fleeTime`). After a
   * chase he can't be alerted for `cooldown` seconds. He can't open doors.
   */
  shane: {
    radius: 15,
    walk: 65,
    chase: 200,
    alertRadius: 80,
    flashAlertSec: 2,
    alertDecay: 0.3,
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
   * off until they've lost `stopAfter` of their health (or he loses them), then wanders off.
   * Bottles, shotgun blasts and gas shake him off the same way. Nothing kills him.
   */
  jaden: {
    radius: 15,
    walk: 62,
    chase: 175,
    alertRadius: 80,
    flashAlertSec: 2,
    alertDecay: 0.3,
    chaseTime: 20,
    hunterBreakRadius: 260,
    loseRadius: 1100,
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
      /** He stops once his target has lost this much health to him. */
      stopAfter: 0.5,
    },
  },

  /**
   * Marc Cortez wanders the warehouse (and beyond: he opens doors). Talk to him and he heals you
   * to full; the first time he also hands you duck confit. Nothing kills him: slashed he
   * protests, hit by a survivor he flinches. A very faint light.
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
   * they're down (Zach is knocked out for `zachKnockTime` s), then turns back. Losing him for
   * `escapeTime` s also calms him. Stuns: bottle, shotgun, machete; gas blinds and slows him.
   * He never dies. Talk to him for a golden pump (once each).
   */
  plasma: {
    radius: 15,
    beastRadius: 24,
    walk: 64,
    chase: 212,
    transformTime: 2,
    punchRange: 34,
    punchCooldown: 0.85,
    punchDamage: 0.25,
    zachPunchDamage: 0.2,
    zachKnockTime: 6,
    escapeTime: 10,
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
    downedAfter: 15,
    stakedAfter: 12,
    ascendTime: 3,
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

  /** Interaction reach (centre-to-centre distance). */
  reach: {
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
    difficultyRange: [0.5, 1.5] as readonly [number, number],
  },
} as const;

export interface LobbyShape {
  hunters: number;
  survivors: number;
  /** Lobby owner's difficulty scaler: >1 is harder for survivors. */
  difficulty: number;
  escapeFraction?: number;
}

/** Match-specific numbers derived from the lobby shape by the auto-balance formula. */
export interface ResolvedBalance {
  hunters: number;
  survivors: number;
  pressure: number;
  scale: number;
  difficulty: number;
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
  const d = clampRange(shape.difficulty, sc.difficultyRange);
  const pressure = S / H;
  const scale = Math.min(sc.maxScale, Math.max(sc.minScale, Math.sqrt(pressure / sc.p0)));

  const required = clampRange(Math.ceil(S / Math.sqrt(H)) + 1, sc.requiredGenClamp);
  const repairTime = BALANCE.objectives.repairTime * clampRange(scale, sc.repairTimeClamp) * d;
  const hunterSpeedMul = clampRange(1 + sc.hunterSpeedSlope * (scale - 1), sc.hunterSpeedClamp) * (1 + 0.05 * (d - 1));
  const stunMul = clampRange(1 / scale, sc.stunClamp) / d;
  const fraction = shape.escapeFraction ?? BALANCE.world.escapeFraction;
  const escapeNeeded = Math.max(1, Math.ceil(S * fraction - 1e-9));

  return {
    hunters: H,
    survivors: S,
    pressure,
    scale,
    difficulty: d,
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
 * Soundcloud Burst lens curvature at lateral offset `s` from its centre line: the wave is a
 * slightly concave lens, thinnest in the middle, so each face bows out toward the edges by
 * this much (the edges lead, the middle trails).
 */
export function burstSag(s: number): number {
  const half = BALANCE.hunter.burst.width / 2;
  return 0.12 * half * (Math.min(Math.abs(s), half) / half) ** 2;
}
