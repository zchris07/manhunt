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
    healTime: 12,
    reviveTime: 8,
    unstakeTime: 1.6,
    pickupTime: 0.35,
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
      hitCooldown: 2.2,
      hitSlowMul: 0.45,
      missCooldown: 0.9,
      missSlowMul: 0.7,
      /** Two melee hits break a dropped barricade or a door. */
      barricadeHits: 2,
      doorHits: 2,
      /**
       * Hold left click to charge the swing, release to strike. A full charge (`max` s) is a
       * heavy swipe: longer reach, wider arc, and it counts as two hits (downs a healthy
       * survivor, breaks a door or barricade outright).
       */
      charge: { max: 0.9, heavyAt: 0.85, rangeMul: 1.3, arcMul: 1.25, slowMul: 0.65 },
    },
    /**
     * Lunge (right click): a League-of-Legends-style dash. Speed starts at `peak` and eases out to zero
     * over `duration` ((1 - t/T)^2 curve). Two charges; each recharges in `recharge` seconds,
     * one at a time, starting as soon as one is spent.
     */
    lunge: { charges: 2, recharge: 7, duration: 0.5, peak: 1150, hitboxMul: 1.5 },
    /**
     * Soundcloud Burst (F): an aimed wave of sound, a slightly concave purple lens of fixed
     * `width` that flies across the whole map through everything. `thickness` is its depth.
     */
    burst: { cooldown: 12, speed: 3400, width: HUNTER_WIDTH * 6, thickness: 36, scareTime: 4 },
    /** Scent trail (always on): survivors running or bleeding leave red scent. */
    scent: { radius: 1300, sendEvery: 0.5 },
    /** Hemp Battery (Q, dropped by Sexton Science). */
    hemp: { duration: 8, zoomOut: 1.2, speedMul: 1.1 },
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
    bottle: { speed: 760, maxRange: 460, stun: 1.4, hitRadius: 10 },
    /** Night vision goggles: hold left click to look through them. A 15 s meter that never refills. */
    goggles: { meter: 15, coneMul: 1.2 },
    shotgun: { shells: 3, reload: 2, range: 420, spreadDeg: 9, stun: 0.8, kbPeak: 520, kbDuration: 0.3 },
    /** Energy drink: stamina refills 1.5x faster and the meter holds 2 s more, fading over 20 s. */
    energy: { duration: 20, refillMul: 1.5, bonusSec: 2 },
    /** Galaxy gas trap: triggers within 5 Zach-widths, gas covers 10 Zach-widths. */
    trap: { triggerRadius: HUNTER_WIDTH * 5, gasRadius: HUNTER_WIDTH * 10, armTime: 1, gasTime: 7, spreadTime: 0.5, slowMul: 0.5 },
    /** After a stun ends Zach can't be stunned again for this long (no chain-stuns). */
    stunImmunity: 2.5,
    barricade: { stun: 3, slamRadius: 60, dropTime: 0.2 },
  },

  /**
   * Penetrating light (goggles, Hemp Battery): within `range` of the cone it sees through
   * everything, at `brightness`. It grows in over `fadeIn` s and fades out over `fadeOut` s.
   */
  xray: { range: 650, brightness: 0.7, fadeIn: 0.75, fadeOut: 1 / 6 },

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
    audio: { near: 60, far: 950 },
    jarvisRadarSec: 10,
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
  },

  trails: {
    scentEvery: 0.28,
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
