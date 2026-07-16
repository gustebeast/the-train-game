/** An item drop from a creep. */
export interface ItemDrop {
  type: itemtype;
  level: number;
}

/** A creep in a camp, with optional item drops. */
export interface CreepUnit {
  id: string;
  itemDrops?: ItemDrop[];
}

/** A single creep camp composition.
 *  `level` is the WC3 ladder minimap dot classification — the SUM of the
 *  creep levels in the camp: 1-9 = green (1), 10-19 = orange (2), 20+ =
 *  red (3). Precomputed from the standard game data; if camp compositions
 *  change, recompute (sum each creep's unit level and apply the thresholds).
 *  Level 2 camps enter the random selection once the Mercenary Contract is
 *  purchased; level 3 never rolls. */
export interface CreepCamp {
  level: number;
  creeps: CreepUnit[];
}

/** Creep camp data extracted from WC3 1v1 Ladder Maps. */
export const CREEP_CAMPS: Record<string, CreepCamp[]> = {
  'Dalaran Ruins': [
    { level: 2, creeps: [{ id: 'nftr' }, { id: 'nogr' }, { id: 'nwzg', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 1, creeps: [{ id: 'nbrg' }, { id: 'nrog', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }, { id: 'nwzr' }] },
    { level: 1, creeps: [{ id: 'nkob' }, { id: 'nkog', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nkot' }] },
    { level: 2, creeps: [{ id: 'nfsh', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nftt' }, { id: 'nftt' }, { id: 'nsqt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'nftb' }, { id: 'nftb' }, { id: 'nogm', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }, { id: 'nomg' }] },
    { level: 1, creeps: [{ id: 'nmrl' }, { id: 'nmrr' }, { id: 'ntrs' }, { id: 'ntrt', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nfsh', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nftk', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }, { id: 'nftt' }, { id: 'nftt' }] },
    { level: 2, creeps: [{ id: 'nass' }, { id: 'ngst', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 4 }] }, { id: 'nogr' }, { id: 'nogr' }, { id: 'nwzr', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }] },
    { level: 3, creeps: [{ id: 'nfsh', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nftb' }, { id: 'nftb' }, { id: 'nogl', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }] }, { id: 'nomg' }] },
  ],
  'Lordaeron Summer': [
    { level: 2, creeps: [{ id: 'ntrg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }, { id: 'ntrt', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'ntrt' }] },
    { level: 1, creeps: [{ id: 'ntrh' }, { id: 'ntrh' }, { id: 'ntrt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }] },
    { level: 1, creeps: [{ id: 'nftr' }, { id: 'ngna' }, { id: 'ngnb', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }] },
    { level: 1, creeps: [{ id: 'nftt' }, { id: 'nftt' }, { id: 'nogr', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nftt' }, { id: 'nftt' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 1, creeps: [{ id: 'ngna' }, { id: 'ngna' }, { id: 'ngnb', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }] },
    { level: 2, creeps: [{ id: 'nftb' }, { id: 'nftb' }, { id: 'nogm', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }, { type: ITEM_TYPE_POWERUP, level: 1 }] }] },
    { level: 2, creeps: [{ id: 'nftb' }, { id: 'nftt' }, { id: 'nogr', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nfsh', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nftt' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }] },
    { level: 1, creeps: [{ id: 'nkob' }, { id: 'nkog', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nkot' }] },
    { level: 1, creeps: [{ id: 'ntrs' }, { id: 'ntrs' }, { id: 'ntrt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }] },
    { level: 2, creeps: [{ id: 'ngns' }, { id: 'ngnv', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'ngnw' }] },
    { level: 1, creeps: [{ id: 'nfsh', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }, { id: 'nftr' }, { id: 'nftt' }] },
    { level: 2, creeps: [{ id: 'nsc3', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }, { id: 'nscb' }, { id: 'ntrt' }, { id: 'ntrt' }] },
    { level: 2, creeps: [{ id: 'nftr' }, { id: 'nftr' }, { id: 'nogr', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'nogr' }] },
    { level: 1, creeps: [{ id: 'nmrl' }, { id: 'nmrm', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nmrr' }, { id: 'nmrr' }] },
    { level: 2, creeps: [{ id: 'nfsh', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nftt' }, { id: 'ngrk' }, { id: 'ngst', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }] },
    { level: 1, creeps: [{ id: 'nmrl' }, { id: 'nmrr' }, { id: 'nmrr' }, { id: 'nsc2', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }] },
    { level: 1, creeps: [{ id: 'nmrl' }, { id: 'nmrm', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }, { id: 'nmrr' }, { id: 'nmrr' }] },
    { level: 2, creeps: [{ id: 'nfsh' }, { id: 'nftb' }, { id: 'nogm' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 4 }] }] },
    { level: 2, creeps: [{ id: 'nftk', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }, { id: 'nftt' }, { id: 'nftt' }, { id: 'nogr' }, { id: 'nogr' }] },
    { level: 2, creeps: [{ id: 'nftt', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nftt' }, { id: 'nogr' }, { id: 'nogr' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'nmfs', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'nmrm', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nmrm' }, { id: 'nmrr' }, { id: 'nmrr' }] },
    { level: 2, creeps: [{ id: 'nftt' }, { id: 'nftt' }, { id: 'nogr', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nogr' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'nmrr' }, { id: 'nmrr' }, { id: 'ntrg', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }, { id: 'ntrt' }, { id: 'ntrt' }] },
    { level: 2, creeps: [{ id: 'nfsh', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nftr' }, { id: 'nftr' }, { id: 'ngrk' }, { id: 'ngst', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'ngno' }, { id: 'ngns', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'ngns' }, { id: 'ngnv', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }, { id: 'ngnw' }] },
    { level: 3, creeps: [{ id: 'nfsh' }, { id: 'nftt' }, { id: 'nftt' }, { id: 'nogl', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }] }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nftt', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nftt' }, { id: 'nogr' }, { id: 'nogr' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'nfsh' }, { id: 'nftt', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nftt', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'ngrk' }, { id: 'ngst', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }] },
    { level: 3, creeps: [{ id: 'nfsh', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nftb' }, { id: 'nftb' }, { id: 'nogl', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }] }, { id: 'nomg' }] },
    { level: 2, creeps: [{ id: 'nmrm' }, { id: 'nmrm' }, { id: 'nmrr' }, { id: 'nmrr' }, { id: 'ntrg', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }, { type: ITEM_TYPE_POWERUP, level: 1 }] }] },
    { level: 3, creeps: [{ id: 'nftb' }, { id: 'nftb' }, { id: 'nogl', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }] }, { id: 'nogr' }, { id: 'nogr' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nkob' }, { id: 'nkob' }, { id: 'nkog' }, { id: 'nkot' }, { id: 'nkot' }, { id: 'nwzg', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }] },
    { level: 3, creeps: [{ id: 'nfsh' }, { id: 'nftb' }, { id: 'nftb' }, { id: 'nogr' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nrdr', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }] },
  ],
  'Lordaeron Winter': [
    { level: 1, creeps: [{ id: 'nftt' }, { id: 'ngnb', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }] },
    { level: 1, creeps: [{ id: 'nmfs', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }, { id: 'nmrr' }] },
    { level: 1, creeps: [{ id: 'nfrs', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }, { id: 'nwlt' }, { id: 'nwlt' }] },
    { level: 1, creeps: [{ id: 'ngna' }, { id: 'ngnw', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }, { id: 'nwlt' }] },
    { level: 1, creeps: [{ id: 'nmam', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'ntka' }, { id: 'ntkt' }] },
    { level: 2, creeps: [{ id: 'nfpt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }, { id: 'ntks' }, { id: 'ntkt' }] },
    { level: 1, creeps: [{ id: 'ngnw' }, { id: 'nitr' }, { id: 'nogr', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nfpt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }, { id: 'ntks' }, { id: 'ntks' }] },
    { level: 2, creeps: [{ id: 'nomg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }, { id: 'ntkt' }, { id: 'ntkw' }] },
    { level: 2, creeps: [{ id: 'nfsh' }, { id: 'nitt' }, { id: 'nsqt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }, { id: 'nwwf' }] },
    { level: 2, creeps: [{ id: 'nfrb', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }, { id: 'nfrl' }, { id: 'nfsh' }, { id: 'nftb' }] },
    { level: 2, creeps: [{ id: 'nitp' }, { id: 'nitt', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nitt' }, { id: 'nsqt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 3, creeps: [{ id: 'nith' }, { id: 'nits' }, { id: 'nmgr', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }] }, { id: 'nplg', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }] },
    { level: 2, creeps: [{ id: 'nftb' }, { id: 'nitt' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }, { id: 'nplb' }] },
    { level: 1, creeps: [{ id: 'nmfs', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }, { id: 'nmrl' }, { id: 'nmrl' }, { id: 'nmrr' }] },
    { level: 2, creeps: [{ id: 'nitp' }, { id: 'nitr' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }, { id: 'ntkt' }] },
    { level: 3, creeps: [{ id: 'nfps' }, { id: 'nmgr', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }] }, { id: 'nogr' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nanb' }, { id: 'nanc' }, { id: 'nano', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'nanw' }, { id: 'nnwl', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'ngnb' }, { id: 'ngnb' }, { id: 'ngns' }, { id: 'ngnv', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }, { id: 'ngnw' }] },
    { level: 2, creeps: [{ id: 'nith' }, { id: 'nitr' }, { id: 'nitr' }, { id: 'nits' }, { id: 'nitw', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 4 }] }] },
  ],
  'Northrend': [
    { level: 1, creeps: [{ id: 'nsts', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nwlt' }, { id: 'nwlt' }] },
    { level: 2, creeps: [{ id: 'nmrr' }, { id: 'nmtw' }, { id: 'nsel', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'ndth', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'ndtr' }, { id: 'ndtr' }, { id: 'nsqt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'ndtt', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nogm', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }, { id: 'nspb' }, { id: 'nspg' }] },
    { level: 2, creeps: [{ id: 'ndtb', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'ndtt' }, { id: 'nfrb', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }, { id: 'nfrl' }] },
    { level: 1, creeps: [{ id: 'nska' }, { id: 'nsty' }, { id: 'nsty' }, { id: 'nwlt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }] },
    { level: 2, creeps: [{ id: 'ndqn' }, { id: 'ndqn' }, { id: 'ndqv', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }, { type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nkog' }] },
    { level: 3, creeps: [{ id: 'nfrb', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nfre', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }] }, { id: 'nfrl' }, { id: 'nfrs' }] },
    { level: 2, creeps: [{ id: 'ndtb' }, { id: 'ndtb' }, { id: 'ngrk' }, { id: 'ngst', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 4 }] }, { id: 'nkot' }] },
    { level: 2, creeps: [{ id: 'ngnw' }, { id: 'nogm', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nspg' }, { id: 'nspr' }] },
  ],
  'Sunken Ruins': [
    { level: 1, creeps: [{ id: 'ntrs' }, { id: 'ntrt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }] },
    { level: 1, creeps: [{ id: 'nmfs', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }, { id: 'nmrl' }, { id: 'nmrr' }] },
    { level: 2, creeps: [{ id: 'ntrg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }, { id: 'ntrt' }, { id: 'ntrt' }] },
    { level: 1, creeps: [{ id: 'nmrm', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nmrr' }, { id: 'nmrr' }] },
    { level: 2, creeps: [{ id: 'nftb', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'nftt' }, { id: 'nsgn' }] },
    { level: 1, creeps: [{ id: 'nsko', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'nsra' }, { id: 'nsrh' }] },
    { level: 2, creeps: [{ id: 'nlsn', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }, { type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'ntrt' }, { id: 'ntrt' }] },
    { level: 2, creeps: [{ id: 'nmbg' }, { id: 'nmsn', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'nmtw' }, { id: 'nmtw' }] },
    { level: 2, creeps: [{ id: 'ngnb' }, { id: 'ngns' }, { id: 'ngnv', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }, { id: 'ngnw' }] },
    { level: 3, creeps: [{ id: 'nggm', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }, { type: ITEM_TYPE_POWERUP, level: 2 }] }, { id: 'ngrk' }, { id: 'nsgh' }, { id: 'nsgh' }] },
    { level: 2, creeps: [{ id: 'nele' }, { id: 'nele' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }, { id: 'nrel' }, { id: 'nrel' }] },
    { level: 3, creeps: [{ id: 'nmrm' }, { id: 'nmrm' }, { id: 'nmrv', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 4 }] }, { id: 'nmsn' }, { id: 'nmsn' }] },
    { level: 2, creeps: [{ id: 'nfsh' }, { id: 'nftr' }, { id: 'nftt' }, { id: 'ngrk' }, { id: 'ngst', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }] },
  ],
  'Village': [
    { level: 1, creeps: [{ id: 'nftr' }, { id: 'nftt', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }] },
    { level: 1, creeps: [{ id: 'nhyh' }, { id: 'ntrt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 1, creeps: [{ id: 'nmrl' }, { id: 'nmrm', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }, { id: 'nmrr' }] },
    { level: 1, creeps: [{ id: 'nftr' }, { id: 'ngnb', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'ngnw', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }] },
    { level: 1, creeps: [{ id: 'nenf', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }, { id: 'nvdw' }, { id: 'nwiz' }] },
    { level: 2, creeps: [{ id: 'nban' }, { id: 'nbrg' }, { id: 'nrog', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nwzg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nfsh' }, { id: 'nftb' }, { id: 'nogr' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }] },
    { level: 2, creeps: [{ id: 'nfsh' }, { id: 'nfsp' }, { id: 'nftb', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nogm', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'nfsp' }, { id: 'nftb', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'nftt' }, { id: 'nogr', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }] },
    { level: 2, creeps: [{ id: 'nlsn', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'nmrr', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nrel' }, { id: 'nrel' }] },
    { level: 2, creeps: [{ id: 'nftb' }, { id: 'nftr' }, { id: 'nkog' }, { id: 'nsqt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'nftb', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nftt' }, { id: 'nkob' }, { id: 'nkol', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nftb' }, { id: 'nftt' }, { id: 'ngno' }, { id: 'ngst', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'nftk', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }, { id: 'nftt' }, { id: 'nftt' }, { id: 'nogr' }] },
    { level: 2, creeps: [{ id: 'nmrm', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nmrm' }, { id: 'ntrh' }, { id: 'ntrh' }, { id: 'ntrt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'ngna' }, { id: 'ngnb' }, { id: 'ngnb' }, { id: 'ngnv', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }, { id: 'ngnw', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }] },
    { level: 1, creeps: [{ id: 'nban' }, { id: 'nban' }, { id: 'nbrg' }, { id: 'nbrg' }, { id: 'nrog', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }] },
    { level: 3, creeps: [{ id: 'nele' }, { id: 'nenf', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nwiz' }, { id: 'nwzd', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }] }, { id: 'nwzr' }] },
    { level: 3, creeps: [{ id: 'nele' }, { id: 'nele' }, { id: 'nltc' }, { id: 'ntrg', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 4 }] }, { id: 'ntrt', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 2 }] }] },
  ],
  'Village Fall': [
    { level: 2, creeps: [{ id: 'nftt' }, { id: 'nftt' }, { id: 'nomg', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }, { type: ITEM_TYPE_POWERUP, level: 2 }] }] },
    { level: 1, creeps: [{ id: 'ngnw', itemDrops: [{ type: ITEM_TYPE_POWERUP, level: 1 }] }, { id: 'nwwf' }, { id: 'nwwf' }] },
    { level: 2, creeps: [{ id: 'nftb' }, { id: 'nftt' }, { id: 'nsqt', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }] },
    { level: 1, creeps: [{ id: 'nska' }, { id: 'nskg' }, { id: 'nslf', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 1 }] }] },
    { level: 3, creeps: [{ id: 'nggr', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 5 }] }, { id: 'nwwd' }, { id: 'nwwd' }] },
    { level: 1, creeps: [{ id: 'nftb', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 2 }] }, { id: 'nftt' }, { id: 'nwwf' }] },
    { level: 2, creeps: [{ id: 'nenf' }, { id: 'ngns' }, { id: 'ngnv', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 3 }] }] },
    { level: 2, creeps: [{ id: 'nkog' }, { id: 'nkog' }, { id: 'nkol', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 3 }] }, { id: 'nkot' }] },
    { level: 1, creeps: [{ id: 'nbrg' }, { id: 'nbrg' }, { id: 'nwiz' }, { id: 'nwzr', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 2 }] }] },
    { level: 2, creeps: [{ id: 'nfsh' }, { id: 'nftb' }, { id: 'nftk', itemDrops: [{ type: ITEM_TYPE_CHARGED, level: 4 }] }, { id: 'nsqt' }] },
    { level: 2, creeps: [{ id: 'ngns' }, { id: 'ngnv' }, { id: 'ngnw' }, { id: 'nowe', itemDrops: [{ type: ITEM_TYPE_PERMANENT, level: 4 }] }] },
  ],
};
