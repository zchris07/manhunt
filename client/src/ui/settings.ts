import { $, el, storageGet, storageSet } from './dom';
import { controlsHtml } from './controls';

export interface Volumes {
  master: number;
  sfx: number;
  ambience: number;
}

const KEY = 'manhunt.volumes';

export function loadVolumes(): Volumes {
  try {
    const v = JSON.parse(storageGet(KEY) ?? 'null') as Volumes | null;
    if (v && typeof v.master === 'number') return v;
  } catch {
    // Defaults below.
  }
  return { master: 0.8, sfx: 0.9, ambience: 0.7 };
}

export interface SettingsHandlers {
  role: 'hunter' | 'survivor' | 'both';
  isOwner: boolean;
  isHost: boolean;
  onVolumes(v: Volumes): void;
  onLeave(): void;
  onEndMatch(): void;
  onDownloadLog(): void;
  onClose(): void;
}

/** Pause-free settings: the match keeps running behind it. */
export function openSettings(parent: HTMLElement, h: SettingsHandlers): HTMLElement {
  const v = loadVolumes();
  const slider = (id: keyof Volumes, label: string): string =>
    `<div class="field"><label>${label}</label><input type="range" id="${id}" min="0" max="1" step="0.05" value="${v[id]}"></div>`;
  const m = el(
    'div',
    'modal',
    `<div class="panel" style="width:min(640px,100%)">
      <h2 style="margin-top:0">Settings <span class="note">(the game keeps running)</span></h2>
      ${slider('master', 'Master volume')}
      ${slider('sfx', 'Effects')}
      ${slider('ambience', 'Ambience')}
      ${controlsHtml(h.role)}
      <div class="row" style="margin-top:16px;justify-content:space-between">
        <button id="leave">Leave match</button>
        ${h.isHost ? '<button class="linklike" id="log">Download match log</button>' : ''}
        ${h.isOwner ? '<button id="end">End match for everyone</button>' : ''}
        <button class="primary" id="close">Back (Esc)</button>
      </div>
    </div>`,
  );
  parent.appendChild(m);
  (['master', 'sfx', 'ambience'] as const).forEach((id) =>
    $(m, `#${id}`).addEventListener('input', (e) => {
      v[id] = Number((e.target as HTMLInputElement).value);
      storageSet(KEY, JSON.stringify(v));
      h.onVolumes(v);
    }),
  );
  const close = (): void => {
    m.remove();
    h.onClose();
  };
  $(m, '#close').addEventListener('click', close);
  $(m, '#leave').addEventListener('click', h.onLeave);
  if (h.isOwner) $(m, '#end').addEventListener('click', h.onEndMatch);
  if (h.isHost) $(m, '#log').addEventListener('click', h.onDownloadLog);
  m.addEventListener('click', (e) => e.target === m && close());
  return m;
}
