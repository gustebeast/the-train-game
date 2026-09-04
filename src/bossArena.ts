import { MapPlayer, Timer, Unit } from 'w3ts';
import { BOSS_ADD_ID, BOSS_ID } from './constants';
import { spawnBoss, stopBoss } from './boss';
import { dealPartyForHumans } from './bossParty';
import { spawnHeroes, getSpawnedHeroes, endHeroState, chooseAllHeroes } from './heroes';
import { spawnMercWithHeroes, getLivingMercCount } from './mercenary';
import { getBossHeroSpots, getBossMercSpots, getBossSpot } from './terrain/spawn';
import { forEachUnitOfPlayer, getHumanPlayers } from './util';

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

/** How often the ending conditions are checked. */
const WATCH_SECONDS = 1.0;
/** Given to the fight before it may be declared over, so the frame where the
 *  party has spawned but the boss has not cannot read as a win. */
const GRACE_SECONDS = 3.0;

let watcher: Timer | null = null;
let elapsed = 0;
/** Set once the party has actually been seen standing. Without it an arena
 *  that never managed to spawn anybody reads as an instant wipe and bounces
 *  straight back out -- which is what a boss fight with no heroes did. */
let partyArrived = false;
let onDefeat: (() => void) | null = null;
let onVictory: (() => void) | null = null;

/** How the arena reports its ending. Set by terrain/load.ts, which owns what
 *  board comes next. */
export function setBossArenaCallbacks(defeat: () => void, victory: () => void): void {
  onDefeat = defeat;
  onVictory = victory;
}

/** Stop watching. Safe to call repeatedly, and called on the way out however
 *  the fight ended. */
function stopBossArena(): void {
  if (watcher != null) { watcher.destroy(); watcher = null; }
  stopBoss();
}

/** Is anything the party owns still standing? */
function partyStanding(): boolean {
  let standing = false;
  for (const player of getHumanPlayers()) {
    const g = CreateGroup()!;
    forEachUnitOfPlayer(player.handle, u => {
      if (standing) return;
      if (IsUnitType(u, UNIT_TYPE_DEAD)) return;
      if (GetUnitState(u, UNIT_STATE_LIFE) <= 0) return;
      standing = true;
    });
    if (standing) return true;
  }
  return false;
}

/** Is the boss, or anything it called down, still on the board? */
function enemiesRemain(): boolean {
  let remain = false;
  const g = CreateGroup()!;
  GroupEnumUnitsInRect(g, GetPlayableMapRect()!, undefined);
  ForGroup(g, () => {
    const u = GetEnumUnit();
    if (remain || u == null) return;
    const id = GetUnitTypeId(u);
    if (id !== BOSS_ID && id !== BOSS_ADD_ID) return;
    if (IsUnitType(u, UNIT_TYPE_DEAD)) return;
    if (GetUnitState(u, UNIT_STATE_LIFE) <= 0) return;
    remain = true;
  });
  DestroyGroup(g);
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
  elapsed = 0;
  partyArrived = false;

  const bossSpot = getBossSpot();
  if (bossSpot != null) spawnBoss(bossSpot.x, bossSpot.y);

  const heroSpots = getBossHeroSpots();
  const mercSpots = getBossMercSpots();
  // Everybody comes to this one, not the usual two.
  chooseAllHeroes();
  const deal = dealPartyForHumans(heroSpots.length, getLivingMercCount());

  // spawnHeroes takes one owner per hero in roster order, which is exactly the
  // shape the deal produces.
  const owners: MapPlayer[] = [];
  for (const id of deal.heroOwners) {
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

  // The mercenaries are handed out by the mercenary system rather than by the
  // deal above: it already places each one with whoever holds the fewest
  // heroes, breaking ties by who has controlled least recently, which is the
  // rule this fight wants and is one implementation instead of two. It is told
  // who holds which hero; it works out the rest.
  if (mercSpots.length > 0) {
    spawnMercWithHeroes(mercSpots[0].x, mercSpots[0].y, deal.heroOwners);
    // Onto their own marks. Derived from the board rather than handed back,
    // since the mercenary system owns those units: whatever the players hold
    // that is not one of the heroes is a mercenary.
    const heroHandles = getSpawnedHeroes().map(h => h.handle);
    let placed = 0;
    for (const player of getHumanPlayers()) {
      const g = CreateGroup()!;
      forEachUnitOfPlayer(player.handle, u => {
        if (placed >= mercSpots.length) return;
        if (heroHandles.indexOf(u) >= 0) return;
        SetUnitPosition(u, mercSpots[placed].x, mercSpots[placed].y);
        placed += 1;
      });
    }
  }

  const timer = Timer.create();
  watcher = timer;
  timer.start(WATCH_SECONDS, true, () => {
    elapsed += WATCH_SECONDS;
    if (elapsed < GRACE_SECONDS) return;
    if (partyStanding()) partyArrived = true;
    if (partyArrived && !partyStanding()) {
      stopBossArena();
      endHeroState();
      if (onDefeat != null) onDefeat();
      return;
    }
    if (!enemiesRemain()) {
      stopBossArena();
      endHeroState();
      if (onVictory != null) onVictory();
    }
  });
}
