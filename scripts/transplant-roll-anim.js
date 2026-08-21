// Transplants the combat-roll animation ("Attack Morph - 19", sequence index
// 31) from Graber's Villager 255 model into WeaponlessPeasant.mdx as a new
// sequence named "Roll" (playable via SetUnitAnimationByIndex with the index
// printed at the end; unknown sequence names are never auto-played by WC3).
//
// Works because both models descend from Blizzard's villager-family rig —
// 19 of the peasant's 23 bones/helpers share exact names with Villager 255.
// Peasant-only nodes get a single freeze key (rest pose) for the new range.
//
// Source model is read from the reference map archive (not committed here):
//   C:/Users/gus/Downloads/ShootingGay_0.6_english.w3x
// Run from the project root:  node scripts/transplant-roll-anim.js
// Credits: Villager 255 Animations by Graber (hiveworkshop.com).

const fs = require('fs');
const base = 'mdx-m3-viewer-th/dist/cjs';
const War3Map = require(base + '/parsers/w3x/map').default;
const Model = require(base + '/parsers/mdlx/model').default;
const Sequence = require(base + '/parsers/mdlx/sequence').default;

const SOURCE_MAP = 'C:/Users/gus/Downloads/ShootingGay_0.6_english.w3x';
const SOURCE_MODEL = 'war3mapImported\\Villager255.mdx';
const SOURCE_SEQ_NAME = 'Attack Morph - 19';
const TARGET = 'maps/TheTrainGame.w3x/war3mapImported/WeaponlessPeasant.mdx';
// Named "Roll" here, then re-tagged to "Walk Alternate" by
// roll-anim-to-alternate-walk.js -- run that next. The rename is what lets the
// engine play it during movement instead of trigger code fighting the walk.
const NEW_NAME = 'Roll';
const NEW_START = 200000; // safely beyond the peasant's last keyframe (~193733)

function loadVillager() {
  const map = new War3Map();
  map.load(new Uint8Array(fs.readFileSync(SOURCE_MAP)), true);
  const f = map.get(SOURCE_MODEL);
  if (f == null) throw new Error('Villager255.mdx not found in source map');
  const m = new Model();
  m.load(f.bytes());
  return m;
}

function nodesByName(model) {
  const out = new Map();
  for (const n of [...model.bones, ...model.helpers]) out.set(n.name.toLowerCase(), n);
  return out;
}

function findAnim(node, tag) {
  return node.animations.find((a) => a.name === tag) ?? null;
}

const villager = loadVillager();
const peasant = new Model();
peasant.load(new Uint8Array(fs.readFileSync(TARGET)));

const srcSeq = villager.sequences.find((s) => s.name === SOURCE_SEQ_NAME);
if (srcSeq == null) throw new Error('source sequence not found');
const [srcStart, srcEnd] = [srcSeq.interval[0], srcSeq.interval[1]];
const NEW_END = NEW_START + (srcEnd - srcStart);

if (peasant.sequences.some((s) => s.name === NEW_NAME)) {
  throw new Error('peasant already has a Roll sequence — transplant already done?');
}

// New sequence entry (nonLooping), bounds copied from the peasant's Stand
const seq = new Sequence();
seq.name = NEW_NAME;
seq.interval = new Uint32Array([NEW_START, NEW_END]);
seq.flags = 1; // NonLooping
const stand = peasant.sequences[0];
seq.extent.boundsRadius = stand.extent.boundsRadius;
seq.extent.min = Float32Array.from(stand.extent.min);
seq.extent.max = Float32Array.from(stand.extent.max);
const newIndex = peasant.sequences.length;
peasant.sequences.push(seq);

const vNodes = nodesByName(villager);
const pNodes = nodesByName(peasant);
let copiedTracks = 0;
let copiedKeys = 0;
let frozen = 0;

for (const [name, pNode] of pNodes) {
  const vNode = vNodes.get(name);

  if (vNode == null) {
    // Peasant-only node: freeze at its first known value so the new range
    // doesn't interpolate across the timeline gap
    for (const anim of pNode.animations) {
      if (anim.globalSequenceId !== -1 || anim.frames.length === 0) continue;
      anim.frames.push(NEW_START);
      anim.values.push(anim.values[0].slice());
      if (anim.inTans.length > 0) {
        anim.inTans.push(anim.inTans[0].slice());
        anim.outTans.push(anim.outTans[0].slice());
      }
      frozen++;
    }
    continue;
  }

  for (const tag of ['KGTR', 'KGRT', 'KGSC']) {
    const src = vNode.animations.find((a) => a.name === tag);
    if (src == null || src.globalSequenceId !== -1) continue;

    // Collect source keys inside the roll interval
    const idxs = [];
    for (let k = 0; k < src.frames.length; k++) {
      if (src.frames[k] >= srcStart && src.frames[k] <= srcEnd) idxs.push(k);
    }
    if (idxs.length === 0) continue;

    let dst = vNode === pNode ? null : pNode.animations.find((a) => a.name === tag);
    if (dst == null) {
      // Same concrete class as the source, empty tracks
      dst = new src.constructor();
      dst.name = tag;
      dst.interpolationType = src.interpolationType;
      dst.globalSequenceId = -1;
      pNode.animations.push(dst);
    }
    const dstTans = dst.interpolationType >= 2; // Hermite/Bezier need tangents
    const srcTans = src.interpolationType >= 2;

    for (const k of idxs) {
      dst.frames.push(src.frames[k] - srcStart + NEW_START);
      dst.values.push(src.values[k].slice());
      if (dstTans) {
        // Reuse source tangents when present; otherwise flat tangents from
        // the value itself (adequate for a fast 1.1s roll)
        dst.inTans.push((srcTans ? src.inTans[k] : src.values[k]).slice());
        dst.outTans.push((srcTans ? src.outTans[k] : src.values[k]).slice());
      }
      copiedKeys++;
    }
    copiedTracks++;
  }
}

const out = peasant.saveMdx();
fs.writeFileSync(TARGET, Buffer.from(out.buffer, out.byteOffset, out.byteLength));

// Validate round-trip
const check = new Model();
check.load(new Uint8Array(fs.readFileSync(TARGET)));
const got = check.sequences[newIndex];
if (got == null || got.name !== NEW_NAME) throw new Error('validation failed');
console.log(`OK: sequence "${NEW_NAME}" at index ${newIndex} [${NEW_START}-${NEW_END}]`);
console.log(`copied ${copiedKeys} keys across ${copiedTracks} tracks; froze ${frozen} peasant-only tracks`);
console.log('total sequences now:', check.sequences.length);
