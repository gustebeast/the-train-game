import { Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';
import { Players } from 'w3ts/globals';
import { registerTest, TestReporter } from './testkit';
import {
  getSparringStatus, forceLevel3Camp, getCampData, restartSparringMatch, measureFieldedForce,
  cancelSparringMatch, getCheckPlayerUnitCount, getCampOrigin, setCampForTest,
  getSparringSecondsToMinimum, getDPSMeasured, getDPSSampleBreakdown,
  SPARRING_DURATION, SPARRING_HP, SPARRING_MIN_SECONDS,
} from './creeps';
import { CREEP_CAMPS } from './creepCamps';
import {
  HeroData, setRosterForTest, spawnHeroes, hasHeroes, getChosenHeroCount,
} from './heroes';
import { setMercsForTest, spawnMercWithHeroes, buyMercContract, hasActiveMerc } from './mercenary';
import { getDPSCheckPlayer, toggleDPSVision } from './teams';
import { getHumanPlayers, forEachUnitOfPlayer } from './util';
import { loadInterRoundLobby, beginNewRun, resetPurchases } from './terrain/load';
import { purchaseSummonUpgrade, isSummonUpgradePurchased } from './summonUpgrade';
import { refreshInterRoundLobbyRoster } from './interRoundLobbyRoster';

/**
 * The sparring match: the fight the inter-round lobby runs against the next
 * camp, whose result scales that camp. Nothing about it is visible if it goes
 * wrong -- it just scales the next round off a bad number -- so these hold it
 * to what it must do.
 *
 * Three tests, each sharing one match's setup across several checks: whether
 * it fields and measures correctly, whether anyone can see it, and whether it
 * restarts and clears away properly. They were nine, most of which paid for a
 * match of their own to check one thing.
 *
 * Waits are on the match itself -- running, past its minimum, over -- rather
 * than on fixed seconds, and its sizes are read from creeps.ts rather than
 * retyped here.
 */

/** Long enough for a lobby to load and a match to start; it takes a frame. */
const START_WAIT = 5;

function matchRunning(): boolean {
  return getSparringStatus().timer;
}

/** A level 5 hero on this map's table (100 XP a level; 900 is the cap), with
 *  two points in each of the first two skills and one in the third. */
function level5(type: string, skills: ReadonlyArray<string>): HeroData {
  const s: Record<string, number> = {};
  s[skills[0]] = 2;
  s[skills[1]] = 2;
  s[skills[2]] = 1;
  return { typeId: FourCC(type), xp: 400, skills: s, items: [],
    tomeStr: 0, tomeAgi: 0, tomeInt: 0, tomeHP: 0 };
}

function countItems(): number {
  let n = 0;
  EnumItemsInRect(GetWorldBounds()!, undefined, () => { n += 1; });
  return n;
}

// --- Fields and measures -----------------------------------------------------

/** gnoll assassins x2, overseer, warden: four creeps. */
const FIELD_CAMP = 217;

/**
 * One whole match, start to finish, with a fixed party -- Far Seer and
 * Priestess at level 5 and an Ogre Lord -- against a fixed camp, so the counts
 * are exact.
 *
 * - Starting a run picks four heroes and fields two, and the match runs with
 *   or without Summon Heroes bought: the upgrade gates casting the spell and
 *   the lobby roster display, nothing else. Gating the match on the purchase
 *   is the regression the unbought half catches.
 * - Every copy fields, each creep keeps its share of ONE camp's pool (not a
 *   sixth of it, from splitting across every copy), the roster's own copy is
 *   one party with one mercenary, owned by the hidden check player rather than
 *   a human (whose camera it would yank), and the ready wait counts down.
 * - Past the minimum: nobody has wandered to a neighbour's camp, every copy has
 *   cast, and no rigging has been banked as damage -- creepHPLost once came
 *   back as -98000 from a baseline taken before the creeps were rigged.
 * - Once over: the field is clear, items included, and the measurement is
 *   positive both ways with a positive scale. This party's Far Seers cast
 *   Feral Spirit, which is what found that a summon cannot be removed once its
 *   summoner has been: every match had been leaving its wolves behind.
 */
function runSparringFields(t: TestReporter): void {
  t.report('purchasedAtStart', isSummonUpgradePurchased() ? 1 : 0);
  beginNewRun();
  t.expectTrue('heroesPickedUnbought', hasHeroes());
  t.expect('chosenThisRoundUnbought', getChosenHeroCount(), 2);
  setRosterForTest([
    level5(Units.FarSeer, [Abilities.FeralSpirit, Abilities.ChainLightning, Abilities.FarSight]),
    level5(Units.PriestessOfTheMoon, [Abilities.SearingArrows, Abilities.TrueshotAura, Abilities.Scout]),
  ]);
  setMercsForTest([FourCC('nogl')]);
  setCampForTest(FIELD_CAMP);
  loadInterRoundLobby();

  t.waitFor('matchStartsUnbought', matchRunning, START_WAIT, () => {
    t.expect('heroesInMatchUnbought', getSparringStatus().heroes, 2);

    purchaseSummonUpgrade();
    refreshInterRoundLobbyRoster();
    loadInterRoundLobby();
    // Counted once the lobby is up: loading it clears whatever earlier tests
    // left lying, which would read as items the match had taken away.
    const itemsBefore = countItems();
    const check = getDPSCheckPlayer().handle;
    let casts = 0;
    const castTrig = CreateTrigger()!;
    TriggerRegisterPlayerUnitEvent(castTrig, check, EVENT_PLAYER_UNIT_SPELL_EFFECT, undefined);
    TriggerAddAction(castTrig, () => { casts += 1; });

    t.waitFor('matchStartsBought', matchRunning, START_WAIT, () => {
      const s = getSparringStatus();
      const camp = CREEP_CAMPS[FIELD_CAMP];
      t.expect('creepsFielded', s.creeps, s.copies * camp.creeps.length);
      let heroes = 0;
      let mercs = 0;
      forEachUnitOfPlayer(check, u => {
        if (IsUnitType(u, UNIT_TYPE_HERO)) heroes += 1;
        else if (GetUnitTypeId(u) === FourCC('nogl')) mercs += 1;
      });
      t.expect('heroesFielded', heroes, s.copies * 2);
      t.expect('mercsFielded', mercs, s.copies);
      t.expect('rosterCopyHeroes', s.heroes, 2);
      t.expect('rosterCopyMercs', s.mercs, 1);
      t.expect('noMatchMercOwnedByAHuman', measureFieldedForce().mercsOwnedByHumans, 0);

      let lowest = 1e9;
      forEachUnitOfPlayer(Player(PLAYER_NEUTRAL_AGGRESSIVE)!, u => {
        const hp = BlzGetUnitMaxHP(u);
        if (hp < lowest) lowest = hp;
      });
      const share = R2I(SPARRING_HP / camp.creeps.length);
      t.report('lowestCreepMaxHP', lowest);
      if (lowest < share) t.fail('lowestCreepMaxHP', 'expected at least ' + I2S(share));

      const wait = getSparringSecondsToMinimum();
      t.report('waitAtStart', wait);
      if (wait <= 0 || wait > SPARRING_MIN_SECONDS) {
        t.fail('waitAtStart', 'expected a wait of up to ' + I2S(SPARRING_MIN_SECONDS) + 's');
      }

      t.waitFor('minimumReached', () => getSparringSecondsToMinimum() === 0, SPARRING_MIN_SECONDS + 2, () => {
        let strays = 0;
        forEachUnitOfPlayer(check, u => {
          let nearest = 1e12;
          forEachUnitOfPlayer(Player(PLAYER_NEUTRAL_AGGRESSIVE)!, c => {
            const d = (GetUnitX(u) - GetUnitX(c)) ** 2 + (GetUnitY(u) - GetUnitY(c)) ** 2;
            if (d < nearest) nearest = d;
          });
          // The leash plus a camp's width.
          if (nearest > 900 * 900) strays += 1;
        });
        t.expect('unitsAwayFromAnyCamp', strays, 0);
        t.report('castsByMinimum', casts);
        if (casts < s.copies) t.fail('castsByMinimum', 'expected every copy to have cast');
        const mid = getDPSSampleBreakdown().creepHPLost;
        t.report('midCreepHPLost', mid);
        if (mid < 0) t.fail('midCreepHPLost', 'rigging banked as damage');

        t.waitFor('matchEnds', () => !matchRunning(), SPARRING_DURATION, () => {
          DestroyTrigger(castTrig);
          t.expect('checkPlayerUnitsLeft', getCheckPlayerUnitCount(), 0);
          // Name whatever is left, so a leak says what leaked.
          const left: string[] = [];
          forEachUnitOfPlayer(check, u => {
            left.push((GetUnitName(u) ?? '?') + (IsUnitType(u, UNIT_TYPE_HERO) ? '(hero)' : '')
              + '@' + I2S(R2I(GetUnitX(u))) + ',' + I2S(R2I(GetUnitY(u))));
          });
          if (left.length > 0) t.report('leftOver', left.join(' '));

          t.expect('creepsLeft', getSparringStatus().creeps, 0);
          t.expect('itemsLeftLying', countItems() - itemsBefore, 0);
          const m = getDPSMeasured();
          const final = getDPSSampleBreakdown().creepHPLost;
          t.report('finalCreepHPLost', final);
          t.report('heroDPSPerCopy', m.heroDPS);
          t.report('creepDPSPerCopy', m.creepDPS);
          t.report('scale', m.scale);
          if (final < 0) t.fail('finalCreepHPLost', 'rigging banked as damage');
          if (m.heroDPS <= 0) t.fail('heroDPSPerCopy', 'must be positive');
          if (m.creepDPS <= 0) t.fail('creepDPSPerCopy', 'match measured no creep damage');
          if (m.scale <= 0) t.fail('scale', 'must be positive');
          t.done();
        });
      });
    });
  });
}

registerTest('sparfields', runSparringFields);

// --- Out of sight ------------------------------------------------------------

/**
 * The match is fought out of sight, for everybody, unless asked for.
 *
 * It used to be visible to the first human as a special case -- one player
 * watched it while the others saw nothing, which was not a decision anyone
 * made. -viewdps hands vision to whoever asks, and only them.
 *
 * Checked both ways: by the alliance flag that carries vision, and by asking
 * the engine whether the match's units are actually visible -- the question
 * the player experiences, which scenery or a nearby unit could answer
 * differently from the flag.
 */
function runSparringVision(t: TestReporter): void {
  const dps = getDPSCheckPlayer().handle;
  const humans = getHumanPlayers();
  const me = humans[0];
  const sharing = (p: player): boolean => GetPlayerAlliance(dps, p, ALLIANCE_SHARED_VISION);
  t.expect('nobodySeesByDefault', humans.filter(p => sharing(p.handle)).length, 0);
  t.expectTrue('toggleOn', toggleDPSVision(me.handle));
  t.expectTrue('watcherSees', sharing(me.handle));
  t.expect('othersStillBlind', humans.filter(p => p.handle !== me.handle && sharing(p.handle)).length, 0);
  t.expectFalse('toggleOff', toggleDPSVision(me.handle));
  t.expectFalse('watcherBlindAgain', sharing(me.handle));

  beginNewRun();
  loadInterRoundLobby();
  t.waitFor('matchStarts', matchRunning, START_WAIT, () => {
    let fielded = 0;
    let seen = 0;
    forEachUnitOfPlayer(dps, u => {
      if (IsUnitType(u, UNIT_TYPE_DEAD)) return;
      fielded += 1;
      if (humans.some(p => IsUnitVisible(u, p.handle))) seen += 1;
    });
    t.report('unitsFielded', fielded);
    if (fielded === 0) t.fail('unitsFielded', 'no match units to look for');
    t.expect('unitsSeenByAHuman', seen, 0);
    t.done();
  });
}

registerTest('sparvision', runSparringVision);

// --- Restarts and clears away ------------------------------------------------

/**
 * The match measures A SPECIFIC CAMP, so whatever changes the camp restarts
 * it, from zero, against the new one -- and when it ends, nothing it brought
 * onto the field outlives it.
 *
 * - The Strange Meat swaps in a level 3 camp: the match restarts against it,
 *   with a fresh clock, the right creeps, the mercenary fielded once rather
 *   than added to, still owned by the check player, and the player's camera
 *   left where it was (spawning a human's unit pans their camera).
 * - Reset Purchases rewinds that: the camp walked in with comes back, the lobby
 *   is rebuilt and the clock starts afresh.
 * - Ended early, the field is swept by OWNER, which is what catches what the
 *   match summoned: a Far Seer's wolves are on no spawn list, survived the
 *   teardown, and fought on into the next match after a reroll. A stand-in
 *   wolf plays that part, since a level 1 roster has learned no summon.
 *
 * The keys are per trigger -- meat*, revert*, clear* -- so a failure says
 * which step stopped working.
 */
function runSparringRestart(t: TestReporter): void {
  beginNewRun();
  t.expectTrue('mercHired', buyMercContract() && hasActiveMerc());
  loadInterRoundLobby();

  t.waitFor('matchStarts', () => matchRunning() && getSparringStatus().elapsed >= 1, START_WAIT + 1, () => {
    const before = getSparringStatus();
    t.report('campOnEntry', before.campIndex);
    const cameraX = GetCameraTargetPositionX();
    const cameraY = GetCameraTargetPositionY();

    t.expectTrue('meatChangedCamp', forceLevel3Camp());
    t.waitFor('meatMatchRestarts', matchRunning, START_WAIT, () => {
      const swapped = getSparringStatus();
      const meatCamp = getCampData();
      t.expect('meatCampLevelIs3', meatCamp != null ? meatCamp.level : 0, 3);
      t.expect('meatCreepsMatchNewCamp', swapped.creeps,
        meatCamp != null ? meatCamp.creeps.length * swapped.copies : -1);
      t.report('meatElapsed', swapped.elapsed);
      if (swapped.elapsed >= before.elapsed) t.fail('meatClockRestarted', 'clock carried over');
      t.expect('meatMercNotDuplicated', swapped.mercs, 1);
      t.expect('meatHeroesNotDuplicated', swapped.heroes, before.heroes);
      t.expect('meatMercNotHumanOwned', measureFieldedForce().mercsOwnedByHumans, 0);
      const moved = math.abs(GetCameraTargetPositionX() - cameraX)
        + math.abs(GetCameraTargetPositionY() - cameraY);
      t.report('meatCameraMoved', moved);
      if (moved > 64) t.fail('meatCameraMoved', 'camera jumped');

      resetPurchases();
      t.waitFor('revertMatchRestarts', matchRunning, START_WAIT, () => {
        const after = getSparringStatus();
        const revertCamp = getCampData();
        t.expect('revertCampIndex', after.campIndex, before.campIndex);
        t.expect('revertCreepsMatchCamp', after.creeps,
          revertCamp != null ? revertCamp.creeps.length * after.copies : -1);
        t.report('revertElapsed', after.elapsed);
        if (after.elapsed > 2) t.fail('revertFreshClock', 'clock carried over');

        const fielded = getCheckPlayerUnitCount();
        t.report('clearUnitsFielded', fielded);
        const origin = getCampOrigin();
        const wolf = Unit.create(getDPSCheckPlayer(), FourCC('nwlt'),
          origin != null ? origin.x : 0, origin != null ? origin.y : 0, 270);
        t.expect('clearStandInSummonOwnedByMatch', getCheckPlayerUnitCount() - fielded, wolf != null ? 1 : -1);
        cancelSparringMatch();
        t.after(0.5, () => {
          t.expect('clearFieldIncludingSummon', getCheckPlayerUnitCount(), 0);
          // And a restart after the sweep fields afresh, not on top of it.
          restartSparringMatch();
          t.waitFor('clearRestartRuns', matchRunning, START_WAIT, () => {
            t.expect('clearRestartMercs', getSparringStatus().mercs, 1);
            t.done();
          });
        });
      });
    });
  });
}

registerTest('sparrestart', runSparringRestart);

// --- What a mercenary does to the scaling ------------------------------------

/**
 * A mercenary raises both halves of the camp's scaling.
 *
 * Camp HP is pegged to the fielded force's effective HP and camp damage to its
 * DPS; counting the mercenary raises both, so camps get tougher for whoever
 * has one. Asserted in direction only -- how MUCH is a balance question -- and
 * reported, so a change to it lands measured.
 *
 * Fields the force directly rather than through a match, which rigs everyone
 * to the same huge HP and would measure the rigging.
 */
function runForceScale(t: TestReporter): void {
  beginNewRun();
  t.expectTrue('mercHired', buyMercContract() && hasActiveMerc());
  spawnHeroes([Players[0]], 0, 0);
  spawnMercWithHeroes(0, -96, [Players[0].id]);
  // A frame for hero tome bonuses to land before anything is read.
  t.after(0.5, () => {
    const f = measureFieldedForce();
    t.expect('mercs', f.mercs, 1);
    const hpPct = f.heroEHP > 0 ? (f.heroEHP + f.mercEHP) / f.heroEHP * 100 : 0;
    const dmgPct = f.heroDPS > 0 ? (f.heroDPS + f.mercDPS) / f.heroDPS * 100 : 0;
    t.report('campHPPercentOfBefore', hpPct);
    t.report('campDamagePercentOfBefore', dmgPct);
    if (hpPct <= 100) t.fail('campHPPercentOfBefore', 'a mercenary must raise camp HP');
    if (dmgPct <= 100) t.fail('campDamagePercentOfBefore', 'a mercenary must raise camp damage');
    t.done();
  });
}

registerTest('forcescale', runForceScale);

