// The peasant model every animation script edits, and the one way to read and
// write it.
//
// Eight scripts each hard-coded this path and then disagreed about the rest:
// six loaded through `new Uint8Array(readFileSync(...))` and two handed the
// Buffer straight to load(); six saved through the byteOffset form and two
// through Buffer.from(saveMdx()). All four spellings work, which is exactly how
// they drifted -- nothing ever failed to tell anyone. Renaming the model was
// also eight edits.

const fs = require('fs');
const Model = require('mdx-m3-viewer-th/dist/cjs/parsers/mdlx/model').default;

/** The imported peasant, the model all the roll and dance work edits. */
const TARGET = 'maps/TheTrainGame.w3x/war3mapImported/WeaponlessPeasant.mdx';

/** Read a model from disk. Defaults to the peasant. */
function load(path = TARGET) {
  const model = new Model();
  model.load(new Uint8Array(fs.readFileSync(path)));
  return model;
}

/** Write a model back over itself.
 *
 *  saveMdx returns a VIEW, so the buffer is sliced by byteOffset/byteLength.
 *  Buffer.from(view) happens to copy correctly too, but only one of the two
 *  spellings should be in the tree. */
function save(model, path = TARGET) {
  const out = model.saveMdx();
  fs.writeFileSync(path, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
}

module.exports = { Model, TARGET, load, save };
