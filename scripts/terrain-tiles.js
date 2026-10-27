// Makes every tile the script paints at runtime drawable in HD graphics.
//
// HD (Definitive / Reforged) draws a tile painted by SetTerrainType only if
// war3map.w3e both lists it and has it on at least one terrain point; anything
// else renders as the ground underneath. Classic draws it regardless. So for
// each runtime tile (src/terrain/tiles.ts) this:
//
// - appends it to the w3e tile list if missing. Appended, never reordered:
//   list order is draw priority where two tiles meet, so the editor's own
//   tiles keep their stacking;
// - paints it on one point of the map's outermost top row if no point has it
//   yet. That row is the map's boundary, outside the camera bounds, so nothing
//   painted there is ever seen.
//
// The list may exceed the World Editor's 16: with 21, WC3 3.0 drew every
// board in Definitive (winter's tiles past index 16 included), and the 2.0.4
// VMs passed the full suite on it (2026-10-27).
//
// Format 12 (the only one known here): 'W3E!', version, tileset char, custom
// flag, tile count + ids, cliff count + ids, width, height, offset x, y, then
// 8 bytes per point with the ground texture index in the low 6 bits of byte 4.
const fs = require('fs');

function ensureRuntimeTiles(w3ePath, runtimeTiles) {
  const b = fs.readFileSync(w3ePath);
  if (b.toString('latin1', 0, 4) !== 'W3E!') throw new Error('war3map.w3e: bad magic');
  const version = b.readInt32LE(4);
  if (version !== 12) throw new Error(`war3map.w3e is version ${version}; only 12 is known (scripts/terrain-tiles.js)`);

  const count = b.readInt32LE(13);
  const tiles = [];
  for (let i = 0; i < count; i++) tiles.push(b.toString('latin1', 17 + 4 * i, 21 + 4 * i));
  const added = runtimeTiles.filter(t => !tiles.includes(t));
  const all = tiles.concat(added);
  if (all.length > 64) throw new Error(`war3map.w3e would list ${all.length} tiles; the point format holds 64`);

  const head = Buffer.alloc(17 + 4 * all.length);
  b.copy(head, 0, 0, 13);
  head.writeInt32LE(all.length, 13);
  all.forEach((t, i) => head.write(t, 17 + 4 * i, 'latin1'));
  const out = Buffer.concat([head, b.subarray(17 + 4 * count)]);

  let at = 17 + 4 * all.length;
  const cliffs = out.readInt32LE(at);
  at += 4 + 4 * cliffs;
  const width = out.readInt32LE(at);
  const height = out.readInt32LE(at + 4);
  const points = at + 16;
  if (out.length !== points + 8 * width * height) {
    throw new Error(`war3map.w3e: ${out.length - points} bytes of points for ${width}x${height}; expected 8 each`);
  }

  const texture = (i) => out[points + 8 * i + 4] & 0x3f;
  const used = new Set();
  for (let i = 0; i < width * height; i++) used.add(texture(i));
  const missing = runtimeTiles.map(t => all.indexOf(t)).filter(i => !used.has(i));
  if (missing.length > width) throw new Error(`war3map.w3e: ${missing.length} tiles to place in a ${width}-point row`);
  const row = height - 1;
  missing.forEach((tileIndex, x) => {
    const p = points + 8 * (row * width + x) + 4;
    out[p] = (out[p] & 0xc0) | tileIndex;
  });

  fs.writeFileSync(w3ePath, out);
  return { added, placed: missing.map(i => all[i]) };
}

module.exports = { ensureRuntimeTiles };
