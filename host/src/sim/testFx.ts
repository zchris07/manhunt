import { BALANCE, TEST_FX, type TestFx } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import { bookHit, stunHunter } from './items';
import { downHunter } from './combat';
import { spawnVape, spawnVapeAt } from './vape';

const I = BALANCE.items;

/** Testing mode: plays a stun or flash effect on yourself, as if it had really happened. */
export function playTestFx(w: World, p: SimPlayer, fx: TestFx): void {
  if (!w.testMode || !TEST_FX.includes(fx) || p.role === 'spectator') return;
  const zach = p.role === 'hunter';
  // Testing is about seeing the effect: stun immunity never gets in the way.
  p.immuneT = 0;
  switch (fx) {
    case 'scare':
      p.scareT = BALANCE.hunter.burst.scareTime;
      w.emit([p.id], { k: 'scare' });
      break;
    case 'book':
      if (zach) bookHit(w, p, undefined);
      else {
        w.emit([p.id], { k: 'book', img: w.rng.int(0, I.book.images - 1) });
        w.emit([p.id], { k: 'boom', x: Math.round(p.move.x), y: Math.round(p.move.y) });
      }
      break;
    case 'waz':
      w.emit([p.id], { k: 'wazSlain' });
      break;
    case 'stun':
      if (zach) stunHunter(w, p, I.bottle.stun, 'bottle');
      else {
        p.stunT = I.bottle.stun;
        w.emit('all', { k: 'stun', target: p.id, kind: 'bottle' });
      }
      break;
    case 'blast': {
      // A shotgun blast from in front: knocked back (and Zach stunned).
      const S = I.shotgun;
      p.move.kbT = S.kbDuration;
      p.move.kbDur = S.kbDuration;
      p.move.kbPeak = S.kbPeak;
      p.move.kbAng = p.facing + Math.PI;
      if (zach) stunHunter(w, p, S.stun, 'shotgun');
      w.emit(w.near(p.move.x, p.move.y, BALANCE.net.maxSensingRadius), {
        k: 'shot',
        x: Math.round(p.move.x + Math.cos(p.facing) * 120),
        y: Math.round(p.move.y + Math.sin(p.facing) * 120),
        p: Array.from({ length: S.pellets }, (_, i) => [Math.round((p.facing + Math.PI + (i - 3.5) * 0.03) * 1000), 110]).flat(),
        hit: true,
        gold: false,
      });
      break;
    }
    case 'gas':
      w.gases.push({ id: w.allocEntityId(), x: p.move.x, y: p.move.y, age: 0 });
      w.emit(w.near(p.move.x, p.move.y, BALANCE.net.maxSensingRadius), { k: 'gas', x: Math.round(p.move.x), y: Math.round(p.move.y) });
      break;
    case 'vape':
      // Zach: a cloud from where he stands; a survivor: caught in one, point blank.
      if (zach) spawnVape(w, p, p.facing);
      else spawnVapeAt(w, p.move.x - Math.cos(p.facing) * 420, p.move.y - Math.sin(p.facing) * 420, p.facing, 900, 0);
      break;
    case 'down':
      // Zach knocked out cold (as by Plasma: no lasting slowdown); a survivor flinches.
      if (zach) downHunter(w, p, false);
      else w.emit('all', { k: 'hit', victim: p.id, by: 0, x: Math.round(p.move.x), y: Math.round(p.move.y), w: 'punch' });
      break;
  }
}
