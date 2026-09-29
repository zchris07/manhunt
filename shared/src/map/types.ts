export type Surface = 'forest' | 'dirt' | 'grass' | 'concrete' | 'wood' | 'water';
export const SURFACES: readonly Surface[] = ['forest', 'dirt', 'grass', 'concrete', 'wood', 'water'];

export type WallKind = 'boundary' | 'warehouse' | 'cabin' | 'shack' | 'fence' | 'shore' | 'rack' | 'wreck' | 'window' | 'dock' | 'yard' | 'log';

export interface WallSeg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  kind: WallKind;
  vision: boolean;
  move: boolean;
}

export type TreeKind = 'pine' | 'dead';

export interface TreeDef {
  x: number;
  y: number;
  r: number;
  kind: TreeKind;
  variant: number;
}

export interface RockDef {
  x: number;
  y: number;
  r: number;
  variant: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LogDef {
  x: number;
  y: number;
  angle: number;
  length: number;
}

export type HidingKind = 'locker' | 'wardrobe' | 'bed' | 'grass' | 'barrel';

export interface HidingSpotDef {
  id: number;
  x: number;
  y: number;
  kind: HidingKind;
  /** Direction the occupant looks out of (slit/peek direction). */
  facing: number;
  /** Where the occupant stands when entering or leaving. */
  exitX: number;
  exitY: number;
}

export type LootKind = 'fuel' | 'wire' | 'flare' | 'bottle' | 'battery';
export const LOOT_KINDS: readonly LootKind[] = ['fuel', 'wire', 'flare', 'bottle', 'battery'];

export interface LootSpawnDef {
  id: number;
  x: number;
  y: number;
  item: LootKind;
}

export interface GeneratorDef {
  id: number;
  x: number;
  y: number;
  angle: number;
  area: 'woods' | 'warehouse';
}

export interface StakeDef {
  id: number;
  x: number;
  y: number;
}

/** A barricade (pallet-like) that survivors can slam down to block a gap. */
export interface BarricadeDef {
  id: number;
  x: number;
  y: number;
  /** Direction along the blocking segment. */
  angle: number;
  length: number;
  /** Index into MapData.dynamicSegments. */
  dyn: number;
}

/** A vaultable window: blocks movement, not vision. */
export interface WindowDef {
  id: number;
  x: number;
  y: number;
  angle: number;
  length: number;
}

export interface GateDef {
  x: number;
  y: number;
  angle: number;
  length: number;
  dyn: number;
  leverX: number;
  leverY: number;
}

export type LightKind = 'campfire' | 'lamp' | 'lantern';

export interface LightDef {
  x: number;
  y: number;
  radius: number;
  kind: LightKind;
}

export interface PathDef {
  points: number[];
  width: number;
}

export interface MapParams {
  seed: number;
  generators: number;
  loot: Record<LootKind, number>;
  stakes: number;
}

export interface MapData {
  params: MapParams;
  width: number;
  height: number;
  walls: WallSeg[];
  dynamicSegments: { ax: number; ay: number; bx: number; by: number; active: boolean }[];
  trees: TreeDef[];
  rocks: RockDef[];
  logs: LogDef[];
  bushes: { x: number; y: number; r: number; variant: number }[];
  paths: PathDef[];
  clearings: { x: number; y: number; r: number }[];
  grassPatches: { x: number; y: number; r: number }[];
  lake: number[];
  dock: number[];
  warehouse: Rect;
  cabins: Rect[];
  racks: Rect[];
  wrecks: Rect[];
  exitZone: Rect;
  generators: GeneratorDef[];
  hidingSpots: HidingSpotDef[];
  loot: LootSpawnDef[];
  stakes: StakeDef[];
  barricades: BarricadeDef[];
  windows: WindowDef[];
  gate: GateDef;
  lights: LightDef[];
  survivorSpawns: { x: number; y: number }[];
  hunterSpawns: { x: number; y: number }[];
  /** Coarse surface lookup grid (cell = surfaceCell units), values index SURFACES. */
  surfaceCell: number;
  surface: Uint8Array;
}
