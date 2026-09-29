export const SURVIVOR_CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Aim your flashlight'],
  ['Shift', 'Run (loud)'],
  ['C / Ctrl', 'Crouch (quiet, slow)'],
  ['E', 'Interact: loot, repair, heal, revive, unstake, hide, open gate'],
  ['Space', 'Vault a window or barricade · slam a barricade down · skill checks · hold breath while hidden'],
  ['F (hold)', 'Flashlight flash: hold the beam on Zach ~2 s to blind him (uses a battery)'],
  ['Right mouse / G', 'Use item: light a flare or throw a bottle at the cursor'],
  ['E while hidden', 'Leave (press again to stay) · burst out if Zach is searching your spot'],
  ['Move keys while carried', 'Struggle free'],
];

export const HUNTER_CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Left mouse', 'Attack'],
  ['Right mouse / Shift', 'Lunge'],
  ['Q', "Stalker's Pulse: reveal recent survivor noise"],
  ['R', 'Bloodhound: see footprints and blood trails'],
  ['F', 'Vault Smash: crash through a window or barricade'],
  ['E', 'Pick up · stake · search hiding spot · damage generator'],
  ['Space', 'Vault a window · break a barricade'],
];

export const GENERAL_CONTROLS: [string, string][] = [
  ['Esc', 'Settings and controls (the game keeps running)'],
  ['Click / ← →', 'Switch who you spectate'],
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
<p class="note">Survivors: scavenge <b>fuel</b> and <b>wire</b> in the woods and the warehouse, install them in
generators and repair them. Once enough generators run, the exit gate on the far side of the warehouse gets power.
Hold it open for 20 seconds, then escape through the yard. Your team wins if enough of you escape.</p>
<p class="note">Zach Branch can't be killed, only stunned and blinded, and he gets a few seconds of immunity after each
stun. He hits you from healthy to wounded to downed, carries you to a scarecrow stake, and a second staking
eliminates you. Teammates can revive you and cut you down.</p>
`;
