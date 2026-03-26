import { GameState, gameState, applyState } from './state';

const SAVE_FILE = 'TheTrainGame/save.txt';
const CACHE_FILE = 'TheTrainGame/save.w3v';
const CACHE_CAT = 's';
const CACHE_KEY = 'data';

/** Serialize a GameState to a "key=val;key=val;..." string. */
function encode(state: GameState): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(state)) {
    parts.push(k + '=' + tostring(v));
  }
  return table.concat(parts, ';');
}

/** Deserialize a "key=val;key=val;..." string into a GameState. */
function decode(raw: string): GameState | null {
  const result: Record<string, number> = {};
  for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
    result[key] = tonumber(val) ?? 0;
  }
  if (result.round == null) return null;
  return result as unknown as GameState;
}

/** Write current gameState to save file. */
export function saveToFile(): void {
  const encoded = encode(gameState);
  PreloadGenClear();
  PreloadGenStart();
  Preload('")\ncall StoreString(InitGameCache("' + CACHE_FILE + '"),"' + CACHE_CAT + '","' + CACHE_KEY + '","' + encoded + '")\n//');
  PreloadGenEnd(SAVE_FILE);
  print('Game saved.');
}

/** Load gameState from save file. Returns true if successful. */
export function loadFromFile(): boolean {
  Preloader(SAVE_FILE);
  const gc = InitGameCache(CACHE_FILE);
  if (gc == null) return false;
  const raw = GetStoredString(gc, CACHE_CAT, CACHE_KEY);
  FlushGameCache(gc);
  if (raw == null || raw === '') return false;
  const loaded = decode(raw);
  if (loaded == null) return false;
  applyState(loaded);
  return true;
}

/** Delete the save file by writing an empty preload file. */
export function deleteSave(): void {
  PreloadGenClear();
  PreloadGenStart();
  PreloadGenEnd(SAVE_FILE);
}
