import { Timer } from 'w3ts';
import { getArmedChallenge } from './challenges';

/**
 * The armed challenge's overlay.
 *
 * A multiboard rather than a custom frame: it already sits in the top-right,
 * already has a collapse button the player can click, and survives the round
 * transitions that tear down and rebuild the world. Building the same thing out
 * of BlzFrames would mean re-implementing placement and collapsing for no gain.
 *
 * Refreshed on a slow timer instead of at every event. Progress comes from
 * counters that several unrelated systems bump, so polling one place is far
 * less error-prone than making each of them remember to redraw, and a challenge
 * counter does not need to be frame-accurate.
 */

const REFRESH_SECONDS = 0.5;

let board: multiboard | null = null;
let refresh: Timer | null = null;
/** Last text drawn, so an unchanged board is left alone. */
let lastTitle = '';
let lastProgress = '';

function destroyBoard(): void {
  if (board != null) {
    DestroyMultiboard(board);
    board = null;
  }
  lastTitle = '';
  lastProgress = '';
}

function setRow(row: number, label: string): void {
  if (board == null) return;
  const item = MultiboardGetItem(board, row, 0);
  if (item == null) return;
  MultiboardSetItemStyle(item, true, false);
  MultiboardSetItemValue(item, label);
  MultiboardSetItemWidth(item, 0.14);
  MultiboardReleaseItem(item);
}

function draw(): void {
  const def = getArmedChallenge();
  if (def == null) {
    // Nothing armed: no board at all, rather than an empty one taking up the
    // corner for the whole round.
    destroyBoard();
    return;
  }

  const progress = def.progress != null ? def.progress() : '';
  if (board != null && def.name === lastTitle && progress === lastProgress) return;

  const rows = progress !== '' ? 2 : 1;
  if (board == null) {
    const created = CreateMultiboard();
    if (created == null) return;
    board = created;
    MultiboardSetColumnCount(board, 1);
    MultiboardDisplay(board, true);
  }
  const b = board;
  MultiboardSetRowCount(b, rows);
  MultiboardSetTitleText(b, 'Challenge');
  setRow(0, '|cffffcc00' + def.name + '|r');
  if (progress !== '') setRow(1, progress);

  lastTitle = def.name;
  lastProgress = progress;
}

/** Start the overlay. Idempotent, so round transitions can call it freely. */
export function initChallengeUI(): void {
  if (refresh == null) {
    refresh = Timer.create();
    refresh.start(REFRESH_SECONDS, true, () => draw());
  }
  draw();
}

/** Tear the overlay down — used when leaving gameplay, so the lobby and the
 *  defeat screen are not left with a stale challenge in the corner. */
export function hideChallengeUI(): void {
  destroyBoard();
}
