// The dance sequences transplanted by transplant-dance-anims.js kept their
// source names -- "Attack - 6", "Attack Morph - 16", "Walk Victory - 1" and so
// on. WC3 does not treat a sequence name as an exact key: it collects every
// sequence whose name contains the requested tokens and picks one at random.
// So "Attack - 6" is a variant of "Attack" and "Walk Victory - 1" is a variant
// of "Walk" -- an ordinary peasant chopping a tree or walking across the map
// would break into a dance.
//
// Two fixes, both idempotent:
//
// 1. Rename them to "Dance - N", a base name the engine never requests. Nothing
//    reads these names -- dance.ts plays them through SetUnitAnimationByIndex
//    -- and renaming does not reorder the sequence list, so the indices there
//    stay valid.
//
// 2. Key geoset alpha to 0 across each dance range, exactly as
//    fix-roll-geosets.js does for the roll. The stepped KGAO tracks end long
//    before these ranges, so with no key inside them the cargo and decay
//    geosets hold their last value and the dancer renders carrying gold, lumber
//    and a skeleton at once.
//
// Run from the project root:  node scripts/fix-dance-anims.js

const fs = require('fs');
const base = 'mdx-m3-viewer-th/dist/cjs';
const Model = require(base + '/parsers/mdlx/model').default;

const TARGET = 'maps/TheTrainGame.w3x/war3mapImported/WeaponlessPeasant.mdx';

/** Source names, in the order transplant-dance-anims.js appends them. */
const SOURCE_NAMES = [
  'Walk Victory - 1',
  'Attack Morph - 31',
  'Attack - 9',
  'Stand Hit - 1',
  'Stand Hit - 5',
  'Attack - 6',
  'Attack - 7',
  'Attack - 8',
  'Stand Hit - 4',
  'Stand Victory - 17',
];
const WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** Unique, so an ability's Animation Names field can name exactly one of them
 *  -- "Dance - 1" and friends were all variants of one base name, and the
 *  engine picks among variants at random. */
const safeName = (i) => `Dance ${WORDS[i]}`;

const m = new Model();
m.load(new Uint8Array(fs.readFileSync(TARGET)));

let renamed = 0;
for (let i = 0; i < SOURCE_NAMES.length; i++) {
  const seq = m.sequences.find((s) => s.name === SOURCE_NAMES[i] || s.name === `Dance - ${i + 1}`);
  if (seq == null) continue; // already renamed, or never transplanted
  seq.name = safeName(i);
  renamed += 1;
}

const dances = m.sequences.filter((s) => s.name.startsWith('Dance '));
if (dances.length === 0) {
  throw new Error('no dance sequences -- run transplant-dance-anims.js first');
}

/** Append alpha=0 keys spanning a range to a stepped KGAO track. */
function hideDuring(track, from, to) {
  if (track.frames.some((f) => f >= from && f <= to)) return false;
  const sample = track.values[0];
  const zero = () => (Array.isArray(sample) ? sample.map(() => 0) : 0);
  const hasTans = Array.isArray(track.inTans) && track.inTans.length === track.frames.length;
  for (const f of [from, to]) {
    track.frames.push(f);
    track.values.push(zero());
    if (hasTans) {
      track.inTans.push(zero());
      track.outTans.push(zero());
    }
  }
  return true;
}

let patched = 0;
for (const g of m.geosetAnimations) {
  const track = g.animations && g.animations[0];
  if (track == null || track.name !== 'KGAO') continue;
  for (const seq of dances) {
    if (hideDuring(track, seq.interval[0], seq.interval[1])) patched += 1;
  }
}

if (renamed === 0 && patched === 0) {
  console.log('nothing to do -- dances already renamed and keyed');
  process.exit(0);
}

const out = m.saveMdx();
fs.writeFileSync(TARGET, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
console.log(`renamed ${renamed} sequences, patched ${patched} geoset alpha ranges`);

// Round-trip validation: the names are gone and every dance range is keyed.
const check = new Model();
check.load(new Uint8Array(fs.readFileSync(TARGET)));
for (const name of SOURCE_NAMES) {
  if (check.sequences.some((s) => s.name === name || s.name.indexOf('Dance - ') === 0)) {
    throw new Error(`sequence "${name}" survived the rename`);
  }
}
const out2 = check.sequences.filter((s) => s.name.startsWith('Dance '));
for (const seq of out2) {
  for (const g of check.geosetAnimations) {
    const track = g.animations && g.animations[0];
    if (track == null || track.name !== 'KGAO') continue;
    if (!track.frames.some((f) => f >= seq.interval[0] && f <= seq.interval[1])) {
      throw new Error(`geoset ${g.geosetId} unkeyed during "${seq.name}"`);
    }
  }
}
console.log(`validation OK: ${out2.length} dances renamed and keyed`);
out2.forEach((s) => console.log('  ' + check.sequences.indexOf(s) + ' ' + JSON.stringify(s.name)));
