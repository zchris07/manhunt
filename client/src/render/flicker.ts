/**
 * Light flicker. Campfires breathe; lamps are old fluorescents that mostly hold steady but
 * now and then stutter or die for a moment. Deterministic per light (seeded by index).
 */
export function lightFlicker(kind: string, time: number, seed: number): number {
  if (kind === 'campfire') return 0.85 + 0.15 * Math.sin(time * 7 + seed * 2.1) * Math.sin(time * 3.1 + seed);
  if (kind === 'lantern') return 0.88 + 0.06 * Math.sin(time * 5 + seed);
  // Lamp: a slow hash of time decides stutter windows.
  const slot = Math.floor(time * 2 + seed * 13.7);
  const h = Math.abs(Math.sin(slot * 12.9898 + seed * 78.233) * 43758.5453) % 1;
  if (h > 0.93) return Math.sin(time * 60) > 0 ? 0.25 : 0.9;
  if (h > 0.9) return 0.15;
  return 0.9;
}
