import { getHumanPlayers } from './util';

// The tutorial's scoreboard. Four things a new player needs to have tried, each
// counting how many of them have done it -- so a table of four learns together
// rather than one person doing everything while the rest watch.
//
// Player ids, not a tally: doing the same thing twice must not fill the bar.

const chopped = new Set<number>();
const mined = new Set<number>();
const watered = new Set<number>();
const loaded = new Set<number>();

/** True while the tutorial board should be counting. Off outside the tutorial,
 *  so nothing in a real round pays for these hooks. */
let counting = false;

export function startTutorialBoard(): void {
  chopped.clear(); mined.clear(); watered.clear(); loaded.clear();
  counting = true;
}

export function stopTutorialBoard(): void {
  counting = false;
}

export function noteChoppedTree(playerId: number): void {
  if (counting) chopped.add(playerId);
}
export function noteMinedStone(playerId: number): void {
  if (counting) mined.add(playerId);
}
export function noteWateredTrain(playerId: number): void {
  if (counting) watered.add(playerId);
}
export function noteLoadedMaterial(playerId: number): void {
  if (counting) loaded.add(playerId);
}

function line(label: string, done: Set<number>, total: number): string {
  const n = done.size;
  const colour = n >= total ? '|cff44ff44' : '|cffffffff';
  return colour + label + ' ' + I2S(n)! + ' / ' + I2S(total)! + '|r';
}

/** The board's contents, rebuilt on each redraw. */
export function tutorialBoardLines(): string[] {
  const total = getHumanPlayers().length;
  return [
    line('Chopped a tree', chopped, total),
    line('Mined a stone', mined, total),
    line('Watered the train', watered, total),
    line('Loaded the engine', loaded, total),
  ];
}
