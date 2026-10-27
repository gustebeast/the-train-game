/**
 * Every terrain tile the script paints at runtime (SetTerrainType), written
 * once. Data only, with no imports, because the build reads it too.
 *
 * The build needs it because HD graphics (Definitive / Reforged) draw a
 * runtime-painted tile only if the map's terrain file both LISTS it and has it
 * painted on at least one point. A tile the editor never put down renders as
 * whatever is underneath -- the board showed the editor's bare dirt where its
 * grass and marble should be. Classic graphics draw it either way, which is how
 * this went unnoticed. scripts/terrain-tiles.js makes sure of both on every
 * build (found with the user's own WC3 in Definitive, 2026-10-27).
 */

/** The three ground tiles of each biome: the field, its paths, and the floor
 *  under the round's water. */
export const BIOME_TILES = {
  summer: { grass: 'Lgrs', grassyDirt: 'Lgrd', pool: 'Lrok' },
  fall: { grass: 'Fgrs', grassyDirt: 'Fgrd', pool: 'Frok' },
  winter: { grass: 'Wsnw', grassyDirt: 'Wsng', pool: 'Wrok' },
};

/** Tiles that are the same whatever the biome. */
export const FIXED_TILES = {
  rock: 'Lrok',
  roughDirt: 'Ldro',
  whiteMarble: 'Xwmb',
  blackBricks: 'Ibkb',
  dungeonDirt: 'Ddrt',
  dungeonBrick: 'Dbrk',
  dungeonRedStone: 'Drds',
  lavaCracks: 'Dlvc',
  /** Dalaran Large Bricks: a water block turned into a bridge (bridge.ts). */
  bridge: 'Zbkl',
};

/** All of the above, each once. */
export const RUNTIME_TILES: string[] = [];
for (const biome of [BIOME_TILES.summer, BIOME_TILES.fall, BIOME_TILES.winter]) {
  for (const tile of [biome.grass, biome.grassyDirt, biome.pool]) {
    if (RUNTIME_TILES.indexOf(tile) === -1) RUNTIME_TILES.push(tile);
  }
}
for (const key of Object.keys(FIXED_TILES)) {
  const tile = (FIXED_TILES as Record<string, string>)[key];
  if (RUNTIME_TILES.indexOf(tile) === -1) RUNTIME_TILES.push(tile);
}
