import { NAME_RE, sanitizeName } from '@manhunt/shared';
import { $, el, esc } from './dom';
import { HOW_TO_PLAY, controlsHtml } from './controls';

export interface LandingOptions {
  name: string;
  room: string;
  error: string;
  busy: string;
  hasLog: boolean;
}

export interface LandingHandlers {
  onCreate(name: string): void;
  onJoin(name: string, roomInput: string): void;
  onDownloadLog(): void;
}

export function renderLanding(root: HTMLElement, o: LandingOptions, h: LandingHandlers): void {
  root.innerHTML = '';
  const screen = el(
    'div',
    'screen',
    `
    <div class="panel" id="landing">
      <h1 class="title">MANHUNT</h1>
      <div class="subtitle">Crystal Lake · Night shoot</div>
      <p class="tagline">Zach Branch plays the masked killer on the new <i>Crystal Lake</i> series.<br>
      Tonight he stopped acting. Repair the generators, power the gate, get out of the woods.</p>
      <div class="field">
        <label for="name">Your name</label>
        <input type="text" id="name" maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="2-16 characters" value="${esc(o.name)}">
      </div>
      <div class="field">
        <button class="primary" id="create" style="width:100%">Create lobby</button>
      </div>
      <div class="field">
        <label for="room">Join a friend</label>
        <div class="row">
          <input type="text" id="room" maxlength="200" autocomplete="off" spellcheck="false" placeholder="Room code or invite link" value="${esc(o.room)}">
          <button id="join">Join</button>
        </div>
      </div>
      <div class="error" id="err">${esc(o.busy || o.error)}</div>
      <p class="note">No account needed. The player who creates the lobby hosts the game in their browser;
      everyone else connects to them directly. Hosts: keep your tab in the foreground.</p>
      <div class="links">
        <button class="linklike" id="howto">How to play</button>
        <a href="sandbox/">Vision sandbox</a>
        ${o.hasLog ? '<button class="linklike" id="log">Download match log</button>' : ''}
      </div>
    </div>`,
  );
  root.appendChild(screen);
  const nameInput = $(screen, '#name') as HTMLInputElement;
  const roomInput = $(screen, '#room') as HTMLInputElement;
  const err = $(screen, '#err');
  const busy = !!o.busy;
  ($(screen, '#create') as HTMLButtonElement).disabled = busy;
  ($(screen, '#join') as HTMLButtonElement).disabled = busy;

  const validName = (): string | null => {
    const n = sanitizeName(nameInput.value);
    if (!NAME_RE.test(n) || n.length < 2) {
      err.textContent = 'Pick a name: 2-16 letters or numbers.';
      nameInput.focus();
      return null;
    }
    return n;
  };
  $(screen, '#create').addEventListener('click', () => {
    const n = validName();
    if (n) h.onCreate(n);
  });
  const join = (): void => {
    const n = validName();
    if (n) h.onJoin(n, roomInput.value);
  };
  $(screen, '#join').addEventListener('click', join);
  roomInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());
  nameInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (roomInput.value.trim()) join();
    else {
      const n = validName();
      if (n) h.onCreate(n);
    }
  });
  $(screen, '#howto').addEventListener('click', () => showModal(root, `<h2>How to play</h2>${HOW_TO_PLAY}${controlsHtml('both')}`));
  if (o.hasLog) $(screen, '#log').addEventListener('click', h.onDownloadLog);
  (o.room && !o.name ? nameInput : o.room ? roomInput : nameInput).focus();
  if (o.room && o.name) ($(screen, '#join') as HTMLButtonElement).focus();
}

export function showModal(root: HTMLElement, html: string, onClose?: () => void): HTMLElement {
  const m = el('div', 'modal', `<div class="panel">${html}<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="close">Close</button></div></div>`);
  const close = (): void => {
    m.remove();
    onClose?.();
  };
  m.querySelector('.close')!.addEventListener('click', close);
  m.addEventListener('click', (e) => e.target === m && close());
  root.appendChild(m);
  return m;
}

export function renderMessage(root: HTMLElement, title: string, text: string, button?: { label: string; onClick(): void }): void {
  root.innerHTML = '';
  const s = el(
    'div',
    'screen',
    `<div class="panel" style="text-align:center">
      <h2 class="banner" style="font-size:32px">${esc(title)}</h2>
      <p class="note">${esc(text)}</p>
      ${button ? `<button class="primary" id="msgbtn">${esc(button.label)}</button>` : ''}
    </div>`,
  );
  root.appendChild(s);
  if (button) $(s, '#msgbtn').addEventListener('click', button.onClick);
}
