import {
  ACTION_LABELS,
  Action,
  BALANCE,
  GenFlag,
  Health,
  PROMPT_LABELS,
  Prompt,
  ToolKind,
  type SelfState,
  type WorldState,
} from '@manhunt/shared';
import type { GameClient } from '../net/GameClient';
import { $, el, esc } from './dom';

const HEALTH_LABEL = ['Healthy', 'Wounded', 'Downed', 'Carried', 'On a stake', 'Escaped', 'Eliminated'];
const HEALTH_CLASS = ['hp-healthy', 'hp-wounded', 'hp-downed', 'hp-carried', 'hp-staked', 'hp-gone', 'hp-gone'];

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Minimal HUD: objective, health, items, noise, prompts, ability cooldowns and a feed. */
export class Hud {
  readonly root: HTMLElement;
  private last = '';
  private readonly roster = new Map<number, number>();

  constructor(
    parent: HTMLElement,
    private readonly client: GameClient,
  ) {
    this.root = el(
      'div',
      'hud',
      `<div class="objective" id="obj"></div>
       <div class="roster" id="roster"></div>
       <div class="status" id="status"></div>
       <div class="abilities" id="abilities"></div>
       <div class="prompt" id="prompt"></div>
       <div class="feed" id="feed"></div>
       <div class="center-msg" id="center"></div>`,
    );
    parent.appendChild(this.root);
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

  setRosterHealth(id: number, health: number): void {
    this.roster.set(id, health);
  }

  update(self: SelfState, world: WorldState): void {
    const m = this.client.match;
    if (!m) return;
    const hunter = self.role === 1;
    const spectating = self.spectating > 0 || self.role === 2;

    // Objective panel.
    const gate = world.gateOpen ? '<b style="color:#9fc08c">OPEN, escape through the yard</b>' : world.gatePowered ? `<b style="color:#d9a441">POWERED</b> ${Math.round(world.gateProgress * 100)}%` : 'no power';
    const known = world.gens.filter((g) => g.flags & GenFlag.Known && !(g.flags & GenFlag.Repaired) && g.progress > 0);
    const obj =
      `<div>Generators <b>${Math.min(world.repaired, world.required)}/${world.required}</b> ${'■'.repeat(Math.min(world.repaired, world.required))}${'□'.repeat(Math.max(0, world.required - world.repaired))}</div>` +
      `<div>Exit gate: ${gate}</div>` +
      `<div class="note">Escaped ${world.escaped} · Sacrificed ${world.eliminated} · ${fmtTime(world.timeLeft)}</div>` +
      (hunter && known.length ? `<div class="note">Heard repairs: ${known.map((g) => `${Math.round(g.progress * 100)}%`).join(' ')}</div>` : '');

    // Roster: survivors' health states (public knowledge).
    const rosterHtml = [...m.players.values()]
      .filter((p) => p.role !== 'spectator')
      .map((p) => {
        if (p.role === 'hunter') return `<div style="color:#e0786e">${esc(p.name)} <span class="note">Zach</span></div>`;
        const h = p.id === self.id && !spectating ? self.health : (this.roster.get(p.id) ?? Health.Healthy);
        return `<div class="${HEALTH_CLASS[h]}">${esc(p.name)} <span class="note">${HEALTH_LABEL[h].toLowerCase()}</span></div>`;
      })
      .join('');

    // Status panel.
    let status = '';
    if (spectating) {
      const target = m.players.get(self.spectating);
      status = `<div>Spectating <b>${esc(target?.name ?? '...')}</b></div><div class="note">Click or ← → to switch</div>`;
    } else if (hunter) {
      status =
        `<div><b style="color:#e0786e">ZACH BRANCH</b>${self.carrying ? ` · carrying ${esc(m.players.get(self.carrying)?.name ?? '')}` : ''}</div>` +
        (self.stunT > 0 ? `<div style="color:#d9a441">STUNNED ${self.stunT.toFixed(1)}s</div>` : '') +
        (self.blindT > 0 ? `<div style="color:#d9a441">BLINDED ${self.blindT.toFixed(1)}s</div>` : '') +
        (self.immuneT > 0 && self.stunT <= 0 && self.blindT <= 0 ? `<div class="note">Stun immune ${self.immuneT.toFixed(0)}s</div>` : '');
    } else {
      const tool = self.tool === ToolKind.Flare ? `Flare ×${self.toolCount}` : self.tool === ToolKind.Bottle ? `Bottle ×${self.toolCount}` : 'no tool';
      const bars = Math.round(self.noise * 5);
      status =
        `<div class="${HEALTH_CLASS[self.health]}"><b>${HEALTH_LABEL[self.health].toUpperCase()}</b>${self.hideState === 2 ? ' · hidden' : ''}</div>` +
        `<div>Fuel ${self.fuel} · Wire ${self.wire} · ${tool}</div>` +
        `<div>Batteries ${self.flashCharges}${self.flashHold > 0 ? ` · flash ${Math.round(self.flashHold * 100)}%` : ''}</div>` +
        `<div>Noise <span class="noise">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= bars ? 'on' : ''}" style="height:${i * 2 + 4}px"></i>`).join('')}</span></div>` +
        (self.health === Health.Staked ? `<div style="color:#e0584c">Stake: ${Math.ceil(self.stakeT)}s. Wait for a teammate.</div>` : '') +
        (self.health === Health.Carried ? `<div>Struggle: ${Math.round(self.wiggle * 100)}% <span class="note">(hold move keys)</span></div>` : '') +
        (self.hideState === 2 ? `<div>Breath ${Math.round(self.breath * 100)}% <span class="note">(hold Space)</span></div>` : '');
    }

    // Abilities (hunter).
    let abilities = '';
    if (hunter && !spectating) {
      const H = BALANCE.hunter;
      const slot = (key: string, name: string, cd: number, max: number, active = false): string =>
        `<div class="ability ${active ? 'active' : ''}"><div class="cd" style="transform:scaleY(${max > 0 ? Math.min(1, cd / max) : 0})"></div><div class="key">${key}</div><div>${name}</div></div>`;
      abilities =
        slot('RMB', 'Lunge', self.lungeCd, H.lunge.cooldown, self.lungeT > 0) +
        slot('Q', 'Pulse', self.pulseCd, H.pulse.cooldown) +
        slot('R', 'Bloodhound', self.bloodhoundCd, H.bloodhound.cooldown, self.bloodhoundT > 0) +
        slot('F', 'Smash', self.smashCd, H.vaultSmash.cooldown);
    }

    // Prompt and progress.
    let prompt = '';
    if (!spectating) {
      const busy = self.action !== Action.None && self.action !== Action.FlashAim && self.action !== Action.Attack;
      if (busy) {
        prompt = `<div>${esc(ACTION_LABELS[self.action] ?? '')}</div><div class="bar"><div style="width:${Math.round(self.actionProgress * 100)}%"></div></div>`;
      } else {
        const parts: string[] = [];
        if (self.prompt !== Prompt.None) parts.push(this.promptText(self.prompt, self.promptTarget));
        if (self.prompt2 !== Prompt.None) parts.push(`<span class="key">Space</span>${esc(PROMPT_LABELS[self.prompt2].replace(/^(Press E to |Hold E to |Space to )/, ''))}`);
        prompt = parts.join('&nbsp;&nbsp;&nbsp;');
      }
    }

    const html = obj + '|' + rosterHtml + '|' + status + '|' + abilities + '|' + prompt;
    if (html === this.last) return;
    this.last = html;
    $(this.root, '#obj').innerHTML = obj;
    $(this.root, '#roster').innerHTML = rosterHtml;
    $(this.root, '#status').innerHTML = status;
    $(this.root, '#abilities').innerHTML = abilities;
    $(this.root, '#prompt').innerHTML = prompt;
  }

  private promptText(p: Prompt, target: number): string {
    const label = PROMPT_LABELS[p] ?? '';
    const m = this.client.match!;
    let text = label;
    if (p === Prompt.Loot && m.map.loot[target]) text = `Press E to take the ${m.map.loot[target].item}`;
    if ((p === Prompt.Heal || p === Prompt.Revive || p === Prompt.Unstake || p === Prompt.PickUp) && m.players.get(target)) {
      text = `${label} ${m.players.get(target)!.name}`;
    }
    const key = /^(Press|Hold) E/.test(text) ? '<span class="key">E</span>' : '';
    return `${key}${esc(text.replace(/^(Press E to |Hold E to )/, (s) => (s.startsWith('Hold') ? 'hold to ' : '')))}`;
  }

  destroy(): void {
    clearTimeout(this.centerTimer);
    this.root.remove();
  }
}

/** Skill check: a needle sweeps a circle; press Space inside the zone. */
export class SkillCheck {
  private readonly canvas: HTMLCanvasElement;
  private active: { id: number; start: number; needleMs: number; zone: number; size: number; great: number } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onResult: (id: number, result: 'miss' | 'good' | 'great') => void,
  ) {
    this.canvas = el('canvas', 'skillcheck');
    this.canvas.width = 150;
    this.canvas.height = 150;
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
    const c = 75;
    const r = 52;
    ctx.clearRect(0, 0, 150, 150);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(200,190,160,0.35)';
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
    const ang = (f: number): number => -Math.PI / 2 + f * Math.PI * 2;
    ctx.strokeStyle = 'rgba(230,220,190,0.9)';
    ctx.beginPath();
    ctx.arc(c, c, r, ang(a.zone), ang(a.zone + a.size));
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(c, c, r, ang(a.zone), ang(a.zone + a.great));
    ctx.stroke();
    ctx.fillStyle = 'rgba(230,220,190,0.8)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SPACE', c, c + 4);
    if (t >= 0) {
      ctx.strokeStyle = '#d23a2e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(ang(t)) * (r + 8), c + Math.sin(ang(t)) * (r + 8));
      ctx.stroke();
    }
  }

  destroy(): void {
    this.canvas.remove();
  }
}
