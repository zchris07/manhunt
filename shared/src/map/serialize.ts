import type { MapData } from './types';

/** JSON form of a map (used only for the rare checksum-mismatch fallback transfer). */
export function serializeMap(d: MapData): string {
  return JSON.stringify({ ...d, surface: Array.from(d.surface) });
}

export function deserializeMap(s: string): MapData {
  const raw = JSON.parse(s) as MapData & { surface: number[] };
  return { ...raw, surface: Uint8Array.from(raw.surface) };
}
