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

/** Movement gait, for animation and scent trails. */
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
  Heal: 3,
  Revive: 4,
  Unstake: 5,
  OpenGate: 6,
  Loot: 7,
  HideEnter: 8,
  HideExit: 9,
  PickUp: 11,
  Stake: 12,
  Search: 13,
  DamageGen: 15,
  Attack: 17,
  Talk: 18,
} as const;
export type Action = (typeof Action)[keyof typeof Action];

export const ACTION_LABELS: Record<number, string> = {
  1: 'Repairing',
  3: 'Healing',
  4: 'Reviving',
  5: 'Unstaking',
  6: 'Opening gate',
  7: 'Picking up',
  8: 'Hiding',
  9: 'Leaving',
  11: 'Picking up',
  12: 'Staking',
  13: 'Searching',
  15: 'Damaging',
  17: 'Swinging',
  18: 'Listening to Sexton',
};

/** Context-sensitive interaction offered to a player right now (drives the HUD prompt). */
export const Prompt = {
  None: 0,
  Repair: 1,
  Heal: 5,
  Revive: 6,
  Unstake: 7,
  OpenGate: 8,
  Loot: 9,
  Hide: 10,
  LeaveHiding: 11,
  DropBarricade: 13,
  PickUp: 14,
  Stake: 15,
  Search: 16,
  DamageGen: 18,
  GatePowerless: 19,
  InventoryFull: 20,
  OpenDoor: 21,
  CloseDoor: 22,
  TalkSexton: 23,
  TakeHemp: 24,
  ConfitRevive: 25,
  ConfitUnstake: 26,
  TalkChris: 27,
} as const;
export type Prompt = (typeof Prompt)[keyof typeof Prompt];

export const PROMPT_LABELS: Record<number, string> = {
  1: 'Hold E to start the generator',
  5: 'Hold E to heal',
  6: 'Hold E to revive',
  7: 'Hold E to unstake',
  8: 'Hold E to open the gate',
  9: 'Press E to pick up',
  10: 'Press E to hide',
  11: 'Press E to leave · Space hold breath',
  13: 'Press Space to slam the barricade',
  14: 'Press E to pick up',
  15: 'Press E to stake',
  16: 'Press E to search',
  18: 'Hold E to damage generator',
  19: 'The gate has no power',
  20: 'You can only carry 2 of those',
  21: 'Press E to open the door',
  22: 'Press E to close the door',
  23: 'Press E to talk to Sexton Science',
  24: 'Press E to take the Hemp Battery',
  25: 'Press E to feed duck confit (instant revive)',
  26: 'Press E to feed duck confit (instant rescue)',
  27: 'Press E to talk to Chris Zelley',
};

/** Items that take an inventory slot. Duck confit is carried separately (HUD icon). */
export const ItemKind = {
  None: 0,
  Bottle: 1,
  Goggles: 2,
  Shotgun: 3,
  Energy: 4,
  Trap: 5,
} as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];
/** Every slot item, in default slot order. There are as many slots as item kinds. */
export const SLOT_ITEMS: readonly ItemKind[] = [ItemKind.Bottle, ItemKind.Goggles, ItemKind.Shotgun, ItemKind.Energy, ItemKind.Trap];
export const ITEM_NAMES: Record<number, string> = {
  1: 'Bottle',
  2: 'Night vision goggles',
  3: 'Shotgun',
  4: 'Energy drink',
  5: 'Galaxy gas trap',
};

/** Non-player entity kinds carried in snapshots. */
export const EntityKind = {
  Player: 0,
  Bottle: 1,
  Trap: 2,
  Gas: 3,
  Sexton: 4,
  Hemp: 5,
  Shane: 6,
  Chris: 7,
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

export const BarricadeState = {
  Up: 0,
  Down: 1,
  Broken: 2,
} as const;
export type BarricadeState = (typeof BarricadeState)[keyof typeof BarricadeState];
