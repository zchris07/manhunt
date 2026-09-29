export type Role = 'hunter' | 'survivor' | 'spectator';

export const Health = {
  Healthy: 0,
  Wounded: 1,
  Downed: 2,
  Carried: 3,
  Staked: 4,
  Escaped: 5,
  Eliminated: 6,
} as const;
export type Health = (typeof Health)[keyof typeof Health];
export const HEALTH_NAMES = ['healthy', 'wounded', 'downed', 'carried', 'staked', 'escaped', 'eliminated'] as const;

/** How a player's own movement is simulated this tick. */
export const MoveMode = {
  Normal: 0,
  Locked: 1,
  Crawl: 2,
} as const;
export type MoveMode = (typeof MoveMode)[keyof typeof MoveMode];

/** Movement gait, for footsteps, noise and animation. */
export const Gait = {
  Idle: 0,
  Walk: 1,
  Run: 2,
  Crouch: 3,
} as const;
export type Gait = (typeof Gait)[keyof typeof Gait];

/** Timed interactions. Progress for each is sent to the acting player. */
export const Action = {
  None: 0,
  Repair: 1,
  Install: 2,
  Heal: 3,
  Revive: 4,
  Unstake: 5,
  OpenGate: 6,
  Loot: 7,
  HideEnter: 8,
  HideExit: 9,
  Vault: 10,
  PickUp: 11,
  Stake: 12,
  Search: 13,
  BreakBarricade: 14,
  DamageGen: 15,
  FlashAim: 16,
  Attack: 17,
} as const;
export type Action = (typeof Action)[keyof typeof Action];

export const ACTION_LABELS: Record<number, string> = {
  1: 'Repairing',
  2: 'Installing part',
  3: 'Healing',
  4: 'Reviving',
  5: 'Unstaking',
  6: 'Opening gate',
  7: 'Searching',
  8: 'Hiding',
  9: 'Leaving',
  10: 'Vaulting',
  11: 'Picking up',
  12: 'Staking',
  13: 'Searching',
  14: 'Breaking',
  15: 'Damaging',
  16: 'Focusing flashlight',
  17: 'Swinging',
};

/** Context-sensitive interaction offered to a player right now (drives the HUD prompt). */
export const Prompt = {
  None: 0,
  Repair: 1,
  InstallFuel: 2,
  InstallWire: 3,
  NeedParts: 4,
  Heal: 5,
  Revive: 6,
  Unstake: 7,
  OpenGate: 8,
  Loot: 9,
  Hide: 10,
  LeaveHiding: 11,
  Vault: 12,
  DropBarricade: 13,
  PickUp: 14,
  Stake: 15,
  Search: 16,
  BreakBarricade: 17,
  DamageGen: 18,
  GatePowerless: 19,
  InventoryFull: 20,
} as const;
export type Prompt = (typeof Prompt)[keyof typeof Prompt];

export const PROMPT_LABELS: Record<number, string> = {
  1: 'Hold E to repair',
  2: 'Hold E to install fuel',
  3: 'Hold E to install wire',
  4: 'Needs fuel and wire',
  5: 'Hold E to heal',
  6: 'Hold E to revive',
  7: 'Hold E to unstake',
  8: 'Hold E to open the gate',
  9: 'Press E to take',
  10: 'Press E to hide',
  11: 'Press E to leave · Space hold breath',
  12: 'Space to vault',
  13: 'Press E to slam barricade',
  14: 'Press E to pick up',
  15: 'Press E to stake',
  16: 'Press E to search',
  17: 'Hold E to break',
  18: 'Hold E to damage generator',
  19: 'The gate has no power',
  20: 'Hands full',
};

export const ToolKind = {
  None: 0,
  Flare: 1,
  Bottle: 2,
} as const;
export type ToolKind = (typeof ToolKind)[keyof typeof ToolKind];

/** Non-player entity kinds carried in snapshots. */
export const EntityKind = {
  Player: 0,
  Flare: 1,
  Bottle: 2,
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

export const BarricadeState = {
  Up: 0,
  Down: 1,
  Broken: 2,
} as const;
export type BarricadeState = (typeof BarricadeState)[keyof typeof BarricadeState];
