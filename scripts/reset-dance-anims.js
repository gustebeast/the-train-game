// Takes every "Dance *" sequence back out of the peasant, keyframes included,
// so transplant-dance-anims.js can lay down a fresh set.
//
// Needed whenever the dance list CHANGES rather than grows: the transplant only
// skips names already present, so it can add dances but never replace or
// reorder them. Leaving the old keys behind would also put two sets of frames
// in the same time range once new sequences reused it, and an MDX track has to
// be sorted.
//
// Run from the project root, then the other two in order:
//   node scripts/reset-dance-anims.js
//   node scripts/transplant-dance-anims.js
//   node scripts/fix-dance-anims.js
const fs = require('fs');
const { Model, TARGET, load, save } = require('./peasant-model');

const m = load();
const doomed = m.sequences.filter((s) => s.name.indexOf('Dance ') === 0);
if (doomed.length === 0) { console.log('nothing to strip'); process.exit(0); }
const ranges = doomed.map((s) => [s.interval[0], s.interval[1]]);
const inDoomed = (f) => ranges.some(([a, b]) => f >= a && f <= b);

const animated = [
  ...m.bones, ...m.helpers, ...m.attachments, ...m.lights, ...m.cameras,
  ...m.geosetAnimations, ...m.textureAnimations, ...m.particleEmitters,
  ...m.particleEmitters2, ...m.ribbonEmitters,
  ...m.materials.reduce((acc, mat) => acc.concat(mat.layers), []),
];
let dropped = 0;
let emptied = 0;
for (const obj of animated) {
  if (obj.animations == null) continue;
  for (const anim of obj.animations) {
    if (anim.globalSequenceId >= 0) continue;
    const hasTans = anim.inTans.length === anim.frames.length;
    const frames = []; const values = []; const inTans = []; const outTans = [];
    for (let i = 0; i < anim.frames.length; i++) {
      if (inDoomed(anim.frames[i])) { dropped += 1; continue; }
      frames.push(anim.frames[i]); values.push(anim.values[i]);
      if (hasTans) { inTans.push(anim.inTans[i]); outTans.push(anim.outTans[i]); }
    }
    anim.frames = frames; anim.values = values;
    if (hasTans) { anim.inTans = inTans; anim.outTans = outTans; }
  }
  // A track the transplant CREATED holds nothing but dance keys, so stripping
  // leaves it with none at all -- and a zero-key track makes WC3 reject the
  // whole model, which renders as an invisible unit with a shadow and a
  // selection circle. Drop those tracks outright.
  const keep = obj.animations.filter((a) => a.frames.length > 0);
  emptied += obj.animations.length - keep.length;
  obj.animations = keep;
}
for (const ev of m.eventObjects) ev.tracks = ev.tracks.filter((f) => !inDoomed(f));
m.sequences = m.sequences.filter((s) => s.name.indexOf('Dance ') !== 0);

save(m);
console.log(`stripped ${doomed.length} sequences, ${dropped} keyframes, ${emptied} emptied tracks`);
const check = load();
check.sequences.forEach((s, i) => console.log('  ' + i + ' ' + JSON.stringify(s.name)));
