import { getHumanPlayers } from './util';
import { boardChanged } from './boardSignal';

// The tutorial's scoreboard. Five things a new player needs to have tried, each
// counting how many of them have done it -- so a table of four learns together
// rather than one person doing everything while the rest watch.
//
// Player ids, not a tally: doing the same thing twice must not fill the bar.

/** One thing to try: what the board calls it, and who has done it. */
interface Lesson { label: string; done: Set<number>; }

const CHOPPED: Lesson = { label: 'Chopped a tree', done: new Set() };
const MINED: Lesson = { label: 'Mined a stone', done: new Set() };
const WATERED: Lesson = { label: 'Watered the train', done: new Set() };
const LOADED: Lesson = { label: 'Loaded the engine', done: new Set() };
const BRIDGED: Lesson = { label: 'Built a bridge', done: new Set() };

/** Every lesson, in the order the board lists them. */
const LESSONS: ReadonlyArray<Lesson> = [CHOPPED, MINED, WATERED, LOADED, BRIDGED];

/** True while the tutorial board should be counting. Off outside the tutorial,
 *  so nothing in a real round pays for these hooks. */
let counting = false;

export function startTutorialBoard(): void {
  for (const lesson of LESSONS) lesson.done.clear();
  counting = true;
  boardChanged();
}

export function stopTutorialBoard(): void {
  counting = false;
}

function note(lesson: Lesson, playerId: number): void {
  if (!counting || lesson.done.has(playerId)) return;
  lesson.done.add(playerId);
  boardChanged();
}

export function noteChoppedTree(playerId: number): void { note(CHOPPED, playerId); }
export function noteMinedStone(playerId: number): void { note(MINED, playerId); }
export function noteWateredTrain(playerId: number): void { note(WATERED, playerId); }
export function noteLoadedMaterial(playerId: number): void { note(LOADED, playerId); }
export function noteBuiltBridge(playerId: number): void { note(BRIDGED, playerId); }

/** The board's contents, rebuilt on each redraw. */
export function getTutorialBoardLines(): string[] {
  const total = getHumanPlayers().length;
  return LESSONS.map(lesson => {
    const n = lesson.done.size;
    const colour = n >= total ? '|cff44ff44' : '|cffffffff';
    return colour + lesson.label + ' ' + I2S(n)! + ' / ' + I2S(total)! + '|r';
  });
}
