// Move an attachment ref (its pivot point) inside a binary MDX model.
//
// Usage: node scripts/patch-attachment-pivot.js <file.mdx> "<node name>" <x> <y> <z>
//        node scripts/patch-attachment-pivot.js <file.mdx> --list
//
// Model space: +X = unit facing (front), +Y = unit's left, +Z = up.
// The pivot lives in the PIVT chunk, indexed by the node's objectId, so the
// patch is a 12-byte in-place write — no other chunk changes.
const fs = require('fs');

const [, , file, nodeName, xs, ys, zs] = process.argv;
if (file == null || nodeName == null) {
  console.error('usage: node patch-attachment-pivot.js <file.mdx> "<node name>"|--list [x y z]');
  process.exit(1);
}
const buf = fs.readFileSync(file);
if (buf.toString('latin1', 0, 4) !== 'MDLX') throw new Error('not an MDX file');

// Index top-level chunks
let off = 4;
const chunks = {};
while (off + 8 <= buf.length) {
  const tag = buf.toString('latin1', off, off + 4);
  const size = buf.readUInt32LE(off + 4);
  chunks[tag] = { start: off + 8, size };
  off += 8 + size;
}
if (chunks.ATCH == null || chunks.PIVT == null) throw new Error('missing ATCH/PIVT chunk');

// Walk ATCH attachments: each is u32 inclusiveSize, then a node
// (u32 inclusiveSize, char[80] name, u32 objectId, ...)
const attachments = [];
let p = chunks.ATCH.start;
while (p < chunks.ATCH.start + chunks.ATCH.size) {
  const entrySize = buf.readUInt32LE(p);
  const name = buf.toString('latin1', p + 8, p + 88).replace(/\0.*$/, '').trim();
  const objectId = buf.readUInt32LE(p + 88);
  attachments.push({ name, objectId });
  p += entrySize;
}

const pivotAt = (id) => chunks.PIVT.start + id * 12;

if (nodeName === '--list') {
  for (const a of attachments) {
    const o = pivotAt(a.objectId);
    console.log(`${a.name}  id=${a.objectId}  (${buf.readFloatLE(o).toFixed(1)}, ${buf.readFloatLE(o + 4).toFixed(1)}, ${buf.readFloatLE(o + 8).toFixed(1)})`);
  }
  process.exit(0);
}

const match = attachments.find(a => a.name.toLowerCase() === nodeName.toLowerCase().trim());
if (match == null) {
  console.error(`node "${nodeName}" not found; attachments: ${attachments.map(a => a.name).join(', ')}`);
  process.exit(1);
}
const o = pivotAt(match.objectId);
const before = [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)];
buf.writeFloatLE(parseFloat(xs), o);
buf.writeFloatLE(parseFloat(ys), o + 4);
buf.writeFloatLE(parseFloat(zs), o + 8);
fs.writeFileSync(file, buf);
console.log(`${match.name}: (${before.map(v => v.toFixed(1)).join(', ')}) -> (${xs}, ${ys}, ${zs})`);
