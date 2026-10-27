import { MapPlayer, Trigger } from 'w3ts';
import { BOSS_ADD_ID, BOSS_ID } from './constants';
import { spawnBoss, stopBoss } from './boss';
import { dealHeroesForHumans } from './bossParty';
import { spawnHeroes, getSpawnedHeroes, endHeroState, chooseAllHeroes } from './heroes';
import { spawnMercWithHeroes, getSpawnedMercUnits } from './mercenary';
import { getBossHeroSpots, getBossMercSpots, getBossSpot } from './terrain/spawn';
import { forEachUnitOfPlayer, getHumanPlayers, nextFrame, isAlive, forEachUnitInWorld } from './util';

/**
 * The boss fight itself: who stands where, and how it ends.
 *
 * The arena's terrain and its marked places come from the map generator like
 * every other board. This fills those places and then watches for one of two
 * endings:
 *
 *   - nothing of the party left standing, which sends everyone back to the
 *     inter-round lobby exactly as an ordinary victory would. The round was
 *     already won and paid out when the train arrived; losing here costs the
 *     attempt, not the run;
 *   - nothing hostile left on the board -- the boss AND every lesser infernal
 *     it called down -- which is the win.
 *
 * "Nothing hostile left" is derived by looking, not by counting kills. The boss
 * summons more of them as it goes and they expire on their own timers, so a
 * tally of what died would have to track what was born, and would be wrong the
 * first time an infernal timed out instead of being killed.
 */

/** Re-checks the ending whenever anything dies or a player leaves.
 *
 *  Both endings can only begin with a death -- the last of the party falling,
 *  or the last hostile going down, which includes a lesser infernal whose timed
 *  life runs out, since expiry is a death -- or with a player leaving, which
 *  takes their units out of the party. So those are the only moments worth
 *  looking. This used to look every second instead, with a three-second grace
 *  so the frame where the party had spawned but the boss had not could not
 *  read as a win; checking only on a death needs no grace, because nothing
 *  has died in that frame. */
let watcher: Trigger | null = null;
/** Set once the party has actually been seen standing. Without it an arena
 *  that never managed to spawn anybody reads as an instant wipe and bounces
 *  straight back out -- which is what a boss fight with no heroes did. */
let partyArrived = false;
let onDefeat: (() => void) | null = null;
/** Told who survived, since they are who must walk out. */
let onVictory: ((this: void, survivors: unit[]) => void) | null = null;

/** How the arena reports its ending. Set by terrain/load.ts, which owns what
 *  board comes next. */
export function setBossArenaCallbacks(
  defeat: () => void, victory: (this: void, survivors: unit[]) => void,
): void {
  onDefeat = defeat;
  onVictory = victory;
}

/** The endings currently installed, so a test can swap in its own to see which
 *  fired and then put these back. */
export function getBossArenaCallbacks(): {
  defeat: (() => void) | null; victory: ((this: void, survivors: unit[]) => void) | null;
} {
  return { defeat: onDefeat, victory: onVictory };
}

/** Stop watching. Safe to call repeatedly, and called on the way out however
 *  the fight ended. */
function stopBossArena(): void {
  if (watcher != null) { watcher.destroy(); watcher = null; }
  stopBoss();
}

/** A boss or lesser infernal the party has taken over with Charm.
 *
 *  It belongs to a player now, but it is not one of the party: it must not keep
 *  a wiped party "standing", walk out of the arena with the winners, or count
 *  as an enemy still to beat. Every check below leaves it out. */
function isCharmedBossUnit(u: unit): boolean {
  const id = GetUnitTypeId(u);
  if (id !== BOSS_ID && id !== BOSS_ADD_ID) return false;
  const owner = GetOwningPlayer(u);
  return getHumanPlayers().some(p => p.handle === owner);
}

/** Is anything the party owns still standing? */
function partyStanding(): boolean {
  let standing = false;
  for (const player of getHumanPlayers()) {
    forEachUnitOfPlayer(player.handle, u => {
      if (standing) return;
      if (isCharmedBossUnit(u)) return;
      if (IsUnitType(u, UNIT_TYPE_DEAD)) return;
      if (!isAlive(u)) return;
      standing = true;
    });
    if (standing) return true;
  }
  return false;
}

/** Is the boss, or anything it called down, still on the board? */
function enemiesRemain(): boolean {
  let remain = false;
  forEachUnitInWorld(u => {
    if (remain) return;
    const id = GetUnitTypeId(u);
    if (id !== BOSS_ID && id !== BOSS_ADD_ID) return;
    // Matched by type, so one the party has charmed has to be left out by
    // owner: it is theirs now, and waiting for it to die stalled the win for
    // up to its three-minute life.
    if (isCharmedBossUnit(u)) return;
    if (!isAlive(u)) return;
    remain = true;
  });
  return remain;
}

/**
 * Stand the fight up: the boss on its mark, the party on theirs, dealt out so
 * everyone has something to play.
 *
 * Called after the arena terrain is laid down, so the marked places exist.
 */
export function startBossFight(): void {
  stopBossArena();
  partyArrived = false;

  const bossSpot = getBossSpot();
  if (bossSpot != null) spawnBoss(bossSpot.x, bossSpot.y);

  const heroSpots = getBossHeroSpots();
  const mercSpots = getBossMercSpots();
  // Everybody comes to this one, not the usual two.
  chooseAllHeroes();
  const heroOwners = dealHeroesForHumans(heroSpots.length);

  // spawnHeroes takes one owner per hero in roster order, which is exactly the
  // shape the deal produces.
  const owners: MapPlayer[] = [];
  for (const id of heroOwners) {
    const p = MapPlayer.fromIndex(id);
    if (p != null) owners.push(p);
  }
  if (owners.length > 0) {
    // ONE call: spawnHeroes stands up the whole roster and takes one owner per
    // hero, so calling it per place would spawn the party once per place.
    const first = heroSpots.length > 0 ? heroSpots[0] : { x: 0, y: 0 };
    spawnHeroes(owners, first.x, first.y);
    // Then onto their own marks, so they arrive in a line rather than in a
    // heap that pathing has to shove apart.
    const standing = getSpawnedHeroes();
    for (let i = 0; i < standing.length && i < heroSpots.length; i++) {
      SetUnitPosition(standing[i].handle, heroSpots[i].x, heroSpots[i].y);
    }
  }

  // The mercenaries are handed out by the mercenary system: it already places
  // each one with whoever holds the fewest heroes, breaking ties by who has
  // controlled least recently, which is the rule this fight wants. It is told
  // who holds which hero; it works out the rest.
  if (mercSpots.length > 0) {
    spawnMercWithHeroes(mercSpots[0].x, mercSpots[0].y, heroOwners);
    // Then onto their own marks.
    const mercs = getSpawnedMercUnits();
    for (let i = 0; i < mercs.length && i < mercSpots.length; i++) {
      SetUnitPosition(mercs[i].handle, mercSpots[i].x, mercSpots[i].y);
    }
  }

  // Everyone is on the board now, so this is when the party has arrived --
  // if anybody spawned at all. A fight that stood up nobody must not read as
  // an instant wipe.
  partyArrived = partyStanding();

  const trig = Trigger.create();
  watcher = trig;
  trig.registerAnyUnitEvent(EVENT_PLAYER_UNIT_DEATH);
  // Charm ends a fight as surely as a death -- the last hostile infernal
  // changing hands leaves nothing to beat -- but it is no death, so it needs
  // its own event. "Any unit" covers every slot up to bj_MAX_PLAYER_SLOTS,
  // neutral aggressive included, so the boss's side needs nothing extra.
  trig.registerAnyUnitEvent(EVENT_PLAYER_UNIT_CHANGE_OWNER);
  for (const p of getHumanPlayers()) trig.registerPlayerEvent(p, EVENT_PLAYER_LEAVE);
  // A frame later: inside the death event the dying unit can still read as
  // alive to the checks below, and judging it standing would miss the ending.
  trig.addAction(() => nextFrame(() => checkEnding()));
}

/** Whether a fight is in progress and being watched. For tests. */
export function isBossFightWatched(): boolean {
  return watcher != null;
}

/** Decide whether the fight is over, by looking at the board. */
function checkEnding(): void {
  if (watcher == null) return; // already ended, or a stale callback
  if (partyArrived && !partyStanding()) {
    stopBossArena();
    endHeroState();
    if (onDefeat != null) onDefeat();
    return;
  }
  if (!enemiesRemain()) {
    // The party stays on the floor: whoever is still standing is who has to
    // walk out. Their state is cleared when the next board loads, as before.
    stopBossArena();
    if (onVictory != null) onVictory(survivors());
  }
}

/** The party units still alive, summons left out: they come and go on their
 *  own timers, and a way out must not wait on one. Only if nothing BUT summons
 *  survived do they count -- otherwise there would be nobody to walk out. */
function survivors(): unit[] {
  const all: unit[] = [];
  for (const player of getHumanPlayers()) {
    forEachUnitOfPlayer(player.handle, u => {
      if (!isAlive(u)) return;
      if (isCharmedBossUnit(u)) return;
      all.push(u);
    });
  }
  const real = all.filter(u => !IsUnitType(u, UNIT_TYPE_SUMMONED));
  return real.length > 0 ? real : all;
}
