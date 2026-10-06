import { BALANCE, ChackoFlag, EntityKind, Health, ItemKind, quantizeEntity, type EntityRecord } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { World } from './World';
import type { ItemHit, NpcTarget } from './npc';
import { hurtHunter } from './combat';
import { addItem } from './inventory';
import { canAct } from './player';

const C = BALANCE.chacko;

/**
 * Chacko sits on the lounge couch watching Madden. A survivor who talks to him gets a Doctor
 * Pepper (once each); Zach gets '50 Nic' (once). A single hit from anything kills him: if a
 * survivor did it, Jaden Nguyen and Plasma.TTV hunt that survivor until they're downed once
 * (or one of the two is slain); if Zach did, Chacko explodes for half of Zach's health.
 */
export class Chacko implements NpcTarget {
  readonly id: number;
  x: number;
  y: number;
  readonly facing: number;
  alive = true;
  readonly hitRadius = C.radius;
  hurtT = 0;
  talkT = 0;
  /** Who he already served (a survivor's can and Zach's 50 Nic are separate). */
  private readonly served = new Set<string>();

  constructor(private readonly w: World) {
    this.id = w.allocEntityId();
    const L = w.map.lounge;
    this.x = L.seat.x;
    this.y = L.seat.y;
    // Looking at the TV, which is north of the couch.
    this.facing = Math.atan2(L.tv.y - L.seat.y, L.tv.x - L.seat.x);
  }

  get solid(): boolean {
    return this.alive;
  }

  canTalk(p: SimPlayer): boolean {
    if (!this.alive || this.served.has(`${p.role}${p.id}`)) return false;
    if (p.role === 'survivor') {
      if (p.health !== Health.Healthy && p.health !== Health.Wounded) return false;
    } else if (p.role !== 'hunter' || !canAct(p)) return false;
    return Math.hypot(p.move.x - this.x, p.move.y - this.y) < C.reach;
  }

  /** A survivor gets a Doctor Pepper; Zach gets 50 Nic, which replaces Penjamin. */
  talk(p: SimPlayer): void {
    if (!this.canTalk(p)) return;
    this.served.add(`${p.role}${p.id}`);
    this.talkT = 2;
    const w = this.w;
    if (p.role === 'hunter') {
      p.nic = true;
      this.say(C.lineZach);
      w.emit([p.id], { k: 'item', text: "Got 50 Nic: it replaces Penjamin (+50% reach, blue)" });
    } else {
      addItem(w, p, ItemKind.Energy);
      this.say(C.lineSurvivor);
      w.emit([p.id], { k: 'item', text: 'Got a Doctor Pepper' });
    }
  }

  /** Any item (bottle, book, pellets, a bullet) kills him. */
  itemHit(by: SimPlayer, _kind: ItemHit): void {
    this.slay(by);
  }

  /** Zach's machete or lunge (`harm` false: only startled, by Penjamin). */
  hit(h: SimPlayer, harm = true): void {
    if (!this.alive) return;
    if (!harm) {
      this.hurtT = 0.35;
      this.say(C.lineHit);
      return;
    }
    h.stats.hits++;
    this.slay(h);
  }

  private slay(by: SimPlayer): void {
    if (!this.alive) return;
    const w = this.w;
    this.alive = false;
    this.hurtT = 0;
    if (by.role === 'hunter') {
      // A bloody explosion on the spot that takes half of Zach's health.
      w.emit(w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'chackoBoom', x: Math.round(this.x), y: Math.round(this.y) });
      w.noise(this.x, this.y, 1200, 'smash');
      w.feed(`${by.name} killed Chacko and he exploded`);
      hurtHunter(w, by, BALANCE.hunter.health.max * C.explosion, null, 'blast');
      return;
    }
    w.feed(`${by.name} killed Chacko`);
    w.avenge(by);
  }

  private say(text: string): void {
    this.w.emit(this.w.near(this.x, this.y, BALANCE.net.maxSensingRadius), { k: 'npc', who: 'chacko', say: text });
  }

  record(): EntityRecord {
    let st = 0;
    if (!this.alive) st |= ChackoFlag.Dead;
    if (this.hurtT > 0) st |= ChackoFlag.Hurt;
    if (this.talkT > 0) st |= ChackoFlag.Talking;
    return quantizeEntity(this.id, EntityKind.Chacko, this.x, this.y, this.facing, st, 0, 0, 0, 0);
  }

  update(dt: number): void {
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.talkT = Math.max(0, this.talkT - dt);
  }
}
