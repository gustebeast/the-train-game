import { Unit } from 'w3ts';
import { SaveSlotInfo, listSaves } from './save';
import { getNeutralPassive } from './teams';
import { decodeHero, spawnHeroFromData } from './heroes';
import { spawnMercFromData } from './mercenary';
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

/** Show whatever is currently selected: the save's party -- its heroes and any
 *  living mercenaries -- standing in a row. */
function refresh(): void {
  clearDisplay();
  if (offered.length === 0) {
    setLabel('No save selected');
    return;
  }
  const info = offered[selected];
  // No text: a save is recognised by the faces in it. The party IS the label,
  // so the heroes and the mercs standing with them are the whole display.
  const partySize = info.heroRecords.length + info.mercs.length;
  if (partySize === 0) {
    setLabel('Empty save');
    return;
  }
  // Display only: neutral passive, invulnerable and paused, so the chooser
  // cannot be played with and nobody wanders off their mark.
  const startX = originX - ((partySize - 1) * TRACK_SIZE) / 2;
  const stand = (u: Unit | null | undefined): void => {
    if (u == null) return;
    u.invulnerable = true;
    PauseUnit(u.handle, true);
    display.push(u);
  };

  // The heroes go up through the ordinary hero spawner, so the save shows the
  // party you would actually resume: its levels, skills, items and tomes. Built
  // from the save's own records rather than the live roster -- looking at a save
  // must not load it.
  let slot = 0;
  for (const record of info.heroRecords) {
    stand(spawnHeroFromData(decodeHero(record), getNeutralPassive(),
      startX + slot * TRACK_SIZE, originY));
    slot += 1;
  }
  // And the mercenaries through the ordinary mercenary spawner, for the same
  // reason: a save shows the party you would resume, kit included.
  for (const merc of info.mercs) {
    stand(spawnMercFromData(merc, getNeutralPassive(), startX + slot * TRACK_SIZE, originY));
    slot += 1;
  }
}

/** How many saves the chooser is currently offering. Paging through one save,
 *  or none, has nothing to page to. */
export function offeredSaveCount(): number {
  return offered.length;
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
