import { DEFAULT_STATE, GameState, gameState, applyState } from './state';

// One file per save slot, so several runs can be resumed independently: host a
// game, quit in the inter-round lobby, host another, and both are still there.
// Each slot gets its OWN game cache too -- a shared cache would hand back the
// previous slot's values when reading the next one.
//
// SLOT_COUNT is a PROBE RANGE, not a storage limit. WC3 cannot enumerate files,
// so the only way to discover a save is to guess its name and try to read it,
// and the range to guess over has to be decided in advance. Raising it costs
// one Preloader read per extra slot on every listSaves() -- which runs on each
// write, to find the next seq -- so it buys room for concurrent runs at a price
// paid forever after. Unbounded would need an index file naming the live slots,
// and losing that index would hide every save at once: a worse failure than the
// one it solves.
const SLOT_COUNT = 16;
const CACHE_CAT = 's';

function slotSaveFile(slot: number): string {
  return 'TheTrainGame/save' + I2S(slot)! + '.txt';
}
function slotCacheFile(slot: number): string {
  return 'TheTrainGame/save' + I2S(slot)! + '.w3v';
}

/** Cache keys holding a slot's own bookkeeping rather than game state.
 *  DEFEATED is spelled out, and stored on its own line rather than packed into
 *  a record, so a save wrongly marked dead can be found and edited by hand --
 *  the flag only HIDES a save from the chooser, and a glitched defeat should
 *  not cost someone their run. */
const KEY_SEQ = 'seq';
const KEY_DEFEATED = 'DEFEATED';
const DEFEATED_YES = 'yes';
const KEY_VERSION = 'VERSION';

/**
 * The save format this build reads and writes.
 *
 * Bump this whenever a change would make an older save load WRONG rather than
 * merely incomplete -- a segment's fields changing meaning, a unit or item
 * rawcode being reused for something else, a rule that older state cannot
 * satisfy. Do NOT bump for additions: a save without a segment already resets
 * that segment to its baseline, which is exactly right for a new one.
 *
 * A slot is readable only if it stamps this exact number. Older is out of date
 * and newer was written by a build this one does not understand; neither can be
 * trusted, so both are malformed as far as this build is concerned. A malformed
 * save is treated exactly as a defeated one: it keeps its slot and is kept out
 * of the chooser, so an early build's save is never loaded into a game whose
 * rules have moved on underneath it, and is recycled in its own time rather
 * than being clobbered the instant someone starts a run.
 *
 * This is the ONLY concession to save compatibility anywhere in the map, and
 * deliberately so. There is no reading of superseded field names, no migrating
 * an old save forward, no slot kept around because a previous format used it.
 * A save either says it is this format or it is malformed, and malformed means
 * gone. Anything else means old formats live on in code that has to keep being
 * understood, which is the cost this constant exists to avoid.
 */
const SAVE_VERSION = 0;

/** Which slot this session is playing, or 0 if it has not claimed one. */
let currentSlot = 0;

/** What a save can say about itself without being loaded. */
export interface SaveSlotInfo {
  slot: number;
  /** Write order, higher is newer. WC3 has no clock that survives a session,
   *  so recency is a counter carried inside the saves themselves. */
  seq: number;
  /** Highest completed round. */
  round: number;
  defeated: boolean;
  /** Hero unit type ids, for the chooser to display. */
  heroTypeIds: number[];
  /** The heroes exactly as stored, one encoded record each. The chooser stands
   *  them up through the ordinary hero spawner, which needs the level, skills,
   *  items and tomes -- not just what type they are. Kept as the raw strings so
   *  this module never has to know the shape of a hero. */
  heroRecords: string[];
  /** The living mercenaries and their kit, likewise. Dead ones are left out --
   *  a corpse is not part of the party you would be resuming. */
  mercs: SavedMerc[];
}

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
  randomSeed: 'rs',
  randomDraws: 'rd',
  heroQueuePos: 'hq',
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

/** Split a "k=v;k=v;..." record into its raw string fields.
 *
 *  Every save segment shares this one wire format, so the split lives here
 *  rather than being re-derived per segment — a change to the format (escaping
 *  ';' or '=' in values, say) then reaches all of them. Values stay strings
 *  because segments interpret them differently: numbers, '1' as a boolean, or
 *  a comma-joined list. */
export function parseFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, val] of string.gmatch(raw, '([^;=]+)=([^;]+)')) {
    fields[key] = val;
  }
  return fields;
}

/** Decode a "k=v;k=v;..." string into a Record, expanding short keys via keyMap. */
function decodeRecord(raw: string, keyMap: Record<string, string>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, val] of pairs(parseFields(raw))) {
    result[keyMap[key] ?? key] = tonumber(val) ?? 0;
  }
  return result;
}

/** Write a StoreString Preload line for a given cache key. */
function preloadStore(cacheFile: string, cacheKey: string, encoded: string): void {
  Preload('")\ncall StoreString(InitGameCache("' + cacheFile + '"),"' + CACHE_CAT + '","' + cacheKey + '","' + encoded + '")\n//');
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

/** A complete restorable state: core gameState plus every extra segment,
 *  encoded exactly as a save file would hold them. */
interface StateBundle {
  core: GameState;
  segments: string[];
}

/** Capture the current session state as a bundle (the in-memory equivalent
 *  of writing a save file). */
function captureStateBundle(): StateBundle {
  const segments: string[] = [];
  for (const encode of extraEncoders) {
    segments.push(encode());
  }
  return { core: { ...gameState }, segments };
}

/** Restore a bundle: reset every segment to baseline, decode the bundle's
 *  segments over that, then apply core state. The single convergence point
 *  for -load (bundle read from disk) and Reset Purchases (bundle captured
 *  in memory on inter-round lobby entry). */
function applyStateBundle(bundle: StateBundle): void {
  // Reset all segments first — a bundle without a segment means "back to
  // default", never "keep whatever the current session has"
  for (const reset of extraResets) {
    if (reset != null) reset();
  }
  for (let i = 0; i < extraKeys.length; i++) {
    const raw = bundle.segments[i];
    if (raw != null && raw !== '') {
      extraDecoders[i](raw);
    }
  }
  applyState(bundle.core);
}

/** In-memory bundle captured on inter-round lobby entry, used by Reset Purchases. */
let lobbyBundle: StateBundle | null = null;

/** Snapshot the current state for inter-round lobby revert. Called on inter-round lobby entry. */
export function saveInterRoundLobbySnapshot(): void {
  lobbyBundle = captureStateBundle();
}

/** Restore the inter-round lobby-entry snapshot. Returns false if none exists. */
export function revertToInterRoundLobbySnapshot(): boolean {
  if (lobbyBundle == null) return false;
  applyStateBundle(lobbyBundle);
  return true;
}

/** Living mercenary type ids out of the 'mm' segment (see mercenary.ts:
 *  t1/t2 are the types, d1/d2 the death flags). */
/** A mercenary as a save describes it: what it is and what it is holding. The
 *  kit matters because the chooser stands these up through the ordinary
 *  mercenary spawner, which shows what a save would actually resume. */
export interface SavedMerc {
  typeId: number;
  items: number[];
}

function decodeMercs(raw: string): SavedMerc[] {
  const out: SavedMerc[] = [];
  if (raw === '') return out;
  const fields = parseFields(raw);
  for (let i = 1; i <= 2; i++) {
    const n = I2S(i)!;
    const typeId = tonumber(fields['t' + n] ?? '');
    if (typeId == null || typeId === 0) continue;
    if ((fields['d' + n] ?? '0') === '1') continue;
    const items: number[] = [];
    for (const [idStr] of string.gmatch(fields['i' + n] ?? '', '([^,]+)')) {
      const id = tonumber(idStr) ?? 0;
      if (id !== 0) items.push(id);
    }
    out.push({ typeId, items });
  }
  return out;
}

/** What this session has written, by slot.
 *
 *  Re-reading a save file the same session that wrote it does NOT come back
 *  changed -- measured in game: a slot marked defeated was still offered, and
 *  still read as undefeated, immediately afterwards. Preloader does not pick up
 *  a file it has already read this session.
 *
 *  That is precisely the flow that matters: lose a run, restart, and the
 *  chooser must not still be offering the save you just lost. So writes are
 *  remembered here and laid over what the disk says. */
const writtenThisSession = new Map<number, SaveSlotInfo>();

/**
 * Everything written to each slot this session, key to value.
 *
 * The preload file on disk is not readable again from inside the same session:
 * WC3 will not re-execute a Preloader file it has already run, so the game
 * cache keeps whatever it was filled with the FIRST time the slot was read.
 * Load a save, play two rounds, save, and reading that slot back hands you the
 * run as it was when you loaded it -- the rounds are on disk, and the session
 * cannot see them.
 *
 * So what is written is kept here as well, and preferred on read. Disk is for
 * the next session; this is for this one.
 */
const sessionData = new Map<number, Map<string, string>>();

/** Whether an already-opened slot cache holds the save format this build
 *  speaks. An unstamped save predates versioning entirely, and tonumber('')
 *  is nil rather than 0, so it fails this the same way a wrong number does. */
function versionMatches(gc: gamecache): boolean {
  return tonumber(GetStoredString(gc, CACHE_CAT, KEY_VERSION) ?? '') === SAVE_VERSION;
}

/** Read what a slot advertises WITHOUT applying any of it: the chooser has to
 *  describe every save on offer, and loading each one to read it would trample
 *  the session. Returns null for an empty or unreadable slot. */
function readSlotInfo(slot: number): SaveSlotInfo | null {
  Preloader(slotSaveFile(slot));
  const gc = InitGameCache(slotCacheFile(slot));
  if (gc == null) return null;
  const stored = (key: string) => GetStoredString(gc, CACHE_CAT, key) ?? '';
  // No core record at all is an EMPTY slot -- there is no save here to speak of.
  // Core present but unreadable is a MALFORMED save, which is a different thing
  // and handled below.
  const raw = stored('core');
  if (raw === '') { FlushGameCache(gc); return null; }
  // Something is written here, but not in a format this build speaks. Report it
  // the way a defeated run is reported: it holds its slot and stays out of the
  // chooser, rather than vanishing and letting the next run land on top of it
  // the moment one is started. Nothing inside is trusted, so nothing inside is
  // read -- seq 0 puts it first in line for reuse once slots run short.
  if (!versionMatches(gc)) {
    FlushGameCache(gc);
    return {
      slot, seq: 0, round: 0, defeated: true,
      heroTypeIds: [], heroRecords: [], mercs: [],
    };
  }
  const core = decodeRecord(raw, SHORT_TO_KEY);
  if (core.round == null) { FlushGameCache(gc); return null; }

  const heroTypeIds: number[] = [];
  const heroRecords: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const heroRaw = stored('h' + I2S(i)!);
    if (heroRaw === '') continue;
    const typeId = tonumber(parseFields(heroRaw)['t'] ?? '');
    if (typeId != null && typeId !== 0) {
      heroTypeIds.push(typeId);
      heroRecords.push(heroRaw);
    }
  }
  const info: SaveSlotInfo = {
    slot,
    seq: tonumber(stored(KEY_SEQ)) ?? 0,
    round: core.round,
    defeated: stored(KEY_DEFEATED) === DEFEATED_YES,
    heroTypeIds,
    heroRecords,
    mercs: decodeMercs(stored('mm')),
  };
  FlushGameCache(gc);
  return writtenThisSession.get(slot) ?? info;
}

/** Every save that exists, newest first. Defeated saves are included only when
 *  asked for: the chooser hides them, but marking one defeated must never be
 *  the same as deleting it. */
export function listSaves(includeDefeated = false): SaveSlotInfo[] {
  const found: SaveSlotInfo[] = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    const info = readSlotInfo(slot) ?? writtenThisSession.get(slot) ?? null;
    if (info == null) continue;
    if (info.defeated && !includeDefeated) continue;
    found.push(info);
  }
  found.sort((a, b) => b.seq - a.seq);
  return found;
}

/** The slot a new run should claim: a free one, else the oldest defeated one,
 *  else the oldest of all. A slot holding a save this build cannot read counts
 *  as free -- readSlotInfo returns nothing for it. */
function allocateSlot(): number {
  const used = listSaves(true);
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    if (!used.some(info => info.slot === slot)) return slot;
  }
  const dead = used.filter(info => info.defeated);
  const pool = dead.length > 0 ? dead : used;
  let oldest = pool[0];
  for (const info of pool) {
    if (info.seq < oldest.seq) oldest = info;
  }
  return oldest.slot;
}

/** Begin a fresh run in its own slot, so it cannot overwrite an existing save.
 *  Call before the first saveToFile of a new game. */
function claimNewSlot(): number {
  currentSlot = allocateSlot();
  return currentSlot;
}

/** Write the session's state into `slot`, stamping it as the newest save.
 *  `defeated` hides it from the chooser without destroying it. */
function writeSlot(slot: number, defeated: boolean): void {
  const cacheFile = slotCacheFile(slot);
  let highestSeq = 0;
  for (const info of listSaves(true)) {
    if (info.seq > highestSeq) highestSeq = info.seq;
  }
  // Every value goes two places: into the file for the next session, and into
  // sessionData for this one.
  const record = new Map<string, string>();
  const put = (key: string, value: string): void => {
    record.set(key, value);
    preloadStore(cacheFile, key, value);
  };
  PreloadGenClear();
  PreloadGenStart();
  put('core', encodeRecord(gameState as unknown as Record<string, number>, KEY_TO_SHORT));
  for (let i = 0; i < extraKeys.length; i++) {
    const encoded = extraEncoders[i]();
    if (encoded !== '') put(extraKeys[i], encoded);
  }
  put(KEY_VERSION, I2S(SAVE_VERSION)!);
  put(KEY_SEQ, I2S(highestSeq + 1)!);
  if (defeated) put(KEY_DEFEATED, DEFEATED_YES);
  PreloadGenEnd(slotSaveFile(slot));
  sessionData.set(slot, record);

  // Same picture the disk would give, so a save written this session describes
  // itself the way one read back from a file does.
  const heroTypeIds: number[] = [];
  const heroRecords: string[] = [];
  let mercs: SavedMerc[] = [];
  for (let i = 0; i < extraKeys.length; i++) {
    const encoded = extraEncoders[i]();
    if (extraKeys[i] === 'mm') { mercs = decodeMercs(encoded); continue; }
    if (extraKeys[i] !== 'h' + I2S(heroTypeIds.length + 1)!) continue;
    const typeId = tonumber(parseFields(encoded)['t'] ?? '');
    if (typeId != null && typeId !== 0) {
      heroTypeIds.push(typeId);
      heroRecords.push(encoded);
    }
  }
  writtenThisSession.set(slot, {
    slot, seq: highestSeq + 1, round: gameState.round, defeated,
    heroTypeIds, heroRecords, mercs,
  });
}

/** Write current gameState + extra segments to the session's save slot. */
export function saveToFile(): void {
  if (currentSlot === 0) claimNewSlot();
  writeSlot(currentSlot, false);
  print('Progress saved.');
}

/** Mark the session's save as defeated: it stays on disk, and stops being
 *  offered in the chooser. Does nothing if no slot was ever claimed, which is
 *  what keeps a tutorial or a cheat session from marking anything. */
export function markCurrentSaveDefeated(): void {
  if (currentSlot === 0) return;
  writeSlot(currentSlot, true);
}

/** Wipe the session back to a brand new run: every segment to its baseline,
 *  core state to defaults, and no slot claimed.
 *
 *  No slot on purpose. A run only takes a slot when it first completes a
 *  round, so quitting during round 1 leaves nothing behind -- and, more to the
 *  point, loading a save and immediately starting a new game cannot write over
 *  the save that was loaded. */
export function resetToNewRun(): void {
  // Deliberately NOT clearing writtenThisSession: what is on disk is on disk,
  // and a new run must still see the saves the session has already written.
  for (const reset of extraResets) {
    if (reset != null) reset();
  }
  applyState({ ...DEFAULT_STATE });
  currentSlot = 0;
}

/** Load a specific slot into the session. On success the session adopts that
 *  slot, so later saves write back to the same run. */
export function loadFromSlot(slot: number): boolean {
  const ok = readSlotInto(slot);
  if (!ok) return false;
  currentSlot = slot;
  return true;
}

/** Load the newest save that is not defeated. */
export function loadFromFile(): boolean {
  const saves = listSaves();
  if (saves.length === 0) return false;
  return loadFromSlot(saves[0].slot);
}

/** Load gameState + extra segments from a slot's file. Returns true if successful. */
function readSlotInto(slot: number): boolean {
  // What this session wrote wins over what the game cache holds. The cache
  // cannot be refreshed from disk mid-session -- see sessionData -- so for a
  // slot saved since the map loaded, the file's contents are unreachable and
  // the cache is stale by exactly the rounds that were played.
  const session = sessionData.get(slot);
  if (session != null) {
    const rawSession = session.get('core') ?? '';
    if (rawSession === '') return false;
    const loadedSession = decodeRecord(rawSession, SHORT_TO_KEY);
    if (loadedSession.round == null) return false;
    const sessionSegments: string[] = [];
    for (let i = 0; i < extraKeys.length; i++) {
      sessionSegments.push(session.get(extraKeys[i]) ?? '');
    }
    applyStateBundle({
      core: loadedSession as unknown as GameState, segments: sessionSegments,
    });
    return true;
  }

  Preloader(slotSaveFile(slot));
  const gc = InitGameCache(slotCacheFile(slot));
  if (gc == null) return false;
  if (!versionMatches(gc)) { FlushGameCache(gc); return false; }

  // Load core state
  const raw = GetStoredString(gc, CACHE_CAT, 'core');
  if (raw == null || raw === '') {
    FlushGameCache(gc);
    return false;
  }
  const loaded = decodeRecord(raw, SHORT_TO_KEY);
  if (loaded.round == null) {
    FlushGameCache(gc);
    return false;
  }

  // Read all extra segments, then restore through the shared bundle path
  const segments: string[] = [];
  for (let i = 0; i < extraKeys.length; i++) {
    segments.push(GetStoredString(gc, CACHE_CAT, extraKeys[i]) ?? '');
  }
  FlushGameCache(gc);
  applyStateBundle({ core: loaded as unknown as GameState, segments });
  return true;
}

/** Erase a slot by writing an empty preload file over it. Nothing calls this in
 *  normal play -- defeat marks a save rather than removing it -- but it is the
 *  only way to genuinely clear one. */
export function deleteSave(slot: number = currentSlot): void {
  PreloadGenClear();
  PreloadGenStart();
  PreloadGenEnd(slotSaveFile(slot));
}
