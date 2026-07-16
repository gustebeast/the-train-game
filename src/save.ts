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

/** Encode a key=val record to a "k=v;k=v;..." string, shortening keys via keyMap. */
function encodeRecord(record: Record<string, number>, keyMap: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    parts.push((keyMap[k] ?? k) + '=' + tostring(v));
  }
  return table.concat(parts, ';');
}

/** Decode a "k=v;k=v;..." string into a Record, expanding short keys via keyMap. */
function decodeRecord(raw: string, keyMap: Record<string, string>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
    result[keyMap[key] ?? key] = tonumber(val) ?? 0;
  }
  return result;
}

/** Write a StoreString Preload line for a given cache key. */
function preloadStore(cacheKey: string, encoded: string): void {
  Preload('")\ncall StoreString(InitGameCache("' + CACHE_FILE + '"),"' + CACHE_CAT + '","' + cacheKey + '","' + encoded + '")\n//');
}

/** Extra data segments to save alongside core state. Populated by other modules. */
const extraKeys: string[] = [];
const extraEncoders: Array<() => string> = [];
const extraDecoders: Array<(raw: string) => void> = [];
const extraResets: Array<(() => void) | null> = [];

/** Register an extra save/load segment with its own cache key.
 *  `reset` (optional) restores the segment's baseline state; every reset
 *  runs before any segment decodes, so loading is always reset-then-apply
 *  and a save without a segment truly means "back to default". */
export function registerSaveSegment(
  key: string,
  encode: () => string,
  decode: (raw: string) => void,
  reset?: () => void,
): void {
  extraKeys.push(key);
  extraEncoders.push(encode);
  extraDecoders.push(decode);
  extraResets.push(reset ?? null);
}

/** Write current gameState + extra segments to save file. */
export function saveToFile(): void {
  PreloadGenClear();
  PreloadGenStart();
  preloadStore('core', encodeRecord(gameState as unknown as Record<string, number>, KEY_TO_SHORT));
  for (let i = 0; i < extraKeys.length; i++) {
    const encoded = extraEncoders[i]();
    if (encoded !== '') preloadStore(extraKeys[i], encoded);
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

  // Reset all segments to baseline first — a save without a segment means
  // "back to default", never "keep whatever the current session has"
  for (const reset of extraResets) {
    if (reset != null) reset();
  }

  // Load extra segments
  for (let i = 0; i < extraKeys.length; i++) {
    const segRaw = GetStoredString(gc, CACHE_CAT, extraKeys[i]);
    if (segRaw != null && segRaw !== '') {
      extraDecoders[i](segRaw);
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
