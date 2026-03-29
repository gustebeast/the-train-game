import { GameState, gameState, applyState } from './state';

const SAVE_FILE = 'TheTrainGame/save.txt';
const CACHE_FILE = 'TheTrainGame/save.w3v';
const CACHE_CAT = 's';
const CACHE_KEY = 'data';

/** Short keys for save encoding to stay within WC3's ~259 char Preload limit. */
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
  hero1Type: 'h1t',
  hero1XP: 'h1x',
  hero1Skills: 'h1s',
  hero2Type: 'h2t',
  hero2XP: 'h2x',
  hero2Skills: 'h2s',
};

/** Reverse mapping: short key → full property name. */
const SHORT_TO_KEY: Record<string, string> = {};
for (const [full, short] of Object.entries(KEY_TO_SHORT)) {
  SHORT_TO_KEY[short] = full;
}

/** Serialize a GameState to a "key=val;key=val;..." string using short keys. */
function encode(state: GameState): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(state)) {
    const short = KEY_TO_SHORT[k] ?? k;
    parts.push(short + '=' + tostring(v));
  }
  return table.concat(parts, ';');
}

/** Deserialize a "key=val;key=val;..." string into a GameState.
 *  Accepts both short keys (new format) and full keys (legacy). */
function decode(raw: string): GameState | null {
  const result: Record<string, number> = {};
  for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
    const fullKey = SHORT_TO_KEY[key] ?? key;
    result[fullKey] = tonumber(val) ?? 0;
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
