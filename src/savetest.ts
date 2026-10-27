import { registerTest, TestReporter } from './testkit';
import { gameState } from './state';
import { beginNewRun } from './terrain/load';
import {
  saveToFile, listSaves, loadFromSlot, markCurrentSaveDefeated, resetToNewRun, encodeKit, decodeKit,
} from './save';

/** A save round trip, through the same reads the chooser and -load use.
 *
 *  Writes a run, reads it back as the chooser describes it, wipes the session,
 *  loads the slot and checks the state came back; then marks it defeated and
 *  checks the chooser stops offering it. Everything here is read back in the
 *  SAME session that wrote it, which is the path sessionData exists for --
 *  WC3 will not re-read a save file it has already read.
 *
 *  Expects:
 *    listed       1 -- the new save is offered
 *    listedRound  the round that was written
 *    listedHeroes the roster size beginNewRun rolled (4)
 *    loadedOk     1
 *    loadedRound / loadedGold   what was written, after a full reset
 *    hiddenWhenDefeated  1 -- a defeated save drops out of the chooser */
function runSaveTest(t: TestReporter): void {
  beginNewRun();
  gameState.round = 7;
  gameState.gold = 3;
  saveToFile();

  const listed = listSaves().filter(info => info.round === 7);
  t.expect('listed', listed.length, 1);
  if (listed.length !== 1) { t.done(); return; }
  const slot = listed[0].slot;
  t.expect('listedRound', listed[0].round, 7);
  t.expect('listedHeroes', listed[0].heroTypeIds.length, 4);

  resetToNewRun();
  t.expect('resetRound', gameState.round, 0);
  t.expect('loadedOk', loadFromSlot(slot) ? 1 : 0, 1);
  t.expect('loadedRound', gameState.round, 7);
  t.expect('loadedGold', gameState.gold, 3);

  markCurrentSaveDefeated();
  const stillListed = listSaves().some(info => info.slot === slot);
  t.expect('hiddenWhenDefeated', stillListed ? 0 : 1, 1);
  const kept = listSaves(true).some(info => info.slot === slot && info.defeated);

  // A kit keeps its charges through the save format, and an id written
  // without them (an older save) still reads.
  const kit = decodeKit(encodeKit([{ id: 1001, charges: 2 }, { id: 1002, charges: 0 }]) + ',1003');
  t.expect('kitLength', kit.length, 3);
  t.expect('kitCharges', kit[0].charges, 2);
  t.expect('kitUncharged', kit[1].charges, 0);
  t.expect('kitLegacyId', kit[2].id, 1003);
  t.expect('keptOnDisk', kept ? 1 : 0, 1);
  t.done();
}

registerTest('saves', runSaveTest);
