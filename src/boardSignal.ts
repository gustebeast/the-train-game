/**
 * "Something the challenge board shows has changed."
 *
 * The board used to redraw on a half-second timer, on the theory that progress
 * is bumped by several unrelated systems and polling one place was safer than
 * making each remember to redraw. But every one of those systems already
 * reports its change through a single function -- armChallenge, noteDash,
 * applyTrackShapes, noteChoppedTree and the rest -- so the redraw belongs there,
 * once, and the timer can go.
 *
 * A module of its own, with no imports, so challenges.ts and the counters can
 * announce a change without importing the UI that draws it (which imports
 * them: a cycle).
 */

const listeners: Array<(this: void) => void> = [];

/** Run cb whenever the board's contents change. The board's redraw is the
 *  one listener today. */
export function onBoardChanged(cb: (this: void) => void): void {
  listeners.push(cb);
}

/** Call wherever anything the board displays has just changed. */
export function boardChanged(): void {
  for (const cb of listeners) cb();
}
