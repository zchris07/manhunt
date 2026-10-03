import { BALANCE, INV_SLOTS, ITEM_KIND_MAX, ItemKind, isWeapon, slotName } from '@manhunt/shared';
import type { SimPlayer } from './player';
import type { Drop, World } from './World';
import { placeDrop } from './items';

/**
 * One inventory slot. Identical items stack (`n`); a weapon is always alone in its slot.
 * `amt` holds per-unit state: each pair of goggles' meter (s), or a weapon's rounds left.
 */
export interface Slot {
  kind: ItemKind;
  n: number;
  amt: number[];
  golden: boolean;
}

export const emptySlot = (): Slot => ({ kind: ItemKind.None, n: 0, amt: [], golden: false });
export const newInventory = (): Slot[] => Array.from({ length: INV_SLOTS }, emptySlot);

/** A fresh unit's state (full goggles, a loaded weapon). */
export function freshAmount(kind: ItemKind, golden = false): number {
  const I = BALANCE.items;
  if (kind === ItemKind.Goggles) return I.goggles.meter;
  if (kind === ItemKind.Shotgun) return golden ? I.golden.shells : I.shotgun.shells;
  if (kind === ItemKind.Pistol) return I.pistol.shots;
  return 0;
}

const usesAmount = (k: ItemKind): boolean => k === ItemKind.Goggles || isWeapon(k);

export function countOf(p: SimPlayer, kind: ItemKind): number {
  let n = 0;
  for (const s of p.inv) if (s.kind === kind) n += s.n;
  return n;
}

/** The selected slot, if it holds anything. */
export function selected(p: SimPlayer): Slot | null {
  const s = p.inv[p.selSlot];
  return s && s.kind !== ItemKind.None && s.n > 0 ? s : null;
}

function clear(s: Slot): void {
  s.kind = ItemKind.None;
  s.n = 0;
  s.amt = [];
  s.golden = false;
}

/** Drops a whole slot on the ground beside the player. */
export function dropSlot(w: World, p: SimPlayer, i: number, back = false): void {
  const s = p.inv[i];
  if (!s || s.kind === ItemKind.None) return;
  const ang = p.facing + (back ? Math.PI : 0);
  for (let u = 0; u < s.n; u++) {
    const d: Drop = { id: w.allocEntityId(), x: p.move.x, y: p.move.y, kind: s.kind, golden: s.golden, amount: s.amt[u] ?? freshAmount(s.kind, s.golden) };
    placeDrop(w, d, p.move.x + Math.cos(ang + u * 0.5) * 26, p.move.y + Math.sin(ang + u * 0.5) * 26);
  }
  w.emit([p.id], { k: 'item', text: `Dropped: ${slotName(s.kind, s.golden)}${s.n > 1 ? ` ×${s.n}` : ''}` });
  clear(s);
}

/**
 * Adds one item: onto a stack of the same kind, else into the first empty slot. With all
 * eight full, whatever is in the last slot goes on the ground to make room.
 */
export function addItem(w: World, p: SimPlayer, kind: ItemKind, amount?: number, golden = false): void {
  if (kind <= ItemKind.None || kind > ITEM_KIND_MAX) return;
  const amt = amount ?? freshAmount(kind, golden);
  if (!isWeapon(kind)) {
    const stack = p.inv.find((s) => s.kind === kind);
    if (stack) {
      stack.n++;
      if (usesAmount(kind)) stack.amt.push(amt);
      return;
    }
  }
  let i = p.inv.findIndex((s) => s.kind === ItemKind.None);
  if (i < 0) {
    i = INV_SLOTS - 1;
    dropSlot(w, p, i, true);
  }
  const s = p.inv[i];
  s.kind = kind;
  s.n = 1;
  s.amt = usesAmount(kind) ? [amt] : [];
  s.golden = kind === ItemKind.Shotgun && golden;
}

/** Uses up one unit of a slot (testing mode never runs out). */
export function consumeSlot(w: World, s: Slot): void {
  if (w.testMode) return;
  s.n--;
  if (usesAmount(s.kind)) s.amt.shift();
  if (s.n <= 0) clear(s);
}

/** Takes one unit out of a slot without using it (dropping one). Returns its amount. */
export function takeOne(s: Slot): number {
  const amt = usesAmount(s.kind) ? (s.amt.pop() ?? freshAmount(s.kind, s.golden)) : 0;
  s.n--;
  if (s.n <= 0) clear(s);
  return amt;
}

export function moveSlot(p: SimPlayer, from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= INV_SLOTS || to >= INV_SLOTS) return;
  const a = p.inv[from];
  p.inv[from] = p.inv[to];
  p.inv[to] = a;
}
