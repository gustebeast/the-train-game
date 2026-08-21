// The transplanted "Roll" sequence (see transplant-roll-anim.js) copied bone
// animation but NOT geoset-visibility (KGAO) keyframes. The peasant's carry and
// decay geosets (lumber, gold, small carry, skeleton) are each gated by a
// stepped KGAO alpha track whose last keyframe (~193133) falls BEFORE the Roll
// time range (200000-201167). With no key inside that range the alpha holds its
// last value (visible), so the roll renders a skeleton + a carried log even on
// an empty-handed peasant.
//
// Fix: append an alpha=0 key across the Roll range to every geoset-animation
// track, hiding cargo + skeleton for the duration of the roll. (A carried item
// therefore disappears during the roll and reappears after — the accepted
// behaviour; a per-cargo roll variant would need separate "Roll Lumber"/"Roll
// Gold" sequences.) Idempotent: re-running is a no-op once the keys exist.
//
// Run from the project root:  node scripts/fix-roll-geosets.js

const fs = require('fs');
const base = 'mdx-m3-viewer-th/dist/cjs';
const Model = require(base + '/parsers/mdlx/model').default;

const TARGET = 'maps/TheTrainGame.w3x/war3mapImported/WeaponlessPeasant.mdx';

const m = new Model();
m.load(new Uint8Array(fs.readFileSync(TARGET)));

// The sequence is called "Walk Alternate" once roll-anim-to-alternate-walk.js
// has re-tagged it; accept the pre-rename name too so this still works on a
// freshly transplanted model.
const roll = m.sequences.find((s) => s.name === 'Walk Alternate' || s.name === 'Roll');
if (roll == null) throw new Error('no roll sequence — run transplant-roll-anim.js first');
const rs = roll.interval[0];
const re = roll.interval[1];

/** Append alpha=0 keys at the roll range to a stepped KGAO track. */
function hideDuringRoll(track) {
  if (track.frames.some((f) => f >= rs && f <= re)) return false; // already patched
  const sample = track.values[0];
  const zero = () => (Array.isArray(sample) ? sample.map(() => 0) : 0);
  const hasTans = Array.isArray(track.inTans) && track.inTans.length === track.frames.length;
  for (const f of [rs, re]) {
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
  if (hideDuringRoll(track)) patched += 1;
}

if (patched === 0) {
  console.log('nothing to patch — geoset alpha already keyed in the Roll range');
} else {
  const out = m.saveMdx();
  fs.writeFileSync(TARGET, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  console.log(`patched ${patched} geoset-animation alpha tracks: hidden during Roll [${rs}-${re}]`);
}

// Round-trip validation.
const check = new Model();
check.load(new Uint8Array(fs.readFileSync(TARGET)));
for (const g of check.geosetAnimations) {
  const track = g.animations && g.animations[0];
  if (track == null || track.name !== 'KGAO') continue;
  const inRange = track.frames.filter((f) => f >= rs && f <= re);
  if (inRange.length === 0) throw new Error(`geoset ${g.geosetId} still unkeyed in roll range`);
}
console.log('validation OK: every geoset-animation is keyed within the Roll range');
