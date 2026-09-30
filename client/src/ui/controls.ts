export const SURVIVOR_CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Aim your flashlight'],
  ['Shift', 'Sprint (8 s meter, refills in 10 s; wait 1.5 s after it runs dry)'],
  ['C / Ctrl', 'Crouch (slow and quiet)'],
  ['E', 'Interact: start generators, pick up, heal, revive, unstake, hide, doors, talk to Sexton'],
  ['Left mouse', 'Use the selected item (hold it for night vision goggles)'],
  ['Mouse wheel / 1-5 / click a slot', 'Select an inventory slot'],
  ['Tab', 'Rearrange your inventory (drag and drop)'],
  ['Q', "JARVIS (after Sexton Science hands you his tablet): reveals the map and shows Zach for 10 s"],
  ['Space', 'Slam a barricade down · skill checks · hold breath while hidden'],
  ['E while hidden', 'Leave (press again to stay)'],
  ['Move keys while carried', 'Struggle free'],
  ['M', 'Full map (only what you have seen)'],
];

export const HUNTER_CONTROLS: [string, string][] = [
  ['W A S D', 'Move (you walk a little slower than survivors)'],
  ['Shift', 'Sprint (6 s meter, 20% faster than survivors)'],
  ['Mouse', 'Look'],
  ['Left mouse', 'Machete swipe: hold to charge a heavy swipe (reaches farther, counts as two hits). Two swipes smash a door or barricade'],
  ['Right mouse', 'Lunge: a quick dash; 2 charges, 7 s each; touching a survivor hits them'],
  ['F', 'Soundcloud Burst: aim a wave of sound across the whole map, through every wall; it jump-scares every survivor it passes (12 s)'],
  ['Q', 'Hemp Battery (slay Sexton Science to get one): wider view and light through walls for 8 s'],
  ['E', 'Pick up · stake · search a hiding spot (instant) · damage a generator · open or close doors'],
  ['M', 'Full map (you know the whole map and every stake)'],
];

export const GENERAL_CONTROLS: [string, string][] = [
  ['Esc', 'Settings and controls (the game keeps running)'],
  ['T', 'Testing mode only: switch between Zach and survivor'],
  ['M then click', 'Testing mode only: teleport to that spot on the map'],
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
<p class="note">Survivors: start <b>every generator</b> on the map (hold E, and hit the skill checks with Space).
Then the exit gate on the far side of the warehouse gets power: hold it open for 20 seconds and escape through the yard.
Your team wins if enough of you escape. Pick up items on the way (2 of each at most): bottles and shotguns stun Zach,
galaxy gas traps slow him, night vision goggles (hold) see through walls, energy drinks keep you sprinting, and duck confit
revives a teammate instantly.</p>
<p class="note">Zach Branch can't be killed, only stunned, and after each stun he is briefly immune. He hits you from
healthy to wounded to downed, carries you to a scarecrow stake, and a second staking eliminates you. He always smells
anyone sprinting or bleeding (a red trail), and he knows the whole map.</p>
<p class="note">Sexton Science wanders the woods playing his tunes. Talk to him for a tablet (JARVIS). Zach can slay him
for a Hemp Battery.</p>
`;
