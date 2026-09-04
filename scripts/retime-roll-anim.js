// Stretches the roll ("Walk Alternate") so it PLAYS slower, by rewriting the
// keyframe times inside its range rather than asking the engine to slow it.
//
// Why not the sequence's moveSpeed: that is the documented lever -- WC3 plays a
// walk at unitSpeed/moveSpeed -- and raising it from 250 to 500 did not visibly
// change the roll in game. Whatever the engine is doing for an alternate walk,
// it is not honouring that field the way a normal walk suggests. Retiming the
// animation itself is independent of any of that: half the speed is baked into
// the keyframes, so it holds however WC3 chooses to scale playback.
//
// Every animated track in the model is remapped, not just the bones: geoset
// alpha (the cargo-hiding keys from fix-roll-geosets.js), texture animations,
// emitters and event objects all live on the same timeline, and stretching the
// bones alone would slide them out of sync.
//
// Frames driven by a GLOBAL sequence are skipped -- their times are relative to
// that global sequence, not to this one, so remapping them would corrupt
// animations elsewhere in the model.
//
// Idempotent: it converges on TARGET_MS, so re-running does nothing and
// changing the number below and re-running retunes it.
// Run from the project root:  node scripts/retime-roll-anim.js

const fs = require('fs');
const { Model, TARGET, load, save } = require('./peasant-model');

const SEQ_NAME = 'Walk Alternate';
const TARGET_MS = 2334; // twice the transplanted roll's natural 1167ms

const model = load();

const seq = model.sequences.find((s) => s.name === SEQ_NAME);
if (seq == null) {
  throw new Error(`no "${SEQ_NAME}" sequence -- run roll-anim-to-alternate-walk.js first`);
}

const start = seq.interval[0];
const end = seq.interval[1];
const duration = end - start;
if (Math.abs(duration - TARGET_MS) <= 1) {
  console.log(`nothing to do -- "${SEQ_NAME}" is already ${duration}ms`);
  process.exit(0);
}

const factor = TARGET_MS / duration;
const remap = (f) => (f < start || f > end ? f : Math.round(start + (f - start) * factor));

// Nothing else in the model may sit at or past the stretched end, or the two
// ranges would overlap and WC3 would blend one sequence into the other.
const newEnd = start + TARGET_MS;
for (const other of model.sequences) {
  if (other === seq) continue;
  if (other.interval[1] >= start && other.interval[0] <= newEnd) {
    throw new Error(`sequence "${other.name}" [${other.interval.join('-')}] would overlap the stretched range [${start}-${newEnd}]`);
  }
}

const animated = [
  ...model.bones, ...model.helpers, ...model.attachments, ...model.lights,
  ...model.cameras, ...model.geosetAnimations, ...model.textureAnimations,
  ...model.particleEmitters, ...model.particleEmitters2, ...model.ribbonEmitters,
  ...model.materials.reduce((acc, m) => acc.concat(m.layers), []),
];

let tracks = 0;
let keys = 0;
for (const obj of animated) {
  for (const anim of obj.animations || []) {
    if (anim.globalSequenceId >= 0) continue;
    let touched = false;
    for (let i = 0; i < anim.frames.length; i++) {
      const next = remap(anim.frames[i]);
      if (next !== anim.frames[i]) { anim.frames[i] = next; keys += 1; touched = true; }
    }
    if (touched) tracks += 1;
  }
}
for (const ev of model.eventObjects) {
  for (let i = 0; i < ev.tracks.length; i++) {
    const next = remap(ev.tracks[i]);
    if (next !== ev.tracks[i]) { ev.tracks[i] = next; keys += 1; }
  }
}

seq.interval[1] = newEnd;
save(model);

const check = load();
const out = check.sequences.find((s) => s.name === SEQ_NAME);
if (out == null || out.interval[1] - out.interval[0] !== TARGET_MS) {
  throw new Error('retime did not survive the round trip');
}
console.log(
  `"${SEQ_NAME}" ${duration}ms -> ${TARGET_MS}ms (x${factor.toFixed(2)} slower), ` +
  `${keys} keyframes across ${tracks} tracks, now [${out.interval.join('-')}]`
);
