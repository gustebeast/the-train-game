// Re-tags the transplanted roll (see transplant-roll-anim.js) as the peasant's
// ALTERNATE WALK, so the engine plays it instead of trigger code forcing it.
//
// Why: a sequence named "Roll" is one WC3 never plays on its own, so it had to
// be started with SetUnitAnimationByIndex. That loses immediately on a moving
// unit -- the engine re-asserts the walk animation as the peasant travels, so
// the roll flickered and vanished, which is why the dash showed a speed change
// and no roll. Renaming it to "Walk Alternate" makes it the walk the engine
// itself picks while AddUnitAnimationProperties(u, 'alternate', true) is set,
// so it survives for as long as the dash does and needs nothing per frame.
//
// moveSpeed is a field on the SEQUENCE, not on the unit: it declares the travel
// speed the animation was authored for, and WC3 then plays the sequence at
// unitSpeed/moveSpeed. So it tunes playback rate ONLY -- raising it slows the
// animation down and does not change how fast the peasant travels. The normal
// Walk is 150, which at the 522 dash speed would spin the roll at 3.5x; 500
// plays it at roughly 1x, which is the speed it was animated at.
//
// Idempotent: re-running converges the sequence onto the values below, so
// changing one here and re-running is all it takes to retune.
// Run from the project root:  node scripts/roll-anim-to-alternate-walk.js

const fs = require('fs');
const base = 'mdx-m3-viewer-th/dist/cjs';
const Model = require(base + '/parsers/mdlx/model').default;

const TARGET = 'maps/TheTrainGame.w3x/war3mapImported/WeaponlessPeasant.mdx';
const OLD_NAME = 'Roll';
const NEW_NAME = 'Walk Alternate';
const MOVE_SPEED = 500;

const model = new Model();
model.load(fs.readFileSync(TARGET));

const roll = model.sequences.find((s) => s.name === NEW_NAME || s.name === OLD_NAME);
const wasNamed = roll == null ? '' : roll.name;
if (roll == null) {
  throw new Error(`no "${OLD_NAME}" sequence -- run transplant-roll-anim.js first`);
}

const alreadyRight =
  roll.name === NEW_NAME && roll.moveSpeed === MOVE_SPEED && roll.nonLooping === 0;
if (alreadyRight) {
  console.log(`nothing to do -- "${NEW_NAME}" already at moveSpeed ${MOVE_SPEED}`);
  process.exit(0);
}

roll.name = NEW_NAME;
roll.moveSpeed = MOVE_SPEED;
roll.nonLooping = 0; // a dash longer than one roll should keep rolling

fs.writeFileSync(TARGET, Buffer.from(model.saveMdx()));

const check = new Model();
check.load(fs.readFileSync(TARGET));
const out = check.sequences.find((s) => s.name === NEW_NAME);
if (out == null) throw new Error('rename did not survive the round trip');
console.log(
  `"${wasNamed}" -> "${out.name}" [${out.interval.join('-')}], ` +
  `moveSpeed ${out.moveSpeed}, looping ${out.nonLooping === 0}`
);
