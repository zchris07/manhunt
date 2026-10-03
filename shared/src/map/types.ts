export type Surface = 'forest' | 'dirt' | 'grass' | 'concrete' | 'wood' | 'water';
export const SURFACES: readonly Surface[] = ['forest', 'dirt', 'grass', 'concrete', 'wood', 'water'];

export type WallKind = 'boundary' | 'warehouse' | 'cabin' | 'shack' | 'fence' | 'shore' | 'rack' | 'wreck' | 'dock' | 'yard' | 'log' | 'window' | 'ambulance';

export interface WallSeg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  kind: WallKind;
  vision: boolean;
  move: boolean;
}

export type TreeKind = 'pine' | 'oak' | 'dead';

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

export type LootKind = 'bottle' | 'goggles' | 'confit' | 'shotgun' | 'energy' | 'trap' | 'book' | 'beastbar' | 'shield';
export const LOOT_KINDS: readonly LootKind[] = ['goggles', 'shotgun', 'confit', 'energy', 'trap', 'bottle', 'book', 'beastbar', 'shield'];

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

/**
 * A hinged door. Closed, its panel runs from the hinge (hx,hy) along `angle` for `length`
 * units and blocks movement and sight; open, it swings 90 degrees out of the way.
 */
export interface DoorDef {
  id: number;
  hx: number;
  hy: number;
  angle: number;
  length: number;
  /** Which way the panel swings open (+1 or -1 quarter turn). */
  swing: number;
  /** Index into MapData.dynamicSegments. */
  dyn: number;
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

/** Chris Zelley's parked ambulance: centre, heading (along its length) and size. */
export interface AmbulanceDef {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
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
  dynamicSegments: { ax: number; ay: number; bx: number; by: number; active: boolean; vision?: boolean }[];
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
  ambulance: AmbulanceDef;
  exitZone: Rect;
  generators: GeneratorDef[];
  hidingSpots: HidingSpotDef[];
  loot: LootSpawnDef[];
  stakes: StakeDef[];
  barricades: BarricadeDef[];
  doors: DoorDef[];
  gate: GateDef;
  lights: LightDef[];
  survivorSpawns: { x: number; y: number }[];
  hunterSpawns: { x: number; y: number }[];
  /** Coarse surface lookup grid (cell = surfaceCell units), values index SURFACES. */
  surfaceCell: number;
  surface: Uint8Array;
}
