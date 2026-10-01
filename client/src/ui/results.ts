import type { MatchResult } from '@manhunt/shared';
import { $, el, esc } from './dom';

export interface ResultsHandlers {
  isOwner: boolean;
  isHost: boolean;
  onRematch(): void;
  onLeave(): void;
  onDownloadLog(): void;
}

const OUTCOME: Record<string, string> = { escaped: 'Escaped', eliminated: 'Sacrificed', survived: 'Survived', hunter: 'Zach' };

export function renderResults(parent: HTMLElement, r: MatchResult, h: ResultsHandlers): HTMLElement {
  const hunters = r.winner === 'hunters';
  const rows = r.stats
    .map(
      (s) => `<tr>
        <td>${esc(s.name)}</td><td>${OUTCOME[s.outcome] ?? s.outcome}</td>
        <td>${s.role === 'hunter' ? s.hits : s.repairSec}</td>
        <td>${s.role === 'hunter' ? s.downs : s.heals + s.revives}</td>
        <td>${s.role === 'hunter' ? s.stakes : s.unstakes}</td>
        <td>${s.role === 'hunter' ? s.stunnedTimes : s.stuns}</td>
        <td>${s.role === 'hunter' ? s.gensDamaged : Math.floor(s.timeAlive / 60) + 'm'}</td>
      </tr>`,
    )
    .join('');
  const screen = el(
    'div',
    'screen over-game',
    `<div class="panel" style="width:min(720px,100%)">
      <h1 class="banner ${hunters ? 'hunters' : 'survivors'}">${hunters ? 'ZACH WINS' : 'SURVIVORS ESCAPED'}</h1>
      <p class="tagline">${esc(r.reason)} · ${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, '0')} ·
        generators ${r.generatorsRepaired}/${r.generatorsRequired}</p>
      <table class="stats">
        <tr><th>Player</th><th>Result</th><th>Repair s / hits</th><th>Heals / downs</th><th>Unstakes / stakes</th><th>Stuns / stunned</th><th>Alive / gens hit</th></tr>
        ${rows}
      </table>
      <div class="row" style="margin-top:16px;justify-content:space-between">
        <button id="leave">Leave</button>
        ${h.isHost ? '<button class="linklike" id="log">Download match log</button>' : ''}
        ${h.isOwner ? '<button class="primary" id="rematch">Back to lobby</button>' : '<span class="note">Waiting for host.</span>'}
      </div>
    </div>`,
  );
  parent.appendChild(screen);
  $(screen, '#leave').addEventListener('click', h.onLeave);
  if (h.isOwner) $(screen, '#rematch').addEventListener('click', h.onRematch);
  if (h.isHost) $(screen, '#log').addEventListener('click', h.onDownloadLog);
  return screen;
}
