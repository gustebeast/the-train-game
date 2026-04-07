/**
 * Analyze full item drop data from WC3 ladder maps via war3map.lua.
 * Extracts the actual item types (permanent/charged/powerup) and levels per unit.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAP_DIR = 'C:\\Users\\guste\\Documents\\Warcraft III\\Maps\\W3Champions';
const MPQ_READER = path.join(__dirname, 'mpq_reader.py');

const UNIT_NAMES = {
    ngna: 'Gnoll', ngnb: 'Gnoll Poacher', ngnw: 'Gnoll Warden',
    nmrl: 'Murloc', nmrm: 'Murloc Huntsman', nmrr: 'Murloc Nightcrawler',
    nmfs: 'Murloc Flesheater', nftt: 'Forest Troll', nftb: 'Forest Troll Berserker',
    nftr: 'Forest Troll Trapper', nfsh: 'Forest Troll Shadow Priest',
    nogr: 'Ogre Warrior', nogm: 'Ogre Magi', nomg: 'Ogre Mauler',
    nkob: 'Kobold', nkog: 'Kobold Geomancer', nkot: 'Kobold Tunneler',
    ngst: 'Rock Golem', ngrk: 'Mud Golem', nwzg: 'Wizard',
    ntrt: 'Sea Turtle', ntrg: 'Sea Giant', nogl: 'Ogre Lord',
    nsc2: 'Spider Crab Shorecrawler', nsc3: 'Spider Crab Limbripper',
    nftk: 'Forest Troll High Priest', ngnv: 'Gnoll Overseer',
    ngno: 'Gnoll Overseer', ngns: 'Gnoll Assassin', nrdr: 'Red Dragon Whelp',
    nsqt: 'Sasquatch', nrog: 'Rogue', nbrg: 'Brigand', nwzr: 'Rogue Wizard',
    nfrl: 'Furbolg', nfrg: 'Furbolg Tracker', nfre: 'Furbolg Elder',
    nfrs: 'Furbolg Shaman', nfrb: 'Furbolg Champion',
    nwlt: 'Timber Wolf', nwlg: 'Giant Wolf', nwld: 'Dire Wolf',
    ntrs: 'Snapping Turtle', ntrh: 'Hardened Sea Turtle',
    nfsp: 'Spider Crab', nscb: 'Spider Crab',
    nban: 'Bandit', nass: 'Assassin',
    ndtr: 'Dark Troll', ndtb: 'Dark Troll Berserker', ndth: 'Dark Troll Shadow Priest',
    ndtw: 'Dark Troll Warlord', ndtp: 'Dark Troll Trapper', ndtt: 'Dark Troll Trapper',
    nsat: 'Satyr', nsth: 'Satyr Hellcaller', nsts: 'Satyr Shadowdancer',
    nstt: 'Satyr Trickster', nsty: 'Satyr Trickster',
    nplb: 'Polar Bear', nplg: 'Giant Polar Bear',
    nmam: 'Mammoth', ntka: 'Tuskarr', ntkt: 'Tuskarr Trapper', ntkw: 'Tuskarr Warrior',
    ntks: 'Tuskarr Sorcerer',
    nitr: 'Ice Troll', nits: 'Ice Troll Berserker', nith: 'Ice Troll High Priest',
    nitp: 'Ice Troll Priest', nitw: 'Ice Troll Warlord', nitt: 'Ice Troll Trapper',
    nfpt: 'Fel Stalker', nfps: 'Searing Destroyer', nfov: 'Overlord',
    nmgr: 'Magnataur Reaver', nmgd: 'Magnataur Destroyer', nmgw: 'Magnataur Warrior',
    nmtw: 'Magnataur Warrior',
    nanb: 'Nerubian Webspinner', nanc: 'Nerubian Seer', nano: 'Nerubian Spider Lord',
    nanw: 'Nerubian Warrior', nnwl: 'Nerubian Queen',
    nenf: 'Enforcer', nenc: 'Enchantress', nvdw: 'Voidwalker', nvdg: 'Greater Voidwalker',
    nwiz: 'Wizard', nwzd: 'Dark Wizard',
    nslf: 'Soulless', nske: 'Skeleton Warrior', nskm: 'Skeletal Marksman',
    nska: 'Skeletal Archer', nskg: 'Burning Archer', nsko: 'Skeletal Orc',
    nsra: 'Stormreaver Apprentice', nsrh: 'Stormreaver Hermit', nsrv: 'Stormreaver',
    nwwf: 'Wendigo', nwwd: 'Dire Wendigo',
    nkol: 'Kobold Leader', nowe: 'Enraged Wildkin', nowb: 'Wildkin',
    nggm: 'Granite Golem', nggr: 'War Golem',
    nlsn: 'Makrura Snapper', nlpr: 'Makrura Prawn', nlds: 'Makrura Deepseer',
    nlkl: 'Makrura Tidal Lord',
    nmbg: "Mur'gul Blood-Gill", nmsn: "Mur'gul Snarecaster",
    nmrv: 'Murloc Tiderunner', nsgn: 'Sea Giant', nsgh: 'Sea Giant Hunter',
    nsel: 'Sea Elemental', nrel: 'Reef Elemental', nele: 'Enraged Elemental',
    nltc: 'Lightning Lizard', ndqn: 'Dune Worm', ndqv: 'Dust Devil',
    nhyh: 'Hydra Hatchling', nspr: 'Spider', nspb: 'Black Spider', nspg: 'Forest Spider',
    narg: 'Battle Golem', nhdc: 'Deceiver', nhhr: 'Heretic',
    nrvi: 'Revenant', nzom: 'Zombie', ngh1: 'Ghost', ngh2: 'Wraith',
    ndrj: 'Draenei', ndrh: 'Draenei Harbinger', ndrs: 'Draenei Seer',
    ndrm: 'Draenei Darkslayer', ndrp: 'Draenei Protector',
    nrzs: 'Razormane Scout', nrzb: 'Razormane Brute', nrzg: 'Razormane Medicine Man',
    njga: 'Jungle Stalker', njgb: 'Elder Jungle Stalker',
    nsqo: 'Sasquatch Oracle', nsqe: 'Elder Sasquatch',
    ngz3: 'Grizzly Bear', nrdk: 'Red Dragon Whelp', ncrb: 'Crab',
    nwnr: 'Nether Dragon Hatchling', nwns: 'Wind Serpent', nthl: 'Thunder Lizard',
};

function extractFromMPQ(mapPath, filename) {
    try {
        return execFileSync('python3', [MPQ_READER, mapPath, filename], { maxBuffer: 10*1024*1024 });
    } catch(e) { return null; }
}

function parseLua(luaText) {
    const lines = luaText.split('\n');

    // Step 1: Parse all drop functions
    const dropFuncs = {};
    let currentFunc = null;
    for (const line of lines) {
        const funcMatch = line.match(/^function (\w+_DropItems)\(\)/);
        if (funcMatch) {
            currentFunc = funcMatch[1];
            dropFuncs[currentFunc] = [];
        }
        if (currentFunc) {
            const dropMatch = line.match(/ChooseRandomItemEx\((ITEM_TYPE_\w+),\s*(\d+)\)/);
            if (dropMatch) {
                dropFuncs[currentFunc].push({
                    type: dropMatch[1].replace('ITEM_TYPE_', '').toLowerCase(),
                    level: parseInt(dropMatch[2]),
                });
            }
            if (line.match(/^end/)) currentFunc = null;
        }
    }

    // Step 2: Walk CreateNeutralHostile, tracking units and triggers.
    // Pattern in lua: BlzCreateUnitWithSkin sets `u`, then optionally
    // CreateTrigger() + TriggerRegisterUnitEvent(t, u, ...) + TriggerAddAction(t, func)
    // The trigger always refers to the unit that was `u` when CreateTrigger() was called.
    const allUnits = []; // { unitId, x, y, drops[] }
    let lastUnitId = null, lastX = 0, lastY = 0;
    // The unit that was current when CreateTrigger() was called
    let trigUnitId = null, trigX = 0, trigY = 0;
    let inNH = false;

    for (const line of lines) {
        if (line.includes('function CreateNeutralHostile')) { inNH = true; continue; }
        if (!inNH) continue;

        const unitMatch = line.match(/BlzCreateUnitWithSkin\(p,\s*FourCC\("(\w+)"\),\s*([-\d.]+),\s*([-\d.]+)/);
        if (unitMatch) {
            // Flush previous unit as non-dropper if not consumed by a trigger
            if (lastUnitId != null && trigUnitId == null) {
                allUnits.push({ unitId: lastUnitId, x: lastX, y: lastY, drops: [] });
            }
            lastUnitId = unitMatch[1];
            lastX = parseFloat(unitMatch[2]);
            lastY = parseFloat(unitMatch[3]);
        }

        // CreateTrigger() freezes the current `u` as the trigger target
        if (line.includes('CreateTrigger()') && lastUnitId != null) {
            // Flush the last unit as non-dropper if there was a pending one before this trigger's unit
            trigUnitId = lastUnitId;
            trigX = lastX;
            trigY = lastY;
            lastUnitId = null; // consumed into trigger
        }

        const trigMatch = line.match(/TriggerAddAction\(t,\s*(\w+_DropItems)\)/);
        if (trigMatch && trigUnitId != null) {
            const funcName = trigMatch[1];
            allUnits.push({
                unitId: trigUnitId,
                x: trigX,
                y: trigY,
                drops: dropFuncs[funcName] || [],
            });
            trigUnitId = null;
        }
    }
    // Push last unit if pending
    if (lastUnitId != null) {
        allUnits.push({ unitId: lastUnitId, x: lastX, y: lastY, drops: [] });
    }

    return allUnits;
}

function clusterUnits(units) {
    const CAMP_RADIUS = 700;
    const assigned = new Set();
    const camps = [];
    for (let i = 0; i < units.length; i++) {
        if (assigned.has(i)) continue;
        const camp = [i];
        assigned.add(i);
        let changed = true;
        while (changed) {
            changed = false;
            for (let j = 0; j < units.length; j++) {
                if (assigned.has(j)) continue;
                for (const ci of camp) {
                    const dx = units[ci].x - units[j].x;
                    const dy = units[ci].y - units[j].y;
                    if (Math.sqrt(dx*dx + dy*dy) < CAMP_RADIUS) {
                        camp.push(j); assigned.add(j); changed = true; break;
                    }
                }
            }
        }
        camps.push(camp.map(idx => units[idx]));
    }
    return camps;
}

const WANTED_MAPS = [
    'AutumnLeaves', 'ConcealedHill', 'LastRefuge', 'NorthernIsles',
    'ShallowGrave', 'Tidehunters', 'TurtleRock', 'EchoIsles',
    'Springtime', 'Hammerfall', 'BoulderVale', 'Scrimmage',
];

const maps = fs.readdirSync(MAP_DIR).filter(f =>
    f.endsWith('.w3x') && WANTED_MAPS.some(name => f.toLowerCase().includes(name.toLowerCase()))
);

const allCamps = new Map();

for (const mapFile of maps) {
    const mapPath = path.join(MAP_DIR, mapFile);
    console.error(`Processing ${mapFile}...`);

    const luaData = extractFromMPQ(mapPath, 'war3map.lua');
    if (!luaData) { console.error('  No lua'); continue; }

    const units = parseLua(luaData.toString('utf-8'));
    const camps = clusterUnits(units);

    for (const camp of camps) {
        const unitTypes = camp.map(u => u.unitId).sort();
        const droppers = camp.filter(u => u.drops.length > 0).map(u => ({
            unitId: u.unitId,
            unitName: UNIT_NAMES[u.unitId] || u.unitId,
            drops: u.drops,
        }));
        if (droppers.length === 0) continue;

        const key = unitTypes.join(',');
        const dropKey = droppers.map(d =>
            `${d.unitId}:${d.drops.map(dd => `${dd.type}${dd.level}`).join('+')}`
        ).sort().join('|');
        const fullKey = key + '||' + dropKey;

        if (!allCamps.has(fullKey)) {
            allCamps.set(fullKey, { units: unitTypes, droppers, count: 1, maps: [mapFile] });
        } else {
            const e = allCamps.get(fullKey);
            e.count++;
            if (!e.maps.includes(mapFile)) e.maps.push(mapFile);
        }
    }
}

const sorted = [...allCamps.values()].sort((a, b) => a.units.length - b.units.length);
for (const camp of sorted) {
    console.log(`\n[${camp.units.join(', ')}] (${camp.count}x)`);
    for (const d of camp.droppers) {
        for (const drop of d.drops) {
            console.log(`  ${d.unitName} (${d.unitId}): Lv${drop.level} ${drop.type}`);
        }
    }
}

// Summary
const typeCounts = {};
for (const camp of sorted) {
    for (const d of camp.droppers) {
        for (const drop of d.drops) {
            const key = `${drop.type}_lv${drop.level}`;
            typeCounts[key] = (typeCounts[key] || 0) + camp.count;
        }
    }
}
console.log('\n--- DROP TYPE SUMMARY ---');
for (const [k, v] of Object.entries(typeCounts).sort()) {
    console.log(`  ${k}: ${v} instances`);
}
