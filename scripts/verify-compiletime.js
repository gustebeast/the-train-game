// Replicates war3-transformer's compiletime evaluation pipeline on the real
// src/compiletime.ts, so eval-breaking syntax (e.g. emitted TS helpers) and
// runtime crashes (sealed objects etc.) are caught before submitting.
// Usage: node verify-compiletime.js <worktree-root>
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || process.cwd();
// Rebind require so bare requires inside the eval'd compiletime block resolve
// from the worktree's node_modules, like they do when the transformer runs.
require = require('module').createRequire(path.join(root, 'package.json'));
const req = p => require(path.join(root, 'node_modules', p));

const ts = req('typescript');
const { loadObjectData } = req('war3-transformer/dist/objectdata.js');
const compileTimeObjects = req('war3-objectdata-th/dist/cjs');
const { stringToBase256 } = req('mdx-m3-viewer-th/dist/cjs/common/typecast');

const source = fs.readFileSync(path.join(root, 'src', 'compiletime.ts'), 'utf8');

// Extract the argument of the single top-level compiletime(...) call.
const start = source.indexOf('compiletime(');
if (start !== 0) throw new Error('expected compiletime( at start of file, found at ' + start);
const end = source.lastIndexOf(');');
const codeBlock = source.slice('compiletime('.length, end);

// Mirror transformer.js exactly: default-options transpile, strip trailing
// semicolon, wrap in parens, eval, call with the same context object.
let transpiledJs = ts.transpile(codeBlock).trimRight();
if (transpiledJs[transpiledJs.length - 1] === ';') {
  transpiledJs = transpiledJs.substr(0, transpiledJs.length - 1);
}

const objectData = loadObjectData(path.join(root, 'maps', 'TheTrainGame.w3x'));
let fn;
try {
  fn = eval('(' + transpiledJs + ')');
} catch (e) {
  console.error('EVAL FAILED (this is what breaks the build):', e.message);
  const m = /var __\w+/.exec(transpiledJs);
  if (m) console.error('Emitted TS helper detected:', m[0], '- avoid spread/etc. in the compiletime block.');
  process.exit(1);
}

const result = fn({
  objectData,
  fourCC: stringToBase256,
  log: console.log,
  constants: {
    abilities: compileTimeObjects.Abilities,
    buffs: compileTimeObjects.Buffs,
    destructables: compileTimeObjects.Destructables,
    doodads: compileTimeObjects.Doodads,
    items: compileTimeObjects.Items,
    units: compileTimeObjects.Units,
    upgrades: compileTimeObjects.Upgrades,
  },
});

console.log('compiletime block evaluated OK, result:', JSON.stringify(result));

// Sanity check the current fix: all six attachment abilities must emit Iatt=0.
const files = objectData.save();
const want = ['AItk', 'AItl', 'AItn', 'AIth', 'AIti', 'AIt6'];
const got = new Map();
if (files.w3a) {
  for (const obj of [...files.w3a.originalTable.objects, ...files.w3a.customTable.objects]) {
    for (const mod of obj.modifications) {
      if (mod.id === 'Iatt') got.set(obj.oldId, mod.value);
    }
  }
}
let ok = true;
for (const code of want) {
  const v = got.get(code);
  if (v !== 0) { console.error('MISSING/WRONG Iatt for', code, '- got', v); ok = false; }
}
if (!ok) process.exit(1);
console.log('All six attachment abilities emit Iatt=0 into war3map.w3a.');
