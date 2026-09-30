import {
  ACTION_LABELS,
  Action,
  BALANCE,
  GenFlag,
  Health,
  ITEM_NAMES,
  ItemKind,
  PROMPT_LABELS,
  Prompt,
  SLOT_ITEMS,
  maxStamina,
  type SelfState,
  type WorldState,
} from '@manhunt/shared';
import type { AssetManager } from '../assets/AssetManager';
import type { GameClient } from '../net/GameClient';
import { $, el, esc, storageGet, storageSet } from './dom';

const HEALTH_LABEL = ['Healthy', 'Wounded', 'Downed', 'Carried', 'On a stake', 'Escaped', 'Eliminated'];
const HEALTH_CLASS = ['hp-healthy', 'hp-wounded', 'hp-downed', 'hp-carried', 'hp-staked', 'hp-gone', 'hp-gone'];
const ITEM_ICON: Record<number, string> = {
  [ItemKind.Bottle]: 'item.bottle',
  [ItemKind.Goggles]: 'item.goggles',
  [ItemKind.Shotgun]: 'item.shotgun',
  [ItemKind.Energy]: 'item.energy',
  [ItemKind.Trap]: 'item.trap',
};
const SLOT_KEY = 'manhunt.slots';

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/**
 * The survivor's inventory as they arranged it: one slot per item kind (a stack of up to 2
 * sits in one slot). Order is personal (saved locally); the host only needs the selected kind.
 */
export class Inventory {
  order: ItemKind[];
  selected = 0;

  constructor() {
    let saved: ItemKind[] | null = null;
    try {
      saved = JSON.parse(storageGet(SLOT_KEY) ?? 'null') as ItemKind[] | null;
    } catch {
      saved = null;
    }
    const valid = saved && saved.length === SLOT_ITEMS.length && SLOT_ITEMS.every((k) => saved!.includes(k));
    this.order = valid ? saved!.slice() : SLOT_ITEMS.slice();
  }

  kindAt(slot: number): ItemKind {
    return this.order[slot] ?? ItemKind.None;
  }

  /** The item kind in hand (none if that slot is empty). */
  held(inv: readonly number[]): ItemKind {
    const k = this.kindAt(this.selected);
    return (inv[k] ?? 0) > 0 ? k : ItemKind.None;
  }

  select(slot: number): void {
    if (slot >= 0 && slot < this.order.length) this.selected = slot;
  }

  /** Mouse wheel: next (or previous) slot that holds something. */
  scroll(dir: number, inv: readonly number[]): void {
    const n = this.order.length;
    for (let i = 1; i <= n; i++) {
      const s = (((this.selected + dir * i) % n) + n) % n;
      if ((inv[this.kindAt(s)] ?? 0) > 0) {
        this.selected = s;
        return;
      }
    }
    this.selected = (((this.selected + dir) % n) + n) % n;
  }

  swap(a: number, b: number): void {
    if (a === b) return;
    const heldKind = this.kindAt(this.selected);
    [this.order[a], this.order[b]] = [this.order[b], this.order[a]];
    this.selected = this.order.indexOf(heldKind);
    storageSet(SLOT_KEY, JSON.stringify(this.order));
  }
}

interface SlotEls {
  root: HTMLElement;
  icon: HTMLImageElement;
  count: HTMLElement;
  meter: HTMLElement;
  cd: HTMLElement;
}

/** HUD: objective, minimap slot, roster, hotbar, prompts, big messages and a feed. */
export class Hud {
  readonly root: HTMLElement;
  readonly topRight: HTMLElement;
  private last = '';
  private readonly roster = new Map<number, number>();
  private slots: SlotEls[] = [];
  private hotbarRole = '';
  private readonly scare: HTMLElement;
  private scareTimer = 0;
  private editor: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly client: GameClient,
    private readonly assets: AssetManager,
    readonly inventory: Inventory,
  ) {
    this.root = el(
      'div',
      'hud',
      `<div class="objective" id="obj"></div>
       <div class="top-right" id="topright"><div class="roster" id="roster"></div></div>
       <div class="status" id="status"></div>
       <div class="hotbar" id="hotbar"></div>
       <div class="prompt" id="prompt"></div>
       <div class="feed" id="feed"></div>
       <div class="center-msg" id="center"></div>
       <div class="big-msg" id="big"></div>`,
    );
    parent.appendChild(this.root);
    this.topRight = $(this.root, '#topright');
    this.scare = el('div', 'scare');
    const url = assets.imageUrl('ui.scare');
    if (url) this.scare.innerHTML = `<img alt="" src="${esc(url)}">`;
    parent.appendChild(this.scare);
  }

  feed(text: string): void {
    const f = $(this.root, '#feed');
    f.insertAdjacentHTML('beforeend', `<div>${esc(text)}</div>`);
    while (f.children.length > 6) f.firstElementChild!.remove();
    setTimeout(() => f.firstElementChild?.remove(), 7000);
  }

  private centerTimer = 0;
  center(text: string, ms = 3500): void {
    const c = $(this.root, '#center');
    c.textContent = text;
    clearTimeout(this.centerTimer);
    this.centerTimer = window.setTimeout(() => (c.textContent = ''), ms);
  }

  private bigTimer = 0;
  /** A big, punchy announcement (JARVIS ONLINE, HEMP BATTERY ACTIVATED). */
  big(text: string, cls: string, ms = 3000): void {
    const b = $(this.root, '#big');
    b.className = `big-msg show ${cls}`;
    b.textContent = text;
    clearTimeout(this.bigTimer);
    this.bigTimer = window.setTimeout(() => (b.className = 'big-msg'), ms);
  }

  /** The Soundcloud Burst hit you: the image covers the screen, then fades out. */
  jumpScare(ms: number): void {
    this.scare.classList.remove('fade');
    this.scare.classList.add('on');
    clearTimeout(this.scareTimer);
    this.scareTimer = window.setTimeout(() => {
      this.scare.classList.add('fade');
      this.scareTimer = window.setTimeout(() => this.scare.classList.remove('on', 'fade'), 1200);
    }, Math.max(0, ms - 1200));
  }

  get scareShowing(): boolean {
    return this.scare.classList.contains('on');
  }

  setRosterHealth(id: number, health: number): void {
    this.roster.set(id, health);
  }

  get editorOpen(): boolean {
    return this.editor !== null;
  }

  /** Tab: drag and drop items between slots. */
  toggleEditor(self: SelfState | null): void {
    if (this.editor) {
      this.editor.remove();
      this.editor = null;
      return;
    }
    const ed = el('div', 'inv-editor', '<div class="inv-title">INVENTORY <span>drag items to rearrange · Tab to close</span></div><div class="inv-slots"></div>');
    this.editor = ed;
    this.root.parentElement!.appendChild(ed);
    this.renderEditor(self);
  }

  private renderEditor(self: SelfState | null): void {
    const ed = this.editor;
    if (!ed) return;
    const wrap = $(ed, '.inv-slots');
    wrap.innerHTML = '';
    const inv = self?.inv ?? [0, 0, 0, 0, 0, 0];
    this.inventory.order.forEach((kind, i) => {
      const s = el(
        'div',
        `inv-slot ${i === this.inventory.selected ? 'sel' : ''} ${inv[kind] > 0 ? '' : 'empty'}`,
        `<b>${i + 1}</b><img draggable="false" src="${this.assets.iconUrl(ITEM_ICON[kind])}"><span>${esc(ITEM_NAMES[kind])}</span><em>${inv[kind] > 0 ? `×${inv[kind]}` : 'none yet'}</em>`,
      );
      s.dataset.slot = String(i);
      s.addEventListener('pointerdown', (e) => this.beginDrag(e, i, self));
      wrap.appendChild(s);
    });
  }

  private beginDrag(e: PointerEvent, from: number, self: SelfState | null): void {
    e.preventDefault();
    const src = e.currentTarget as HTMLElement;
    const ghost = src.cloneNode(true) as HTMLElement;
    ghost.classList.add('ghost');
    document.body.appendChild(ghost);
    const move = (ev: PointerEvent): void => {
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
      this.editor?.querySelectorAll('.inv-slot').forEach((n) => n.classList.remove('over'));
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.inv-slot:not(.ghost)');
      over?.classList.add('over');
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.inv-slot');
      if (over?.dataset.slot !== undefined) this.inventory.swap(from, Number(over.dataset.slot));
      this.hotbarRole = '';
      this.renderEditor(self);
    };
    move(e);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Builds the hotbar's fixed DOM for a role; values are updated in place each frame. */
  private buildHotbar(role: 'survivor' | 'hunter' | 'none', test: boolean): void {
    const key = `${role}:${this.inventory.order.join(',')}:${test}`;
    if (key === this.hotbarRole) return;
    this.hotbarRole = key;
    const hb = $(this.root, '#hotbar');
    hb.innerHTML = '';
    this.slots = [];
    const slot = (label: string, iconId: string, extraClass = ''): SlotEls => {
      const root = el('div', `slot ${extraClass}`, `<b class="slot-key">${esc(label)}</b><img alt="" draggable="false"><i class="count"></i><div class="meter"><div></div></div><div class="cd"></div>`);
      const icon = root.querySelector('img')!;
      if (iconId) icon.src = this.assets.iconUrl(iconId);
      hb.appendChild(root);
      const s: SlotEls = { root, icon, count: root.querySelector('.count')!, meter: root.querySelector('.meter')!, cd: root.querySelector('.cd')! };
      this.slots.push(s);
      return s;
    };
    if (role === 'survivor') {
      this.inventory.order.forEach((kind, i) => slot(String(i + 1), ITEM_ICON[kind]));
      hb.appendChild(el('div', 'sep'));
      slot('Q', 'item.tablet', 'ability');
      slot('', 'item.confit', 'confit');
    } else if (role === 'hunter') {
      const machete = slot('LMB', 'char.machete', 'ability wide');
      machete.icon.classList.add('rot');
      slot('F', '', 'ability lunge');
      slot('RMB', '', 'ability burst');
      slot('Q', 'item.hemp', 'ability');
    }
  }

  update(self: SelfState, world: WorldState): void {
    const m = this.client.match;
    if (!m) return;
    const hunter = self.role === 1;
    const spectating = self.spectating > 0 || self.role === 2;
    const test = self.testMode === 1;

    // Objective card.
    const req = world.required;
    const done = Math.min(world.repaired, req);
    const gate = world.gateOpen ? '<b class="ok">OPEN · escape through the yard</b>' : world.gatePowered ? `<b class="warn">POWERED</b> ${Math.round(world.gateProgress * 100)}%` : '<span class="dim">no power</span>';
    const known = world.gens.filter((g) => g.flags & GenFlag.Known && !(g.flags & GenFlag.Repaired) && g.progress > 0);
    const obj =
      `<div class="obj-title">${test ? 'TESTING MODE <span class="dim">T switches role</span>' : hunter ? 'HUNT THEM DOWN' : 'START THE GENERATORS'}</div>` +
      `<div class="gens">${Array.from({ length: req }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')}<span>${done}/${req}</span></div>` +
      `<div>Exit gate: ${gate}</div>` +
      `<div class="dim">Escaped ${world.escaped} · Sacrificed ${world.eliminated}${test ? '' : ` · ${fmtTime(world.timeLeft)}`}</div>` +
      (hunter && known.length ? `<div class="dim">Heard repairs: ${known.map((g) => `${Math.round(g.progress * 100)}%`).join(' ')}</div>` : '');

    // Roster: survivors' health states (public knowledge).
    const rosterHtml = [...m.players.values()]
      .filter((p) => p.role !== 'spectator')
      .map((p) => {
        if (p.role === 'hunter') return `<div class="chip hunter">${esc(p.name)}<span>Zach</span></div>`;
        const h = p.id === self.id && !spectating ? self.health : (this.roster.get(p.id) ?? Health.Healthy);
        return `<div class="chip ${HEALTH_CLASS[h]}">${esc(p.name)}<span>${HEALTH_LABEL[h].toLowerCase()}</span></div>`;
      })
      .join('');

    // Status (bottom left).
    let status = '';
    if (spectating) {
      const target = m.players.get(self.spectating);
      status = `<div>Spectating <b>${esc(target?.name ?? '...')}</b></div><div class="dim">Click or ← → to switch</div>`;
    } else {
      const role = hunter ? 'hunter' : 'survivor';
      const cap = maxStamina(role, self.boostT);
      const frac = cap > 0 ? self.stamina / cap : 0;
      const locked = self.staminaLock > 0;
      const staminaBar = `<div class="stam ${locked ? 'locked' : ''} ${self.boostT > 0 ? 'boost' : ''}"><div style="width:${Math.round(frac * 100)}%"></div><span>${locked ? `SPRINT LOCKED ${self.staminaLock.toFixed(1)}s` : `SPRINT ${self.stamina.toFixed(1)}s`}</span></div>`;
      if (hunter) {
        status =
          `<div class="who hunter">ZACH BRANCH${self.carrying ? ` <span>carrying ${esc(m.players.get(self.carrying)?.name ?? '')}</span>` : ''}</div>` +
          staminaBar +
          (self.stunT > 0 ? `<div class="warn">STUNNED ${self.stunT.toFixed(1)}s</div>` : '') +
          (self.hempT > 0 ? `<div class="ok">HEMP BATTERY ${test && self.hemp === 2 ? '∞' : `${self.hempT.toFixed(1)}s`}</div>` : '') +
          (self.gassed ? '<div class="purple">IN GALAXY GAS: slowed</div>' : '') +
          (self.immuneT > 0 && self.stunT <= 0 ? `<div class="dim">Stun immune ${self.immuneT.toFixed(1)}s</div>` : '');
      } else {
        status =
          `<div class="who ${HEALTH_CLASS[self.health]}">${HEALTH_LABEL[self.health].toUpperCase()}${self.hideState === 2 ? ' <span>hidden</span>' : ''}</div>` +
          staminaBar +
          (self.boostT > 0 ? `<div class="cyan">ENERGY DRINK ${Math.ceil(self.boostT)}s</div>` : '') +
          (self.gogglesOn ? `<div class="ok">NIGHT VISION ${test ? '∞' : `${self.goggleMeter.toFixed(1)}s`}</div>` : '') +
          (self.health === Health.Staked ? `<div class="warn">Stake: ${Math.ceil(self.stakeT)}s. Wait for a teammate.</div>` : '') +
          (self.health === Health.Carried ? `<div>Struggle: ${Math.round(self.wiggle * 100)}% <span class="dim">(hold move keys)</span></div>` : '') +
          (self.hideState === 2 ? `<div>Breath ${Math.round(self.breath * 100)}% <span class="dim">(hold Space)</span></div>` : '');
      }
    }

    // Prompt and progress.
    let prompt = '';
    if (!spectating) {
      const busy = self.action !== Action.None && self.action !== Action.Attack;
      if (busy) {
        prompt = `<div>${esc(ACTION_LABELS[self.action] ?? '')}</div><div class="bar"><div style="width:${Math.round(self.actionProgress * 100)}%"></div></div>`;
      } else {
        const parts: string[] = [];
        if (self.prompt !== Prompt.None) parts.push(this.promptText(self.prompt, self.promptTarget));
        if (self.prompt2 !== Prompt.None) parts.push(`<span class="key">Space</span>${esc(PROMPT_LABELS[self.prompt2].replace(/^(Press Space to )/, ''))}`);
        prompt = parts.join('&nbsp;&nbsp;&nbsp;');
      }
    }

    const html = obj + '|' + rosterHtml + '|' + status + '|' + prompt;
    if (html !== this.last) {
      this.last = html;
      $(this.root, '#obj').innerHTML = obj;
      $(this.root, '#roster').innerHTML = rosterHtml;
      $(this.root, '#status').innerHTML = status;
      $(this.root, '#prompt').innerHTML = prompt;
    }
    this.updateHotbar(self, spectating ? 'none' : hunter ? 'hunter' : 'survivor', test);
    if (this.editor && hunter) this.toggleEditor(null);
  }

  private updateHotbar(self: SelfState, role: 'survivor' | 'hunter' | 'none', test: boolean): void {
    this.buildHotbar(role, test);
    const set = (s: SlotEls | undefined, o: { on?: boolean; sel?: boolean; count?: string; meter?: number | null; cd?: number; active?: boolean; hidden?: boolean }): void => {
      if (!s) return;
      s.root.classList.toggle('off', o.on === false);
      s.root.classList.toggle('sel', !!o.sel);
      s.root.classList.toggle('active', !!o.active);
      s.root.style.display = o.hidden ? 'none' : '';
      const c = o.count ?? '';
      if (s.count.textContent !== c) s.count.textContent = c;
      s.meter.style.display = o.meter === null || o.meter === undefined ? 'none' : '';
      if (o.meter !== null && o.meter !== undefined) (s.meter.firstElementChild as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, o.meter)) * 100)}%`;
      s.cd.style.transform = `scaleY(${Math.max(0, Math.min(1, o.cd ?? 0))})`;
    };
    if (role === 'survivor') {
      const inv = self.inv;
      this.inventory.order.forEach((kind, i) => {
        const n = inv[kind] ?? 0;
        let meter: number | null = null;
        let cd = 0;
        if (kind === ItemKind.Goggles && n > 0) meter = test ? 1 : self.goggleMeter / BALANCE.items.goggles.meter;
        if (kind === ItemKind.Shotgun && n > 0) {
          meter = test ? 1 : self.shells / BALANCE.items.shotgun.shells;
          cd = self.reloadT / BALANCE.items.shotgun.reload;
        }
        if (kind === ItemKind.Goggles) cd = self.gogglesCd / BALANCE.items.goggles.toggleDelay;
        set(this.slots[i], { on: n > 0, sel: i === this.inventory.selected, count: n > 0 ? (test ? '∞' : `×${n}`) : '', meter, cd, active: kind === ItemKind.Goggles && self.gogglesOn === 1 });
      });
      const j = self.jarvis;
      set(this.slots[5], { on: j === 1 || j === 3, count: j === 3 ? '∞' : j === 2 ? 'used' : j === 1 ? 'JARVIS' : '', active: self.jarvisT > 0, hidden: j === 0 });
      set(this.slots[6], { on: self.confit > 0, count: test ? '∞' : '', hidden: self.confit <= 0 });
    } else if (role === 'hunter') {
      const H = BALANCE.hunter;
      set(this.slots[0], { cd: self.attackCd / H.attack.hitCooldown, count: 'Swipe' });
      const charges = self.lungeCharges;
      set(this.slots[1], { on: charges > 0, count: `Lunge ${'●'.repeat(charges)}${'○'.repeat(Math.max(0, H.lunge.charges - charges))}`, cd: charges < H.lunge.charges ? self.lungeRecharge / H.lunge.recharge : 0, active: self.lungeT > 0 });
      set(this.slots[2], { on: self.burstCd <= 0, count: self.burstCd > 0 ? `${Math.ceil(self.burstCd)}s` : 'Burst', cd: self.burstCd / H.burst.cooldown });
      set(this.slots[3], { on: self.hemp > 0 || self.hempT > 0, count: self.hemp === 2 ? '∞' : self.hempT > 0 ? `${Math.ceil(self.hempT)}s` : 'Hemp', active: self.hempT > 0, hidden: self.hemp === 0 && self.hempT <= 0 });
    }
  }

  private promptText(p: Prompt, target: number): string {
    const label = PROMPT_LABELS[p] ?? '';
    const m = this.client.match!;
    let text = label;
    if (p === Prompt.Loot && m.map.loot[target]) text = `Press E to pick up the ${LOOT_NAMES[m.map.loot[target].item] ?? m.map.loot[target].item}`;
    if ((p === Prompt.Heal || p === Prompt.Revive || p === Prompt.Unstake || p === Prompt.PickUp) && m.players.get(target)) {
      text = `${label} ${m.players.get(target)!.name}`;
    }
    const key = /^(Press|Hold) E/.test(text) ? '<span class="key">E</span>' : '';
    return `${key}${esc(text.replace(/^(Press E to |Hold E to )/, (s) => (s.startsWith('Hold') ? 'hold to ' : '')))}`;
  }

  destroy(): void {
    clearTimeout(this.centerTimer);
    clearTimeout(this.bigTimer);
    clearTimeout(this.scareTimer);
    this.editor?.remove();
    this.scare.remove();
    this.root.remove();
  }
}

const LOOT_NAMES: Record<string, string> = {
  bottle: 'bottle',
  goggles: 'night vision goggles',
  confit: 'duck confit',
  shotgun: 'shotgun',
  energy: 'energy drink',
  trap: 'galaxy gas trap',
};

/** Skill check: a needle sweeps a circle; press Space inside the zone. */
export class SkillCheck {
  private readonly canvas: HTMLCanvasElement;
  private active: { id: number; start: number; needleMs: number; zone: number; size: number; great: number } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onResult: (id: number, result: 'miss' | 'good' | 'great') => void,
  ) {
    this.canvas = el('canvas', 'skillcheck');
    this.canvas.width = 160;
    this.canvas.height = 160;
    this.canvas.style.display = 'none';
    this.canvas.style.position = 'absolute';
    parent.appendChild(this.canvas);
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  begin(id: number, delayMs: number, needleMs: number, zone: number, size: number, great: number, now: number): void {
    this.active = { id, start: now + delayMs, needleMs, zone, size, great };
    this.canvas.style.display = 'block';
  }

  /** Space pressed. Returns true if the press was consumed. */
  press(now: number): boolean {
    const a = this.active;
    if (!a) return false;
    if (now < a.start) return true;
    const t = (now - a.start) / a.needleMs;
    let result: 'miss' | 'good' | 'great' = 'miss';
    if (t >= a.zone && t <= a.zone + a.great) result = 'great';
    else if (t >= a.zone && t <= a.zone + a.size) result = 'good';
    this.finish(result);
    return true;
  }

  private finish(result: 'miss' | 'good' | 'great'): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.canvas.style.display = 'none';
    this.onResult(a.id, result);
  }

  cancel(): void {
    this.active = null;
    this.canvas.style.display = 'none';
  }

  draw(now: number): void {
    const a = this.active;
    if (!a) return;
    const t = (now - a.start) / a.needleMs;
    if (t > 1.02) {
      this.finish('miss');
      return;
    }
    const ctx = this.canvas.getContext('2d')!;
    const c = 80;
    const r = 56;
    ctx.clearRect(0, 0, 160, 160);
    ctx.fillStyle = 'rgba(20,14,36,0.75)';
    ctx.beginPath();
    ctx.arc(c, c, r + 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
    const ang = (f: number): number => -Math.PI / 2 + f * Math.PI * 2;
    ctx.strokeStyle = '#ffd23a';
    ctx.beginPath();
    ctx.arc(c, c, r, ang(a.zone), ang(a.zone + a.size));
    ctx.stroke();
    ctx.strokeStyle = '#4cff6a';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(c, c, r, ang(a.zone), ang(a.zone + a.great));
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px Rubik, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SPACE', c, c + 5);
    if (t >= 0) {
      ctx.strokeStyle = '#ff3a5a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(ang(t)) * (r + 10), c + Math.sin(ang(t)) * (r + 10));
      ctx.stroke();
    }
  }

  destroy(): void {
    this.canvas.remove();
  }
}
