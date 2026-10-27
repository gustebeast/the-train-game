import { DEFAULT_STATE, GameState, gameState, applyState } from './state';
import { KitItem } from './util';
import { log } from './debug';
import { HERO_SLOTS, MAX_MERCS } from './constants';

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
/** Set the moment the boss falls. A victorious save is still OFFERED -- the
 *  chooser shows the party that won, trophies and all -- but it cannot be
 *  loaded: the run is finished. Spelled out on its own line for the same
 *  reason DEFEATED is. */
const KEY_VICTORIOUS = 'VICTORIOUS';
const VICTORIOUS_YES = 'yes';
const KEY_VERSION = 'VERSION';

/** The segment holding hero slot n (1-based); heroes.ts registers one per slot.
 *  Built with tostring, not I2S: the registrations run at module load, where
 *  I2S does not work, and a key that differs between write and read loses the
 *  hero silently. */
export function heroSaveKey(n: number): string {
  return 'h' + tostring(n);
}
/** The segment holding the mercenaries; mercenary.ts registers it. */
export const MERC_SAVE_KEY = 'mm';

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
const SAVE_VERSION = 1;

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
  /** The run beat the boss. Shown in the chooser, never loaded. */
  victorious: boolean;
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
const KEY_TO_SHORT: Record<keyof GameState, string> = {
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

/** Split a comma-joined field value ("a,b,c") into its entries. */
export function parseList(raw: string): string[] {
  const out: string[] = [];
  for (const [entry] of string.gmatch(raw, '([^,]+)')) out.push(entry);
  return out;
}

/** A comma-joined list of numbers, as `numbers.join(',')` writes it. */
export function parseNumberList(raw: string): number[] {
  return parseList(raw).map(entry => tonumber(entry) ?? 0);
}

/** A kit as one field value: "id,id*charges,..." -- the charges written only
 *  for an item that has them, so a bare id is an item without charges. */
export function encodeKit(kit: ReadonlyArray<KitItem>): string {
  const parts: string[] = [];
  for (const entry of kit) {
    parts.push(entry.charges > 0 ? tostring(entry.id) + '*' + tostring(entry.charges) : tostring(entry.id));
  }
  return table.concat(parts, ',');
}

export function decodeKit(raw: string): KitItem[] {
  const kit: KitItem[] = [];
  for (const entry of parseList(raw)) {
    const [idStr, chargesStr] = string.match(entry, '^(%d+)%*?(%d*)$');
    const id = tonumber(idStr ?? '') ?? 0;
    if (id !== 0) kit.push({ id, charges: tonumber(chargesStr ?? '') ?? 0 });
  }
  return kit;
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

/** A data segment saved alongside core state, registered by the module that
 *  owns it. The functions are `this: void` because they are called off the
 *  record (`segment.decode(raw)`), which TSTL otherwise emits as a method call
 *  that hands the record over as the first argument. */
interface SaveSegment {
  key: string;
  encode: (this: void) => string;
  decode: (this: void, raw: string) => void;
  reset: ((this: void) => void) | null;
}
/** Every segment registered, in registration order -- the order a bundle
 *  holds their encodings in. */
const registered: SaveSegment[] = [];

/** Register an extra save/load segment with its own cache key.
 *  `reset` (optional) restores the segment's baseline state; every reset
 *  runs before any segment decodes, so loading is always reset-then-apply
 *  and a save without a segment truly means "back to default". */
export function registerSaveSegment(
  key: string,
  encode: (this: void) => string,
  decode: (this: void, raw: string) => void,
  reset?: (this: void) => void,
): void {
  registered.push({ key, encode, decode, reset: reset ?? null });
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
  for (const { encode } of registered) {
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
  for (const { reset } of registered) {
    if (reset != null) reset();
  }
  for (let i = 0; i < registered.length; i++) {
    const raw = bundle.segments[i];
    if (raw != null && raw !== '') {
      registered[i].decode(raw);
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

/** A mercenary as a save describes it: what it is and what it is holding. The
 *  kit matters because the chooser stands these up through the ordinary
 *  mercenary spawner, which shows what a save would actually resume. */
export interface SavedMerc {
  typeId: number;
  items: KitItem[];
}

/** One mercenary slot as the MERC_SAVE_KEY segment stores it (typeId 0: never
 *  hired). The format lives here, not in mercenary.ts, because two readers
 *  need it: mercenary.ts restores its slots, and the chooser describes a save
 *  without loading it. */
export interface SavedMercSlot extends SavedMerc {
  dead: boolean;
}

/** Per slot n: tn is the type, dn the death flag, and `in` the kit. A never-hired
 *  slot writes nothing. */
export function encodeMercSlots(slots: ReadonlyArray<SavedMercSlot>): string {
  const parts: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const sl = slots[i];
    if (sl.typeId === 0) continue;
    const n = tostring(i + 1);
    parts.push('t' + n + '=' + tostring(sl.typeId));
    parts.push('d' + n + '=' + (sl.dead ? '1' : '0'));
    if (sl.items.length > 0) parts.push('i' + n + '=' + encodeKit(sl.items));
  }
  return table.concat(parts, ';');
}

/** Every slot, MAX_MERCS of them, hired or not. */
export function decodeMercSlots(raw: string): SavedMercSlot[] {
  const fields = parseFields(raw);
  const out: SavedMercSlot[] = [];
  for (let i = 0; i < MAX_MERCS; i++) {
    const n = tostring(i + 1);
    out.push({
      typeId: tonumber(fields['t' + n] ?? '') ?? 0,
      dead: fields['d' + n] === '1',
      items: decodeKit(fields['i' + n] ?? ''),
    });
  }
  return out;
}

/** The living mercenaries in a save. */
function decodeLivingMercs(raw: string): SavedMerc[] {
  return decodeMercSlots(raw).filter(sl => sl.typeId !== 0 && !sl.dead);
}

/**
 * Every slot's contents as this session knows them, key to value: the save
 * catalog, read off disk once at boot and then kept up to date by every write.
 * Every read of a save is served from here, never from disk.
 *
 * Why not from disk:
 *
 * - Disk is not the same on every machine. Each player's saves are their own,
 *   and anything a save decides -- which parties the chooser stands up, what a
 *   load restores -- has to be decided identically everywhere or the game
 *   desyncs. So the catalog is the FIRST player's disk, sent to everyone
 *   (saveSync.ts), and nobody else's disk is ever consulted.
 * - A file cannot be read twice. WC3 will not re-execute a Preloader file it
 *   has already run, so the game cache keeps whatever it was filled with the
 *   first time. (Measured in game: a slot marked defeated was still offered,
 *   and still read as undefeated, immediately afterwards.)
 *
 * Each write lands here and on every player's own disk, so the next session
 * finds it whoever turns out to be first then.
 */
const slotData = new Map<number, Map<string, string>>();
/** Whether slotData holds the catalog yet. No save can be read before it does. */
let catalogReady = false;

/** A slot's stored values, key to string ('' when absent). */
type SlotReader = (key: string) => string;

/** Read a slot through `read`, from the catalog. Null, and logged, before the
 *  catalog has arrived: reading a save then would read this machine's disk,
 *  which is exactly what must not decide anything. */
function withSlot<T>(slot: number, read: (get: SlotReader) => T): T | null {
  if (!catalogReady) {
    log('save: slot ' + tostring(slot) + ' read before the save catalog arrived');
    return null;
  }
  const data = slotData.get(slot);
  return read(key => (data != null ? data.get(key) : undefined) ?? '');
}

/** Whether the save catalog has arrived, so saves can be listed and loaded. */
export function isSaveCatalogReady(): boolean {
  return catalogReady;
}

/** Every key a slot can hold. A save is only ever written with these, so they
 *  are all a disk read has to ask for. */
function slotKeys(): string[] {
  const keys = ['core', KEY_VERSION, KEY_SEQ, KEY_DEFEATED, KEY_VICTORIOUS];
  for (const { key } of registered) keys.push(key);
  return keys;
}

/** Separators for the catalog's wire format: slot records, then the fields
 *  within one. Neither appears in anything a save writes (records are
 *  "k=v;k=v" of numbers and ids), and encodeDiskCatalog refuses a value that
 *  would contain one rather than send a catalog that parses wrong. */
const RECORD_SEP = '~';
const FIELD_SEP = '|';

/** Read this machine's saves off disk into the catalog's wire format: one
 *  "slot|key|value" record per stored value.
 *
 *  Every player runs this, the same way, whether or not their disk is the one
 *  that will be used: the game cache is created before the file runs, on
 *  every machine, so the engine objects behind the read are made identically
 *  everywhere and only the strings read back differ. Only the first player's
 *  result is ever sent. */
export function encodeDiskCatalog(): string {
  const records: string[] = [];
  const keys = slotKeys();
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    const gc = InitGameCache(slotCacheFile(slot));
    Preloader(slotSaveFile(slot));
    if (gc == null) continue;
    for (const key of keys) {
      const value = GetStoredString(gc, CACHE_CAT, key) ?? '';
      if (value === '') continue;
      if (value.includes(RECORD_SEP) || value.includes(FIELD_SEP)) {
        log('save: slot ' + tostring(slot) + ' key ' + key + ' holds a catalog separator; left out');
        continue;
      }
      records.push(tostring(slot) + FIELD_SEP + key + FIELD_SEP + value);
    }
    FlushGameCache(gc);
  }
  return records.join(RECORD_SEP);
}

/** Take a catalog in encodeDiskCatalog's format as every slot's contents. A
 *  slot it does not mention is empty. Saves can be read from here on. */
export function adoptSaveCatalog(raw: string): void {
  slotData.clear();
  for (let slot = 1; slot <= SLOT_COUNT; slot++) slotData.set(slot, new Map());
  if (raw !== '') {
    for (const record of raw.split(RECORD_SEP)) {
      const first = record.indexOf(FIELD_SEP);
      const second = record.indexOf(FIELD_SEP, first + 1);
      const slot = tonumber(record.substring(0, first));
      const data = slot != null ? slotData.get(slot) : undefined;
      if (first < 0 || second < 0 || data == null) {
        log('save: malformed catalog record ' + record);
        continue;
      }
      data.set(record.substring(first + 1, second), record.substring(second + 1));
    }
  }
  catalogReady = true;
}

/** Whether a slot holds the save format this build speaks. An unstamped save
 *  predates versioning entirely, and tonumber('') is nil rather than 0, so it
 *  fails this the same way a wrong number does. */
function versionMatches(get: SlotReader): boolean {
  return tonumber(get(KEY_VERSION)) === SAVE_VERSION;
}

/** The core record, or null when there is none or it is unreadable. */
function readCore(get: SlotReader): GameState | null {
  const raw = get('core');
  if (raw === '') return null;
  const core = decodeRecord(raw, SHORT_TO_KEY);
  if (core.round == null) return null;
  return core as unknown as GameState;
}

/** What a slot advertises, read WITHOUT applying any of it: the chooser has to
 *  describe every save on offer, and loading each one to read it would trample
 *  the session. Returns null for an empty slot. */
function describeSlot(slot: number, get: SlotReader): SaveSlotInfo | null {
  // No core record at all is an EMPTY slot -- there is no save here to speak of.
  if (get('core') === '') return null;
  // Something is written here, but not in a format this build speaks. Report it
  // the way a defeated run is reported: it holds its slot and stays out of the
  // chooser, rather than vanishing and letting the next run land on top of it
  // the moment one is started. Nothing inside is trusted, so nothing inside is
  // read -- seq 0 puts it first in line for reuse once slots run short.
  if (!versionMatches(get)) {
    return {
      slot, seq: 0, round: 0, defeated: true, victorious: false,
      heroTypeIds: [], heroRecords: [], mercs: [],
    };
  }
  const core = readCore(get);
  if (core == null) return null;

  const heroTypeIds: number[] = [];
  const heroRecords: string[] = [];
  for (let n = 1; n <= HERO_SLOTS; n++) {
    const heroRaw = get(heroSaveKey(n));
    if (heroRaw === '') continue;
    const typeId = tonumber(parseFields(heroRaw)['t'] ?? '');
    if (typeId != null && typeId !== 0) {
      heroTypeIds.push(typeId);
      heroRecords.push(heroRaw);
    }
  }
  return {
    slot,
    seq: tonumber(get(KEY_SEQ)) ?? 0,
    round: core.round,
    defeated: get(KEY_DEFEATED) === DEFEATED_YES,
    victorious: get(KEY_VICTORIOUS) === VICTORIOUS_YES,
    heroTypeIds,
    heroRecords,
    mercs: decodeLivingMercs(get(MERC_SAVE_KEY)),
  };
}

/** Every save that exists, newest first. Defeated saves are included only when
 *  asked for: the chooser hides them, but marking one defeated must never be
 *  the same as deleting it. */
export function listSaves(includeDefeated = false): SaveSlotInfo[] {
  const found: SaveSlotInfo[] = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    const info = withSlot(slot, get => describeSlot(slot, get));
    if (info == null) continue;
    if (info.defeated && !includeDefeated) continue;
    found.push(info);
  }
  found.sort((a, b) => b.seq - a.seq);
  return found;
}

/** The slot a new run should claim: a free one, else the oldest finished one
 *  -- defeated or victorious, since neither can be played again, and a save
 *  this build cannot read reports itself as defeated -- else the oldest of
 *  all. */
function allocateSlot(): number {
  const used = listSaves(true);
  for (let slot = 1; slot <= SLOT_COUNT; slot++) {
    if (!used.some(info => info.slot === slot)) return slot;
  }
  const dead = used.filter(info => info.defeated || info.victorious);
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
 *  `defeated` hides it from the chooser without destroying it; `victorious`
 *  keeps it on show but closes it to loading. */
function writeSlot(slot: number, defeated: boolean, victorious = false): void {
  const cacheFile = slotCacheFile(slot);
  let highestSeq = 0;
  for (const info of listSaves(true)) {
    if (info.seq > highestSeq) highestSeq = info.seq;
  }
  // Every value goes two places: into the file for the next session, and into
  // the catalog for this one.
  const record = new Map<string, string>();
  const put = (key: string, value: string): void => {
    record.set(key, value);
    preloadStore(cacheFile, key, value);
  };
  PreloadGenClear();
  PreloadGenStart();
  put('core', encodeRecord(gameState as unknown as Record<string, number>, KEY_TO_SHORT));
  for (const { key, encode } of registered) {
    const encoded = encode();
    if (encoded !== '') put(key, encoded);
  }
  put(KEY_VERSION, I2S(SAVE_VERSION)!);
  put(KEY_SEQ, I2S(highestSeq + 1)!);
  if (defeated) put(KEY_DEFEATED, DEFEATED_YES);
  if (victorious) put(KEY_VICTORIOUS, VICTORIOUS_YES);
  PreloadGenEnd(slotSaveFile(slot));
  slotData.set(slot, record);
}

/** Write current gameState + extra segments to the session's save slot. */
export function saveToFile(): void {
  // Without the catalog every slot looks free, and a new run would claim the
  // first one and write over whatever save is really in it.
  if (!catalogReady) {
    log('save: not saved -- the save catalog has not arrived');
    print('Progress could not be saved.');
    return;
  }
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

/** Mark the session's save as victorious: the boss has fallen. Written the
 *  moment the last enemy dies, so the run is finished on disk even if nobody
 *  ever walks out of the arena. Does nothing if no slot was ever claimed. */
export function markCurrentSaveVictorious(): void {
  if (currentSlot === 0) return;
  writeSlot(currentSlot, false, true);
}

/** Wipe the session back to a brand new run: every segment to its baseline,
 *  core state to defaults, and no slot claimed.
 *
 *  No slot on purpose. A run only takes a slot when it first completes a
 *  round, so quitting during round 1 leaves nothing behind -- and, more to the
 *  point, loading a save and immediately starting a new game cannot write over
 *  the save that was loaded. */
export function resetToNewRun(): void {
  // Deliberately NOT clearing the catalog: what is on disk is on disk, and a
  // new run must still see the saves the session has already written.
  applyStateBundle({ core: DEFAULT_STATE, segments: [] });
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

/** Load the newest save that is still playable: not defeated, not victorious. */
export function loadFromFile(): boolean {
  const saves = listSaves().filter(info => !info.victorious);
  if (saves.length === 0) return false;
  return loadFromSlot(saves[0].slot);
}

/** Load gameState + extra segments from a slot. Returns true if successful. */
function readSlotInto(slot: number): boolean {
  const bundle = withSlot(slot, (get): StateBundle | null => {
    if (!versionMatches(get)) return null;
    const core = readCore(get);
    if (core == null) return null;
    return { core, segments: registered.map(({ key }) => get(key)) };
  });
  if (bundle == null) return false;
  applyStateBundle(bundle);
  return true;
}
