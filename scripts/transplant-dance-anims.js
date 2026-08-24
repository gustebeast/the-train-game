// Transplants the start-lobby dance animations out of Villager 255 Animations
// by Graber (hiveworkshop.com) into WeaponlessPeasant.mdx, using the same
// bone-name matching as transplant-roll-anim.js -- both models descend from
// Blizzard's villager rig, so most nodes share names.
//
// The dances the host's guests get, chosen by eye and mapped to hotkeys.
// QWERYUIO rather than QWERTYUI: it puts the right hand one key over so a
// thumb falls on B, with the left thumb on V. P is avoided throughout -- it
// issues a patrol order the engine owns and will not give up.
//   Q Walk Victory - 1     I Attack - 7
//   W Attack Morph - 31    O Attack - 8
//   E Attack - 9           V Stand Hit - 4
//   R Stand Hit - 1        B Stand Victory - 17
//   Y Stand Hit - 5
//   U Attack - 6
//
// Source model, not committed here -- point SOURCE at wherever it lives:
//   https://www.hiveworkshop.com/threads/villager-255-animations.192204/
//
// The sequences are RENAMED to "Dance <word>" on the way in. WC3 resolves an
// animation request by collecting every sequence whose name contains the
// requested tokens and picking one at random, so keeping the source names would
// make "Attack - 6" a variant of "Attack" and "Walk Victory - 1" a variant of
// "Walk" -- an ordinary peasant would break into a dance while chopping or
// walking. Nothing reads these names: dance.ts plays them by index.
//
// Run scripts/fix-dance-anims.js afterwards to key geoset alpha across the new
// ranges (and to rename any dances left over from an older run of this script).
//
// Idempotent: sequences already present are skipped, so re-running adds only
// what is missing.
// Run from the project root:  node scripts/transplant-dance-anims.js

const fs = require('fs');
const base = 'mdx-m3-viewer-th/dist/cjs';
const Model = require(base + '/parsers/mdlx/model').default;
const Sequence = require(base + '/parsers/mdlx/sequence').default;

const SOURCE = 'C:/Users/gus/Downloads/Villager 255 Animations/Villager255.MDX';
const TARGET = 'maps/TheTrainGame.w3x/war3mapImported/WeaponlessPeasant.mdx';
/** Well clear of the peasant's own keyframes AND of the roll at 200000-202334. */
let nextStart = 210000;
/** Gap between transplanted ranges so no two can interpolate into each other. */
const GAP = 2000;

/** Source sequence, and the safe name it is stored under. Hotkey order --
 *  Dance One is Q, Dance Ten is B -- so dance.ts is a straight list. */
const DANCES = [
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
].map((source, i) => ({ source, name: `Dance ${['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][i]}` }));

function nodesByName(model) {
  const out = new Map();
  for (const n of [...model.bones, ...model.helpers]) out.set(n.name.toLowerCase(), n);
  return out;
}

const villager = new Model();
villager.load(new Uint8Array(fs.readFileSync(SOURCE)));
const peasant = new Model();
peasant.load(new Uint8Array(fs.readFileSync(TARGET)));

// Start after everything already in the model, whatever that is.
for (const s of peasant.sequences) {
  if (s.interval[1] + GAP > nextStart) nextStart = s.interval[1] + GAP;
}

const vNodes = nodesByName(villager);
const pNodes = nodesByName(peasant);
let added = 0;

for (const { source: sourceName, name } of DANCES) {
  if (peasant.sequences.some((s) => s.name === name)) {
    console.log('skip (already present): ' + name);
    continue;
  }
  const srcSeq = villager.sequences.find((s) => s.name === sourceName);
  if (srcSeq == null) throw new Error('source sequence not found: ' + sourceName);
  const srcStart = srcSeq.interval[0];
  const srcEnd = srcSeq.interval[1];
  const newStart = nextStart;
  const newEnd = newStart + (srcEnd - srcStart);
  nextStart = newEnd + GAP;

  const seq = new Sequence();
  seq.name = name;
  seq.interval = new Uint32Array([newStart, newEnd]);
  seq.nonLooping = 1; // a dance plays once per press
  const stand = peasant.sequences[0];
  seq.extent.boundsRadius = stand.extent.boundsRadius;
  seq.extent.min = Float32Array.from(stand.extent.min);
  seq.extent.max = Float32Array.from(stand.extent.max);
  peasant.sequences.push(seq);

  let copiedKeys = 0;
  for (const [nodeName, pNode] of pNodes) {
    const vNode = vNodes.get(nodeName);
    if (vNode == null) {
      // Peasant-only node: freeze at its first value so the new range does not
      // interpolate across the gap in the timeline.
      for (const anim of pNode.animations) {
        if (anim.globalSequenceId !== -1 || anim.frames.length === 0) continue;
        anim.frames.push(newStart);
        anim.values.push(anim.values[0].slice());
        if (anim.inTans.length > 0) {
          anim.inTans.push(anim.inTans[0].slice());
          anim.outTans.push(anim.outTans[0].slice());
        }
      }
      continue;
    }
    for (const tag of ['KGTR', 'KGRT', 'KGSC']) {
      const source = vNode.animations.find((a) => a.name === tag);
      if (source == null || source.globalSequenceId !== -1) continue;
      const idxs = [];
      for (let k = 0; k < source.frames.length; k++) {
        if (source.frames[k] >= srcStart && source.frames[k] <= srcEnd) idxs.push(k);
      }
      if (idxs.length === 0) continue;
      let dst = vNode === pNode ? null : pNode.animations.find((a) => a.name === tag);
      if (dst == null) {
        dst = new source.constructor();
        dst.name = tag;
        dst.interpolationType = source.interpolationType;
        dst.globalSequenceId = -1;
        pNode.animations.push(dst);
      }
      const dstTans = dst.interpolationType >= 2;
      const srcTans = source.interpolationType >= 2;
      for (const k of idxs) {
        dst.frames.push(source.frames[k] - srcStart + newStart);
        dst.values.push(source.values[k].slice());
        if (dstTans) {
          dst.inTans.push((srcTans ? source.inTans[k] : source.values[k]).slice());
          dst.outTans.push((srcTans ? source.outTans[k] : source.values[k]).slice());
        }
        copiedKeys++;
      }
    }
  }
  console.log('added "' + name + '" [' + newStart + '-' + newEnd + '] ' + copiedKeys + ' keys');
  added++;
}

if (added === 0) {
  console.log('nothing to do');
  process.exit(0);
}

const out = peasant.saveMdx();
fs.writeFileSync(TARGET, Buffer.from(out.buffer, out.byteOffset, out.byteLength));

const check = new Model();
check.load(new Uint8Array(fs.readFileSync(TARGET)));
console.log('--- sequences now in the peasant ---');
check.sequences.forEach((s, i) => {
  if (DANCES.some((d) => d.name === s.name) || s.name === 'Walk Alternate') {
    console.log('  ' + i + ' ' + JSON.stringify(s.name));
  }
});
