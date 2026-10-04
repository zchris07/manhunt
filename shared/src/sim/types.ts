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
  Plant: 19,
  Drink: 20,
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
  19: 'Planting a galaxy gas trap',
  20: 'Drinking a mini shield',
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
  TalkChris: 27,
  TalkMarc: 28,
  TalkPlasma: 29,
  SextonMore: 30,
  PickDrop: 31,
  /** Zach next to an NPC or an item: just its name (target: NPC_NAMES index, loot index, drop item). */
  NameNpc: 32,
  NameLoot: 33,
  NameDrop: 34,
  TalkWaz: 35,
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
  11: 'Press E to leave',
  13: 'Press Space to slam the barricade',
  14: 'Press E to pick up',
  15: 'Press E to stake',
  16: 'Press E to search',
  18: 'Hold E to damage generator',
  19: 'The gate has no power',
  20: 'Full',
  21: 'Press E to open the door',
  22: 'Press E to close the door',
  23: 'Press E to talk to Sexton Science',
  24: 'Press E to take the Hemp Battery',
  27: 'Press E to talk to Chris Zelley',
  28: 'Press E to talk to Marc Cortez',
  29: 'Press E to talk to Plasma.TTV',
  30: 'Press E to keep listening',
  31: 'Press E to pick up',
  35: 'Press E to talk to Waz',
};

/** NPC names, indexed by the NameNpc prompt target. */
export const NPC_NAMES = ['Sexton Science', 'Shane Jeans', 'Chris Zelley', 'Marc Cortez', 'Plasma.TTV', 'Jaden Nguyen', 'Waz'];

/**
 * Survivor items. Everything goes in one of the `INV_SLOTS` free slots: identical items
 * stack in one slot without limit, except weapons (shotgun, golden pump, pistol), which
 * take a slot each.
 */
export const ItemKind = {
  None: 0,
  Bottle: 1,
  Goggles: 2,
  Shotgun: 3,
  /** Doctor Pepper (it was an energy drink). */
  Energy: 4,
  Trap: 5,
  /** The Grapes of Wrath: thrown like a bottle. */
  Book: 6,
  Confit: 7,
  /** Jaden Nguyen's P250 (he drops it when he dies). */
  Pistol: 8,
  /** Mr Beast bar: eat it for a fifth of your health back. */
  BeastBar: 9,
  /** Mini shield: drink it (2 s) for a quarter bar of shield. */
  Shield: 10,
} as const;
export type ItemKind = (typeof ItemKind)[keyof typeof ItemKind];
export const ITEM_KIND_MAX = 10;
export const INV_SLOTS = 8;
/** Golden pump flag in a slot or drop byte (item kinds fit in the low 4 bits). */
export const GOLDEN_BIT = 16;
/** A survivor's entity `aux`: dizzy in Penjamin gas. */
export const DIZZY_BIT = 32;
export const isWeapon = (k: number): boolean => k === ItemKind.Shotgun || k === ItemKind.Pistol;
export const ITEM_NAMES: Record<number, string> = {
  1: 'Bottle',
  2: 'Night vision goggles',
  3: 'Shotgun',
  4: 'Doctor Pepper',
  5: 'Galaxy gas trap',
  6: 'The Grapes of Wrath',
  7: 'Duck confit',
  8: 'P250',
  9: 'Mr Beast bar',
  10: 'Mini shield',
};
/** A slot's display name (a golden shotgun is Plasma's golden pump). */
export const slotName = (kind: number, golden: boolean): string => (kind === ItemKind.Shotgun && golden ? 'Golden pump' : (ITEM_NAMES[kind] ?? ''));

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
  Marc: 8,
  Plasma: 9,
  /** An item a survivor dropped (G) for a teammate: extra = ItemKind (+8 = golden pump). */
  Drop: 10,
  /** Sexton's Hemp Beam: x,y origin, facing, extra = length / 8. */
  Beam: 11,
  /** Jaden Nguyen: state = ShaneFlag (+ JadenFlag.Firing), extra = alert meter 0-255. */
  Jaden: 12,
  /** Waz: state = WazFlag. */
  Waz: 13,
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

export const BarricadeState = {
  Up: 0,
  Down: 1,
  Broken: 2,
} as const;
export type BarricadeState = (typeof BarricadeState)[keyof typeof BarricadeState];
