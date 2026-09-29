import { describe, expect, it } from 'vitest';
import { generateMap, mapParamsFor, validateMap } from '../src/map/generate';
import { resolveBalance } from '../src/balance';

// 200 seeds across several lobby shapes: every objective reachable from the survivor spawn,
// enough parts, and at least two loopable structures around every generator.
const shapes = [
  resolveBalance({ hunters: 1, survivors: 4, difficulty: 1 }),
  resolveBalance({ hunters: 2, survivors: 8, difficulty: 1 }),
  resolveBalance({ hunters: 1, survivors: 1, difficulty: 1 }),
  resolveBalance({ hunters: 3, survivors: 7, difficulty: 1.5 }),
  resolveBalance({ hunters: 1, survivors: 9, difficulty: 0.5 }),
];

describe('map reachability across 200 seeds', () => {
  for (let chunk = 0; chunk < 20; chunk++) {
    it(`seeds ${chunk * 10}..${chunk * 10 + 9} are winnable`, async () => {
      const failures: string[] = [];
      for (let s = chunk * 10; s < chunk * 10 + 10; s++) {
        // Yield so the test worker can answer the runner's RPC between long synchronous steps.
        await new Promise((r) => setTimeout(r, 0));
        const d = generateMap(mapParamsFor(1000 + s * 7919, shapes[s % shapes.length]));
        const v = validateMap(d);
        if (!v.ok) failures.push(`seed ${s}: ${v.problems.join(', ')}`);
      }
      expect(failures).toEqual([]);
    });
  }
});
