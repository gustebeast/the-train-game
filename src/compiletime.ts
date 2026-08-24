compiletime(({ objectData, constants }) => {
  /** Everything visible is drawn at peasant scale. Shared by the blanket
   *  loop below and the hero block near the end of this file. */
  const UNIT_SCALE = 0.6;

  // Everything in the world is peasant-sized unless we say otherwise.
  //
  // The heroes are scaled to 0.6 to match the peasant (see the hero block near
  // the end of this file), which left every creep, mercenary and summoned unit
  // towering over them. Rather than enumerate what to shrink, shrink EVERYTHING
  // and let the units we author ourselves set their own scale further down --
  // this loop runs first, so every later assignment simply overrides it.
  //
  // Blanket rather than a list, because a list cannot be kept honest here. A
  // summoned unit is a unit TYPE, so scaling the type covers every instance
  // however it came to exist: a lava spawn splitting in two, a Black Arrow kill
  // raising a dark minion, a beetle clawing out of a corpse. Catching those at
  // runtime would mean catching every creation path instead, and deriving the
  // list from ability data demonstrably misses some -- carrion beetles and
  // clockwerk goblins appear in no ability's unit list, and both come from
  // heroes in our own pool.
  //
  // KEEP holds the units that must stay at their authored size AND have no
  // explicit scale later: the peasant, which is the yardstick everything else
  // is matched against; the ambient critters, already small; and the circle of
  // power, whose footprint has to keep reading as the ready zone that the
  // trigger radius actually covers.
  const KEEP: string[] = [
    constants.units.Peasant,
    constants.units.Rabbit, constants.units.Stag, constants.units.Sheep,
    constants.units.Pig, constants.units.Chicken, constants.units.Raccoon,
    constants.units.CircleOfPower,
  ];
  const alreadyScaled: Record<string, boolean> = {};
  for (const unitId of Object.values(constants.units) as string[]) {
    // constants.units aliases several names onto one rawcode; visit each once.
    if (alreadyScaled[unitId] === true) continue;
    alreadyScaled[unitId] = true;
    if (KEEP.indexOf(unitId as never) !== -1) continue;
    const anyUnit = objectData.units.get(unitId as never);
    if (anyUnit == null) continue;
    anyUnit.scalingValueundefined = UNIT_SCALE;
  }

  // The dash: a Channel copy authored in the world editor, so it has no entry
  // in the generated constants and is referenced by rawcode. Keep in step with
  // DASH_ABILITY_ID in constants.ts.
  const DASH_ABILITY = 'A000';
  // Keep in step with DANCE_ABILITY_IDS in constants.ts.
  const DANCE_IDS = ['A001', 'A002', 'A003', 'A004', 'A005', 'A006', 'A007', 'A008'];

  const trackTypes: { [key: string]: string } = {
    EN: constants.units.ArcaneTower,
    ES: constants.units.CannonTower,
    EW: constants.units.GuardTower,
    NS: constants.units.ScoutTower,
    NW: constants.units.WatchTower,
    Omni: constants.units.Farm,
    SW: constants.units.BoulderTower,
  };

  for (const [orientation, unitName] of Object.entries(trackTypes)) {
    const track = objectData.units.get(unitName)!;
    track.buildTime = 0;
    track.defenseBase = 1;
    track.defenseType = 'none';
    track.description = 'A section of railway track.';
    track.hitPointsMaximumBase = 5;
    track.name = 'Railway Track';
    track.modelFile = `war3mapImported\\${orientation}Track.mdx`;
    track.scalingValueundefined = 1;
    track.shadowTextureBuilding = 'NONE';
    track.groundTexture = 'NONE';
    track.sightRadiusDay = 400;
    track.sightRadiusNight = 400;
    track.pathingMap = `PathTextures\\${
      orientation == 'Omni' ? '4x4simplesolid' : '4x4unbuildable'
    }.tga`;
  }

  const train = objectData.units.get(constants.units.WarWagon)!;
  train.name = "Train";
  train.tooltipBasic = "Train";
  train.collisionSize = 16;
  train.modelFile = 'war3mapImported\\WarWagon.mdx';
  train.normal = constants.abilities.InventoryHero;
  train.scalingValueundefined = 0.6;
  train.selectionScale = 1;
  train.sightRadiusDay = 400;
  train.sightRadiusNight = 400;
  train.speedMaximum = 522;
  train.speedMinimum = 1;
  train.hitPointsMaximumBase = 100;
  train.hitPointsRegenerationRate = -1;
  train.hitPointsRegenerationType = 'always';
  train.manaMaximum = 100;
  train.manaInitialAmount = 0;
  train.manaRegeneration = 0;
  // Not Mechanical: the engine auto-attaches tiered damage fire (and its
  // sound) to damaged mechanical units at the model's sprite refs. Clearing
  // the classification suppresses it; the 1HP burning state adds its own
  // fire explicitly (train.ts igniteBurnVisuals).
  train.unitClassification = '';

  // Track wagon: blood elf wagon unit trailing the engine, holds produced tracks.
  // TrackWagon.mdx is the stock SD BloodElfWagon model copied into the map so
  // its baked-in levitation glow can be edited out (the glow geosets use
  // ShockwaveWater1/Yellow_Glow3/Star8c textures).
  const trackWagon = objectData.units.get(constants.units.Wagon)!;
  trackWagon.name = 'Track Wagon';
  trackWagon.tooltipBasic = 'Track Wagon';
  trackWagon.collisionSize = 16;
  trackWagon.modelFile = 'war3mapImported\\TrackWagon.mdx';
  trackWagon.normal = constants.abilities.InventoryHero;
  trackWagon.scalingValueundefined = 0.6;
  // Negative selection scale hides the health bar (invulnerability doesn't);
  // the unit stays selectable and give/take targetable
  trackWagon.selectionScale = -1;
  trackWagon.shadowImageHeight = 100;
  trackWagon.shadowImageWidth = 100;
  trackWagon.shadowImageCenterX = 50;
  trackWagon.shadowImageCenterY = 50;
  trackWagon.sightRadiusDay = 400;
  trackWagon.sightRadiusNight = 400;
  trackWagon.speedMaximum = 522;
  trackWagon.speedMinimum = 1;
  // Match the engine's turn rate (its hbew default is 0.6) so both cars lose
  // the same speed rounding corners and the coupling gap stays constant
  trackWagon.turnRate = 0.4;

  const peasant = objectData.units.get(constants.units.Peasant)!;
  // WeaponlessPeasant.mdx carries a transplanted 'Roll' sequence at index 22
  // (from Villager 255 by Graber — see scripts/transplant-roll-anim.js)
  peasant.modelFile = 'war3mapImported\\WeaponlessPeasant.mdx';
  // 32 so a unit standing in a 1-tile (128 = 4 pathing cells) corridor blocks
  // it: movers with collision 32-47 need 3 free cells. 48+ would need all 4
  // and couldn't path empty tile corridors at all.
  peasant.collisionSize = 32;
  peasant.structuresBuilt = '';
  peasant.normal = [constants.abilities.InventoryHero, constants.abilities.Channel, constants.abilities.InvulnerableNeutral, DASH_ABILITY].join(',');
  // Normalize damage to exactly 5 so trees/rocks always take exactly 3 hits
  peasant.attack1CooldownTime = 1;
  peasant.attack1DamageBase = 4; // base + 1 = 5 (WC3 adds 1 to base)
  peasant.attack1DamageNumberOfDice = 1;
  peasant.attack1DamageSidesPerDie = 1;
  // The cast point/backswing keep a spell order "in progress" for ~0.3s after an
  // instant cast, which delays whatever the player queued behind it. Dash needs
  // the queue to advance immediately, so both are zeroed.
  // SetUnitMoveSpeed is clamped to the unit's own maximum, which defaults to
  // 400 — the dash was only reaching 2.1x base, which barely reads on screen.
  // 522 is WC3's gameplay-constant ceiling.
  peasant.speedMaximum = 522;
  // The engine clamps SetUnitMoveSpeed to this, and the stock minimum is 150 --
  // so asking for 0 left the start-lobby dancers walking around at 150
  // (measured in game). 1 is the same trick the train already uses.
  peasant.speedMinimum = 1;
  peasant.animationCastPoint = 0;
  peasant.animationCastBackswing = 0;

  type ChannelAbility = NonNullable<ReturnType<typeof objectData.abilities.get>> & { targetType: number; options: number; followThroughTime: number; artDuration: number; baseOrderIDundefined: string };

  // Dash spell: A000, a Channel copy authored in the world editor.
  //
  // It has to be a SECOND Channel rather than the stock one, because stock
  // Channel (ANcl) is already the give/take spell.
  //
  // Channel over Flare: the ability is only ever a way to turn a click into a
  // walk -- nothing happens when it goes off -- so the only thing that matters
  // is how fast it completes once the peasant arrives, which is when the queue
  // moves on. Flare has a hard 0.80s between cast and effect that no exposed
  // field trims (measured in game with castingTime, cast point, cast backswing
  // and every duration already reading 0). Channel's followThroughTime and
  // artDuration are real fields and are set to 0 below, so it resolves at once.
  //
  // Its base order is 'flare' (set in the editor), which is why the trigger
  // code still watches that order id.
  const dash = objectData.abilities.get(DASH_ABILITY)! as ChannelAbility;
  dash.heroAbility = false;
  dash.levels = 1;
  dash.targetType = 2; // point target
  dash.options = 1; // visible on the command card
  // NOT 0. Channel reads a follow-through of 0 as "channel until something
  // interrupts you", so the spell never ends, the order never completes, and
  // everything queued behind the dash waits forever (seen in game: the effect
  // fired but FINISH and ENDCAST never did). The smallest non-zero value ends
  // it on the next frame, which is what "instant" has to mean here.
  dash.followThroughTime = 0.01;
  dash.artDuration = 0;
  // A DELIBERATELY TINY cast range is what turns the cast into a walk. Order a
  // spell at a point outside its range and WC3 walks the caster there itself --
  // an engine approach move, which respects the order queue perfectly and
  // finishes the way any move finishes. That is strictly better than appending
  // our own move behind the cast, which the engine would sometimes never
  // complete, blocking everything queued behind it.
  //
  // Not 0: the caster has to actually get within range for the spell to fire,
  // and a point it cannot stand exactly on (rock edge, unit in the way) would
  // leave it approaching forever. Half a tile of slack is invisible in play.
  dash.castRange = 64;
  dash.castingTime = 0;
  // Deliberately 0: the dash has no in-game cooldown at all. The engine starts
  // an ability's cooldown when the spell FIRES, and this spell fires when the
  // peasant ARRIVES, so any value here would put a command-card cooldown on
  // screen at the end of the dash rather than the start -- and a long dash
  // would run its whole boost before one began. dash.ts limits the thing that
  // actually matters, the speed boost, with a timer of its own; the ability
  // itself stays castable. See DASH_COOLDOWN in dash.ts.
  dash.cooldown = 0;
  // No cast animation: the spell animation is part of what the unit sits
  // through before the queue advances.
  dash.animationNames = '';
  dash.tooltipNormal = 'Dash';
  dash.tooltipNormalExtended = 'Dash toward the target point, moving at speed briefly.';
  dash.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNEvasion.blp';
  dash.hotkeyNormal = 'E';
  // Row 0 of the command card is the stock Move/Stop/Hold/Attack row; an
  // ability placed there is hidden behind them.
  dash.buttonPositionNormalX = 2;
  dash.buttonPositionNormalY = 1;
  dash.caster = '';
  dash.target = '';
  dash.effect = '';

  // Dance spells: copies of Channel minted here rather than authored in the
  // editor, since abilities.copy() can mint them at build time.
  //
  // They exist for the players who are NOT the host: while player 1 picks what
  // to do in the start lobby, the others are parked as immobile peasants
  // with these on their command card, so there is something to do.
  //
  // Each needs its OWN base order. Two abilities sharing one order id on the
  // same unit collide on the command card, and the order is also how a cast is
  // told apart before the spell event resolves.
  // Base orders are only identifiers here -- the dances are MINTED abilities,
  // so no hero or mercenary spell is repurposed or altered. They are still
  // chosen off units that cannot appear in this map, so an order string can
  // never collide with something a hero, merc or creep casts.
  const DANCE_ORDERS = [
    'robogoblin', 'battlestations', 'burrow', 'unburrow',
    'corporealform', 'etherealform', 'sacrifice', 'ambush',
  ];
  const DANCE_HOTKEYS = ['Q', 'W', 'E', 'R', 'U', 'I', 'O', 'P'];
  for (let i = 0; i < DANCE_IDS.length; i++) {
    const dance = objectData.abilities.copy(constants.abilities.Channel, DANCE_IDS[i]) as ChannelAbility | undefined;
    if (dance == null) continue;
    dance.heroAbility = false;
    dance.levels = 1;
    dance.targetType = 0; // instant, no target to pick
    dance.options = 1; // visible on the command card
    dance.followThroughTime = 0.01; // 0 means "channel forever" -- see the dash
    dance.artDuration = 0;
    dance.castingTime = 0;
    dance.cooldown = 0;
    dance.animationNames = '';
    dance.baseOrderIDundefined = DANCE_ORDERS[i];
    dance.tooltipNormal = 'Dance (' + DANCE_HOTKEYS[i] + ')';
    dance.tooltipNormalExtended = 'Bust a move.';
    dance.iconNormal = 'ReplaceableTextures\CommandButtons\BTNBrilliance.blp';
    dance.hotkeyNormal = DANCE_HOTKEYS[i];
    // Two rows of four: QWER above UIOP, mirroring the keyboard.
    dance.buttonPositionNormalX = i % 4;
    dance.buttonPositionNormalY = i < 4 ? 1 : 2;
    dance.caster = '';
    dance.target = '';
    dance.effect = '';
  }

  // Build track spell (BuildTinyFarm — repurposed for one-click track placement)
  const buildTrack = objectData.abilities.get(constants.abilities.BuildTinyFarm)!;
  buildTrack.tooltipNormal = 'Build track piece';
  buildTrack.tooltipNormalExtended = 'Consume a track piece item and build new rail for your train to follow.';
  buildTrack.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
  buildTrack.hotkeyNormal = 'D';

  // Give/Take spell (Channel — unit or point target)
  const giveTake = objectData.abilities.get(constants.abilities.Channel)! as ChannelAbility;
  giveTake.heroAbility = false;
  giveTake.levels = 1;
  giveTake.targetType = 3;
  giveTake.options = 1;
  giveTake.targetsAllowed = 'alive,allies,friend,ground,hero,invulnerable,item,mechanical,neutral,nonhero,notself,organic,player,structure,vulnerable';
  giveTake.castRange = 80;
  giveTake.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNLoad.blp';
  giveTake.caster = '';
  giveTake.target = '';
  giveTake.effect = '';
  giveTake.tooltipNormal = 'Give/Take Item';
  giveTake.tooltipNormalExtended = 'When holding an item, can be used to drop it on the ground or give it to a building/unit. When not holding an item, can be used to pick up an item on the ground or pull from a building. When pulling items from buildings, tracks will be pulled first, then wood, then stone.';
  giveTake.hotkeyNormal = 'W';

  // Monkey-patch save to fix per-level ability fields (library bug: doesn't set
  // levelOrVariation/dataPointer for ability-specific fields like Ncl1-Ncl6)
  const perLevelFields = new Set([
    'atar', 'acas', 'adur', 'ahdu', 'acdn', 'amcs', 'aare', 'aran',
    'abuf', 'aeff', 'atp1', 'aub1', 'aut1', 'auu1',
  ]);
  // Per-level data fields without a digit suffix: field id -> data column
  const dataFieldPointers: { [id: string]: number } = {
    Iatt: 1, // Item Damage Bonus "attack bonus" (DataA)
  };
  function fixAbilityLevels(w3a: any) {
    for (const table of [w3a.originalTable, w3a.customTable]) {
      for (const obj of table.objects) {
        for (const mod of obj.modifications) {
          if (mod.levelOrVariation !== 0) continue;
          if (perLevelFields.has(mod.id)) {
            mod.levelOrVariation = 1;
          } else if (dataFieldPointers[mod.id] != null) {
            mod.levelOrVariation = 1;
            mod.dataPointer = dataFieldPointers[mod.id];
          } else {
            // Ability-specific fields (e.g. Ncl1-6): digit suffix is the dataPointer
            // Exclude attachment point fields like ata0-ata5 which use digits but aren't per-level
            const match = mod.id.match(/^[A-Za-z]{3}(\d)$/);
            if (match && !mod.id.startsWith('ata')) {
              mod.levelOrVariation = 1;
              mod.dataPointer = parseInt(match[1]);
            }
          }
        }
      }
    }
  }
  // Channel fields whose real WC3 default differs from the library's stored default
  // (library thinks 0 is default, so it won't write them — we must inject manually)
  const Modification = require('mdx-m3-viewer-th/dist/cjs/parsers/w3x/w3u/modification').default;
  const ModifiedObject = require('mdx-m3-viewer-th/dist/cjs/parsers/w3x/w3u/modifiedobject').default;
  // Forced mods: fields whose real WC3 default differs from what the library stores
  const forcedMods: { [rawcode: string]: { id: string; variableType: number; dataPointer: number; value: number }[] } = {
    ANcl: [ // Channel
      { id: 'Ncl1', variableType: 2, dataPointer: 1, value: 0 }, // followThroughTime
      { id: 'Ncl4', variableType: 2, dataPointer: 4, value: 0 }, // artDuration
      { id: 'Ncl5', variableType: 0, dataPointer: 5, value: 0 }, // disableOtherAbilities
    ],
    Afod: [ // FingerOfDeath neutral hostile (bridge spell)
      { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 }, // manaCost
      { id: 'acdn', variableType: 2, dataPointer: 0, value: 0 }, // cooldown
      { id: 'adur', variableType: 2, dataPointer: 0, value: 0 }, // duration
      { id: 'ahdu', variableType: 2, dataPointer: 0, value: 0 }, // heroDuration
      { id: 'aare', variableType: 2, dataPointer: 0, value: 0 }, // areaOfEffect
    ],
    Acdh: [ // DrunkenHaze Chen (water train spell)
      { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 }, // manaCost
      { id: 'acdn', variableType: 2, dataPointer: 0, value: 0 }, // cooldown
      { id: 'adur', variableType: 2, dataPointer: 0, value: 0 }, // duration
      { id: 'ahdu', variableType: 2, dataPointer: 0, value: 0 }, // heroDuration
      { id: 'aare', variableType: 2, dataPointer: 0, value: 0 }, // areaOfEffect
    ],
    Aroa: [ // Roar (summon heroes spell)
      { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 }, // manaCost
      { id: 'acdn', variableType: 2, dataPointer: 0, value: 0 }, // cooldown
      { id: 'adur', variableType: 2, dataPointer: 0, value: 0 }, // duration
      { id: 'ahdu', variableType: 2, dataPointer: 0, value: 0 }, // heroDuration
      { id: 'aare', variableType: 2, dataPointer: 0, value: 0 }, // areaOfEffect
    ],
    ACro: [ // RoarNeutralHostile (unsummon heroes spell)
      { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 }, // manaCost
      { id: 'acdn', variableType: 2, dataPointer: 0, value: 0 }, // cooldown
      { id: 'adur', variableType: 2, dataPointer: 0, value: 0 }, // duration
      { id: 'ahdu', variableType: 2, dataPointer: 0, value: 0 }, // heroDuration
      { id: 'aare', variableType: 2, dataPointer: 0, value: 0 }, // areaOfEffect
    ],
    ACss: [ // ShadowStrike neutral hostile (fill bucket spell)
      { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 }, // manaCost
      { id: 'acdn', variableType: 2, dataPointer: 0, value: 0 }, // cooldown
      { id: 'adur', variableType: 2, dataPointer: 0, value: 0 }, // duration
      { id: 'ahdu', variableType: 2, dataPointer: 0, value: 0 }, // heroDuration
      { id: 'aare', variableType: 2, dataPointer: 0, value: 0 }, // areaOfEffect
    ],
    // NOTE: there was an Aihn (UnitInventoryHuman) block here configuring
    // "mercenary inventory, no drop on death". It was dead: no unit anywhere
    // carries Aihn. The mercenary is given AInv (InventoryHero) instead -- see
    // the mercCreepTypes loop below and MERC_INVENTORY_ABILITY_ID in
    // mercenary.ts -- so none of that config ever reached the game.
    //
    // Consequence, which is why this note is here rather than a silent
    // deletion: the merc carries STOCK AInv, and stock hero inventory DOES drop
    // its items on death. Nothing in object data prevents it. The only thing
    // stopping a dead merc's items hitting the ground is the strip in
    // mercenary.ts's death trigger, so that code is load-bearing, not a
    // belt-and-braces backstop.
  };
  const originalSave = objectData.save.bind(objectData);
  objectData.save = () => {
    const result = originalSave();
    if (result.w3a) {
      fixAbilityLevels(result.w3a);
      const seen = new Set<string>();
      for (const obj of result.w3a.originalTable.objects) {
        const mods = forcedMods[obj.oldId];
        if (mods != null) {
          seen.add(obj.oldId);
          for (const forced of mods) {
            if (!obj.modifications.some((m: any) => m.id === forced.id)) {
              const mod = new Modification();
              Object.assign(mod, forced, { levelOrVariation: 1, u1: 0 });
              obj.modifications.push(mod);
            }
          }
        }
      }
      // Create w3a entries for abilities that only ended up in w3aSkin
      for (const [rawcode, mods] of Object.entries(forcedMods)) {
        if (seen.has(rawcode)) continue;
        const obj = new ModifiedObject();
        obj.oldId = rawcode;
        for (const forced of mods) {
          const mod = new Modification();
          Object.assign(mod, forced, { levelOrVariation: 1, u1: 0 });
          obj.modifications.push(mod);
        }
        result.w3a.originalTable.objects.push(obj);
      }
    }
    if (result.w3aSkin) fixAbilityLevels(result.w3aSkin);
    // Upgrade Name (gnam) is a per-level string and the library emits it at
    // level 0, which the engine ignores -- the same rule fixAbilityLevels
    // applies to abilities. Without this bump the name silently does not apply
    // (A/B tested in-game: level 0 still showed the stock "Magic Sentry").
    for (const table of [result.w3q, result.w3qSkin]) {
      if (table == null) continue;
      for (const sub of [table.originalTable, table.customTable]) {
        if (sub == null) continue;
        for (const obj of sub.objects) {
          for (const mod of obj.modifications) {
            if (mod.id === 'gnam' && mod.levelOrVariation === 0) mod.levelOrVariation = 1;
          }
        }
      }
    }
    // war3-transformer writes only w3u/w3t/w3b/w3d/w3a (+Skin) -- it emits NO
    // upgrade file at all, so every objectData.upgrades edit was silently
    // discarded and the summon gate kept showing its stock name "Magic Sentry".
    // Write the upgrade table ourselves into the dist folder build.ts packages.
    // It must land in war3map.w3q: the engine reads an ability's
    // "Requires <name>" text from there, NOT from war3mapSkin.w3q (verified
    // in-game -- the skin file alone leaves the stock name showing).
    const fsMod = require('fs');
    const cfg = JSON.parse(fsMod.readFileSync('config.json', 'utf8'));
    const outDir = './dist/' + cfg.mapFolder;
    if (fsMod.existsSync(outDir)) {
      const upgrades = result.w3q != null ? result.w3q : result.w3qSkin;
      if (upgrades != null) {
        const bytes = upgrades.save();
        fsMod.writeFileSync(outDir + '/war3map.w3q', bytes);
        fsMod.writeFileSync(outDir + '/war3mapSkin.w3q', bytes);
      }
    }
    // GUARD: every item the map customises must be one creeps never drop.
    //
    // The map identifies its items by rawcode alone -- shop.ts reads "a unit
    // picked up this rawcode" as a purchase wherever it happened, and items.ts
    // reads another as the peasant's axe -- so a customised rawcode that is
    // also in WC3's random drop pool means a creep corpse hands out a free
    // upgrade or a free tool. Measured before the rawcodes were moved: 90 of
    // 1080 rolls came back as one of the map's own items.
    //
    // Customising an item is exactly what puts it in this table, so there is no
    // list to keep in sync: base a new custom item on a droppable rawcode and
    // the BUILD fails here, naming the offender. Miscellaneous, Campaign and
    // Purchasable items ship with the flag false and are safe; Permanent and
    // PowerUp ones generally are not. Re-base the item rather than editing the
    // drop tables -- the loot ecology is not ours to change.
    for (const tag of ['w3t', 'w3tSkin']) {
      const itemTable = (result as any)[tag];
      if (itemTable == null) continue;
      for (const sub of [itemTable.originalTable, itemTable.customTable]) {
        if (sub == null) continue;
        for (const obj of sub.objects) {
          const base = objectData.items.get(obj.oldId);
          if (base != null && base.includeAsRandomChoice) {
            throw new Error(
              'Custom item "' + base.name + '" (' + obj.oldId + ') is in the random drop pool, ' +
              'so a creep could drop it. The map matches items by rawcode, so that would be a ' +
              'free upgrade or tool off a corpse. Re-base it on an item creeps never drop ' +
              '(Miscellaneous, Campaign or Purchasable).');
          }
        }
      }
    }
    return result;
  };

  // Attachment abilities below repurpose stock Item Damage Bonus abilities
  // purely for their model-attachment art; attackBonus is zeroed so carrying a
  // tool never changes the peasant's combat stats. Only abilities whose bonus
  // field is actually settable in war3-objectdata-th are used (AItx/AId7/AId8
  // expose no data field and crash the transformer on assignment), and none
  // are referenced by items in the creep-camp random drop pools.
  type StatBonusAbility = NonNullable<ReturnType<typeof objectData.abilities.get>> & { attackBonus: number };

  // war3-objectdata-th's bundled dataset wrongly lists attackBonus = 0 as the
  // default for these abilities (the real in-game bonuses are +2..+10), and
  // the saver only emits modifications that differ from the dataset default —
  // so a plain `attackBonus = 0` never reaches war3map.w3a and the in-game
  // bonus stays live. The dataset objects are frozen; swap in unfrozen copies
  // with a sentinel default so the 0 actually serializes as an Iatt mod.
  const attachmentAbilityIds = [
    constants.abilities.ItemDamageBonusPlus7,
    constants.abilities.ItemDamageBonusPlus8,
    constants.abilities.ItemDamageBonusPlus10,
    constants.abilities.ItemDamageBonusPlus2,
    constants.abilities.ItemDamageBonusPlus4,
    constants.abilities.ItemDamageBonusPlus6,
  ];
  // NOTE: no object spread here — the transformer transpiles this block with
  // ts.transpile() and evals it wrapped in parens; spread emits a `var __assign`
  // helper above the function expression, which is a SyntaxError in that eval.
  const abilityGameData = objectData.abilities as unknown as { game: Record<string, object> };
  const pokedGame: Record<string, object> = Object.assign({}, abilityGameData.game);
  for (const abilityId of attachmentAbilityIds) {
    pokedGame[abilityId] = Object.assign({}, abilityGameData.game[abilityId], { attackBonus: 1 });
  }
  abilityGameData.game = pokedGame;

  // Axe attachment ability (passive, shows axe model on caster's left hand)
  const axeAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus7)! as StatBonusAbility;
  axeAttach.target = 'war3mapImported\\Axe.mdx';
  axeAttach.targetAttachments = 1;
  axeAttach.targetAttachmentPoint1 = 'left,hand';
  axeAttach.attackBonus = 0;

  // Pickaxe attachment ability (passive, shows pickaxe model on caster's left hand)
  // (Pickaxe.mdx's handle texture was swapped from a singleplayer glue-screen
  // asset to AshenTree.blp — the glue texture was suspected in a multiplayer
  // framerate bug)
  const pickAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus8)! as StatBonusAbility;
  pickAttach.target = 'war3mapImported\\Pickaxe.mdx';
  pickAttach.targetAttachments = 1;
  pickAttach.targetAttachmentPoint1 = 'left,hand';
  pickAttach.attackBonus = 0;

  // Track piece attachment ability (passive, shows track model in left hand)
  const trackAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus10)! as StatBonusAbility;
  trackAttach.target = 'war3mapImported\\OmniTrackSmall.mdx';
  trackAttach.targetAttachments = 1;
  trackAttach.targetAttachmentPoint1 = 'left,hand';
  trackAttach.attackBonus = 0;

  // Empty bucket attachment ability
  const bucketAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus2)! as StatBonusAbility;
  bucketAttach.target = 'war3mapImported\\Bucket.mdx';
  bucketAttach.targetAttachments = 1;
  bucketAttach.targetAttachmentPoint1 = 'left,hand';
  bucketAttach.attackBonus = 0;

  // Full bucket attachment ability
  const bucketFullAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus4)! as StatBonusAbility;
  bucketFullAttach.target = 'war3mapImported\\BucketFull.mdx';
  bucketFullAttach.targetAttachments = 1;
  bucketFullAttach.targetAttachmentPoint1 = 'left,hand';
  bucketFullAttach.attackBonus = 0;

  // Ready orb attachment ability (passive, shows orb model on caster's head)
  const readyOrbAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus6)! as StatBonusAbility;
  readyOrbAttach.target = 'war3mapImported\\ReadyOrb.mdx';
  readyOrbAttach.targetAttachments = 1;
  readyOrbAttach.targetAttachmentPoint1 = 'head';
  readyOrbAttach.attackBonus = 0;


  // Axe item
  const axe = objectData.items.get(constants.items.SturdyWarAxe)!;
  axe.name = 'Axe';
  axe.description = 'Allows chopping trees which can be given to the train and converted to tracks, or used to build bridges across water.';
  axe.tooltipExtended = axe.description;
  axe.goldCost = 0;
  axe.canBeDropped = true;
  axe.droppedWhenCarrierDies = true;
  axe.perishable = false;
  axe.canBeSoldToMerchants = false;
  axe.abilities = '';
  axe.modelUsed = 'war3mapImported\\AxeGround.mdx';

  // Pickaxe item
  const pickaxe = objectData.items.get(constants.items.RustyMiningPick)!;
  pickaxe.name = 'Pickaxe';
  pickaxe.description = 'Allows mining rocks which can be given to the train and converted to tracks.';
  pickaxe.tooltipExtended = pickaxe.description;
  pickaxe.goldCost = 0;
  pickaxe.canBeDropped = true;
  pickaxe.droppedWhenCarrierDies = true;
  pickaxe.perishable = false;
  pickaxe.canBeSoldToMerchants = false;
  pickaxe.abilities = '';
  pickaxe.modelUsed = 'war3mapImported\\PickaxeGround.mdx';

  // Empty bucket item
  const bucket = objectData.items.get(constants.items.EmptyVial)!;
  bucket.name = 'Empty Bucket';
  bucket.description = 'Can be filled with water and used on the train to restore HP.';
  bucket.tooltipExtended = bucket.description;
  bucket.goldCost = 0;
  bucket.canBeDropped = true;
  bucket.droppedWhenCarrierDies = true;
  bucket.perishable = false;
  bucket.canBeSoldToMerchants = false;
  bucket.abilities = '';
  bucket.modelUsed = 'war3mapImported\\Bucket.mdx';

  // Bucket full item
  const bucketFull = objectData.items.get(constants.items.FullVial)!;
  bucketFull.name = 'Full Bucket';
  bucketFull.description = 'Can be used on the train to restore HP.';
  bucketFull.tooltipExtended = bucketFull.description;
  bucketFull.goldCost = 0;
  bucketFull.canBeDropped = true;
  bucketFull.droppedWhenCarrierDies = true;
  bucketFull.perishable = false;
  bucketFull.canBeSoldToMerchants = false;
  bucketFull.abilities = '';
  bucketFull.modelUsed = 'war3mapImported\\BucketFull.mdx';

  // Wood resource item (IronwoodBranch — normal holdable item)
  const wood = objectData.items.get(constants.items.IronwoodBranch)!;
  wood.name = 'Wood';
  wood.description = 'Can be given to the train and converted to tracks, or used to build bridges across water.';
  wood.tooltipExtended = wood.description;
  wood.classification = 'Charged';
  wood.goldCost = 0;
  wood.canBeDropped = true;
  wood.droppedWhenCarrierDies = true;
  wood.perishable = false;
  wood.useAutomaticallyWhenAcquired = false;
  wood.canBeSoldToMerchants = false;
  wood.abilities = '';
  wood.numberOfCharges = 1;
  wood.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNBundleOfLumber.blp';
  wood.modelUsed = 'Doodads\\Felwood\\Props\\FelwoodLogStraight\\FelwoodLogStraight.mdx';
  wood.scalingValue = 0.4;

  // Stone resource item (GemFragment — normal holdable item)
  const stone = objectData.items.get(constants.items.GemFragment)!;
  stone.name = 'Stone';
  stone.description = 'Can be given to the train and converted to tracks.';
  stone.tooltipExtended = stone.description;
  stone.classification = 'Charged';
  stone.goldCost = 0;
  stone.canBeDropped = true;
  stone.droppedWhenCarrierDies = true;
  stone.perishable = false;
  stone.useAutomaticallyWhenAcquired = false;
  stone.canBeSoldToMerchants = false;
  stone.abilities = '';
  stone.numberOfCharges = 1;
  stone.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNGolemStormBolt.blp';
  stone.modelUsed = 'Doodads\\LordaeronSummer\\Rocks\\Lords_Rock\\Lords_Rock6.mdx';
  stone.scalingValue = 0.4;

  // Tree destructables (SummerTreeWall / LTlt)
  const tree = objectData.destructables.get(constants.destructables.SummerTreeWall)!;
  tree.hitPoints = 15;
  tree.selectableInGame = false;
  tree.occlusionHeight = 0;
  tree.targetedAs = 'debris';

  // Rock destructables (RockChunks2 / LTrt — 6 variations, same model as granite)
  const rock = objectData.destructables.get(constants.destructables.RockChunks2)!;
  rock.hitPoints = 15;
  rock.selectableInGame = false;
  rock.occlusionHeight = 0;

  // Creep camp destructable (Cage / LOcg)
  const creepCamp = objectData.destructables.get(constants.destructables.Cage)!;
  creepCamp.hitPoints = 5;
  creepCamp.selectableInGame = false;
  creepCamp.occlusionHeight = 0;

  // Granite rocks: dark tint, unselectable, indestructible
  const granite = objectData.destructables.get(constants.destructables.RockChunks1)!;
  granite.hitPoints = 999999;
  granite.occlusionHeight = 0;
  granite.selectableInGame = false;
  granite.tintingColor1Red = 40;
  granite.tintingColor2Green = 40;
  granite.tintingColor3Blue = 40;

  // Water: Burrow repurposed with WaterPlane model, targetable by spells, no shadow
  const water = objectData.units.get(constants.units.Burrow)!;
  water.collisionSize = 32;
  water.groundTexture = 'NONE';
  water.hideMinimapDisplay = true;
  water.modelFile = 'war3mapImported\\WaterPlane.mdx';
  water.name = 'Water';
  water.occluderHeight = 0;
  water.pathingMap = 'PathTextures\\4x4simplesolid.tga';
  water.scalingValueundefined = 1;
  water.shadowTextureBuilding = 'NONE';
  water.sightRadiusDay = 320;
  water.sightRadiusNight = 320;

  // Storage crate: GrainWarehouse shrunk to 4x4 with crate model and inventory
  const crate = objectData.units.get(constants.units.GrainWarehouse)!;
  crate.name = 'Storage Crate';
  crate.modelFile = 'Buildings\\Other\\CratesUnit\\CratesUnit';
  crate.pathingMap = 'PathTextures\\4x4simplesolid.tga';
  crate.collisionSize = 32;
  crate.selectionScale = 2;
  crate.scalingValueundefined = 1;
  crate.shadowTextureBuilding = 'ShadowCrates';
  crate.normal = [constants.abilities.InventoryHero, constants.abilities.InvulnerableNeutral].join(',');

  // Track piece item (MechanicalCritter — placeholder for track building)
  const trackPiece = objectData.items.get(constants.items.MechanicalCritter)!;
  trackPiece.name = 'Track Piece';
  trackPiece.description = 'A section of railway track which can be placed adjacent to the previous track piece';
  trackPiece.tooltipExtended = trackPiece.description;
  trackPiece.classification = 'Charged';
  trackPiece.goldCost = 0;
  trackPiece.canBeDropped = true;
  trackPiece.droppedWhenCarrierDies = true;
  trackPiece.perishable = false;
  trackPiece.useAutomaticallyWhenAcquired = false;
  trackPiece.canBeSoldToMerchants = false;
  trackPiece.abilities = '';
  trackPiece.numberOfCharges = 1;
  trackPiece.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
  trackPiece.modelUsed = 'war3mapImported\\OmniTrack.mdx';
  trackPiece.scalingValue = 0.5;

  // Bridge spell: FingerOfDeath (neutral hostile) repurposed as a no-mana, unit+building-targeting spell
  const bridge = objectData.abilities.get(constants.abilities.FingerOfDeathNeutralHostile)!;
  bridge.heroAbility = false;
  bridge.levels = 1;
  bridge.castRange = 80;
  bridge.targetsAllowed = 'alive,allies,friend,ground,hero,invulnerable,mechanical,neutral,nonhero,notself,organic,player,structure,vulnerable';
  bridge.tooltipNormal = 'Build Bridge';
  bridge.tooltipNormalExtended = 'Consumes one wood to convert a water block into a tile you can walk and build on';
  bridge.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
  bridge.hotkeyNormal = 'D';

  // Water train spell: DrunkenHaze (Chen) repurposed as a no-mana, train-targeting spell
  const waterTrain = objectData.abilities.get(constants.abilities.DrunkenHazeChen)!;
  waterTrain.heroAbility = false;
  waterTrain.levels = 1;
  waterTrain.castRange = 80;
  waterTrain.targetsAllowed = 'alive,allies,friend,ground,hero,invulnerable,mechanical,neutral,nonhero,notself,organic,player,structure,vulnerable';
  waterTrain.tooltipNormal = 'Water Train';
  waterTrain.tooltipNormalExtended = 'Pours water on the train to restore it to full HP.';
  waterTrain.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
  waterTrain.hotkeyNormal = 'D';

  // Fill bucket spell: ShadowStrike (neutral hostile) repurposed as a no-mana, water-targeting spell
  const fillBucket = objectData.abilities.get(constants.abilities.UndefinedNeutralHostile)!;
  fillBucket.heroAbility = false;
  fillBucket.levels = 1;
  fillBucket.castRange = 80;
  fillBucket.targetsAllowed = 'alive,allies,friend,ground,hero,invulnerable,mechanical,neutral,nonhero,notself,organic,player,structure,vulnerable';
  fillBucket.tooltipNormal = 'Fill Bucket';
  fillBucket.tooltipNormalExtended = 'Fills a bucket with water from a water block.';
  fillBucket.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
  fillBucket.hotkeyNormal = 'D';

  // Summon Heroes tech: MagicSentry upgrade repurposed as the requirement
  // gating the summon ability. Granted via SetPlayerTechResearched when the
  // upgrade is bought from the inter-round lobby shop (see summonUpgrade.ts).
  const summonTech = objectData.upgrades.get(constants.upgrades.MagicSentry)!;
  // Name shows up in the ability's greyed-out "Requires <name>" text.
  summonTech.name = 'Shop Upgrade';
  summonTech.levels = 1;
  summonTech.tooltip = 'Shop Upgrade';
  summonTech.tooltipExtended = 'Unlocks the Summon Heroes ability.';

  // Summon Heroes spell: Roar repurposed as a no-target instant-cast ability
  const summonHeroes = objectData.abilities.get(constants.abilities.Roar)!;
  summonHeroes.heroAbility = false;
  summonHeroes.levels = 1;
  summonHeroes.tooltipNormal = 'Summon Heroes';
  summonHeroes.tooltipNormalExtended = 'Summon your heroes to fight alongside you.';
  // Left at the base ability's own icon: BTNSelectHeroOn.blp is not a real
  // file, so setting it here drew the Summon Heroes button as a '?' too.
  summonHeroes.hotkeyNormal = 'R';
  summonHeroes.buffs = '';
  summonHeroes.effect = '';
  // Grayed out until the Summon Heroes upgrade is bought from the inter-round lobby shop
  summonHeroes.requirements = constants.upgrades.MagicSentry;

  // Unsummon Heroes spell: RoarNeutralHostile repurposed as a no-target instant-cast ability
  const unsummonHeroes = objectData.abilities.get(constants.abilities.RoarNeutralHostile)!;
  unsummonHeroes.heroAbility = false;
  unsummonHeroes.levels = 1;
  unsummonHeroes.tooltipNormal = 'Unsummon Heroes';
  unsummonHeroes.tooltipNormalExtended = 'Dismiss your heroes and return peasant control to normal.';
  unsummonHeroes.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNSelectHeroOff.blp';
  unsummonHeroes.hotkeyNormal = 'R';
  unsummonHeroes.buffs = '';
  unsummonHeroes.effect = '';

  // NOTE on item rawcodes: everything the map repurposes must be an item creeps
  // never drop. Camps roll drops with ChooseRandomItemEx, whose pool is every
  // item flagged "Include As Random Choice" -- and the map matches its items by
  // rawcode alone, so a rolled one becomes a free shop upgrade or a free tool
  // off a corpse (measured: 90 of 1080 rolls, before these four moved).
  // Miscellaneous, Campaign and Purchasable items carry that flag false and are
  // safe; Permanent ones generally do not. Pick from the safe classes.
  //
  // Shop: based on the melee MARKETPLACE (nmrk), the one unit whose
  // dynamically added stock (AddItemToStock) natively displays — Blizzard's
  // own rotating-stock flow targets it. Stock is added at runtime in
  // stockShop (shop.ts) so availability can depend on game state; the
  // creep-drop rotation and purchase-removal machinery is disabled in
  // initShop, so only our items ever appear.
  const shop = objectData.units.get(constants.units.Marketplace)!;
  shop.name = 'Shop';
  shop.scalingValueundefined = 0.5;
  shop.selectionScale = 1;
  shop.groundTexture = ''; // Same texture as a human farm
  shop.pathingMap = 'PathTextures\\4x4simplesolid.tga';
  shop.collisionSize = 32;
  shop.itemsSold = '';
  shop.itemsMade = '';
  shop.sightRadiusDay = 400;
  shop.sightRadiusNight = 400;
  // Do NOT hand-write this unit's ability list. The Marketplace ships with
  // 'Aneu,Asid,Avul,Asud,Apit', and Aneu is "Select Hero" -- the ability that
  // gives the shop a unit to hand a purchase to. An earlier override dropped
  // Aneu (swapping in Aall, "Shop Sharing, Allied Bldg."), and without it every
  // purchase had no buyer and fell on the ground instead of entering an
  // inventory. Apit ("Shop Purchase Item", needed for the reroll pawn/refund
  // path in reroll.ts) is already one of those defaults, so leaving the list
  // alone gets it for free.

  // Hero Reroll cast — Wand of Negation repurposed as a unit-target spell.
  // Its native purge doesn't matter: reroll.ts replaces the target on cast.
  const rerollCast = objectData.abilities.get(constants.abilities.ItemIllusions)!;
  // A peasant (non-hero) carries and casts the reroll item, so the item's
  // ability must not be hero-only or the peasant can't activate it.
  rerollCast.heroAbility = false;
  rerollCast.tooltipNormal = 'Reroll';
  rerollCast.tooltipNormalExtended = 'Replace a hero or mercenary in the inter-round lobby with a random new one. XP and items carry over.';
  rerollCast.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNReincarnation.blp';
  // Must include the friendly/own-player flags: the target is one of YOUR OWN
  // inter-round lobby heroes, and without them the hero is not a legal target at all.
  // NONHERO matters as much as hero: the mercenary is a plain creep, and a
  // list with only 'hero' on it makes the merc an illegal target, so the
  // cursor refuses it however the code behind is wired.
  rerollCast.targetsAllowed = 'alive,allies,friend,hero,nonhero,invulnerable,neutral,player,vulnerable';
  rerollCast.castRange = 500;
  rerollCast.caster = '';
  rerollCast.target = '';
  rerollCast.effect = '';
  rerollCast.buffs = '';

  // Shady Dealer: Tomb of Relics reskinned as an acolyte, sells inter-round lobby challenges.
  // SelectHero(Aneu)/SellItems/ShopPurchaseItem make it usable while neutral.
  const shadyDealer = objectData.units.get(constants.units.TombOfRelics)!;
  shadyDealer.name = 'Shady Dealer';
  shadyDealer.modelFile = 'units\\undead\\Acolyte\\Acolyte';
  shadyDealer.normal = [
    constants.abilities.SelectHero,
    constants.abilities.SellItems,
    constants.abilities.ShopPurchaseItem,
    constants.abilities.InvulnerableNeutral,
  ].join(',');
  shadyDealer.scalingValueundefined = 1;
  shadyDealer.selectionScale = 1;
  shadyDealer.shadowTextureBuilding = 'NONE';
  shadyDealer.groundTexture = 'NONE';
  shadyDealer.pathingMap = 'PathTextures\\4x4simplesolid.tga';
  shadyDealer.collisionSize = 32;
  shadyDealer.sightRadiusDay = 400;
  shadyDealer.sightRadiusNight = 400;
  shadyDealer.itemsSold = constants.items.Shimmerweed;
  shadyDealer.itemsMade = '';

  // The Shady Deal (Shimmerweed — the Shady Dealer's one slot).
  //
  // Deliberately generic: WHICH challenge this sells is decided at runtime from
  // the seeded sequence in challenges.ts, and object-data text is fixed at
  // build time, so the specific challenge is announced on purchase instead.
  const critterpocalypse = objectData.items.get(constants.items.Shimmerweed)!;
  critterpocalypse.name = 'Shady Deal';
  critterpocalypse.tooltipBasic = critterpocalypse.name;
  critterpocalypse.description = "Take the dealer's challenge for this round. Complete it to earn 2 gold.";
  critterpocalypse.tooltipExtended = critterpocalypse.description;
  critterpocalypse.goldCost = 1;
  critterpocalypse.stockMaximum = 1;
  critterpocalypse.stockReplenishInterval = 3600;
  critterpocalypse.stockInitialAfterStartDelay = 10;
  critterpocalypse.useAutomaticallyWhenAcquired = true;
  critterpocalypse.activelyUsed = false;
  critterpocalypse.canBeDropped = false;
  critterpocalypse.perishable = true;
  critterpocalypse.abilities = '';
  critterpocalypse.classification = 'PowerUp';
  critterpocalypse.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNSheep.blp';

  // Retired: the Shady Dealer now has a single slot (see Shady Deal above) and
  // Tough Creep Camp is one of the challenges it can sell. Object data kept so
  // the item id still resolves.
  // Tough Creep Camp challenge (SkeletalArtifact)
  const toughCamp = objectData.items.get(constants.items.SkeletalArtifact)!;
  toughCamp.name = 'Tough Creep Camp';
  toughCamp.tooltipBasic = toughCamp.name;
  toughCamp.description = "Next round's creep camp hits far harder. Defeat it to earn 2 bonus gold.";
  toughCamp.tooltipExtended = toughCamp.description;
  toughCamp.goldCost = 1;
  toughCamp.stockMaximum = 1;
  toughCamp.stockReplenishInterval = 3600;
  toughCamp.stockInitialAfterStartDelay = 10;
  toughCamp.useAutomaticallyWhenAcquired = true;
  toughCamp.activelyUsed = false;
  toughCamp.canBeDropped = false;
  toughCamp.perishable = true;
  toughCamp.abilities = '';
  toughCamp.classification = 'PowerUp';
  toughCamp.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNGrunt.blp';

  // Restore Lost HP (HeartOfAszune — purchased from shop). Replaces Flame
  // Resistance on the shelf whenever the train is below its starting max HP.
  const restoreHp = objectData.items.get(constants.items.HeartOfAszune)!;
  restoreHp.name = 'Repair Train';
  restoreHp.tooltipBasic = restoreHp.name;
  restoreHp.description = 'Repairs the fire damage, restoring the train to 100 health. Health upgrades bought before the fire are not restored.';
  restoreHp.tooltipExtended = restoreHp.description;
  restoreHp.goldCost = 1;
  restoreHp.stockMaximum = 1;
  restoreHp.stockReplenishInterval = 3600;
  restoreHp.stockInitialAfterStartDelay = 10;
  restoreHp.useAutomaticallyWhenAcquired = true;
  restoreHp.activelyUsed = false;
  restoreHp.canBeDropped = false;
  restoreHp.perishable = true;
  restoreHp.abilities = '';
  restoreHp.classification = 'PowerUp';
  // Double backslashes matter here: with single ones the path collapses to
  // ReplaceableTexturesCommandButtons... because \C and \B are not escape
  // sequences, and the icon silently fails to load.
  restoreHp.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNHealingSalve.blp';

  // Flame Resistance upgrade (AncientFigurine — purchased from shop)
  const flameResistance = objectData.items.get(constants.items.AncientFigurine)!;
  flameResistance.name = 'Flame Resistance';
  flameResistance.tooltipBasic = flameResistance.name;
  flameResistance.description = 'Increases train health by 10, making it take longer to catch fire.';
  flameResistance.tooltipExtended = flameResistance.description;
  flameResistance.goldCost = 1;
  flameResistance.stockMaximum = 10;
  flameResistance.stockReplenishInterval = 3600;
  flameResistance.stockInitialAfterStartDelay = 10;
  flameResistance.useAutomaticallyWhenAcquired = true;
  flameResistance.activelyUsed = false;
  flameResistance.canBeDropped = false;
  flameResistance.perishable = true;
  flameResistance.abilities = '';
  flameResistance.classification = 'PowerUp';
  flameResistance.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNOrbOfFire.blp';

  // Track Manufacturing upgrade (BracerOfAgility — purchased from shop)
  const trackManufacturing = objectData.items.get(constants.items.BracerOfAgility)!;
  trackManufacturing.name = 'Track Manufacturing';
  trackManufacturing.tooltipBasic = trackManufacturing.name;
  trackManufacturing.description = 'Reduces train mana by 10, allowing it to convert wood and stone to tracks more quickly.';
  trackManufacturing.tooltipExtended = trackManufacturing.description;
  trackManufacturing.goldCost = 1;
  trackManufacturing.stockMaximum = 10;
  trackManufacturing.stockReplenishInterval = 3600;
  trackManufacturing.stockInitialAfterStartDelay = 10;
  trackManufacturing.useAutomaticallyWhenAcquired = true;
  trackManufacturing.activelyUsed = false;
  trackManufacturing.canBeDropped = false;
  trackManufacturing.perishable = true;
  trackManufacturing.abilities = '';
  trackManufacturing.classification = 'PowerUp';
  trackManufacturing.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNStaffOfTeleportation.blp';

  // Train Resource Capacity upgrade (DruidPouch — purchased from shop)
  const resourceCapacity = objectData.items.get(constants.items.DruidPouch)!;
  resourceCapacity.name = 'Train Resource Capacity';
  resourceCapacity.tooltipBasic = resourceCapacity.name;
  resourceCapacity.description = 'Increases the amount of wood and stone the train can carry by 2.';
  resourceCapacity.tooltipExtended = resourceCapacity.description;
  resourceCapacity.goldCost = 1;
  resourceCapacity.stockMaximum = 10;
  resourceCapacity.stockReplenishInterval = 3600;
  resourceCapacity.stockInitialAfterStartDelay = 10;
  resourceCapacity.useAutomaticallyWhenAcquired = true;
  resourceCapacity.activelyUsed = false;
  resourceCapacity.canBeDropped = false;
  resourceCapacity.perishable = true;
  resourceCapacity.abilities = '';
  resourceCapacity.classification = 'PowerUp';
  resourceCapacity.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNPackBeast.blp';

  // Train Track Capacity upgrade (JadeRing — purchased from shop)
  const trackCapacity = objectData.items.get(constants.items.JadeRing)!;
  trackCapacity.name = 'Train Track Capacity';
  trackCapacity.tooltipBasic = trackCapacity.name;
  trackCapacity.description = 'Increases the amount of tracks the train can carry by 2.';
  trackCapacity.tooltipExtended = trackCapacity.description;
  trackCapacity.goldCost = 1;
  trackCapacity.stockMaximum = 10;
  trackCapacity.stockReplenishInterval = 3600;
  trackCapacity.stockInitialAfterStartDelay = 10;
  trackCapacity.useAutomaticallyWhenAcquired = true;
  trackCapacity.activelyUsed = false;
  trackCapacity.canBeDropped = false;
  trackCapacity.perishable = true;
  trackCapacity.abilities = '';
  trackCapacity.classification = 'PowerUp';
  trackCapacity.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNSpiritLink.blp';

  // Crate Capacity upgrade (LionsRing — purchased from shop)
  const crateCapacity = objectData.items.get(constants.items.LionsRing)!;
  crateCapacity.name = 'Crate Capacity';
  crateCapacity.tooltipBasic = crateCapacity.name;
  crateCapacity.description = 'Increases the amount of tracks, wood and stone the crate can carry by 4.';
  crateCapacity.tooltipExtended = crateCapacity.description;
  crateCapacity.goldCost = 1;
  crateCapacity.stockMaximum = 10;
  crateCapacity.stockReplenishInterval = 3600;
  crateCapacity.stockInitialAfterStartDelay = 10;
  crateCapacity.useAutomaticallyWhenAcquired = true;
  crateCapacity.activelyUsed = false;
  crateCapacity.canBeDropped = false;
  crateCapacity.perishable = true;
  crateCapacity.abilities = '';
  crateCapacity.classification = 'PowerUp';
  crateCapacity.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNMonsterLure.blp';

  // Mercenary Contract (MogrinsReport — purchased from shop; back on sale whenever
  // no mercenary is alive, so it doubles as the replacement hire)
  const mercContract = objectData.items.get(constants.items.MogrinsReport)!;
  mercContract.name = 'Mercenary Contract';
  mercContract.tooltipBasic = mercContract.name;
  mercContract.description = 'Unlocks level 2 creep camps and recruits a random mercenary creep that joins your heroes whenever they are summoned. If it dies you lose the level 2 camps and this goes back on the shelf: buying again hires a fresh mercenary, carrying the gear the last one held.';
  mercContract.tooltipExtended = mercContract.description;
  mercContract.goldCost = 1;
  mercContract.stockMaximum = 1;
  mercContract.stockReplenishInterval = 3600;
  mercContract.stockInitialAfterStartDelay = 10;
  mercContract.useAutomaticallyWhenAcquired = true;
  mercContract.activelyUsed = false;
  mercContract.canBeDropped = false;
  mercContract.perishable = true;
  mercContract.abilities = '';
  mercContract.classification = 'PowerUp';
  mercContract.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNMedalionOfCourage.blp';

  // Summon Heroes upgrade (HornOfCenarius — purchased from shop, one-time)
  const summonUpgrade = objectData.items.get(constants.items.HornOfCenarius)!;
  summonUpgrade.name = 'Summon Heroes Upgrade';
  summonUpgrade.tooltipBasic = summonUpgrade.name;
  summonUpgrade.description = 'Unlocks the Summon Heroes ability, allowing heroes to be summoned at creep camps. One-time purchase, kept across rounds.';
  summonUpgrade.tooltipExtended = summonUpgrade.description;
  summonUpgrade.goldCost = 1;
  summonUpgrade.stockMaximum = 1;
  summonUpgrade.stockReplenishInterval = 3600;
  summonUpgrade.stockInitialAfterStartDelay = 10;
  summonUpgrade.useAutomaticallyWhenAcquired = true;
  summonUpgrade.activelyUsed = false;
  summonUpgrade.canBeDropped = false;
  summonUpgrade.perishable = true;
  summonUpgrade.abilities = '';
  summonUpgrade.classification = 'PowerUp';
  // Left at the stock item's own icon (BTNHornOfCenarius.blp): the previous
  // BTNSelectHeroOn.blp is not a real file, which the shop draws as a '?'.

  // Second Contract (SkullOfGuldan — purchased from shop, one per living pair).
  // A Campaign-class rawcode, like every other item the map repurposes, so
  // creeps can never drop it (the build guard above enforces that).
  const secondContract = objectData.items.get(constants.items.SkullOfGuldan)!;
  secondContract.name = 'Second Contract';
  secondContract.tooltipBasic = secondContract.name;
  secondContract.description = 'Hires a SECOND mercenary and unlocks level 3 (red) creep camps. Only on sale while exactly one mercenary is alive. If either dies you lose the level 3 camps and this goes back on the shelf.';
  secondContract.tooltipExtended = secondContract.description;
  secondContract.goldCost = 1;
  secondContract.stockMaximum = 1;
  secondContract.stockReplenishInterval = 3600;
  secondContract.stockInitialAfterStartDelay = 10;
  secondContract.useAutomaticallyWhenAcquired = true;
  secondContract.activelyUsed = false;
  secondContract.canBeDropped = false;
  secondContract.perishable = true;
  secondContract.abilities = '';
  secondContract.classification = 'PowerUp';
  // Icon deliberately NOT set: the stock item already has a valid one
  // (BTNGuldanSkull.blp), and a BTN name guessed from the item's name --
  // BTNSkullOfGuldan.blp -- does not exist, which the game draws as a green
  // box. Only override this with a path read off real object data.

  // Hero Reroll (VoodooDoll — purchased from shop, kept in inventory, not a
  // powerup: the buyer carries it, can pawn it back for a refund, and casts
  // it on an inter-round lobby hero to reroll them (reroll.ts)
  const heroReroll = objectData.items.get(constants.items.VoodooDoll)!;
  heroReroll.name = 'Reroll';
  heroReroll.tooltipBasic = heroReroll.name;
  heroReroll.description = 'Use on a hero or mercenary in the inter-round lobby to replace it with a random new one. XP and items carry over. Sell back to the shop for a full refund.';
  heroReroll.tooltipExtended = heroReroll.description;
  heroReroll.goldCost = 1;
  heroReroll.stockMaximum = 10;
  heroReroll.stockReplenishInterval = 3600;
  heroReroll.stockInitialAfterStartDelay = 10;
  heroReroll.useAutomaticallyWhenAcquired = false;
  heroReroll.activelyUsed = true;
  heroReroll.canBeDropped = true;
  heroReroll.droppedWhenCarrierDies = true;
  heroReroll.perishable = true;
  heroReroll.canBeSoldToMerchants = true;
  heroReroll.numberOfCharges = 1;
  heroReroll.abilities = constants.abilities.ItemIllusions;
  heroReroll.classification = 'Charged';
  heroReroll.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNReincarnation.blp';

  // Mercenary inventory: a rolled mercenary is a plain creep type, and WC3 only
  // grants working inventory slots for an inventory ability present on the unit
  // at CREATION time — UnitAddAbility at runtime shows the ability but yields 0
  // slots (verified in-game). So bake InventoryHero (the same ability the
  // peasant carries tools with) onto every Lordaeron Summer creep type, the pool
  // rollMercType draws mercenaries from. Enemy camp copies get an (unused) empty
  // inventory too — harmless. Keep this list in sync with
  // CREEP_CAMPS['Lordaeron Summer'].
  //
  // Death-drop is NOT prevented in object data: this is stock AInv, which drops
  // items on death. mercenary.ts strips them in the death trigger instead, so
  // that strip is the only thing preventing a dead merc's items from hitting
  // the ground. Giving the merc an inventory ability with dropItemsOnDeath=0
  // would make it robust rather than order-dependent, but AInv is shared with
  // the train, peasant and crate, so it cannot simply be reconfigured here.
  const mercCreepTypes = [
    'nfsh', 'nftb', 'nftk', 'nftr', 'nftt', 'ngna', 'ngnb', 'ngno', 'ngns',
    'ngnv', 'ngnw', 'ngrk', 'ngst', 'nkob', 'nkog', 'nkot', 'nmfs', 'nmrl',
    'nmrm', 'nmrr', 'nogl', 'nogm', 'nogr', 'nomg', 'nrdr', 'nsc2', 'nsc3',
    'nscb', 'ntrg', 'ntrh', 'ntrs', 'ntrt', 'nwzg',
  ];
  for (const creepId of mercCreepTypes) {
    const creep = objectData.units.get(creepId);
    if (creep == null) continue;
    const existing = (creep.normal as unknown as string) ?? '';
    if (existing.indexOf(constants.abilities.InventoryHero) !== -1) continue;
    creep.normal = (existing !== '' ? existing + ',' : '') + constants.abilities.InventoryHero;
  }

  // Scale down all hero types to match peasant size
  const heroTypes: string[] = [
    // Human
    constants.units.Paladin, constants.units.Archmage, constants.units.MountainKing, constants.units.BloodMage,
    // Orc
    constants.units.Blademaster, constants.units.FarSeer, constants.units.TaurenChieftain, constants.units.ShadowHunter,
    // Undead
    constants.units.DeathKnight, constants.units.Lich, constants.units.Dreadlord, constants.units.CryptLord,
    // Night Elf
    constants.units.DemonHunter, constants.units.KeeperOfTheGrove, constants.units.PriestessOfTheMoon, constants.units.Warden,
    // Tavern
    constants.units.Beastmaster, constants.units.DarkRanger, constants.units.PitLord, constants.units.Tinker,
    constants.units.Firelord, constants.units.Alchemist, constants.units.Brewmaster, constants.units.SeaWitch,
  ];

  for (const heroType of heroTypes) {
    const hero = objectData.units.get(heroType)!;
    hero.scalingValueundefined = UNIT_SCALE;
    hero.selectionScale = 1;
    hero.collisionSize = 32; // match peasants: one unit blocks a 1-tile corridor
    hero.pathingMap = '';
    hero.shadowImageHeight = 100;
    hero.shadowImageWidth = 100;
    hero.shadowImageCenterX = 40;
    hero.shadowImageCenterY = 40;
    hero.speedBase = 200;
  }

  objectData.save();
});
