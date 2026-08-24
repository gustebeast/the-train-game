import { Timer } from 'w3ts';
import { getArmedChallenge, ChallengeDef, CHALLENGE_COST } from './challenges';

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
let lastName = '';
let lastProgress = '';

/** Take the board off screen WITHOUT destroying it.
 *
 *  Destroying it and building a fresh one each time a challenge is armed is
 *  what produced three separate faults, all of them versions of "a new board
 *  has no memory":
 *
 *  - it came back at the engine's default collapsed/expanded state rather than
 *    the one the player had chosen;
 *  - it came back too narrow, because a board is sized from its contents the
 *    first time it is shown, and it had none yet;
 *  - collapsing and re-expanding fixed the width, which is the giveaway -- that
 *    forces the engine to lay the board out again, this time with rows in it.
 *
 *  One board for the whole session, hidden and shown, has none of those: it is
 *  laid out once with real content, and it remembers being collapsed. */
function hideBoard(): void {
  if (board != null) MultiboardDisplay(board, false);
  lastTitle = '';
  lastName = '';
  lastProgress = '';
}

/** Roughly how much screen width one character of multiboard text takes.
 *  Measured off a capture rather than derived: "Critterpocalypse" -- 16
 *  characters -- came out about 240px across a 1656px frame. */
const CHAR_WIDTH = 0.0092;
/** Never narrower than this, so a short label still looks like a panel. */
const MIN_WIDTH = 0.14;

/** Printed length of a line: colour codes take no screen space.
 *
 *  A tutorial row like "Chopped a tree 2 / 4" is 20 characters on screen but 32
 *  in the string, because the "|cff44ff44"/"|r" wrapper the board colours it
 *  with counts too. Sizing off the raw length made the panel half again as wide
 *  as it needed to be. */
function visibleLen(text: string): number {
  const [stripped] = string.gsub(string.gsub(text, '|c%x%x%x%x%x%x%x%x', '')[0], '|r', '');
  return string.len(stripped);
}

function setRow(row: number, label: string, width: number): void {
  if (board == null) return;
  const item = MultiboardGetItem(board, row, 0);
  if (item == null) return;
  MultiboardSetItemStyle(item, true, false);
  MultiboardSetItemValue(item, label);
  MultiboardSetItemWidth(item, width);
  MultiboardReleaseItem(item);
}

/** Width that fits the longest line the board is about to show.
 *
 *  A fixed width was fine while every progress line was a bare "7 / 15", but
 *  the lines now name what they are counting ("Straight in a row 7 / 15"), and
 *  a column too narrow for its text does not wrap -- it spills out of the
 *  panel. Sized to the content instead, both rows together so they stay a
 *  rectangle. */
function widthFor(name: string, progress: string): number {
  let longest = visibleLen(name);
  const p = visibleLen(progress);
  if (p > longest) longest = p;
  const wanted = longest * CHAR_WIDTH;
  return wanted > MIN_WIDTH ? wanted : MIN_WIDTH;
}

/** A challenge being previewed rather than played: the dealer's current offer,
 *  shown while a player has him selected. */
let preview: ChallengeDef | null = null;

/** Put the dealer's offer in the corner. Cleared by clearChallengePreview.
 *
 *  Reuses the overlay rather than adding a second panel, so the thing that
 *  describes a challenge is in the same place whether you are considering it or
 *  running it -- and the row that will track your progress is already visible,
 *  showing the goal it is going to count toward.
 *
 *  Caveat worth knowing: a multiboard belongs to the game, not to a player, so
 *  one player inspecting the dealer puts the preview on everybody's screen.
 *  There is no per-player multiboard to switch to. */
export function showChallengePreview(def: ChallengeDef): void {
  preview = def;
  draw();
}

export function clearChallengePreview(): void {
  if (preview == null) return;
  preview = null;
  draw();
}

/** A board owned by something that is not a challenge -- currently the
 *  tutorial. Takes precedence over both the armed challenge and the preview,
 *  because during the tutorial neither exists.
 *
 *  Reuses this board rather than making a second multiboard: the sizing and
 *  collapse-memory lessons above were expensive to learn once. */
let panel: { title: string; lines: () => string[] } | null = null;

export function showPanel(title: string, lines: () => string[]): void {
  panel = { title, lines };
  draw();
}

export function hidePanel(): void {
  if (panel == null) return;
  panel = null;
  hideBoard();
}

function drawPanel(): void {
  if (panel == null) return;
  const lines = panel.lines();
  const joined = table.concat(lines, ' | ');
  if (board != null && panel.title === lastTitle && joined === lastProgress) return;

  let created = false;
  if (board == null) {
    const made = CreateMultiboard();
    if (made == null) return;
    board = made;
    created = true;
    MultiboardSetColumnCount(board, 1);
  }
  const b = board;
  MultiboardSetRowCount(b, lines.length);
  MultiboardSetTitleText(b, panel.title);
  let longest = visibleLen(panel.title);
  for (const text of lines) {
    const len = visibleLen(text);
    if (len > longest) longest = len;
  }
  const wanted = longest * CHAR_WIDTH;
  const width = wanted > MIN_WIDTH ? wanted : MIN_WIDTH;
  for (let i = 0; i < lines.length; i++) setRow(i, lines[i], width);
  MultiboardDisplay(b, true);
  if (created) MultiboardMinimize(b, false);
  lastTitle = panel.title;
  lastName = '';
  lastProgress = joined;
}

function draw(): void {
  if (panel != null) { drawPanel(); return; }
  // An armed challenge outranks a preview: what you are actually playing
  // matters more than what is on the shelf. In practice they never collide --
  // the dealer only exists in the inter-round lobby, where nothing is armed.
  const armed = getArmedChallenge();
  const def = armed != null ? armed : preview;
  if (def == null) {
    // Nothing armed and nothing being inspected: nothing on screen, rather
    // than an empty board taking up the corner.
    hideBoard();
    return;
  }
  const previewing = armed == null;
  const title = previewing ? 'Shady Deal - ' + I2S(CHALLENGE_COST) + ' gold' : 'Challenge';

  const progress = def.progress != null ? def.progress() : '';
  if (board != null && title === lastTitle && def.name === lastName
      && progress === lastProgress) return;

  const rows = progress !== '' ? 2 : 1;
  let created = false;
  if (board == null) {
    const made = CreateMultiboard();
    if (made == null) return;
    board = made;
    created = true;
    MultiboardSetColumnCount(board, 1);
  }
  const b = board;
  MultiboardSetRowCount(b, rows);
  MultiboardSetTitleText(b, title);
  const width = widthFor(def.name, progress);
  setRow(0, '|cffffcc00' + def.name + '|r', width);
  if (progress !== '') setRow(1, progress, width);

  // Show it only after the rows exist. Displaying an empty board and filling it
  // afterwards sizes the corner from the board as it was AT THAT MOMENT, giving
  // a row too narrow for its own name -- see hideBoard.
  //
  // Start expanded, but only ever on the very first build: after that the
  // player owns the collapsed state, and re-asserting it here would spring the
  // board back open every time a challenge was bought.
  MultiboardDisplay(b, true);
  if (created) MultiboardMinimize(b, false);

  lastTitle = title;
  lastName = def.name;
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

/** Take the overlay off screen -- used when leaving gameplay, so the inter-round lobby and
 *  the defeat screen are not left with a stale challenge in the corner.
 *
 *  Hides rather than destroys, so a player who collapsed it finds it still
 *  collapsed next round. */
export function hideChallengeUI(): void {
  hideBoard();
}
