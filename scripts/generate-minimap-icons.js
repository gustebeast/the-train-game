// Generates the custom minimap tool-icon textures (TGA) into
// maps/TheTrainGame.w3x/war3mapImported/.
//
// Run from the project root:  node scripts/generate-minimap-icons.js
//
// CreateMinimapIcon's pingPath takes a 16x16 image file (.blp/.tga/.dds),
// which the game scales to the standard minimap icon slot. (Passing a 3D
// model renders it in the wrong coordinate space and can cover the whole
// screen — don't.) To render the tools at ~50% of the standard icon size,
// each glyph is drawn in the CENTRAL 8x8 of the 16x16 canvas with a
// transparent border: half-size relative to the canvas, whether the game
// normalizes the canvas to the slot or draws it 1:1.
//
// Glyph art: ASCII grids below, '#' = opaque white (tinted per-item at
// runtime by CreateMinimapIcon's RGB args), '.' = transparent.

const fs = require('fs');
const path = require('path');

const TEX_SIZE = 16;
const GLYPH_SIZE = 8; // drawn centered — (TEX_SIZE - GLYPH_SIZE) / 2 margin
const OUT_DIR = path.join(__dirname, '..', 'maps', 'TheTrainGame.w3x', 'war3mapImported');

const GLYPHS = {
  Axe: [
    '.###....',
    '#####...',
    '######..',
    '.#####..',
    '...##...',
    '...##...',
    '...##...',
    '...##...',
  ],
  Pickaxe: [
    '.######.',
    '##....##',
    '#..##..#',
    '...##...',
    '...##...',
    '...##...',
    '...##...',
    '...##...',
  ],
  Bucket: [
    '########',
    '##....##',
    '##....##',
    '.#....#.',
    '.#....#.',
    '.##..##.',
    '..####..',
    '........',
  ],
  BucketFull: [
    '########',
    '########',
    '########',
    '.######.',
    '.######.',
    '.######.',
    '..####..',
    '........',
  ],
};

/** Write a 32-bit uncompressed TGA (top-left origin) with the glyph centered. */
function writeTga(filePath, glyph) {
  const header = Buffer.alloc(18);
  header[2] = 2; // uncompressed truecolor
  header.writeUInt16LE(TEX_SIZE, 12); // width
  header.writeUInt16LE(TEX_SIZE, 14); // height
  header[16] = 32; // bits per pixel
  header[17] = 0x28; // top-left origin + 8 alpha bits

  const margin = (TEX_SIZE - GLYPH_SIZE) / 2;
  const pixels = Buffer.alloc(TEX_SIZE * TEX_SIZE * 4);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const gy = y - margin;
      const gx = x - margin;
      const on = gy >= 0 && gy < GLYPH_SIZE && gx >= 0 && gx < GLYPH_SIZE
        && glyph[gy][gx] === '#';
      const i = (y * TEX_SIZE + x) * 4;
      // BGRA — keep RGB white on transparent pixels so filtering doesn't
      // darken the glyph edges
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = on ? 255 : 0;
    }
  }
  fs.writeFileSync(filePath, Buffer.concat([header, pixels]));
}

function main() {
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    if (glyph.length !== GLYPH_SIZE || glyph.some((row) => row.length !== GLYPH_SIZE)) {
      throw new Error(`Glyph ${name} is not ${GLYPH_SIZE}x${GLYPH_SIZE}`);
    }
    const texFile = `Minimap${name}.tga`;
    writeTga(path.join(OUT_DIR, texFile), glyph);
    console.log(`OK ${texFile} (${TEX_SIZE}x${TEX_SIZE}, glyph ${GLYPH_SIZE}x${GLYPH_SIZE})`);
  }
}

main();
