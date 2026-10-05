export const SURVIVOR_CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Aim'],
  ['Shift', 'Sprint'],
  ['C / Ctrl', 'Crouch'],
  ['E', 'Interact'],
  ['Left mouse', 'Use item'],
  ['Wheel / 1-8', 'Select item'],
  ['G', 'Drop item'],
  ['Tab', 'Arrange inventory'],
  ['Q', 'JARVIS'],
  ['Space', 'Barricade · hold breath'],
  ['M', 'Map'],
];

export const HUNTER_CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Shift', 'Sprint'],
  ['Mouse', 'Look'],
  ['Left mouse', 'Machete (hold to charge)'],
  ['Right mouse', 'Lunge'],
  ['F', 'Soundcloud Burst'],
  ['Q', 'Hemp Battery (toggle)'],
  ['R', 'Hemp Beam (once you have it)'],
  ['Space', 'Penjamin (vape gas)'],
  ['E', 'Interact'],
  ['M', 'Map'],
];

export const GENERAL_CONTROLS: [string, string][] = [
  ['Esc', 'Settings'],
  ['T', 'Switch role (testing)'],
  ['Click / ← →', 'Switch spectate target'],
];

export function controlsHtml(which: 'survivor' | 'hunter' | 'both'): string {
  const table = (rows: [string, string][]): string =>
    `<div class="controls">${rows.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('')}</div>`;
  const parts: string[] = [];
  if (which !== 'hunter') parts.push(`<h3>Survivor</h3>${table(SURVIVOR_CONTROLS)}`);
  if (which !== 'survivor') parts.push(`<h3>Zach Branch (hunter)</h3>${table(HUNTER_CONTROLS)}`);
  parts.push(`<h3>Always</h3>${table(GENERAL_CONTROLS)}`);
  return parts.join('');
}

export const HOW_TO_PLAY = `
<p class="note">Survivors: start every generator, open the gate, escape.</p>
<p class="note">Zach: hunt them down.</p>
`;
