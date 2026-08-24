// Retimes individual dances so they PLAY faster or slower, by rewriting the
// keyframe times inside a sequence's range rather than asking the engine to
// scale playback. Same technique as retime-roll-anim.js, and for the same
// reason: the speed is baked into the keyframes, so it holds however WC3
// chooses to play the sequence, and no runtime code has to remember to set a
// time scale before the animation and put it back afterwards.
//
// Every animated track in the model is remapped, not just the bones: geoset
// alpha (the cargo-hiding keys from fix-dance-anims.js), texture animations,
// emitters and event objects all live on the same timeline, and moving the
// bones alone would slide them out of sync.
//
// Frames driven by a GLOBAL sequence are skipped -- their times are relative to
// that global sequence rather than to this one, so remapping them would corrupt
// animations elsewhere in the model.
//
// Idempotent, and loud when it cannot be sure. A multiplier applied twice is
// not the same as applying it once, so the script does not simply multiply what
// it finds: it converges on an absolute target derived from the length the
// sequence has when freshly transplanted. A sequence sitting at neither its
// natural length nor its target is something this script did not do, so it
// stops rather than compounding a change it does not understand.
//
// Last step of the dance chain, since the earlier steps rebuild the sequences
// at their natural lengths and would undo this:
//   node scripts/reset-dance-anims.js
//   node scripts/transplant-dance-anims.js
//   node scripts/fix-dance-anims.js
//   node scripts/retime-dance-anims.js

const fs = require('fs');
const base = 'mdx-m3-viewer-th/dist/cjs';
const Model = require(base + '/parsers/mdlx/model').default;

const TARGET = 'maps/TheTrainGame.w3x/war3mapImported/WeaponlessPeasant.mdx';

/** Dances to retime: name -> { speed, natural }.
 *
 *  speed   how much faster to play it. 1.15 is 15% faster.
 *  natural the sequence's length in ms straight out of the transplant, which is
 *          what makes the retime idempotent. Read it off the model after
 *          running fix-dance-anims.js; if a dance is later swapped for a
 *          different source animation, this number changes with it and the
 *          script will say so rather than guess. */
const RETIMED = {
  'Dance Two': { speed: 1.15, natural: 1667 },  // W, Attack Morph - 31
};

const model = new Model();
model.load(new Uint8Array(fs.readFileSync(TARGET)));

let changed = 0;
for (const [name, { speed, natural }] of Object.entries(RETIMED)) {
  const seq = model.sequences.find((s) => s.name === name);
  if (seq == null) {
    throw new Error(`no "${name}" sequence -- run the transplant and fix steps first`);
  }

  const start = seq.interval[0];
  const duration = seq.interval[1] - start;
  const target = Math.round(natural / speed);

  if (Math.abs(duration - target) <= 1) {
    console.log(`"${name}" already ${duration}ms (x${speed} of ${natural}ms)`);
    continue;
  }
  if (Math.abs(duration - natural) > 1) {
    throw new Error(
      `"${name}" is ${duration}ms, which is neither its natural ${natural}ms nor ` +
      `its target ${target}ms. Something else has retimed it, or the animation ` +
      `behind this dance was swapped -- rebuild through reset-dance-anims.js, or ` +
      `update the natural length in this script.`
    );
  }

  // Speeding a dance up shortens its range, so it cannot collide with the
  // sequence after it. Slowing one down can, and silently overlapping ranges
  // make WC3 blend one sequence into the next.
  const newEnd = start + target;
  for (const other of model.sequences) {
    if (other === seq) continue;
    if (other.interval[1] >= start && other.interval[0] <= newEnd) {
      throw new Error(
        `sequence "${other.name}" [${other.interval.join('-')}] would overlap ` +
        `"${name}" retimed to [${start}-${newEnd}]`
      );
    }
  }

  const end = seq.interval[1];
  const factor = target / duration;
  const remap = (f) => (f < start || f > end ? f : Math.round(start + (f - start) * factor));

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
  changed += 1;
  console.log(
    `"${name}" ${duration}ms -> ${target}ms (x${speed} faster), ` +
    `${keys} keyframes across ${tracks} tracks`
  );
}

if (changed === 0) {
  console.log('nothing to do');
  process.exit(0);
}

const out = model.saveMdx();
fs.writeFileSync(TARGET, Buffer.from(out.buffer, out.byteOffset, out.byteLength));

// Round trip: the lengths survived the save, and every dance is still keyed for
// geoset alpha across its NEW range -- the keys fix-dance-anims.js wrote sit at
// the old range ends, and a retime that left one outside would put the cargo
// geosets back on the dancer.
const check = new Model();
check.load(new Uint8Array(fs.readFileSync(TARGET)));
for (const [name, { speed, natural }] of Object.entries(RETIMED)) {
  const seq = check.sequences.find((s) => s.name === name);
  const target = Math.round(natural / speed);
  if (seq == null || Math.abs(seq.interval[1] - seq.interval[0] - target) > 1) {
    throw new Error(`retime of "${name}" did not survive the round trip`);
  }
  for (const g of check.geosetAnimations) {
    const track = g.animations && g.animations[0];
    if (track == null || track.name !== 'KGAO') continue;
    if (!track.frames.some((f) => f >= seq.interval[0] && f <= seq.interval[1])) {
      throw new Error(`geoset ${g.geosetId} left unkeyed during "${name}" by the retime`);
    }
  }
  console.log(`validation OK: "${name}" [${seq.interval.join('-')}]`);
}
