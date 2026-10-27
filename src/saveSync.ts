import { MapPlayer, Timer, Trigger } from 'w3ts';
import { adoptSaveCatalog, encodeDiskCatalog, isSaveCatalogReady } from './save';
import { getHumanPlayers } from './util';
import { onPlayerLeave } from './playerLeave';
import { log } from './debug';

/**
 * Getting the save catalog onto every machine.
 *
 * Saves live on each player's own disk, and a read of one only sees the local
 * machine. Left at that, the chooser would stand up a different party on each
 * screen and a load would restore a different run -- an instant desync. So one
 * player's saves are the source of truth: the FIRST human player, in slot
 * order, who is the one choosing saves in the start lobby. That is not always
 * Player 1, whose slot may be empty.
 *
 * Their machine sends its catalog to everyone with BlzSendSyncData, cut into
 * chunks the message size allows, and every machine -- theirs included --
 * adopts the catalog only when the last chunk arrives through the sync event.
 * Nothing reads a save before then (save.ts refuses to), and the start lobby
 * keeps its Load circle closed until it has arrived.
 *
 * If the first player leaves before finishing, the next one in slot order
 * takes over and sends their own catalog from the top.
 */

const CHUNK_PREFIX = 'ttgSaveChunk';
const END_PREFIX = 'ttgSaveEnd';
/** Characters of catalog per message. A sync message is capped at 255 bytes,
 *  prefix included; this leaves room to spare. */
const CHUNK_SIZE = 200;

/** This machine's own saves, in the catalog's wire format. Read at boot by
 *  every player alike; only the source's is ever sent. */
let localCatalog = '';
/** The player whose saves are the truth. */
let source: MapPlayer | null = null;
/** Chunks received from the source so far. */
let received: string[] = [];

const readyListeners: Array<(this: void) => void> = [];

/** Run cb once the save catalog has arrived (straight away if it already has). */
export function onSaveCatalogReady(cb: (this: void) => void): void {
  if (isSaveCatalogReady()) cb();
  else readyListeners.push(cb);
}

/** The first human player in slot order, leaving out one on their way out
 *  (who still counts as playing while their leave event runs). */
function firstPlayer(leaving: MapPlayer | null): MapPlayer | null {
  for (const p of getHumanPlayers()) {
    if (leaving == null || p.id !== leaving.id) return p;
  }
  return null;
}

/** Make `p` the source and, on their machine, send the catalog. */
function startFrom(p: MapPlayer | null): void {
  source = p;
  received = [];
  if (p == null) {
    log('saveSync: no human player to take saves from');
    return;
  }
  if (GetLocalPlayer() !== p.handle) return;
  let count = 0;
  for (let at = 0; at < localCatalog.length; at += CHUNK_SIZE) {
    BlzSendSyncData(CHUNK_PREFIX, localCatalog.substring(at, at + CHUNK_SIZE));
    count += 1;
  }
  // The count lets every receiver check it has the whole thing.
  BlzSendSyncData(END_PREFIX, tostring(count));
}

function onSyncMessage(): void {
  if (isSaveCatalogReady() || source == null) return;
  // Only the current source counts: chunks still in flight from a source who
  // has since left belong to a catalog nobody is finishing.
  if (GetPlayerId(GetTriggerPlayer()!) !== source.id) return;
  const prefix = BlzGetTriggerSyncPrefix();
  const data = BlzGetTriggerSyncData() ?? '';
  if (prefix === CHUNK_PREFIX) {
    received.push(data);
    return;
  }
  if (prefix !== END_PREFIX) return;
  if (tonumber(data) !== received.length) {
    // Loud, not papered over: an incomplete catalog would load wrong saves.
    log('saveSync: expected ' + data + ' chunks, got ' + tostring(received.length));
    print('|cffff4040Saved games could not be shared with everyone; loading is unavailable this game.|r');
    source = null;
    return;
  }
  adoptSaveCatalog(received.join(''));
  received = [];
  for (const cb of readyListeners) cb();
  readyListeners.length = 0;
}

/** Read this machine's saves and share the source's with everyone. */
export function initSaveSync(): void {
  const t = Trigger.create();
  for (const p of getHumanPlayers()) {
    BlzTriggerRegisterPlayerSyncEvent(t.handle, p.handle, CHUNK_PREFIX, false);
    BlzTriggerRegisterPlayerSyncEvent(t.handle, p.handle, END_PREFIX, false);
  }
  t.addAction(() => onSyncMessage());

  onPlayerLeave((leaving) => {
    if (isSaveCatalogReady() || source == null || leaving.id !== source.id) return;
    startFrom(firstPlayer(leaving));
  });

  // From a timer: init runs before the game has started, when nothing can be
  // sent yet. Every machine reads its disk here, at the same moment.
  const start = Timer.create();
  start.start(0, false, () => {
    start.destroy();
    localCatalog = encodeDiskCatalog();
    startFrom(firstPlayer(null));
  });
}
