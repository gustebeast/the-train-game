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

/** Mark the upgrade as bought and unlock the summon ability. */
export function purchaseSummonUpgrade(): void {
  purchased = true;
  applyTech();
}

// Persist as save segment 'su': '1' when bought, omitted otherwise
registerSaveSegment('su',
  () => (purchased ? '1' : ''),
  (raw) => {
    if (raw === '1') {
      purchased = true;
      applyTech();
    }
  },
);
