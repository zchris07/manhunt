import { resolveBalance, type AssignedRole, type LobbySettings, type RolePref } from '@manhunt/shared';
import type { GameClient, LobbyView } from '../net/GameClient';
import { inviteLink } from '../net/config';
import { readMatchLog } from '../net/matchLog';
import { summarize } from '@manhunt/host';
import { $, el, esc } from './dom';

/** One-line summary of the host's stored match log (telemetry). */
function logSummary(): string {
  const s = summarize(readMatchLog());
  if (!s.matches) return 'No matches logged yet.';
  return `${s.matches} match${s.matches === 1 ? '' : 'es'} logged · Zach won ${Math.round(s.hunterWinRate * 100)}% ·`;
}

export interface LobbyHandlers {
  onLeave(): void;
  onDownloadLog(): void;
}

function rolePreview(v: LobbyView): { h: number; s: number; spec: number } {
  const present = v.players.filter((p) => p.connected);
  const n = present.length;
  const forcedH = present.filter((p) => p.assigned === 'hunter').length;
  const forcedS = present.filter((p) => p.assigned === 'survivor').length;
  const forcedSpec = present.filter((p) => p.assigned === 'spectator').length;
  const free = n - forcedH - forcedS - forcedSpec;
  const wantH = Math.max(0, Math.min(v.settings.hunters, n - 1) - forcedH);
  const h = forcedH + Math.min(free, wantH);
  const s = forcedS + Math.max(0, Math.min(free - Math.min(free, wantH), v.settings.survivors - forcedS));
  return { h, s, spec: n - h - s };
}

/** Lobby screen: player list, role toggles, owner settings, ready-check and chat. */
export class LobbyScreen {
  readonly root: HTMLElement;
  private readonly off: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    private readonly client: GameClient,
    private readonly isHost: boolean,
    h: LobbyHandlers,
  ) {
    this.root = el(
      'div',
      'screen',
      `
      <div class="lobby">
        <div class="panel" style="width:auto">
          <div class="row" style="justify-content:space-between">
            <div>
              <div class="field" style="margin:0"><label>Room code</label></div>
              <div class="room-code" id="code">${esc(client.room)}</div>
            </div>
            <div style="text-align:right">
              <button id="copy">Copy invite link</button>
              <div class="note" id="copied" style="height:1.2em"></div>
            </div>
          </div>
          <div class="note" style="word-break:break-all" id="link">${esc(inviteLink(client.room))}</div>
          <ul class="players" id="players"></ul>
          <div class="field">
            <label>I want to play</label>
            <div class="row" id="prefs">
              <button data-pref="survivor">Survivor</button>
              <button data-pref="hunter">Zach (hunter)</button>
              <button data-pref="any">Either</button>
              <span style="flex:1"></span>
              <button id="ready">Ready</button>
            </div>
          </div>
          ${this.isHost ? '<div class="warning">You are hosting. The game runs in this tab: keep it in the foreground and don\'t close it until the night is over.</div>' : ''}
          <div class="error" id="err"></div>
          <div class="row" style="justify-content:space-between;margin-top:6px">
            <button id="leave">Leave</button>
            ${this.isHost ? `<span class="note">${logSummary()} <button class="linklike" id="log">Download match log</button></span>` : ''}
          </div>
        </div>
        <div class="panel" style="width:auto">
          <div id="settings"></div>
          <div class="field">
            <label>Chat</label>
            <div class="chat" id="chat"></div>
            <input type="text" id="chatin" maxlength="140" placeholder="Say something..." style="width:100%">
          </div>
        </div>
      </div>`,
    );
    parent.appendChild(this.root);

    $(this.root, '#copy').addEventListener('click', () => {
      void navigator.clipboard?.writeText(inviteLink(client.room)).then(
        () => ($(this.root, '#copied').textContent = 'Copied'),
        () => ($(this.root, '#copied').textContent = 'Copy failed: select the link below'),
      );
    });
    this.root.querySelectorAll<HTMLButtonElement>('#prefs [data-pref]').forEach((b) =>
      b.addEventListener('click', () => client.send({ t: 'rolePref', pref: b.dataset.pref as RolePref })),
    );
    $(this.root, '#ready').addEventListener('click', () => {
      const me = client.lobby?.players.find((p) => p.id === client.you);
      client.send({ t: 'ready', ready: !me?.ready });
    });
    $(this.root, '#leave').addEventListener('click', h.onLeave);
    if (this.isHost) $(this.root, '#log').addEventListener('click', h.onDownloadLog);
    const chatIn = $(this.root, '#chatin') as HTMLInputElement;
    chatIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chatIn.value.trim()) {
        client.send({ t: 'chat', text: chatIn.value });
        chatIn.value = '';
      }
    });
    this.off.push(client.on('lobby', () => this.update()));
    this.off.push(
      client.on('chat', (m) => {
        const { from, text } = m as { from: string; text: string };
        const chat = $(this.root, '#chat');
        chat.insertAdjacentHTML('beforeend', `<div><b>${esc(from)}:</b> ${esc(text)}</div>`);
        chat.scrollTop = chat.scrollHeight;
      }),
    );
    this.off.push(client.on('error', (msg) => ($(this.root, '#err').textContent = String(msg))));
    this.update();
  }

  private sendSettings(patch: Partial<LobbySettings>): void {
    const s = this.client.lobby!.settings;
    this.client.send({ t: 'settings', settings: { ...s, ...patch } });
  }

  update(): void {
    const v = this.client.lobby;
    if (!v) return;
    const owner = this.client.isOwner;
    const me = v.players.find((p) => p.id === this.client.you);

    $(this.root, '#players').innerHTML = v.players
      .map((p) => {
        const roleBadge =
          p.assigned === 'auto'
            ? `<span class="badge ${p.pref === 'any' ? '' : p.pref}">wants ${p.pref === 'any' ? 'either' : p.pref === 'hunter' ? 'Zach' : 'survivor'}</span>`
            : `<span class="badge ${p.assigned}">${p.assigned === 'hunter' ? 'Zach' : p.assigned}</span>`;
        const assign = owner
          ? `<select data-assign="${p.id}">${(['auto', 'hunter', 'survivor', 'spectator'] as AssignedRole[])
              .map((r) => `<option value="${r}" ${r === p.assigned ? 'selected' : ''}>${r === 'auto' ? 'auto role' : r === 'hunter' ? 'Zach' : r}</option>`)
              .join('')}</select>`
          : roleBadge;
        return `<li class="${p.id === this.client.you ? 'me' : ''} ${p.connected ? '' : 'offline'}">
          <span>${p.owner ? '♛ ' : ''}${esc(p.name)}${p.id === this.client.you ? ' <span class="note">(you)</span>' : ''}${p.owner ? ' <span class="note">host</span>' : ''}</span>
          ${assign}
          <span class="badge ${p.ready ? 'ready' : ''}">${p.connected ? (p.ready ? 'ready' : 'not ready') : 'offline'}</span>
          <span class="note">${p.owner ? '' : `${p.ping} ms`}</span>
        </li>`;
      })
      .join('');
    this.root.querySelectorAll<HTMLSelectElement>('[data-assign]').forEach((sel) =>
      sel.addEventListener('change', () => this.client.send({ t: 'assign', player: Number(sel.dataset.assign), role: sel.value as AssignedRole })),
    );
    this.root.querySelectorAll<HTMLButtonElement>('#prefs [data-pref]').forEach((b) => b.classList.toggle('active', me?.pref === b.dataset.pref));
    const readyBtn = $(this.root, '#ready') as HTMLButtonElement;
    readyBtn.style.display = owner ? 'none' : '';
    readyBtn.classList.toggle('active', !!me?.ready);
    readyBtn.textContent = me?.ready ? 'Ready ✓' : 'Ready';

    const s = v.settings;
    const pv = rolePreview(v);
    const allReady = v.players.filter((p) => p.connected).every((p) => p.ready);
    const canStart = owner && allReady && (s.testMode || (pv.h >= 1 && pv.s >= 1));
    const rb = resolveBalance({ hunters: Math.max(1, pv.h), survivors: Math.max(1, pv.s), difficulty: s.difficulty, escapeFraction: s.escapeFraction });
    const settings = $(this.root, '#settings');
    const focused = document.activeElement?.id;
    const seedValue = focused === 'seed' ? (document.getElementById('seed') as HTMLInputElement).value : s.seed;
    settings.innerHTML = `
      <div class="field"><label>Match settings ${owner ? '' : '<span class="note">(set by the host)</span>'}</label></div>
      <div class="row" style="justify-content:space-between">
        <span>Hunters (Zach)</span>
        <span class="stepper"><button data-step="hunters" data-d="-1" ${owner ? '' : 'disabled'}>−</button><span>${s.hunters}</span><button data-step="hunters" data-d="1" ${owner ? '' : 'disabled'}>+</button></span>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:6px">
        <span>Max survivors</span>
        <span class="stepper"><button data-step="survivors" data-d="-1" ${owner ? '' : 'disabled'}>−</button><span>${s.survivors}</span><button data-step="survivors" data-d="1" ${owner ? '' : 'disabled'}>+</button></span>
      </div>
      <div class="field"><label>Map seed (blank = random)</label>
        <input type="text" id="seed" maxlength="32" value="${esc(seedValue)}" ${owner ? '' : 'disabled'} style="width:100%"></div>
      <div class="field"><label>Difficulty for survivors: ${s.difficulty.toFixed(2)}×</label>
        <input type="range" id="diff" min="0.5" max="1.5" step="0.05" value="${s.difficulty}" ${owner ? '' : 'disabled'}></div>
      <div class="field"><label>Survivors needed to escape: ${Math.round(s.escapeFraction * 100)}%</label>
        <input type="range" id="esc" min="0.1" max="1" step="0.05" value="${s.escapeFraction}" ${owner ? '' : 'disabled'}></div>
      <label class="toggle"><input type="checkbox" id="testmode" ${s.testMode ? 'checked' : ''} ${owner ? '' : 'disabled'}>
        <span><b>Testing mode</b> · T switches Zach/survivor, infinite items and abilities, nobody wins</span></label>
      <div class="preview">
        Next match: <b>${pv.h}</b> Zach · <b>${pv.s}</b> survivors${pv.spec ? ` · ${pv.spec} spectating` : ''}<br>
        Auto-balance: all ${rb.requiredGenerators} generators, ${Math.round(rb.repairTime)} s each,
        Zach walk ${Math.round(rb.hunterSpeed)}, stuns ×${rb.stunMul.toFixed(2)}, ${rb.escapeNeeded} must escape.
      </div>
      ${
        owner
          ? `<div class="row" style="margin-top:12px">
              <button id="shuffle">Shuffle roles</button>
              <span style="flex:1"></span>
              <button class="primary" id="start" ${canStart ? '' : 'disabled'}>Start the night</button>
            </div>
            <div class="note" style="margin-top:6px">${allReady ? ((pv.h < 1 || pv.s < 1) && !s.testMode ? 'Need at least 1 hunter and 1 survivor.' : 'Everyone is ready.') : 'Waiting for everyone to ready up.'}</div>`
          : `<div class="note" style="margin-top:12px">Waiting for the host to start.</div>`
      }`;
    if (!owner) return;
    settings.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
      b.addEventListener('click', () => {
        const key = b.dataset.step as 'hunters' | 'survivors';
        const next = Math.max(1, Math.min(9, s[key] + Number(b.dataset.d)));
        this.sendSettings({ [key]: next });
      }),
    );
    const seed = $(settings, '#seed') as HTMLInputElement;
    seed.addEventListener('change', () => this.sendSettings({ seed: seed.value.slice(0, 32) }));
    if (focused === 'seed') {
      seed.focus();
      seed.setSelectionRange(seed.value.length, seed.value.length);
    }
    const diff = $(settings, '#diff') as HTMLInputElement;
    diff.addEventListener('change', () => this.sendSettings({ difficulty: Number(diff.value) }));
    const escIn = $(settings, '#esc') as HTMLInputElement;
    escIn.addEventListener('change', () => this.sendSettings({ escapeFraction: Number(escIn.value) }));
    const test = $(settings, '#testmode') as HTMLInputElement;
    test.addEventListener('change', () => this.sendSettings({ testMode: test.checked }));
    $(settings, '#shuffle').addEventListener('click', () => this.client.send({ t: 'shuffle' }));
    $(settings, '#start').addEventListener('click', () => this.client.send({ t: 'start' }));
  }

  destroy(): void {
    for (const f of this.off) f();
    this.root.remove();
  }
}
