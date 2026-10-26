import { registerSaveSegment } from './save';
import { getHumanPlayers } from './util';
import { SUMMON_TECH_ID } from './constants';

/** Whether the Summon Heroes upgrade has been bought (persisted in saves). */
let purchased = false;

export function isSummonUpgradePurchased(): boolean {
  return purchased;
}

/** Research the tech for all human players, un-graying the summon ability. */
function applyTech(): void {
  for (const p of getHumanPlayers()) {
    SetPlayerTechResearched(p.handle, SUMMON_TECH_ID, 1);
  }
}

/** Mark the upgrade as bought: unlock the summon ability. Taking it off the
 *  shelf is the shop's business (shop.ts). */
export function purchaseSummonUpgrade(): void {
  purchased = true;
  applyTech();
}

// Persist as save segment 'su': '1' when bought, omitted otherwise.
// Loading is reset-then-apply: baseline is "not purchased, tech unresearched";
// the decoder re-applies the purchase if the save has it. The shop needs no
// handling here — loading rebuilds the map, and the fresh shop is stocked
// from the (post-load) purchased flag (see stockShop in shop.ts).
registerSaveSegment('su',
  () => (purchased ? '1' : ''),
  (raw) => {
    if (raw === '1') {
      purchased = true;
      applyTech();
    }
  },
  () => {
    purchased = false;
    for (const p of getHumanPlayers()) {
      SetPlayerTechResearched(p.handle, SUMMON_TECH_ID, 0);
    }
  },
);
