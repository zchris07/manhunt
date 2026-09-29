/**
 * Every tunable number in MANHUNT lives in this file. Nothing gameplay-relevant is
 * hardcoded elsewhere. Units: world units (u), seconds (s), radians unless noted as Deg.
 *
 * Balance target: about a 60% hunter win rate at 1 hunter vs 4 survivors, with the
 * auto-balance formula (`resolveBalance`) keeping other lobby shapes near that target.
 */

export const DEG = Math.PI / 180;

export const BALANCE = {
  world: {
    size: 6000,
    warehouseSize: 1200,
    matchTimeLimit: 15 * 60,
    /** Survivor team wins if at least this fraction of survivors escape. */
    escapeFraction: 0.5,
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
    maxSensingRadius: 1400,
  },

  survivor: {
    radius: 15,
    walk: 120,
    run: 190,
    crouch: 70,
    crawl: 32,
    /** Speed burst after being hit (DBD-style), multiplier and duration. */
    hitHasteMul: 1.35,
    hitHasteTime: 1.8,
    vision: { coneHalfAngleDeg: 50, range: 620, proximity: 95 },
    downedVisionMul: 0.6,
    /** Hearing radius of each movement mode: how far away others can hear you. */
    noise: { idle: 0, crouch: 45, walk: 170, run: 430 },
    wiggleTime: 16,
    healTime: 12,
    reviveTime: 8,
    unstakeTime: 1.6,
    vaultTime: 0.85,
    fastVaultTime: 0.5,
    installPartTime: 1.2,
    pickupTime: 0.4,
    maxParts: 2,
    startFlashCharges: 1,
    maxFlashCharges: 3,
  },

  hunter: {
    radius: 19,
    speed: 205,
    carrySpeedMul: 0.9,
    vision: { coneHalfAngleDeg: 65, range: 470, proximity: 125 },
    noise: 360,
    terrorRadius: 700,
    attack: {
      range: 62,
      arcDeg: 100,
      windup: 0.15,
      hitCooldown: 2.4,
      hitSlowMul: 0.45,
      missCooldown: 1.1,
      missSlowMul: 0.7,
    },
    lunge: { mul: 2.0, duration: 0.6, cooldown: 12, reachBonus: 20, missPenalty: 1.5, missSlowMul: 0.55 },
    pulse: { cooldown: 30, radius: 1800, historySec: 8, jitter: 70, echoDuration: 6 },
    bloodhound: { cooldown: 35, duration: 8, trailHistorySec: 10, radius: 1200 },
    vaultSmash: { cooldown: 20, time: 0.4 },
    vaultTime: 1.5,
    breakBarricadeTime: 2.2,
    searchTime: 1.5,
    damageGenTime: 2.0,
    pickupTime: 1.0,
    stakeTime: 1.2,
    chaseRange: 520,
    chaseLoseSec: 5,
    windupSlowMul: 0.85,
    hitSlowFraction: 0.75,
    missSlowTime: 0.45,
    wiggleStun: 1.5,
    smashBreakSlowMul: 0.6,
    /** Hunters only learn generator progress within this distance. */
    genKnownRadius: 750,
    blindProximityMul: 0.5,
  },

  hiding: {
    enterTime: 0.6,
    exitTime: 0.5,
    noisyEnterRadius: 300,
    enterNoise: 380,
    breathMax: 6,
    breathRegen: 0.6,
    breathingHearRadius: 130,
    gaspNoise: 260,
    slamWindow: 0.7,
    slamStun: 1.5,
    peek: { coneHalfAngleDeg: 28, range: 420, proximity: 40 },
    grassPeek: { coneHalfAngleDeg: 180, range: 150, proximity: 150 },
    breathingIntervalSec: 1.5,
    gaspCooldown: 2,
  },

  tools: {
    flare: { radius: 190, blind: 3, burnTime: 10, lightRadius: 320, visionMul: 0.3 },
    flash: { holdTime: 2.0, range: 360, halfAngleDeg: 14, blind: 2.5, decayPerSec: 0.5 },
    barricade: { stun: 4, slamRadius: 60, breakTime: 2.2, dropTime: 0.2 },
    bottle: { maxRange: 420, flightTime: 0.7, noiseRadius: 900, decaySec: 4 },
    stunImmunity: 6,
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
    gateNoise: 900,
    extraGenerators: 2,
    stakeStageTime: 60,
    stakeNoise: 1000,
  },

  loot: {
    /** Per-generator parts spawned (before density scaling). */
    fuelPerGen: 1.6,
    wirePerGen: 1.6,
    flaresPerSurvivor: 0.75,
    bottlesPerSurvivor: 1.0,
    batteriesPerSurvivor: 0.75,
  },

  /** Hearing radius of discrete sound events (how far a noise event carries). */
  noise: {
    pulse: 900,
    sniff: 300,
    smash: 700,
    windowSmash: 650,
    swing: 220,
    scream: 850,
    grunt: 500,
    search: 250,
    vaultFast: 420,
    vaultSlow: 160,
    install: 200,
    genKick: 500,
    genDone: 2600,
    gateOpen: 3000,
    barricade: 750,
    flare: 520,
    hunterIdle: 120,
    downed: 140,
    woundedMin: 110,
  },

  /** Interaction reach (centre-to-centre distance). */
  reach: {
    teammate: 70,
    generator: 78,
    gate: 58,
    loot: 48,
    hide: 58,
    barricade: 80,
    window: 50,
    stake: 78,
    pickup: 68,
  },

  trails: {
    footprintEvery: 0.35,
    bloodEvery: 0.45,
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
    lootClamp: [0.7, 1.3] as readonly [number, number],
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
  requiredGenerators: number;
  totalGenerators: number;
  repairTime: number;
  hunterSpeed: number;
  stunMul: number;
  lootMul: number;
  escapeNeeded: number;
  timeLimit: number;
}

function clampRange(v: number, r: readonly [number, number]): number {
  return Math.min(r[1], Math.max(r[0], v));
}

/**
 * Auto-balance: pressure P = survivors / hunters, reference P0 = 4.
 * scale = sqrt(P / P0), clamped. Higher pressure (more survivors per hunter) makes each
 * survivor's job harder: longer repairs, a slightly faster hunter, shorter stuns, less loot.
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
  const hunterSpeed =
    BALANCE.hunter.speed * clampRange(1 + sc.hunterSpeedSlope * (scale - 1), sc.hunterSpeedClamp) * (1 + 0.05 * (d - 1));
  const stunMul = clampRange(1 / scale, sc.stunClamp) / d;
  const lootMul = clampRange(1 / scale, sc.lootClamp) / Math.sqrt(d);
  const fraction = shape.escapeFraction ?? BALANCE.world.escapeFraction;
  const escapeNeeded = Math.max(1, Math.ceil(S * fraction - 1e-9));

  return {
    hunters: H,
    survivors: S,
    pressure,
    scale,
    difficulty: d,
    requiredGenerators: required,
    totalGenerators: required + BALANCE.objectives.extraGenerators,
    repairTime,
    hunterSpeed,
    stunMul,
    lootMul,
    escapeNeeded,
    timeLimit: BALANCE.world.matchTimeLimit,
  };
}

export const TICK_DT = 1 / BALANCE.net.tickHz;
