import { registerTest, TestReporter } from './testkit';
import { gameState } from './state';
import { Units } from '@objectdata/units';
import { beginNewRun, loadTerrain, loadInterRoundLobby, loadBossBattlefield } from './terrain/load';
import { armChallenge, clearChallenges, isChallengeArmed, getArmedChallenge } from './challenges';
import { CH_DASH, CH_SOLO_TOOLS, noteDash } from './challengeList';
import { challengeUIState, initChallengeUI } from './challengeUI';
import { isBossFightWatched, startBossFight } from './bossArena';
import { getHumanPlayers, forEachUnitInWorld, forEachUnitOfPlayer, isAlive } from './util';
import { AXE_ID, PICKAXE_ID, PEASANT_ID, BOSS_ID, BOSS_ADD_ID, WOOD_ID, STONE_ID, TRACK_PIECE_ID, BUCKET_FULL_ID, BUCKET_ID, BOSS_KEY_ITEM_ID,
  TRAIN_ID, TRACK_WAGON_ID } from './constants';
import { Item, Unit } from 'w3ts';
import { cargoShowing } from './cargoVisuals';
import { spawnStrangeRock } from './bossRock';
import { placedTracks } from './track/state';
import { auditMinimapIcons, minimapIconCount } from './minimapIcons';
import { getTrain, getTrackWagon } from './train';
import { setStorageItem, giveToStorage, findItemByType } from './items';

/**
 * Five systems that used to poll on the global tick now run on events. What
 * separates the two is WHEN the reaction lands, so each case below is read in
 * the same frame as the event, or one frame later where the code deliberately
 * waits a frame -- never after a wait long enough for a poll to have caught up.
 */

function expect(t: TestReporter, key: string, actual: number, want: number): void {
  t.report(key, actual);
  if (actual !== want) t.fail(key, 'expected ' + I2S(want) + ', got ' + I2S(actual));
}

/** A frame, give or take: long enough for nextFrame, far shorter than the
 *  half-second tick these systems used to ride. */
const ONE_FRAME = 0.05;

// --- the challenge board --------------------------------------------------

function runBoardEvents(t: TestReporter): void {
  beginNewRun();
  loadTerrain(0);
  initChallengeUI();
  armChallenge(CH_DASH);
  // Same frame: armed means shown.
  expect(t, 'shownOnArm', challengeUIState().title === 'Challenge' ? 1 : 0, 1);
  const before = challengeUIState().progress;
  noteDash();
  const after = challengeUIState().progress;
  t.report('progressBefore', before);
  t.report('progressAfter', after);
  // Same frame: the counter moving IS the redraw.
  expect(t, 'redrawnOnCount', before !== after ? 1 : 0, 1);
  clearChallenges();
  expect(t, 'hiddenOnClear', challengeUIState().title === '' ? 1 : 0, 1);
  t.done();
}
registerTest('boardevents', runBoardEvents);

// --- the dealer's preview -------------------------------------------------

function firstUnitOfType(typeId: number): unit | null {
  let found: unit | null = null;
  forEachUnitInWorld(u => { if (found == null && GetUnitTypeId(u) === typeId) found = u; });
  return found;
}

/** How long a synced selection event may take to arrive. */
const SELECTION_LIMIT = 3;

function runDealerSelect(t: TestReporter): void {
  beginNewRun();
  loadInterRoundLobby();
  const dealer = firstUnitOfType(FourCC(Units.TombOfRelics));
  const me = getHumanPlayers()[0].handle;
  let peasant: unit | null = null;
  forEachUnitOfPlayer(me, u => { if (peasant == null && GetUnitTypeId(u) === PEASANT_ID) peasant = u; });
  expect(t, 'dealerFound', dealer != null ? 1 : 0, 1);
  expect(t, 'peasantFound', peasant != null ? 1 : 0, 1);
  if (dealer == null || peasant == null) { t.done(); return; }

  // Selection events are synced like any player input, so they land a little
  // after the call that caused them. The test waits for each reaction, frame by
  // frame, and reports how long it took -- that is latency, not polling in the
  // game: the game itself only acts when the event arrives. The first selection
  // of a session has been measured at just over a second (1.05s, against 0.4-0.75s
  // later), so the limit leaves room for that; a missing reaction still fails.
  SelectUnitForPlayerSingle(dealer, me);
  waitFor(t, () => challengeUIState().previewing, SELECTION_LIMIT, (ok, waited) => {
    t.report('selectLatency', waited);
    expect(t, 'previewOnSelect', ok ? 1 : 0, 1);
    SelectUnitForPlayerSingle(peasant!, me);
    waitFor(t, () => !challengeUIState().previewing, SELECTION_LIMIT, (ok2, waited2) => {
      t.report('deselectLatency', waited2);
      expect(t, 'previewClearedOnDeselect', ok2 ? 1 : 0, 1);
      t.done();
    });
  });
}

/** Wait, a frame at a time, for `cond` -- up to `limit` seconds. */
function waitFor(
  t: TestReporter, cond: () => boolean, limit: number,
  then: (ok: boolean, waited: number) => void,
): void {
  let waited = 0;
  const step = (): void => {
    if (cond()) { then(true, waited); return; }
    if (waited >= limit) { then(false, waited); return; }
    waited += ONE_FRAME;
    t.after(ONE_FRAME, step);
  };
  step();
}
registerTest('dealerselect', runDealerSelect);

// --- the boss fight's endings ---------------------------------------------

function killAll(filter: (u: unit) => boolean): number {
  const doomed: unit[] = [];
  forEachUnitInWorld(u => { if (filter(u) && isAlive(u)) doomed.push(u); });
  for (const u of doomed) {
    SetUnitInvulnerable(u, false);
    KillUnit(u);
  }
  return doomed.length;
}

function isEnemy(u: unit): boolean {
  const id = GetUnitTypeId(u);
  return id === BOSS_ID || id === BOSS_ADD_ID;
}

function isParty(u: unit): boolean {
  for (const p of getHumanPlayers()) if (GetOwningPlayer(u) === p.handle) return true;
  return false;
}

function runBossEnding(t: TestReporter): void {
  beginNewRun();
  // Both halves, as the victory callback does: loading lays the arena down,
  // starting the fight stands the boss and party up and begins watching.
  loadBossBattlefield();
  startBossFight();
  expect(t, 'watchingAtStart', isBossFightWatched() ? 1 : 0, 1);

  // Nothing dies: the fight must stay on. The old version needed a three-second
  // grace to survive this; an event version has nothing to react to.
  t.after(3, () => {
    expect(t, 'stillOnWithNoDeaths', isBossFightWatched() ? 1 : 0, 1);

    // Victory: everything hostile dies.
    t.report('enemiesKilled', killAll(isEnemy));
    t.after(ONE_FRAME * 4, () => {
      expect(t, 'endedOnVictory', isBossFightWatched() ? 1 : 0, 0);

      // Defeat: a fresh fight, and the party dies instead.
      beginNewRun();
      loadBossBattlefield();
      startBossFight();
      expect(t, 'watchingSecondFight', isBossFightWatched() ? 1 : 0, 1);
      t.report('partyKilled', killAll(isParty));
      t.after(ONE_FRAME * 4, () => {
        expect(t, 'endedOnDefeat', isBossFightWatched() ? 1 : 0, 0);
        t.done();
      });
    });
  });
}
registerTest('bossending', runBossEnding);

// --- Union Rules ----------------------------------------------------------

function runUnionRules(t: TestReporter): void {
  beginNewRun();
  loadTerrain(0);
  armChallenge(CH_SOLO_TOOLS);
  const me = getHumanPlayers()[0];
  const a = CreateUnit(me.handle, PEASANT_ID, 0, 0, 0)!;
  const b = CreateUnit(me.handle, PEASANT_ID, 64, 0, 0)!;

  // Different tools: allowed.
  UnitAddItem(a, CreateItem(AXE_ID, 0, 0)!);
  UnitAddItem(b, CreateItem(PICKAXE_ID, 0, 0)!);
  t.after(ONE_FRAME, () => {
    const allowed = getArmedChallenge();
    t.report('progressAfterDifferentTools', allowed != null && allowed.progress != null ? allowed.progress() : '-');
    expect(t, 'differentToolsAllowed', isChallengeArmed(CH_SOLO_TOOLS)
      && allowed != null && allowed.progress != null && allowed.progress() === 'No tool shared yet' ? 1 : 0, 1);

    // The same tool in two hands, arriving by script UnitAddItem -- the path
    // the give/take system uses, and the one most worth proving fires pickup.
    UnitAddItem(b, CreateItem(AXE_ID, 64, 0)!);
    t.after(ONE_FRAME, () => {
      const def = getArmedChallenge();
      const text = def != null && def.progress != null ? def.progress() : '-';
      t.report('progressAfterSharing', text);
      expect(t, 'sharingCaughtOnPickup', text === 'Tool shared - failed' ? 1 : 0, 1);
      t.done();
    });
  });
}
registerTest('unionrules', runUnionRules);

// --- cargo models on the train cars ---------------------------------------

/** Each way cargo reaches or leaves a car, read two frames after it happens
 *  (the sync waits one frame, because DROP fires before the item leaves). */
function runCargoEvents(t: TestReporter): void {
  beginNewRun();
  loadTerrain(0);
  const train = getTrain();
  const wagon = getTrackWagon();
  if (train == null || wagon == null) {
    t.fail('train', 'loadTerrain stood up no train');
    t.done();
    return;
  }
  const me = getHumanPlayers()[0];
  const wait = ONE_FRAME * 2;

  // Start from empty cars, whatever the round handed out.
  setStorageItem(train, WOOD_ID, 0);
  setStorageItem(train, STONE_ID, 0);
  setStorageItem(wagon, TRACK_PIECE_ID, 0);
  t.after(wait, () => {
    const c0 = cargoShowing();
    expect(t, 'emptyShowsNothing', (c0.wood || c0.stone || c0.tracks) ? 1 : 0, 0);

    // In: setStorageItem adding a new stack (production's path to the wagon).
    setStorageItem(wagon, TRACK_PIECE_ID, 2);
    // In: a player's give, from a peasant carrying stone.
    const peasant = Unit.create(me, PEASANT_ID, train.x + 64, train.y, 0)!;
    const stone = Item.create(STONE_ID, peasant.x, peasant.y)!;
    stone.charges = 2;
    UnitAddItem(peasant.handle, stone.handle);
    expect(t, 'giveAccepted', giveToStorage(stone, train) ? 1 : 0, 1);
    // In: setStorageItem on the engine.
    setStorageItem(train, WOOD_ID, 1);
    t.after(wait, () => {
      const c1 = cargoShowing();
      expect(t, 'tracksOnAfterStore', c1.tracks ? 1 : 0, 1);
      expect(t, 'stoneOnAfterGive', c1.stone ? 1 : 0, 1);
      expect(t, 'woodOnAfterStore', c1.wood ? 1 : 0, 1);

      // A charge changing in place must not take the model off.
      const s = findItemByType(train, STONE_ID);
      if (s != null) s.charges = s.charges + 1;
      // Out: the last wood used up exactly as production does it.
      const w = findItemByType(train, WOOD_ID);
      if (w != null) { w.charges -= 1; if (w.charges <= 0) RemoveItem(w.handle); }
      // Out: a stack set to zero.
      setStorageItem(wagon, TRACK_PIECE_ID, 0);
      t.after(wait, () => {
        const c2 = cargoShowing();
        expect(t, 'woodOffWhenUsedUp', c2.wood ? 1 : 0, 0);
        expect(t, 'tracksOffAtZero', c2.tracks ? 1 : 0, 0);
        expect(t, 'stoneStaysOnChargeChange', c2.stone ? 1 : 0, 1);

        // A new round replaces both cars. Cargo that arrives on the NEW engine
        // must show there.
        loadTerrain(0);
        const newTrain = getTrain();
        if (newTrain != null) setStorageItem(newTrain, WOOD_ID, 1);
        t.after(wait, () => {
          expect(t, 'woodOnNewTrain', cargoShowing().wood ? 1 : 0, 1);
          t.done();
        });
      });
    });
  });
}
registerTest('cargoevents', runCargoEvents);

// --- minimap tool icons ---------------------------------------------------

/**
 * "Reliable" is defined against the scanner this replaced: after every kind of
 * change, a full scan of the ground must find NOTHING to fix. auditMinimapIcons
 * is that scan; it returns how many icons it had to correct.
 */
function runMinimapEvents(t: TestReporter): void {
  beginNewRun();
  loadTerrain(0);
  const wait = ONE_FRAME * 2;
  const me = getHumanPlayers()[0];

  const groundAxe = (): item | null => {
    let found: item | null = null;
    EnumItemsInRect(GetWorldBounds()!, null!, () => {
      const it = GetEnumItem();
      if (found == null && it != null && GetItemTypeId(it) === AXE_ID && !IsItemOwned(it)) found = it;
    });
    return found;
  };

  t.after(wait, () => {
    t.report('iconsAfterLoad', minimapIconCount());
    if (minimapIconCount() === 0) t.fail('iconsAfterLoad', 'no tools on the ground, nothing tested');
    expect(t, 'auditAfterLoad', auditMinimapIcons(), 0);

    const axe = groundAxe();
    if (axe == null) { t.fail('axe', 'no ground axe'); t.done(); return; }
    const icons0 = minimapIconCount();
    const carrier = CreateUnit(me.handle, PEASANT_ID, GetItemX(axe), GetItemY(axe), 0)!;

    // Picked up.
    UnitAddItem(carrier, axe);
    t.after(wait, () => {
      expect(t, 'pickupRemovesIcon', icons0 - minimapIconCount(), 1);
      expect(t, 'auditAfterPickup', auditMinimapIcons(), 0);

      // Dropped somewhere else.
      SetUnitPosition(carrier, GetUnitX(carrier) + 256, GetUnitY(carrier));
      UnitRemoveItem(carrier, axe);
      t.after(wait, () => {
        expect(t, 'dropRestoresIcon', minimapIconCount(), icons0);
        expect(t, 'auditAfterDrop', auditMinimapIcons(), 0);

        // Carried, and the carrier dies.
        UnitAddItem(carrier, axe);
        t.after(wait, () => {
          KillUnit(carrier);
          t.after(wait, () => {
            expect(t, 'carrierDeathRestoresIcon', minimapIconCount(), icons0);
            expect(t, 'auditAfterCarrierDeath', auditMinimapIcons(), 0);

            // Moved on the ground, hidden, shown, then created and removed.
            SetItemPosition(axe, GetItemX(axe) - 384, GetItemY(axe));
            t.after(wait, () => {
              expect(t, 'auditAfterMove', auditMinimapIcons(), 0);
              SetItemVisible(axe, false);
              t.after(wait, () => {
                expect(t, 'hideRemovesIcon', icons0 - minimapIconCount(), 1);
                SetItemVisible(axe, true);
                const spare = CreateItem(PICKAXE_ID, 0, 0)!;
                t.after(wait, () => {
                  expect(t, 'createAddsIcon', minimapIconCount(), icons0 + 1);
                  RemoveItem(spare);
                  // Same frame: removal is handled inside the call.
                  expect(t, 'removeDropsIconSameFrame', minimapIconCount(), icons0);
                  t.after(wait, () => {
                    expect(t, 'auditAfterCreateRemove', auditMinimapIcons(), 0);

                    // Created and picked up in one frame -- how filling or
                    // emptying a bucket swaps the item. Must leave no icon.
                    const swap = Unit.create(me, PEASANT_ID, 0, 0, 0)!;
                    UnitAddItem(swap.handle, CreateItem(BUCKET_FULL_ID, 0, 0)!);
                    t.after(wait, () => {
                      expect(t, 'createThenCarryNoIcon', minimapIconCount(), icons0);
                      expect(t, 'auditAfterSwap', auditMinimapIcons(), 0);

                      // Destroyed on the ground, the way it happens in play:
                      // damage. (SetWidgetLife to 0 does NOT fire an item's
                      // death event -- measured -- and nothing in the map
                      // destroys tools that way.)
                      // Beyond the tools' 999999 HP: unreachable in play now,
                      // but the icon's death handling is still held to account.
                      UnitDamageTarget(swap.handle, axe, 10000000, true, false,
                        ATTACK_TYPE_CHAOS, DAMAGE_TYPE_UNIVERSAL, WEAPON_TYPE_WHOKNOWS);
                      t.after(wait, () => {
                        t.report('axeLifeAfterDamage', GetWidgetLife(axe));
                        expect(t, 'auditAfterDestroy', auditMinimapIcons(), 0);

                        // A new board: everything wiped and respawned.
                        loadTerrain(0);
                        t.after(wait, () => {
                          expect(t, 'auditAfterRegen', auditMinimapIcons(), 0);
                          t.report('iconsAfterRegen', minimapIconCount());
                          t.done();
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}
registerTest('minimapevents', runMinimapEvents);

// --- tools can't be broken ------------------------------------------------

/** The tools and the key carry 999999 HP, so an A-click cannot destroy them.
 *  Read off real items, which is what proves the object data reached the built
 *  map rather than only the source. Wood is reported as the breakable control. */
function runToolHealth(t: TestReporter): void {
  const me = getHumanPlayers()[0];
  const hitter = CreateUnit(me.handle, PEASANT_ID, 0, 0, 0)!;
  const tools: [string, number][] = [
    ['axe', AXE_ID], ['pickaxe', PICKAXE_ID], ['bucket', BUCKET_ID],
    ['bucketFull', BUCKET_FULL_ID], ['key', BOSS_KEY_ITEM_ID],
  ];
  for (const [name, id] of tools) {
    const it = CreateItem(id, 0, 0)!;
    const life = GetWidgetLife(it);
    t.report(name + 'HP', life);
    if (life < 999999) t.fail(name + 'HP', 'expected 999999, got ' + I2S(R2I(life)));
    // A far harder hit than any A-click, which must leave it standing.
    UnitDamageTarget(hitter, it, 5000, true, false,
      ATTACK_TYPE_CHAOS, DAMAGE_TYPE_UNIVERSAL, WEAPON_TYPE_WHOKNOWS);
    expect(t, name + 'SurvivesHeavyHit', GetWidgetLife(it) > 0 ? 1 : 0, 1);
    RemoveItem(it);
  }
  const wood = CreateItem(WOOD_ID, 0, 0)!;
  t.report('woodHP', GetWidgetLife(wood));
  RemoveItem(wood);
  t.done();
}
registerTest('toolhealth', runToolHealth);

// --- Transmute must not pay gold -------------------------------------------

/** The Alchemist's Transmute kills a creep and pays its owner gold. Gold here
 *  lives in gameState and is copied onto native gold by syncGold, so a payout
 *  shows as phantom gold the shop then refuses to honour. Cast it for real and
 *  measure both. */
function runTransmuteGold(t: TestReporter): void {
  beginNewRun();
  loadTerrain(0);
  const me = getHumanPlayers()[0];
  const alchemist = CreateUnit(me.handle, FourCC('Nalc'), 0, 0, 0)!;
  UnitAddAbility(alchemist, FourCC('ANtm'));
  SetUnitAbilityLevel(alchemist, FourCC('ANtm'), 1);
  SetUnitState(alchemist, UNIT_STATE_MANA, 1000);
  const creep = CreateUnit(Player(PLAYER_NEUTRAL_AGGRESSIVE)!, FourCC('nkob'), 150, 0, 180)!;
  const nativeBefore = GetPlayerState(me.handle, PLAYER_STATE_RESOURCE_GOLD);
  const stateBefore = gameState.gold;
  const ordered = IssueTargetOrder(alchemist, 'transmute', creep);
  expect(t, 'orderAccepted', ordered ? 1 : 0, 1);
  t.after(4, () => {
    expect(t, 'creepTransmuted', !isAlive(creep) ? 1 : 0, 1);
    const nativeGain = GetPlayerState(me.handle, PLAYER_STATE_RESOURCE_GOLD) - nativeBefore;
    t.report('stateGoldGain', gameState.gold - stateBefore);
    expect(t, 'nativeGoldGain', nativeGain, 0);
    t.done();
  });
}
registerTest('transmutegold', runTransmuteGold);

/** Kills pay no gold either. Found as the control for transmutegold: with
 *  Transmute's own payout zeroed, 10 gold still arrived, and a plain kill of the
 *  same creep paid 6 -- kill bounty, phantom gold on every creep in a round. */
function runKillBounty(t: TestReporter): void {
  beginNewRun();
  loadTerrain(0);
  const me = getHumanPlayers()[0];
  const killer = CreateUnit(me.handle, FourCC('Nalc'), 0, 0, 0)!;
  const creep = CreateUnit(Player(PLAYER_NEUTRAL_AGGRESSIVE)!, FourCC('nkob'), 150, 0, 180)!;
  const before = GetPlayerState(me.handle, PLAYER_STATE_RESOURCE_GOLD);
  UnitDamageTarget(killer, creep, 100000, true, false,
    ATTACK_TYPE_CHAOS, DAMAGE_TYPE_UNIVERSAL, WEAPON_TYPE_WHOKNOWS);
  t.after(1, () => {
    expect(t, 'creepKilled', !isAlive(creep) ? 1 : 0, 1);
    expect(t, 'nativeGoldFromPlainKill', GetPlayerState(me.handle, PLAYER_STATE_RESOURCE_GOLD) - before, 0);
    t.done();
  });
}
registerTest('killbounty', runKillBounty);

// --- the Strange Key ------------------------------------------------------

function holdsKey(u: unit): boolean {
  for (let slot = 0; slot < 6; slot++) {
    const it = UnitItemInSlot(u, slot);
    if (it != null && GetItemTypeId(it) === BOSS_KEY_ITEM_ID) return true;
  }
  return false;
}

/** The key is thrown at the rock and breaks it on impact; everything else is
 *  refused by the engine before the key is spent; attacks do nothing. */
function runStrangeKey(t: TestReporter): void {
  beginNewRun();
  loadTerrain(0);
  const me = getHumanPlayers()[0];
  // The board is random, so clear the patch the test stands on: a rock or a
  // peasant dropped onto water or granite gets shoved aside, and the throw then
  // fails for reasons that have nothing to do with the key.
  const area = Rect(-200, -300, 700, 400)!;
  EnumDestructablesInRect(area, null!, () => RemoveDestructable(GetEnumDestructable()!));
  const clear = CreateGroup()!;
  GroupEnumUnitsInRect(clear, area, null!);
  ForGroup(clear, () => {
    const u = GetEnumUnit()!;
    if (GetUnitTypeId(u) !== TRAIN_ID && GetUnitTypeId(u) !== TRACK_WAGON_ID) RemoveUnit(u);
  });
  DestroyGroup(clear);
  RemoveRect(area);
  const rock = spawnStrangeRock(400, 0);
  expect(t, 'rockSpawned', rock != null ? 1 : 0, 1);
  if (rock == null) { t.done(); return; }
  const p = CreateUnit(me.handle, PEASANT_ID, 150, 0, 0)!;
  const key = CreateItem(BOSS_KEY_ITEM_ID, 150, 0)!;
  UnitAddItem(p, key);

  // Refused targets: a creep, one of our own tracks (a structure, so the
  // ancient flag is what excludes it), and the peasant's own side.
  const kobold = CreateUnit(Player(PLAYER_NEUTRAL_AGGRESSIVE)!, FourCC('nkob'), 150, 200, 0)!;
  const track = placedTracks[0];
  expect(t, 'refusedOnCreep', UnitUseItemTarget(p, key, kobold) ? 1 : 0, 0);
  expect(t, 'refusedOnTrack', track != null && UnitUseItemTarget(p, key, track.handle) ? 1 : 0, 0);
  expect(t, 'refusedOnSelf', UnitUseItemTarget(p, key, p) ? 1 : 0, 0);
  expect(t, 'keyKeptAfterRefusals', holdsKey(p) ? 1 : 0, 1);

  // Invulnerable, as water is: no health bar, and a player's attack on it is
  // refused when clicked. (A SCRIPT order skips that click-time check, so it
  // cannot be asserted here -- checked with real clicks instead.)
  expect(t, 'invulnerable', BlzIsUnitInvulnerable(rock) ? 1 : 0, 1);

  // Damage does nothing to it either.
  UnitDamageTarget(p, rock, 5000, true, false,
    ATTACK_TYPE_CHAOS, DAMAGE_TYPE_UNIVERSAL, WEAPON_TYPE_WHOKNOWS);
  expect(t, 'survivesHeavyHit', isAlive(rock) ? 1 : 0, 1);

  const gold0 = GetPlayerState(me.handle, PLAYER_STATE_RESOURCE_GOLD);
  t.after(ONE_FRAME * 4, () => {
  expect(t, 'throwAccepted', UnitUseItemTarget(p, key, rock) ? 1 : 0, 1);
  t.after(0.1, () => {
    // The missile is still in the air: thrown, not instant.
    t.report('rockAliveWhileInFlight', isAlive(rock) ? 1 : 0);
    t.after(3, () => {
      expect(t, 'rockBrokenOnImpact', isAlive(rock) ? 1 : 0, 0);
      expect(t, 'keySpent', holdsKey(p) ? 1 : 0, 0);
      let keysOnGround = 0;
      EnumItemsInRect(GetWorldBounds()!, null!, () => {
        const it = GetEnumItem();
        if (it != null && GetItemTypeId(it) === BOSS_KEY_ITEM_ID) keysOnGround += 1;
      });
      expect(t, 'keyNotLeftOnGround', keysOnGround, 0);
      expect(t, 'noGoldFromThrow', GetPlayerState(me.handle, PLAYER_STATE_RESOURCE_GOLD) - gold0, 0);
      expect(t, 'creepUntouched', isAlive(kobold) ? 1 : 0, 1);
      t.done();
    });
  });
  });
}
registerTest('strangekey', runStrangeKey);
