import { Unit } from 'w3ts';
import { SaveSlotInfo, listSaves } from './save';
import { getNeutralPassive } from './teams';
import { TRACK_SIZE } from './track/constants';

// The save chooser's own state: which of the offered saves is selected, and the
// display units and label standing in for it. The lobby terrain is spawned by
// terrain/load.ts; everything that changes as you page through saves lives
// here, so paging does not respawn the map.

/** Saves on offer, newest first. Defeated ones are not listed at all. */
let offered: SaveSlotInfo[] = [];
let selected = 0;

/** Hero display units for the current selection, cleared on every refresh. */
let display: Unit[] = [];
let label: texttag | null = null;

/** Where the heroes stand and the label sits, filled in when the lobby loads. */
let originX = 0;
let originY = 0;

function clearDisplay(): void {
  for (const u of display) u.destroy();
  display = [];
  if (label != null) { DestroyTextTag(label); label = null; }
}

function setLabel(text: string): void {
  if (label == null) label = CreateTextTag() ?? null;
  if (label == null) return;
  SetTextTagText(label, text, 0.028);
  SetTextTagPos(label, originX - 220, originY + TRACK_SIZE, 0);
  SetTextTagColor(label, 255, 255, 255, 255);
  SetTextTagVisibility(label, true);
  SetTextTagPermanent(label, true);
}

/** Show whatever is currently selected: the save's heroes in a row, with its
 *  highest completed round above them. */
function refresh(): void {
  clearDisplay();
  if (offered.length === 0) {
    setLabel('No save selected');
    return;
  }
  const info = offered[selected];
  setLabel('Round ' + I2S(info.round)! + '   (save ' + I2S(selected + 1)! + ' of ' + I2S(offered.length)! + ')');
  // Display only: neutral passive, invulnerable and paused, so the chooser
  // cannot be played with and the heroes cannot wander off their marks.
  const startX = originX - ((info.heroTypeIds.length - 1) * TRACK_SIZE) / 2;
  for (let i = 0; i < info.heroTypeIds.length; i++) {
    const u = Unit.create(getNeutralPassive(), info.heroTypeIds[i], startX + i * TRACK_SIZE, originY, 270);
    if (u == null) continue;
    u.invulnerable = true;
    PauseUnit(u.handle, true);
    display.push(u);
  }
}

/** Enter the chooser: read what is on disk and select the most recent save. */
export function openChooseSaveLobby(cx: number, cy: number): void {
  originX = cx;
  originY = cy;
  offered = listSaves(); // newest first, defeated hidden
  selected = 0;
  refresh();
}

/** Leaving the chooser. Drops the display so nothing survives into the next
 *  lobby or round. */
export function closeChooseSaveLobby(): void {
  clearDisplay();
  offered = [];
  selected = 0;
}

/** Step to the next NEWER save, wrapping round to the oldest. Does nothing
 *  when there is nothing to choose between. */
export function selectNewerSave(): void {
  if (offered.length === 0) return;
  selected = (selected - 1 + offered.length) % offered.length;
  refresh();
}

/** Step to the next OLDER save, wrapping round to the newest. */
export function selectOlderSave(): void {
  if (offered.length === 0) return;
  selected = (selected + 1) % offered.length;
  refresh();
}

/** The slot the player has settled on, or 0 when there is nothing to play. */
export function getSelectedSlot(): number {
  if (offered.length === 0) return 0;
  return offered[selected].slot;
}
