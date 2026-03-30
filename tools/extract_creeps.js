/**
 * Extract creep camp data from WC3 ladder maps.
 * Uses mpq_reader.py to extract war3mapUnits.doo from .w3x archives,
 * then wc3maptranslator to parse the unit placement data.
 */
const { UnitsTranslator } = require('wc3maptranslator');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAP_DIRS = [
    'C:\\Users\\gus\\Documents\\Warcraft III\\Maps\\Download\\Season8',
    'C:\\Users\\gus\\Documents\\Warcraft III\\Maps\\Download\\Season1',
];
const MPQ_READER = path.join(__dirname, 'mpq_reader.py');

// Maps from warcraft-gym.com/learn-warcraft-3/warcraft-3-creep-routes/
const WANTED_MAPS = [
    'AutumnLeaves', 'ConcealedHill', 'EchoIsles', 'LastRefuge',
    'NorthernIsles', 'TerenasStand', 'Tidehunters', 'TurtleRock',
    'ShatteredExile', 'Amazonia', 'ShallowGraves',
];

// Collect matching maps from all directories, preferring S2 versions
const TARGET_MAPS = [];
for (const dir of MAP_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.w3x')) continue;
        if (!WANTED_MAPS.some(name => f.toLowerCase().includes(name.toLowerCase()))) continue;
        // Skip non-S2 version if S2 exists (e.g. skip (2)Amazonia.w3x if (2)Amazonia_S2.w3x exists)
        if (!f.includes('_S') && TARGET_MAPS.some(m => m.file.includes('_S') &&
            m.file.toLowerCase().includes(f.replace(/\(\d\)/, '').replace('.w3x', '').toLowerCase()))) continue;
        TARGET_MAPS.push({ file: f, dir });
    }
}

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
};

function parseItemDrop(code) {
    if (!code || code.length < 4 || code[0] !== 'Y') return code;
    const levelMap = { k: 1, j: 2, i: 3, h: 4, g: 5, f: 6 };
    const typeMap = { I: 'permanent', P: 'powerup', C: 'charged', A: 'artifact' };
    return `Lv${levelMap[code[1]] || '?'} ${typeMap[code[2]] || code[2]}`;
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
                    const dx = units[ci].position[0] - units[j].position[0];
                    const dy = units[ci].position[1] - units[j].position[1];
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

function extractUnitsFromMPQ(mapPath) {
    try {
        const data = execFileSync('python3', [MPQ_READER, mapPath, 'war3mapUnits.doo'], {
            maxBuffer: 10 * 1024 * 1024,
        });
        return UnitsTranslator.warToJson(data).json;
    } catch (e) {
        return null;
    }
}

// Process all maps
const allCamps = [];

for (const { file: mapFile, dir: mapDir } of TARGET_MAPS) {
    const mapPath = path.join(mapDir, mapFile);
    console.error(`Processing ${mapFile}...`);

    const units = extractUnitsFromMPQ(mapPath);
    if (!units) {
        console.error(`  FAILED to extract units`);
        continue;
    }

    const creeps = units.filter(u => u.player === 24);
    console.error(`  Found ${creeps.length} creep units`);

    if (creeps.length === 0) continue;

    const camps = clusterUnits(creeps);
    console.error(`  Clustered into ${camps.length} camps`);

    for (const camp of camps) {
        const unitTypes = camp.map(u => u.type).sort();

        // Find max item drop level
        let maxDropLevel = 0;
        camp.forEach(u => {
            if (u.customItemSets) {
                for (const set of u.customItemSets) {
                    for (const code of Object.keys(set)) {
                        if (code[0] === 'Y') {
                            const lvlMap = { k: 1, j: 2, i: 3, h: 4, g: 5, f: 6 };
                            maxDropLevel = Math.max(maxDropLevel, lvlMap[code[1]] || 0);
                        }
                    }
                }
            }
        });

        allCamps.push({
            map: mapFile,
            units: unitTypes,
            names: unitTypes.map(t => UNIT_NAMES[t] || t),
            dropLevel: maxDropLevel,
            count: camp.length,
        });
    }
}

// Deduplicate camps (same unit composition)
const uniqueCamps = new Map();
for (const camp of allCamps) {
    const key = camp.units.join(',');
    if (!uniqueCamps.has(key)) {
        uniqueCamps.set(key, { ...camp, occurrences: 1, maps: [camp.map] });
    } else {
        const existing = uniqueCamps.get(key);
        existing.occurrences++;
        if (!existing.maps.includes(camp.map)) {
            existing.maps.push(camp.map);
        }
    }
}

// Sort by count of units (camp size)
const sorted = [...uniqueCamps.values()].sort((a, b) => a.count - b.count);

console.log(JSON.stringify(sorted, null, 2));
