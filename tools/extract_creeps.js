/**
 * Extract creep camp data from WC3 ladder maps.
 * Parses war3map.lua for unit positions and item drop triggers,
 * which contain the real item types (permanent/charged/powerup).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAP_DIR = 'C:\\Users\\guste\\Documents\\Warcraft III\\Maps\\W3Champions';
const MPQ_READER = path.join(__dirname, 'mpq_reader.py');

// W3Champions 1v1 ladder map pool
const WANTED_MAPS = [
    'AutumnLeaves', 'ConcealedHill', 'LastRefuge', 'NorthernIsles',
    'ShallowGrave', 'Tidehunters', 'TurtleRock', 'EchoIsles',
    'Springtime', 'Hammerfall', 'BoulderVale', 'Scrimmage',
];

// WC3 unit names
const UNIT_NAMES = {
    ngna: 'Gnoll', ngnb: 'Gnoll Poacher', ngnw: 'Gnoll Warden',
    nmrl: 'Murloc', nmrm: 'Murloc Huntsman', nmrr: 'Murloc Nightcrawler',
    nmfs: 'Murloc Flesheater',
    nftt: 'Forest Troll', nftb: 'Forest Troll Berserker', nftr: 'Forest Troll Trapper',
    nfsh: 'Forest Troll Shadow Priest',
    nogr: 'Ogre Warrior', nogm: 'Ogre Magi', nomg: 'Ogre Mauler',
    nkob: 'Kobold', nkog: 'Kobold Geomancer', nkot: 'Kobold Tunneler',
    ngst: 'Rock Golem', ngrk: 'Mud Golem', nwzg: 'Wizard',
    ntrt: 'Sea Turtle', ntrg: 'Sea Giant',
    nspb: 'Black Spider', nssp: 'Spider', nspg: 'Forest Spider',
    nban: 'Bandit', nbrg: 'Brigand', nrog: 'Rogue', nass: 'Assassin',
    ndtr: 'Dark Troll', ndtb: 'Dark Troll Berserker', ndth: 'Dark Troll Shadow Priest',
    ndtw: 'Dark Troll Warlord', ndtp: 'Dark Troll Trapper',
    nsat: 'Satyr', nsth: 'Satyr Hellcaller', nsts: 'Satyr Shadowdancer',
    nstt: 'Satyr Trickster',
    nhrr: 'Harpy Rogue', nhrq: 'Harpy Queen', nhrw: 'Harpy Windwitch',
    ncen: 'Centaur Outrunner', ncer: 'Centaur Archer', ncnk: 'Centaur Khan',
    nfrl: 'Furbolg', nfrg: 'Furbolg Tracker', nfre: 'Furbolg Elder',
    nfrs: 'Furbolg Shaman',
    nwlt: 'Timber Wolf', nwlg: 'Giant Wolf', nwld: 'Dire Wolf',
    nslf: 'Soulless', nske: 'Skeleton Warrior', nskm: 'Skeletal Marksman',
    nzom: 'Zombie', ngh1: 'Ghost', ngh2: 'Wraith',
    nplb: 'Polar Bear', nplg: 'Giant Polar Bear',
    ndrj: 'Draenei', ndrh: 'Draenei Harbinger', ndrs: 'Draenei Seer',
    ndrm: 'Draenei Darkslayer', ndrp: 'Draenei Protector',
    nwzr: 'Rogue Wizard', nwzd: 'Dark Wizard',
    nmgw: 'Magnataur Warrior', nmgr: 'Magnataur Reaver',
    nenf: 'Enforcer', nenc: 'Enchantress',
    nwns: 'Wind Serpent', nwnr: 'Nether Dragon Hatchling',
    nthl: 'Thunder Lizard', nftk: 'Forest Troll High Priest',
    ngnv: 'Gnoll Overseer', nfsp: 'Spider Crab',
    njga: 'Jungle Stalker', njgb: 'Elder Jungle Stalker',
    nsqt: 'Sasquatch', nsqo: 'Sasquatch Oracle', nsqe: 'Elder Sasquatch',
    nowb: 'Wildkin', nowe: 'Enraged Wildkin', nrzs: 'Razormane Scout',
    nrzb: 'Razormane Brute', nrzg: 'Razormane Medicine Man',
    nmgd: 'Magnataur Destroyer',
    nlds: 'Makrura Deepseer', nlsn: 'Makrura Snapper', nlpr: 'Makrura Prawn',
    nlkl: 'Makrura Tidal Lord',
    nsc2: 'Spider Crab Shorecrawler', nsc3: 'Spider Crab Limbripper',
    ncrb: 'Crab',
    nanb: 'Nerubian Webspinner', nanc: 'Nerubian Seer', nano: 'Nerubian Spider Lord',
    nanw: 'Nerubian Warrior', narg: 'Battle Golem', nele: 'Enraged Elemental',
    nfov: 'Overlord', nfps: 'Searing Destroyer', nfpt: 'Fel Stalker',
    nggm: 'Granite Golem', nggr: 'War Golem', ngno: 'Gnoll Overseer',
    ngns: 'Gnoll Assassin', nhdc: 'Deceiver', nhhr: 'Heretic',
    nith: 'Ice Troll High Priest', nitp: 'Ice Troll Priest', nitr: 'Ice Troll',
    nits: 'Ice Troll Berserker', nitw: 'Ice Troll Warlord',
    nkol: 'Kobold Leader', nmbg: "Mur'gul Blood-Gill", nmrv: 'Murloc Tiderunner',
    nmsn: "Mur'gul Snarecaster", nmtw: 'Magnataur Warrior', nnwl: 'Nerubian Queen',
    nogl: 'Ogre Lord', nrdr: 'Red Dragon Whelp', nrel: 'Reef Elemental',
    nrvi: 'Revenant', nsel: 'Sea Elemental', nsgh: 'Sea Giant Hunter',
    nsgn: 'Sea Giant', nska: 'Skeletal Archer', nskg: 'Burning Archer',
    nsko: 'Skeletal Orc', nsra: 'Stormreaver Apprentice', nsrh: 'Stormreaver Hermit',
    nsrv: 'Stormreaver', ntks: 'Tuskarr Sorcerer', ntkt: 'Tuskarr Trapper',
    ntkw: 'Tuskarr Warrior', ntrh: 'Hardened Sea Turtle', ntrs: 'Snapping Turtle',
    nvdg: 'Greater Voidwalker', nvdw: 'Voidwalker', nwiz: 'Wizard',
    nwwd: 'Dire Wendigo', nwwf: 'Wendigo',
    nfrb: 'Furbolg Champion', ngz3: 'Grizzly Bear', nitt: 'Ice Troll Trapper',
    nmam: 'Mammoth', nrdk: 'Red Dragon Whelp', ntka: 'Tuskarr',
    ndqn: 'Dune Worm', ndqv: 'Dust Devil', ndtt: 'Dark Troll Trapper',
    nhyh: 'Hydra Hatchling', nltc: 'Lightning Lizard', nspr: 'Spider',
    nsty: 'Satyr Trickster', nscb: 'Spider Crab',
};

const TILESETS = {
    A: 'Ashenvale', B: 'Barrens', C: 'Felwood', D: 'Dungeon',
    F: 'Lordaeron Fall', G: 'Underground', I: 'Icecrown',
    J: 'Dalaran Ruins', K: 'Black Citadel', L: 'Lordaeron Summer',
    N: 'Northrend', O: 'Outland', Q: 'Village Fall',
    V: 'Village', W: 'Lordaeron Winter', X: 'Dalaran',
    Y: 'Cityscape', Z: 'Sunken Ruins',
};

function extractFromMPQ(mapPath, filename) {
    try {
        return execFileSync('python3', [MPQ_READER, mapPath, filename], {
            maxBuffer: 10 * 1024 * 1024,
        });
    } catch (e) {
        return null;
    }
}

/**
 * Parse war3map.lua to extract creep units and their drop info.
 * Returns an array of { unitId, x, y, drops: [{type, level}] }.
 *
 * The lua structure:
 *   function UnitXXX_DropItems() ... ChooseRandomItemEx(ITEM_TYPE_XXX, N) ... end
 *   function CreateNeutralHostile()
 *     u = BlzCreateUnitWithSkin(p, FourCC("xxxx"), x, y, ...)
 *     -- optionally:
 *     t = CreateTrigger()
 *     TriggerRegisterUnitEvent(t, u, ...)
 *     TriggerAddAction(t, UnitXXX_DropItems)
 */
function parseLua(luaText) {
    const lines = luaText.split('\n');

    // Step 1: Parse all drop functions -> { funcName: [{type, level}] }
    const dropFuncs = {};
    let currentFunc = null;
    for (const line of lines) {
        const funcMatch = line.match(/^function (\w+_DropItems)\(\)/);
        if (funcMatch) {
            currentFunc = funcMatch[1];
            dropFuncs[currentFunc] = [];
        } else if (currentFunc && line.match(/^function /)) {
            // Next function starts — previous drop function ended
            currentFunc = null;
        }
        if (currentFunc) {
            const dropMatch = line.match(/ChooseRandomItemEx\((ITEM_TYPE_\w+),\s*(\d+)\)/);
            if (dropMatch) {
                dropFuncs[currentFunc].push({
                    type: dropMatch[1].replace('ITEM_TYPE_', '').toLowerCase(),
                    level: parseInt(dropMatch[2]),
                });
            }
        }
    }

    // Step 2: Walk CreateNeutralHostile, tracking units and triggers.
    // CreateTrigger() freezes the current `u` as the trigger target.
    const allUnits = [];
    let lastUnitId = null, lastX = 0, lastY = 0;
    let trigUnitId = null, trigX = 0, trigY = 0;
    let inNH = false;

    for (const line of lines) {
        if (line.includes('function CreateNeutralHostile')) { inNH = true; continue; }
        if (!inNH) continue;
        // Stop at the next top-level function
        if (line.match(/^function /) && !line.includes('CreateNeutralHostile')) break;

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

        if (line.includes('CreateTrigger()') && lastUnitId != null) {
            trigUnitId = lastUnitId;
            trigX = lastX;
            trigY = lastY;
            lastUnitId = null;
        }

        const trigMatch = line.match(/TriggerAddAction\(t,\s*(\w+_DropItems)\)/);
        if (trigMatch && trigUnitId != null) {
            allUnits.push({
                unitId: trigUnitId,
                x: trigX,
                y: trigY,
                drops: dropFuncs[trigMatch[1]] || [],
            });
            trigUnitId = null;
        }
    }
    if (lastUnitId != null) {
        allUnits.push({ unitId: lastUnitId, x: lastX, y: lastY, drops: [] });
    }

    return allUnits;
}

function clusterUnits(units) {
    const CAMP_RADIUS = 700;
    const camps = [];
    const assigned = new Set();
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
                    if (Math.sqrt(dx * dx + dy * dy) < CAMP_RADIUS) {
                        camp.push(j);
                        assigned.add(j);
                        changed = true;
                        break;
                    }
                }
            }
        }
        camps.push(camp.map(idx => units[idx]));
    }
    return camps;
}

// Collect matching maps
const candidateMaps = [];
if (fs.existsSync(MAP_DIR)) {
    for (const f of fs.readdirSync(MAP_DIR)) {
        if (f.endsWith('.w3x')) {
            if (WANTED_MAPS.some(name => f.toLowerCase().includes(name.toLowerCase()))) {
                candidateMaps.push(f);
            }
        }
    }
}

// Process all maps
const allCamps = [];
const mapTilesets = {};

for (const mapFile of candidateMaps) {
    const mapPath = path.join(MAP_DIR, mapFile);
    console.error(`Processing ${mapFile}...`);

    // Extract tileset from war3map.w3e
    const w3eData = extractFromMPQ(mapPath, 'war3map.w3e');
    if (w3eData && w3eData.length > 9) {
        const tilesetChar = String.fromCharCode(w3eData[8]);
        mapTilesets[mapFile] = TILESETS[tilesetChar] || `Unknown (${tilesetChar})`;
        console.error(`  Tileset: ${mapTilesets[mapFile]}`);
    }

    // Extract and parse lua script
    const luaData = extractFromMPQ(mapPath, 'war3map.lua');
    if (!luaData) {
        console.error(`  FAILED to extract war3map.lua`);
        continue;
    }

    const units = parseLua(luaData.toString('utf-8'));
    console.error(`  Found ${units.length} creep units`);

    if (units.length === 0) continue;

    const camps = clusterUnits(units);
    console.error(`  Clustered into ${camps.length} camps`);

    for (const camp of camps) {
        const unitTypes = camp.map(u => u.unitId).sort();

        // Collect all drops in this camp
        const drops = [];
        for (const u of camp) {
            for (const drop of u.drops) {
                drops.push({
                    unitId: u.unitId,
                    unitName: UNIT_NAMES[u.unitId] || u.unitId,
                    type: drop.type,
                    level: drop.level,
                });
            }
        }

        allCamps.push({
            map: mapFile,
            tileset: mapTilesets[mapFile] || 'Unknown',
            units: unitTypes,
            names: unitTypes.map(t => UNIT_NAMES[t] || t),
            drops,
            count: camp.length,
        });
    }
}

// Deduplicate camps (same unit composition + same drop pattern)
const uniqueCamps = new Map();
for (const camp of allCamps) {
    const dropKey = camp.drops
        .map(d => `${d.unitId}:${d.type}${d.level}`)
        .sort()
        .join('|');
    const key = camp.units.join(',') + '||' + dropKey;
    if (!uniqueCamps.has(key)) {
        uniqueCamps.set(key, { ...camp, occurrences: 1, maps: [camp.map], tilesets: [camp.tileset] });
    } else {
        const existing = uniqueCamps.get(key);
        existing.occurrences++;
        if (!existing.maps.includes(camp.map)) {
            existing.maps.push(camp.map);
        }
        if (!existing.tilesets.includes(camp.tileset)) {
            existing.tilesets.push(camp.tileset);
        }
    }
}

// Sort by count of units (camp size)
const sorted = [...uniqueCamps.values()].sort((a, b) => a.count - b.count);

console.log(JSON.stringify(sorted, null, 2));
