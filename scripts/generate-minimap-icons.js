// Generates the custom minimap tool-icon assets (TGA textures + MDX models)
// into maps/TheTrainGame.w3x/war3mapImported/.
//
// Run from the project root:  node scripts/generate-minimap-icons.js
//
// CreateMinimapIcon's pingPath requires a MODEL (a texture path silently
// shows nothing — hiveworkshop.com/threads/minimap-icon-wont-show.349318).
// Each model is a flat unshaded quad textured with a 16x16 glyph TGA.
//
// SIZE: The icon renderer draws the model in a screen-like coordinate
// space, NOT world units (a 12x12 quad covered the entire screen; a
// 0.005-half-extent quad renders roughly stock-icon sized). QUAD_HALF was
// calibrated in-game by the user: on a ladder where 0.002 was "1" and
// 0.005 was "10", they picked 8 → 0.00433.
//
// Glyph art: ASCII grids below, '#' = opaque white (tinted per-item at
// runtime by CreateMinimapIcon's RGB args), '.' = transparent.

const fs = require('fs');
const path = require('path');
const Model = require('mdx-m3-viewer-th/dist/cjs/parsers/mdlx/model').default;

const TEX_SIZE = 16;
const OUT_DIR = path.join(__dirname, '..', 'maps', 'TheTrainGame.w3x', 'war3mapImported');

// User-calibrated icon size (see header). Same for all tools.
const QUAD_HALF = {
  Axe: 0.00433,
  Pickaxe: 0.00433,
  Bucket: 0.00433,
  BucketFull: 0.00433,
};

const GLYPHS = {
  Axe: [
    '................',
    '....#####.......',
    '..#######.......',
    '.########.......',
    '.#########......',
    '..########......',
    '....######......',
    '......####......',
    '......###.......',
    '......###.......',
    '......###.......',
    '......###.......',
    '......###.......',
    '......###.......',
    '......###.......',
    '................',
  ],
  Pickaxe: [
    '................',
    '.....######.....',
    '...##########...',
    '..####.##.####..',
    '.###...##...###.',
    '.##....##....##.',
    '.#.....##.....#.',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '................',
  ],
  Bucket: [
    '................',
    '................',
    '.##############.',
    '.##############.',
    '.##..........##.',
    '.##..........##.',
    '..##........##..',
    '..##........##..',
    '..##........##..',
    '...##......##...',
    '...##......##...',
    '...##......##...',
    '...##########...',
    '...##########...',
    '................',
    '................',
  ],
  BucketFull: [
    '................',
    '................',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '...##########...',
    '...##########...',
    '...##########...',
    '...##########...',
    '................',
    '................',
  ],
};

/** Write a 32-bit uncompressed TGA (top-left origin) from an ASCII glyph. */
function writeTga(filePath, glyph) {
  const header = Buffer.alloc(18);
  header[2] = 2; // uncompressed truecolor
  header.writeUInt16LE(TEX_SIZE, 12); // width
  header.writeUInt16LE(TEX_SIZE, 14); // height
  header[16] = 32; // bits per pixel
  header[17] = 0x28; // top-left origin + 8 alpha bits

  const pixels = Buffer.alloc(TEX_SIZE * TEX_SIZE * 4);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const on = glyph[y][x] === '#';
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

/** Build MDL text for a flat unshaded quad using the given texture. */
function buildMdl(name, texturePath, h) {
  const r = Math.ceil(Math.sqrt(2 * h * h) * 10000) / 10000;
  const extent = `
		MinimumExtent { ${-h}, ${-h}, 0 },
		MaximumExtent { ${h}, ${h}, 0.001 },
		BoundsRadius ${r},`;
  return `Version {
	FormatVersion 800,
}
Model "${name}" {
	BlendTime 150,${extent.replace(/\t\t/g, '\t')}
}
Sequences 1 {
	Anim "Stand" {
		Interval { 0, 1000 },${extent}
	}
}
Textures 1 {
	Bitmap {
		Image "${texturePath}",
	}
}
Materials 1 {
	Material {
		Layer {
			FilterMode Blend,
			Unshaded,
			Unfogged,
			TwoSided,
			static TextureID 0,
		}
	}
}
Geoset {
	Vertices 4 {
		{ ${-h}, ${-h}, 0 },
		{ ${h}, ${-h}, 0 },
		{ ${-h}, ${h}, 0 },
		{ ${h}, ${h}, 0 },
	},
	Normals 4 {
		{ 0, 0, 1 },
		{ 0, 0, 1 },
		{ 0, 0, 1 },
		{ 0, 0, 1 },
	},
	TVertices 4 {
		{ 0, 1 },
		{ 1, 1 },
		{ 0, 0 },
		{ 1, 0 },
	},
	VertexGroup {
		0,
		0,
		0,
		0,
	},
	Faces 1 6 {
		Triangles {
			{ 0, 1, 2, 2, 1, 3 },
		},
	},
	Groups 1 1 {
		Matrices { 0 },
	},${extent.replace(/\t\t/g, '\t')}
	MaterialID 0,
	SelectionGroup 0,
}
Bone "Root" {
	ObjectId 0,
}
PivotPoints 1 {
	{ 0, 0, 0 },
}
`;
}

function main() {
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    if (glyph.length !== TEX_SIZE || glyph.some((row) => row.length !== TEX_SIZE)) {
      throw new Error(`Glyph ${name} is not ${TEX_SIZE}x${TEX_SIZE}`);
    }

    const texFile = `Minimap${name}.tga`;
    const mdxFile = `Minimap${name}.mdx`;
    writeTga(path.join(OUT_DIR, texFile), glyph);

    const model = new Model();
    model.load(buildMdl(`Minimap${name}`, `war3mapImported\\${texFile}`, QUAD_HALF[name]));
    const mdx = model.saveMdx();
    fs.writeFileSync(path.join(OUT_DIR, mdxFile), Buffer.from(mdx.buffer, mdx.byteOffset, mdx.byteLength));

    // Validate: re-parse the written MDX
    const check = new Model();
    check.load(new Uint8Array(fs.readFileSync(path.join(OUT_DIR, mdxFile))));
    if (check.geosets.length !== 1 || check.textures.length !== 1 || check.sequences.length !== 1) {
      throw new Error(`Generated ${mdxFile} failed validation`);
    }
    console.log(`OK ${mdxFile} + ${texFile} (quad half ${QUAD_HALF[name]})`);
  }
}

main();
