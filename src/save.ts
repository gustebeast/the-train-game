import { GameState, gameState, applyState } from './state';

const SAVE_FILE = 'TheTrainGame/save.txt';
const CACHE_FILE = 'TheTrainGame/save.w3v';
const CACHE_CAT = 's';

/** Short keys for core state encoding. */
const KEY_TO_SHORT: Record<string, string> = {
  round: 'r',
  gold: 'g',
  trainCargoMaxStack: 'tc',
  trainTrackMaxStack: 'tt',
  peasantMaxStack: 'ps',
  crateMaxStack: 'cs',
  trainMaxHP: 'th',
  trainMaxMana: 'tm',
  trainSpeed: 'ts',
  crateTrackCount: 'ct',
  crateStoneCount: 'cn',
  crateWoodCount: 'cw',
};

/** Reverse mapping: short key → full property name. */
const SHORT_TO_KEY: Record<string, string> = {};
for (const [full, short] of Object.entries(KEY_TO_SHORT)) {
  SHORT_TO_KEY[short] = full;
}

/** Encode a key=val record to a "k=v;k=v;..." string. */
function encodeRecord(record: Record<string, number>, keyMap?: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    const short = keyMap != null ? (keyMap[k] ?? k) : k;
    parts.push(short + '=' + tostring(v));
  }
  return table.concat(parts, ';');
}

/** Decode a "k=v;k=v;..." string into a Record, optionally expanding short keys. */
function decodeRecord(raw: string, keyMap?: Record<string, string>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
    const fullKey = keyMap != null ? (keyMap[key] ?? key) : key;
    result[fullKey] = tonumber(val) ?? 0;
  }
  return result;
}

/** Write a StoreString Preload line for a given cache key. */
function preloadStore(cacheKey: string, encoded: string): void {
  Preload('")\ncall StoreString(InitGameCache("' + CACHE_FILE + '"),"' + CACHE_CAT + '","' + cacheKey + '","' + encoded + '")\n//');
}

/** Extra data segments to save alongside core state. Populated by other modules. */
const extraSegments: { key: string; encode: () => string }[] = [];
const extraLoaders: { key: string; decode: (raw: string) => void }[] = [];

/** Register an extra save/load segment with its own cache key. */
export function registerSaveSegment(
  key: string,
  encode: () => string,
  decode: (raw: string) => void,
): void {
  extraSegments.push({ key, encode });
  extraLoaders.push({ key, decode });
}

/** Write current gameState + extra segments to save file. */
export function saveToFile(): void {
  PreloadGenClear();
  PreloadGenStart();
  preloadStore('core', encodeRecord(gameState as unknown as Record<string, number>, KEY_TO_SHORT));
  for (const seg of extraSegments) {
    const encoded = seg.encode();
    if (encoded !== '') preloadStore(seg.key, encoded);
  }
  PreloadGenEnd(SAVE_FILE);
  print('Game saved.');
}

/** Load gameState + extra segments from save file. Returns true if successful. */
export function loadFromFile(): boolean {
  Preloader(SAVE_FILE);
  const gc = InitGameCache(CACHE_FILE);
  if (gc == null) return false;

  // Load core state
  const coreRaw = GetStoredString(gc, CACHE_CAT, 'core');
  // Fall back to legacy 'data' key for old saves
  const raw = (coreRaw != null && coreRaw !== '') ? coreRaw : GetStoredString(gc, CACHE_CAT, 'data');
  if (raw == null || raw === '') {
    FlushGameCache(gc);
    return false;
  }
  const loaded = decodeRecord(raw, SHORT_TO_KEY);
  if (loaded.round == null) {
    FlushGameCache(gc);
    return false;
  }

  // Load extra segments
  for (const seg of extraLoaders) {
    const segRaw = GetStoredString(gc, CACHE_CAT, seg.key);
    if (segRaw != null && segRaw !== '') {
      seg.decode(segRaw);
    }
  }

  FlushGameCache(gc);
  applyState(loaded as unknown as GameState);
  return true;
}

/** Delete the save file by writing an empty preload file. */
export function deleteSave(): void {
  PreloadGenClear();
  PreloadGenStart();
  PreloadGenEnd(SAVE_FILE);
}
