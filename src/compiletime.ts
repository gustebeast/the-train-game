compiletime(({ objectData, constants }) => {
  // --- Shared data -------------------------------------------------------------
  //
  // Values the game reads as well -- rawcodes, pools, prices, tables -- live in
  // plain-data modules (sharedData.ts, track/constants.ts) and
  // are written exactly once. This closure cannot import them: war3-transformer
  // evaluates its TEXT on its own, so module scope and imports do not exist in
  // here. It loads them the way Node would instead, through the TypeScript
  // compiler that is already a dependency of the build.
  //
  // What makes that work is the rule those modules keep (see sharedData.ts):
  // data only, importing nothing but @objectdata constants. WC3 globals a data
  // table names -- ITEM_TYPE_PERMANENT in a creep's drops -- do not exist at
  // build time, so each one is stood in by its own name when first missed.
  function loadShared(file: string): any {
    const ts = require('typescript');
    const fs = require('fs');
    const js: string = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
    }).outputText;
    const libraries: { [spec: string]: object } = {
      '@objectdata/units': { Units: constants.units },
      '@objectdata/items': { Items: constants.items },
      '@objectdata/abilities': { Abilities: constants.abilities },
      '@objectdata/upgrades': { Upgrades: constants.upgrades },
      '@objectdata/destructables': { Destructables: constants.destructables },
    };
    const shimRequire = (spec: string): object => {
      const lib = libraries[spec];
      if (lib == null) {
        throw new Error(file + ' imports ' + spec + ': shared data may import only @objectdata constants');
      }
      return lib;
    };
    const globalNames: string[] = [];
    for (let attempt = 0; attempt < 50; attempt++) {
      const mod = { exports: {} as any };
      try {
        // apply, not spread: argument spread emits a helper that breaks this
        // block's eval, exactly as object spread does.
        const params = ['exports', 'module', 'require'].concat(globalNames);
        const run = Function.apply(null, params.concat([js]));
        run.apply(null, [mod.exports, mod, shimRequire].concat(globalNames as any[]));
        return mod.exports;
      } catch (e) {
        const missing = /^(\w+) is not defined$/.exec((e as Error).message);
        if (!(e instanceof ReferenceError) || missing == null) throw e;
        globalNames.push(missing[1]);
      }
    }
    throw new Error(file + ' names more than 50 globals; is it really a data module?');
  }

  // Typed by the modules themselves: `typeof import` is a type, so it is gone
  // before the transformer evaluates this block.
  const shared = loadShared('src/sharedData.ts') as typeof import('./sharedData');
  const trackData = loadShared('src/track/constants.ts') as typeof import('./track/constants');

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
  const KEEP: string[] = (shared.CRITTER_TYPES as string[])
    .concat([constants.units.Peasant, constants.units.CircleOfPower]);
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

  // Every orientation's unit wears its own pre-rotated model (the pairs are in
  // track/constants.ts); the omni piece is the one being placed.
  const trackModels: { [unitId: string]: string } = {};
  trackModels[trackData.OMNI_TRACK] = trackData.OMNI_TRACK_MODEL;
  for (const orientation of Object.keys(trackData.TRACK_PIECES)) {
    const piece = trackData.TRACK_PIECES[orientation];
    trackModels[piece.unit] = piece.model;
  }

  for (const unitId of Object.keys(trackModels)) {
    const isOmni = unitId === trackData.OMNI_TRACK;
    const track = objectData.units.get(unitId)!;
    track.buildTime = 0;
    track.defenseBase = 1;
    track.defenseType = 'none';
    track.description = 'A section of railway track.';
    track.hitPointsMaximumBase = 5;
    track.name = 'Railway Track';
    track.modelFile = 'war3mapImported\\' + trackModels[unitId] + '.mdx';
    track.scalingValueundefined = 1;
    track.shadowTextureBuilding = 'NONE';
    track.groundTexture = 'NONE';
    track.sightRadiusDay = 400;
    track.sightRadiusNight = 400;
    // Solid while being placed, so it pushes its builder off the tile; walkable
    // once placed, so the train can drive over it.
    track.pathingMap = isOmni ? 'PathTextures\\4x4simplesolid.tga' : 'PathTextures\\4x4unbuildable.tga';
  }

  const train = objectData.units.get(constants.units.WarWagon)!;
  train.name = 'Train';
  train.tooltipBasic = 'Train';
  train.collisionSize = 16;
  train.modelFile = 'war3mapImported\\WarWagon.mdx';
  train.normal = constants.abilities.InventoryHero;
  train.scalingValueundefined = UNIT_SCALE;
  train.selectionScale = 1;
  train.sightRadiusDay = 400;
  train.sightRadiusNight = 400;
  train.speedMaximum = shared.MAX_MOVE_SPEED;
  // The engine clamps a unit's speed to at least this, and stock is 150: the
  // train is told to stand still (0) and to creep (1) while it waits on track.
  train.speedMinimum = 1;
  train.hitPointsMaximumBase = shared.TRAIN_INITIAL_MAX_HP;
  train.hitPointsRegenerationRate = shared.TRAIN_HP_REGEN;
  train.hitPointsRegenerationType = 'always';
  train.manaMaximum = shared.TRAIN_INITIAL_MAX_MANA;
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
  trackWagon.scalingValueundefined = UNIT_SCALE;
  // Negative selection scale hides the health bar (invulnerability doesn't);
  // the unit stays selectable and give/take targetable
  trackWagon.selectionScale = -1;
  trackWagon.shadowImageHeight = 100;
  trackWagon.shadowImageWidth = 100;
  trackWagon.shadowImageCenterX = 50;
  trackWagon.shadowImageCenterY = 50;
  trackWagon.sightRadiusDay = 400;
  trackWagon.sightRadiusNight = 400;
  trackWagon.speedMaximum = shared.MAX_MOVE_SPEED;
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
  peasant.normal = [constants.abilities.InventoryHero, constants.abilities.Channel, constants.abilities.InvulnerableNeutral, shared.DASH_ABILITY].join(',');
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
  // MAX_MOVE_SPEED is WC3's gameplay-constant ceiling.
  peasant.speedMaximum = shared.MAX_MOVE_SPEED;
  // The engine clamps SetUnitMoveSpeed to this, and the stock minimum is 150 --
  // so asking for 0 left the start-lobby dancers walking around at 150
  // (measured in game). 1 is the same trick the train already uses.
  peasant.speedMinimum = 1;
  peasant.animationCastPoint = 0;
  peasant.animationCastBackswing = 0;
  // Daylight sight, a tile shorter than stock. Measured rather than guessed:
  // the peasant carried 800 by day, which is 6.25 tiles at TRACK_SIZE 128, and
  // read one tile too far in play.
  //
  // ONLY the day value; night keeps whatever it has always had, since only the
  // day reading was too generous.
  //
  // Do not try to tune night by reading UNIT_RF_SIGHT_RADIUS a second or two
  // after SetTimeOfDay: the engine FADES sight between the two values, so a
  // reading taken during the fade is a point on the way, not the night figure.
  // Three runs here gave 667, 757 and 624 for what should have been the same
  // number, which is what that looks like.
  // 672 was still a tile long once the water border stopped being suspect and
  // the peasant could be judged on its own.
  peasant.sightRadiusDay = 544;

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
  const dash = objectData.abilities.get(shared.DASH_ABILITY)! as ChannelAbility;
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
            if (match != null && !mod.id.startsWith('ata')) {
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
  //
  // Every spell repurposed as a trigger-only cast (shared.PEASANT_SPELLS) wants
  // the same things off: it is a button that raises an event, so mana,
  // cooldown, duration and area are all in the way. Shared safely because the consumer only READS these into fresh
  // Modification objects; it never writes back through them.
  const zeroedSpellCost = [
    { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 }, // manaCost
    { id: 'acdn', variableType: 2, dataPointer: 0, value: 0 }, // cooldown
    { id: 'adur', variableType: 2, dataPointer: 0, value: 0 }, // duration
    { id: 'ahdu', variableType: 2, dataPointer: 0, value: 0 }, // heroDuration
    { id: 'aare', variableType: 2, dataPointer: 0, value: 0 }, // areaOfEffect
  ];
  const zeroedTransmutePayout = [
    { id: 'Ntm1', variableType: 2, dataPointer: 1, value: 0 }, // goldCostFactor
    { id: 'Ntm2', variableType: 2, dataPointer: 2, value: 0 }, // lumberCostFactor
  ];
  /** A forced field. levelOrVariation defaults to 1; a field that is not per
   *  level (requirements) names 0. */
  type ForcedMod = { id: string; variableType: number; dataPointer: number; value: number | string; levelOrVariation?: number };
  const noMana: ForcedMod = { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 };
  const noRequirement: ForcedMod = { id: 'areq', variableType: 3, dataPointer: 0, value: '', levelOrVariation: 0 };
  const forcedMods: { [rawcode: string]: ForcedMod[] } = {
    ANcl: [ // Channel
      { id: 'Ncl1', variableType: 2, dataPointer: 1, value: 0 }, // followThroughTime
      { id: 'Ncl4', variableType: 2, dataPointer: 4, value: 0 }, // artDuration
      { id: 'Ncl5', variableType: 0, dataPointer: 5, value: 0 }, // disableOtherAbilities
    ],
    // The Alchemist's Transmute pays its caster gold for the creep it kills.
    // Gold here is gameState.gold, copied onto native gold by syncGold, so the
    // payout only ever showed as phantom gold: the counter jumped (66 for one
    // kobold, measured) and the shop, which spends gameState.gold, refused to
    // honour it. Zeroed rather than left to the next sync to wipe. Forced
    // because 0 is what the library THINKS the default is, so assigning
    // goldCostFactor = 0 would write nothing at all.
    ANtm: zeroedTransmutePayout,
    // The Strange Key's throw, a COPY of Transmute (see the keyThrow block).
    // A copy starts from the stock Transmute, not from the ANtm fix above, so
    // it needs its own: no gold, and free for a peasant with no mana.
    // concat, not a spread: spreads break this block's eval (see project notes).
    // Peasant ability item spells (see their blocks). Copies, so these REPLACE
    // what the copy inherits -- which is why none of them lists the cooldown
    // or duration it sets itself. No mana: a peasant has none.
    // Vacuum Resources, a copy of Channel: no target, and it must not disable
    // the peasant's other abilities while it runs.
    [shared.VACUUM_ABILITY]: [noMana,
      { id: 'Ncl2', variableType: 0, dataPointer: 2, value: 0 }, // targetType: none
      { id: 'Ncl4', variableType: 2, dataPointer: 4, value: 0 }, // artDuration
      { id: 'Ncl5', variableType: 0, dataPointer: 5, value: 0 }, // disableOtherAbilities
    ],
    // Unholy Frenzy and Bloodlust both wait on an upgrade in melee (Necromancer
    // and Shaman training); with it the cast is simply refused. Not per level.
    [shared.UNHOLY_FRENZY_ABILITY]: [noMana, noRequirement],
    [shared.GREATER_UNHOLY_FRENZY_ABILITY]: [noMana, noRequirement],
    // Imbue With Horse, a copy of Bloodlust: speed only -- no attack rate and
    // no growing the target.
    [shared.IMBUE_HORSE_ABILITY]: [noMana, noRequirement,
      { id: 'Blo1', variableType: 2, dataPointer: 1, value: 0 }, // attack speed
      { id: 'Blo3', variableType: 2, dataPointer: 3, value: 0 }, // scaling
    ],
    [shared.GREATER_IMBUE_HORSE_ABILITY]: [noMana, noRequirement,
      { id: 'Blo1', variableType: 2, dataPointer: 1, value: 0 },
      { id: 'Blo3', variableType: 2, dataPointer: 3, value: 0 },
    ],
    [shared.KEY_THROW_ABILITY]: zeroedSpellCost.concat(zeroedTransmutePayout),
    // NOTE: there was an Aihn (UnitInventoryHuman) block here configuring
    // "mercenary inventory, no drop on death". It was dead: no unit anywhere
    // carries Aihn. The mercenary is given AInv (InventoryHero) instead -- see
    // MERC_INVENTORY_ABILITY_ID in mercenary.ts -- so none of that config ever
    // reached the game.
    //
    // Consequence, which is why this note is here rather than a silent
    // deletion: the merc carries STOCK AInv, and stock hero inventory DOES drop
    // its items on death. Nothing in object data prevents it. The only thing
    // stopping a dead merc's items hitting the ground is the strip in
    // mercenary.ts's death trigger, so that code is load-bearing, not a
    // belt-and-braces backstop.
  };
  for (const key of Object.keys(shared.PEASANT_SPELLS)) {
    forcedMods[(shared.PEASANT_SPELLS as Record<string, string>)[key]] = zeroedSpellCost;
  }
  /** Add each forced field the object lacks. A copy also inherits whatever
   *  this file did to its base -- the vacuum, a copy of Channel, came out with
   *  give/take's "unit or point" target type -- so for a copy (`replace`) a
   *  forced value overwrites an inherited one instead of only filling a gap. */
  function pushForced(obj: any, mods: ForcedMod[], replace = false): void {
    for (const forced of mods) {
      const existing = obj.modifications.find((m: any) => m.id === forced.id);
      if (existing != null) {
        if (replace) existing.value = forced.value;
        continue;
      }
      const mod = new Modification();
      Object.assign(mod, { levelOrVariation: 1, u1: 0 }, forced);
      obj.modifications.push(mod);
    }
  }
  const originalSave = objectData.save.bind(objectData);
  objectData.save = () => {
    const result = originalSave();
    if (result.w3a) {
      fixAbilityLevels(result.w3a);
      const seen = new Set<string>();
      // Custom copies first, matched by their NEW id. Without this a forced
      // entry for a copy (A012) found nothing in the original table, and the
      // fallback below then wrote it there as if it were a stock ability.
      for (const obj of result.w3a.customTable.objects) {
        const mods = forcedMods[obj.newId];
        if (mods == null) continue;
        seen.add(obj.newId);
        pushForced(obj, mods, true);
      }
      for (const obj of result.w3a.originalTable.objects) {
        const mods = forcedMods[obj.oldId];
        if (mods == null) continue;
        seen.add(obj.oldId);
        pushForced(obj, mods);
      }
      // Create w3a entries for abilities that only ended up in w3aSkin
      for (const [rawcode, mods] of Object.entries(forcedMods)) {
        if (seen.has(rawcode)) continue;
        const obj = new ModifiedObject();
        obj.oldId = rawcode;
        pushForced(obj, mods);
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
  const attachments: { ability: string; model: string; point: string }[] =
    Object.keys(shared.CARRIED_TOOLS).map(item => shared.CARRIED_TOOLS[item]).concat([shared.READY_ORB]);
  const attachmentAbilityIds = attachments.map(a => a.ability);
  // NOTE: no object spread here — the transformer transpiles this block with
  // ts.transpile() and evals it wrapped in parens; spread emits a `var __assign`
  // helper above the function expression, which is a SyntaxError in that eval.
  const abilityGameData = objectData.abilities as unknown as { game: Record<string, object> };
  const pokedGame: Record<string, object> = Object.assign({}, abilityGameData.game);
  for (const abilityId of attachmentAbilityIds) {
    pokedGame[abilityId] = Object.assign({}, abilityGameData.game[abilityId], { attackBonus: 1 });
  }
  abilityGameData.game = pokedGame;

  // Each carried tool, and the ready orb, shown through its own ability (the
  // table is sharedData's CARRIED_TOOLS and READY_ORB, which the game reads to
  // pick the ability). (Pickaxe.mdx's handle texture was swapped from a
  // singleplayer glue-screen asset to AshenTree.blp -- the glue texture was
  // suspected in a multiplayer framerate bug.)
  for (const attachment of attachments) {
    const art = objectData.abilities.get(attachment.ability)! as StatBonusAbility;
    art.target = attachment.model;
    art.targetAttachments = 1;
    art.targetAttachmentPoint1 = attachment.point;
    art.attackBonus = 0;
  }

  // A peasant's tool: free, dropped where its carrier falls, never sold back.
  const authorTool = (rawcode: string, name: string, description: string, model: string) => {
    const tool = objectData.items.get(rawcode)!;
    tool.name = name;
    tool.description = description;
    tool.tooltipExtended = description;
    tool.goldCost = 0;
    tool.canBeDropped = true;
    tool.droppedWhenCarrierDies = true;
    tool.perishable = false;
    tool.canBeSoldToMerchants = false;
    tool.abilities = '';
    tool.modelUsed = model;
    return tool;
  };
  const axe = authorTool(constants.items.SturdyWarAxe, 'Axe',
    'Allows chopping trees which can be given to the train and converted to tracks, or used to build bridges across water.',
    'war3mapImported\\AxeGround.mdx');
  const pickaxe = authorTool(constants.items.RustyMiningPick, 'Pickaxe',
    'Allows mining rocks which can be given to the train and converted to tracks.',
    'war3mapImported\\PickaxeGround.mdx');
  const bucket = authorTool(constants.items.EmptyVial, 'Empty Bucket',
    'Can be filled with water and used on the train to restore HP.', shared.BUCKET_MODEL);
  const bucketFull = authorTool(constants.items.FullVial, 'Full Bucket',
    'Can be used on the train to restore HP.', shared.BUCKET_FULL_MODEL);

  // The Strange Key: dropped by a level 3 creep camp cleared without losing
  // anybody, and the only thing that breaks the Strange Rock barring the way to
  // the boss. A peasant item, so it lives by the peasant's one-item rule and
  // cannot be handed to the engine, the wagon or the crate -- see itemRules.ts.
  const bossKey = objectData.items.get(constants.items.KeyOfThreeMoons)!;
  bossKey.name = 'Strange Key';
  bossKey.description = 'Taken from something that should not have been carrying it.';
  bossKey.tooltipExtended = 'Whatever this opens is not on any map. Use it on the Strange Rock at the far edge of the line.';
  bossKey.goldCost = 0;
  bossKey.canBeDropped = true;
  bossKey.droppedWhenCarrierDies = true;
  bossKey.canBeSoldToMerchants = false;
  // Used, not just carried: the key throws itself at the Strange Rock (A012,
  // a copy of Transmute). One charge, perishable, so the key is spent by the
  // throw that breaks the rock -- and only that throw, because the engine
  // refuses any other target before a charge is touched.
  bossKey.abilities = shared.KEY_THROW_ABILITY;
  bossKey.activelyUsed = true;
  bossKey.numberOfCharges = 1;
  bossKey.perishable = true;

  // Peasant ability items, sold by the Secret Salesperson. Carried in the last
  // inventory slot, apart from the one carried item (items.ts), and passed to
  // another peasant like any item. Holding one grants its spell; the item
  // itself does nothing when clicked. Campaign items, so creeps never drop them.
  const resourceVacuum = objectData.items.get(constants.items.GlyphOfPurification)!;
  resourceVacuum.name = 'Resource Vacuum';
  resourceVacuum.description = 'Grants Vacuum Resources (Q): pulls the wood and stone lying within a tile of you into one pile of each.';
  const greaterResourceVacuum = objectData.items.get(constants.items.EnchantedGemstone)!;
  greaterResourceVacuum.name = 'Greater Resource Vacuum';
  greaterResourceVacuum.description = 'Grants Vacuum Resources (Q): pulls the wood and stone lying within two tiles of you into one pile of each.';
  const unholyBone = objectData.items.get(constants.items.BloodKey)!;
  unholyBone.name = 'Unholy Bone';
  unholyBone.description = 'Grants Unholy Frenzy (Q): a friendly unit attacks 50% faster, losing 2 hit points a second. A peasant chops and mines faster.';
  const greaterUnholyBone = objectData.items.get(constants.items.GhostKey)!;
  greaterUnholyBone.name = 'Greater Unholy Bone';
  greaterUnholyBone.description = 'Grants Unholy Frenzy (Q): a friendly unit attacks 75% faster, losing 4 hit points a second. A peasant chops and mines faster.';
  const horseEssence = objectData.items.get(constants.items.MoonKey)!;
  horseEssence.name = 'Horse Essence';
  horseEssence.description = 'Grants Imbue With Horse (Q): a friendly unit moves 70% faster for 10 seconds.';
  const greaterHorseEssence = objectData.items.get(constants.items.SunKey)!;
  greaterHorseEssence.name = 'Greater Horse Essence';
  greaterHorseEssence.description = 'Grants Imbue With Horse (Q): a friendly unit moves 70% faster for 20 seconds.';
  const muscleMilk = objectData.items.get(constants.items.TheHeartOfSearinox)!;
  muscleMilk.name = 'Muscle Milk™';
  muscleMilk.description = 'Carry 1 more of any stack of wood, stone or tracks. Storage limits stay the same.';
  const greaterMuscleMilk = objectData.items.get(constants.items.UrnOfKingTerenas)!;
  greaterMuscleMilk.name = 'Greater Muscle Milk™';
  greaterMuscleMilk.description = 'Carry 2 more of any stack of wood, stone or tracks. Storage limits stay the same.';
  const iconFor: [typeof unholyBone, string][] = [
    [muscleMilk, 'BTNLesserRejuvPotion'], [greaterMuscleMilk, 'BTNGreaterRejuvPotion'],
    [resourceVacuum, 'BTNTornado'], [greaterResourceVacuum, 'BTNTornado'],
    [unholyBone, 'BTNBoneChimes'], [greaterUnholyBone, 'BTNBoneChimes'],
    [horseEssence, 'BTNRiderlessHorse'], [greaterHorseEssence, 'BTNRiderlessHorse'],
  ];
  for (const [abilityItem, icon] of iconFor) {
    abilityItem.tooltipBasic = abilityItem.name;
    abilityItem.tooltipExtended = abilityItem.description;
    abilityItem.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\' + icon + '.blp';
    abilityItem.goldCost = 2;
    abilityItem.stockMaximum = 10;
    abilityItem.stockReplenishInterval = 3600;
    abilityItem.stockInitialAfterStartDelay = 10;
    abilityItem.abilities = '';
    abilityItem.activelyUsed = false;
    abilityItem.useAutomaticallyWhenAcquired = false;
    abilityItem.canBeDropped = true;
    abilityItem.droppedWhenCarrierDies = true;
    abilityItem.perishable = false;
    // Sellable so the salesperson can buy it back; the regular shop hands it back.
    abilityItem.canBeSoldToMerchants = true;
  }

  // Upgrade Peasant Ability: used up on purchase, turning the buyer's ability
  // item into its Greater version (salesperson.ts). Bought with nothing to
  // upgrade, it is refunded.
  const upgradeAbility = objectData.items.get(constants.items.Mooncrystal)!;
  upgradeAbility.name = 'Upgrade Peasant Ability';
  upgradeAbility.tooltipBasic = upgradeAbility.name;
  upgradeAbility.description = 'Turns the peasant ability item you are holding into its Greater version: a Greater Resource Vacuum reaches two tiles, a Greater Unholy Bone frenzies harder, a Greater Horse Essence lasts twice as long, Greater Muscle Milk™ carries 2 extra. Refunded if you have nothing to upgrade.';
  upgradeAbility.tooltipExtended = upgradeAbility.description;
  upgradeAbility.goldCost = 3;
  upgradeAbility.stockMaximum = 10;
  upgradeAbility.stockReplenishInterval = 3600;
  upgradeAbility.stockInitialAfterStartDelay = 10;
  upgradeAbility.abilities = '';
  upgradeAbility.activelyUsed = false;
  upgradeAbility.useAutomaticallyWhenAcquired = true;
  upgradeAbility.perishable = true;
  upgradeAbility.classification = 'PowerUp';
  upgradeAbility.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNGlyph.blp';

  // The tools and the key can't be destroyed by attacking them: items have hit
  // points, and A-clicking a tool on the ground used to break it, which loses a
  // whole round's worth of chopping, mining or watering -- or the only key to
  // the boss. 999999, the same as the indestructible granite; no attack in the
  // map comes close. Wood, stone and track pieces are left breakable: losing
  // one is a nuisance, not a lost round.
  for (const unbreakable of [axe, pickaxe, bucket, bucketFull, bossKey, resourceVacuum, greaterResourceVacuum,
    unholyBone, greaterUnholyBone, horseEssence, greaterHorseEssence, muscleMilk, greaterMuscleMilk]) {
    unbreakable.hitPoints = 999999;
  }

  // The carried resources: one charge per item, stacked by the game (items.ts).
  // Breakable, unlike the tools -- losing one is a nuisance, not a round.
  const authorResource = (rawcode: string, name: string, description: string, icon: string, model: string, scale: number): void => {
    const resource = objectData.items.get(rawcode)!;
    resource.name = name;
    resource.description = description;
    resource.tooltipExtended = description;
    resource.classification = 'Charged';
    resource.goldCost = 0;
    resource.canBeDropped = true;
    resource.droppedWhenCarrierDies = true;
    resource.perishable = false;
    resource.useAutomaticallyWhenAcquired = false;
    resource.canBeSoldToMerchants = false;
    resource.abilities = '';
    resource.numberOfCharges = 1;
    resource.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\' + icon + '.blp';
    resource.modelUsed = model;
    resource.scalingValue = scale;
  };
  authorResource(constants.items.IronwoodBranch, 'Wood',
    'Can be given to the train and converted to tracks, or used to build bridges across water.',
    'BTNBundleOfLumber', shared.WOOD_MODEL, 0.4);
  authorResource(constants.items.GemFragment, 'Stone',
    'Can be given to the train and converted to tracks.',
    'BTNGolemStormBolt', shared.STONE_MODEL, 0.4);
  authorResource(constants.items.MechanicalCritter, 'Track Piece',
    'A section of railway track which can be placed adjacent to the previous track piece',
    'BTNHumanBuild', 'war3mapImported\\OmniTrack.mdx', 0.5);

  // Tree destructables: one tree wall per biome
  for (const treeId of [shared.TREE_WALLS.summer, shared.TREE_WALLS.fall, shared.TREE_WALLS.winter]) {
    const tree = objectData.destructables.get(treeId)!;
    tree.hitPoints = 15;
    tree.selectableInGame = false;
    tree.occlusionHeight = 0;
    tree.targetedAs = 'debris';
  }

  // Rock destructables (6 variations, same model as granite)
  const rock = objectData.destructables.get(shared.ROCK_RAW)!;
  rock.hitPoints = 15;
  rock.selectableInGame = false;
  rock.occlusionHeight = 0;

  // Creep camp destructable
  const creepCamp = objectData.destructables.get(shared.CAGE_RAW)!;
  creepCamp.hitPoints = 5;
  creepCamp.selectableInGame = false;
  creepCamp.occlusionHeight = 0;

  // Granite rocks: dark tint, unselectable, indestructible
  const granite = objectData.destructables.get(shared.GRANITE_RAW)!;
  granite.hitPoints = 999999;
  granite.occlusionHeight = 0;
  granite.selectableInGame = false;
  granite.tintingColor1Red = 40;
  granite.tintingColor2Green = 40;
  granite.tintingColor3Blue = 40;

  // The Strange Rock: seals the boss exit until somebody brings the key.
  //
  // A UNIT dressed as a rock, not a destructable. The key breaks it by throwing
  // a copy of Transmute (A012), and Transmute will not target a destructable at
  // all -- the order is refused outright, measured. As a unit it is a legal
  // target, and the engine does everything: the throw, the missile, and the
  // kill when it lands.
  //
  // Copied from the Barracks only because it is a plain building nothing else
  // here modifies; everything that makes it a barracks is cleared.
  //
  // Classified ANCIENT so the key can target it and nothing else: the key's
  // targets are "ancient structure", and this is the only one in the map.
  //
  // Made invulnerable when spawned (bossRock.ts), like the water tiles: no
  // health bar, and attacks get the engine's refusal. The 999999 HP is only a
  // backstop. Transmute kills rather than damages, invulnerable or not.
  // Secret Salesperson: a shop that turns up on snow rounds, selling peasant
  // ability items. A Marketplace copy because the Marketplace is the one shop
  // whose runtime stock (AddItemToStock) displays -- see the shop below -- and
  // standing still is all he does anyway. Model: "Mr. Goblin, the Goblin
  // Adventurer" by Deolrin (Hive Workshop), which uses only stock textures.
  // Like every copy it starts from the Marketplace as this file has left it.
  const salesGoblin = objectData.units.copy(constants.units.Marketplace, shared.SALESPERSON_UNIT)!;
  {
    salesGoblin.name = 'Secret Salesperson';
    salesGoblin.nameEditorSuffix = '';
    salesGoblin.modelFile = 'war3mapImported\\MrGoblin.mdx';
    // The goblin model is small: this makes him peasant height (peasants are 0.6).
    salesGoblin.scalingValueundefined = 1.65;
    salesGoblin.selectionScale = 1;
    salesGoblin.groundTexture = '';
    salesGoblin.shadowTextureBuilding = '';
    salesGoblin.pathingMap = 'PathTextures\\4x4simplesolid.tga';
    salesGoblin.collisionSize = 32;
    salesGoblin.itemsSold = '';
    salesGoblin.itemsMade = '';
    salesGoblin.sightRadiusDay = 400;
    salesGoblin.sightRadiusNight = 400;
    // Secret: finding him is the point, so he is not on the minimap.
    salesGoblin.hideMinimapDisplay = true;
  }
  // Note what a copy inherits: it starts from the object as THIS file has left
  // it so far, so the rock already carries the blanket scale from the top.
  const sealRock = objectData.units.copy(constants.units.Barracks, shared.STRANGE_ROCK)!;
  {
    sealRock.name = 'Strange Rock';
    sealRock.nameEditorSuffix = '';
    // RockChunks1's model, variation 0 -- the one the destructable used. Read
    // from the destructable's own data rather than typed from memory.
    sealRock.modelFile = 'Doodads\\LordaeronSummer\\Terrain\\LoardaeronRockChunks\\LoardaeronRockChunks0.mdl';
    sealRock.tintingColor1Redundefined = 255;
    sealRock.tintingColor2Greenundefined = 40;
    sealRock.tintingColor3Blueundefined = 40;
    sealRock.unitClassification = 'ancient';
    // The selection ring is the Barracks', sized for a building several tiles
    // across, and SetUnitScale shrinks the model but not the ring. Sized to
    // the rock as it is actually drawn (granite's scale, bossRock.ts).
    sealRock.selectionScale = 1.5;
    sealRock.normal = '';
    sealRock.unitsTrained = '';
    sealRock.researchesAvailable = '';
    sealRock.upgradesTo = '';
    sealRock.hitPointsMaximumBase = 999999;
    sealRock.hitPointsRegenerationRate = 0;
    sealRock.sightRadiusDay = 0;
    sealRock.sightRadiusNight = 0;
    sealRock.hideMinimapDisplay = true;
    sealRock.groundTexture = '';
    sealRock.pathingMap = 'PathTextures\\4x4SimpleSolid.tga';
  }

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
  // The border tiles exist to give the lobby an even ring of vision, not to
  // reveal what is outside it. WC3 shrinks sight at night on top of these
  // fields, so day is set LOWER than night on purpose -- an odd-looking pair,
  // but it is what makes the two match on screen. The game then shrinks the
  // water's sight further when it spawns one (shrinkWaterSight in
  // terrain/spawn.ts), which is the number to tune now.
  water.sightRadiusDay = 180;
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

  // The peasant's three targeted spells: each a stock spell taken over as a
  // free cast at point-blank range, with the trigger deciding what the target
  // must be (shared.PEASANT_SPELLS; their cost is zeroed in forcedMods).
  const authorTargetSpell = (rawcode: string, name: string, description: string): void => {
    const spell = objectData.abilities.get(rawcode)!;
    spell.heroAbility = false;
    spell.levels = 1;
    spell.castRange = 80;
    spell.targetsAllowed = 'alive,allies,friend,ground,hero,invulnerable,mechanical,neutral,nonhero,notself,organic,player,structure,vulnerable';
    spell.tooltipNormal = name;
    spell.tooltipNormalExtended = description;
    spell.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
    spell.hotkeyNormal = 'D';
  };
  authorTargetSpell(shared.PEASANT_SPELLS.bridge, 'Build Bridge',
    'Consumes one wood to convert a water block into a tile you can walk and build on');
  authorTargetSpell(shared.PEASANT_SPELLS.waterTrain, 'Water Train',
    'Pours water on the train to restore it to full HP.');
  authorTargetSpell(shared.PEASANT_SPELLS.fillBucket, 'Fill Bucket',
    'Fills a bucket with water from a water block.');

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
  const summonHeroes = objectData.abilities.get(shared.PEASANT_SPELLS.summonHeroes)!;
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
  const unsummonHeroes = objectData.abilities.get(shared.PEASANT_SPELLS.unsummonHeroes)!;
  unsummonHeroes.heroAbility = false;
  unsummonHeroes.levels = 1;
  unsummonHeroes.tooltipNormal = 'Unsummon Heroes';
  unsummonHeroes.tooltipNormalExtended = 'Dismiss your heroes and return peasant control to normal.';
  unsummonHeroes.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNSelectHeroOff.blp';
  unsummonHeroes.hotkeyNormal = 'R';
  unsummonHeroes.buffs = '';
  unsummonHeroes.effect = '';

  // Every item the map repurposes must be one creeps never drop; the build
  // guard in the patched save above enforces it.
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

  // Hero Reroll cast — the Wand of Illusion's ability repurposed as a
  // unit-target spell. Its native illusion doesn't matter: reroll.ts replaces
  // the target on cast.
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

  // --- The shelf ---------------------------------------------------------------
  //
  // Everything the shop and the dealer sell is consumed the instant it is
  // bought: shop.ts turns the pickup into the upgrade. Price and shelf size come
  // from sharedData's SHELF, which shop.ts charges from too, and the amounts in
  // the text are the ones the purchase applies.
  function authorShelfItem(rawcode: string, name: string, description: string, icon: string | null) {
    const item = objectData.items.get(rawcode)!;
    const shelf = shared.SHELF[rawcode];
    if (shelf == null) throw new Error(name + ' (' + rawcode + ') is authored as a shelf item but has no SHELF entry');
    item.name = name;
    item.tooltipBasic = name;
    item.description = description;
    item.tooltipExtended = description;
    item.goldCost = shelf.cost;
    item.stockMaximum = shelf.stock;
    item.stockReplenishInterval = 3600;
    item.stockInitialAfterStartDelay = 10;
    item.useAutomaticallyWhenAcquired = true;
    item.activelyUsed = false;
    item.canBeDropped = false;
    item.perishable = true;
    item.abilities = '';
    item.classification = 'PowerUp';
    // Only ever a path read off real object data: a guessed BTN name that does
    // not exist draws as a '?' or a green box. Null keeps the stock icon.
    if (icon != null) item.interfaceIcon = icon;
    return item;
  }

  // Deliberately generic: WHICH challenge this sells is decided at runtime from
  // the seeded sequence in challenges.ts, and object-data text is fixed at
  // build time, so the specific challenge is announced on purchase instead.
  authorShelfItem(constants.items.Shimmerweed, 'Shady Deal',
    "Take the dealer's challenge for this round. Complete it to earn " + shared.CHALLENGE_BONUS + ' gold.',
    'ReplaceableTextures\\CommandButtons\\BTNSheep.blp');

  // Replaces Flame Resistance on the shelf whenever the train is below its
  // starting max HP.
  authorShelfItem(constants.items.HeartOfAszune, 'Repair Train',
    'Repairs the fire damage, restoring the train to ' + shared.TRAIN_INITIAL_MAX_HP
      + ' health. Health upgrades bought before the fire are not restored.',
    'ReplaceableTextures\\CommandButtons\\BTNHealingSalve.blp');

  authorShelfItem(constants.items.AncientFigurine, 'Flame Resistance',
    'Increases train health by ' + shared.FLAME_RESISTANCE_HP + ', making it take longer to catch fire.',
    'ReplaceableTextures\\CommandButtons\\BTNOrbOfFire.blp');

  authorShelfItem(constants.items.BracerOfAgility, 'Track Manufacturing',
    'Reduces train mana by ' + shared.TRACK_MANUFACTURING_MANA
      + ' (to no less than ' + shared.TRACK_MANUFACTURING_MIN_MANA
      + '), allowing it to convert wood and stone to tracks more quickly.',
    'ReplaceableTextures\\CommandButtons\\BTNStaffOfTeleportation.blp');

  authorShelfItem(constants.items.DruidPouch, 'Train Resource Capacity',
    'Increases the amount of wood and stone the train can carry by ' + shared.RESOURCE_CAPACITY_STEP + '.',
    'ReplaceableTextures\\CommandButtons\\BTNPackBeast.blp');

  authorShelfItem(constants.items.JadeRing, 'Train Track Capacity',
    'Increases the amount of tracks the train can carry by ' + shared.TRACK_CAPACITY_STEP + '.',
    'ReplaceableTextures\\CommandButtons\\BTNSpiritLink.blp');

  authorShelfItem(constants.items.LionsRing, 'Crate Capacity',
    'Increases the amount of tracks, wood and stone the crate can carry by ' + shared.CRATE_CAPACITY_STEP + '.',
    'ReplaceableTextures\\CommandButtons\\BTNMonsterLure.blp');

  // Back on sale whenever no mercenary is alive, so it doubles as the
  // replacement hire.
  authorShelfItem(constants.items.MogrinsReport, 'Mercenary Contract',
    'Unlocks level 2 creep camps and recruits a random mercenary creep that joins your heroes whenever they are summoned. If it dies you lose the level 2 camps and this goes back on the shelf: buying again hires a fresh mercenary, carrying the gear the last one held.',
    'ReplaceableTextures\\CommandButtons\\BTNMedalionOfCourage.blp');

  // One-time; keeps the stock BTNHornOfCenarius.blp icon.
  authorShelfItem(constants.items.HornOfCenarius, 'Summon Heroes Upgrade',
    'Unlocks the Summon Heroes ability, allowing heroes to be summoned at creep camps. One-time purchase, kept across rounds.',
    null);

  // One per living pair. Keeps the stock BTNGuldanSkull.blp icon.
  authorShelfItem(constants.items.SkullOfGuldan, 'Second Contract',
    'Hires a SECOND mercenary and unlocks level 3 (red) creep camps. Only on sale while exactly one mercenary is alive. If either dies you lose the level 3 camps and this goes back on the shelf.',
    null);

  // Bait: buying it makes the next camp a level 3 one, which is the only camp
  // that can drop the Strange Key. Keeps the stock icon.
  const strangeMeat = authorShelfItem(constants.items.BloodfeathersHeart, 'Strange Meat',
    'Guarantees the next camp will be level 3.', null);
  strangeMeat.description = 'Something out there wants this badly enough to bring friends.';

  // Hero Reroll (VoodooDoll — purchased from shop, kept in inventory, not a
  // powerup: the buyer carries it, can pawn it back for a refund, and casts
  // it on an inter-round lobby hero to reroll them (reroll.ts)
  const heroReroll = objectData.items.get(constants.items.VoodooDoll)!;
  heroReroll.name = 'Reroll';
  heroReroll.tooltipBasic = heroReroll.name;
  heroReroll.description = 'Use on a hero or mercenary in the inter-round lobby to replace it with a random new one. XP and items carry over. Sell back to the shop for a full refund.';
  heroReroll.tooltipExtended = heroReroll.description;
  heroReroll.goldCost = shared.SHELF[constants.items.VoodooDoll].cost;
  heroReroll.stockMaximum = shared.SHELF[constants.items.VoodooDoll].stock;
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

  // Every hero the pool can roll, sized and pathed like the peasant. (The
  // blanket loop at the top already scaled them.)
  for (const heroType of shared.HERO_POOL) {
    const hero = objectData.units.get(heroType)!;
    hero.selectionScale = 1;
    hero.collisionSize = 32; // match peasants: one unit blocks a 1-tile corridor
    hero.pathingMap = '';
    hero.shadowImageHeight = 100;
    hero.shadowImageWidth = 100;
    hero.shadowImageCenterX = 40;
    hero.shadowImageCenterY = 40;
    hero.speedBase = 200;
  }

  // The "?" that stands in for a hero or mercenary whose identity you have
  // rolled but not yet seen (see hiddenRoll in heroes.ts / mercenary.ts).
  //
  // A COPY of the peasant rather than a repurposed stock unit: every stock unit
  // worth taking is already spoken for -- towers are track, the marketplace is
  // the shop, and every neutral creep is now a camp or mercenary type -- and
  // copying keeps the peasant's small footprint and inventory without dragging
  // in a creep's attacks or abilities.
  //
  // The model path is real, not guessed: an invalid path renders NOTHING, so it
  // was confirmed in game before being written down here.
  // A copy starts from the peasant as this file has already edited it, so it
  // has to stay below the peasant block.
  const unknown = objectData.units.copy(constants.units.Peasant, shared.UNKNOWN_UNIT)!;
  unknown.name = 'Unknown';
  unknown.description = 'Rolled, but not yet revealed. You will meet them when the round starts.';
  // The World Editor's "Question Mark" model preset, read out of a map saved by
  // the editor rather than guessed. The guessed path (a Doodads\Cinematic one)
  // does not exist, and an invalid model path renders NOTHING -- which looks
  // identical to a dozen more interesting explanations and cost a long hunt.
  //
  // Double backslashes matter: '\R' is not an escape sequence, so a single
  // backslash silently collapses the path to ObjectsRandomObjectRandomObject
  // and puts you straight back to rendering nothing.
  unknown.modelFile = 'Objects\\RandomObject\\RandomObject.mdl';
  // Only the inventory: it still has to show the kit it is holding, which is
  // the whole reason the lobby displays these units at all. Everything else the
  // peasant can do (build, harvest, repair) would be nonsense on a question mark.
  unknown.normal = constants.abilities.InventoryHero;
  unknown.speedBase = 0;
  unknown.attacksEnabled = '0';
  unknown.unitsTrained = '';

  // --- The final boss ------------------------------------------------------
  //
  // An Infernal, twice a hero's size and standing on a 2x2 tile footprint. Its stats are FIXED rather than scaled off a DPS measurement
  // the way creep camps are, so the numbers below are the balance dial.
  //
  // The ability is a COPY of the NEUTRAL HOSTILE Inferno (ANin), which leaves
  // the Dreadlord's AUin alone -- he is in our hero pool, so editing his
  // Inferno would rewrite a spell a player can be handed.
  //
  // The neutral hostile version specifically, and this was measured rather than
  // chosen: handing one unit each of AUin, the SNin campaign version and ANin
  // in turn, only ANin accepted an "inferno" order. The other two are hero
  // abilities, and the engine will not take their order from a unit that is not
  // a hero -- the button appears and the order is simply refused. So the
  // campaign copy the design asked for exists, but cannot be cast by a creep.
  //
  // Copying rather than editing ANin in place, for the same reason the dash is
  // a Channel copy: a fresh rawcode cannot collide with anything.
  /** Thunder Clap's mana cost, the same at all three levels. Stamped onto the
   *  copy below rather than inherited, so the add's mana pool can be defined as
   *  "exactly two casts" and stay true if the cost is ever retuned. */
  const THUNDER_CLAP_MANA = 75;

  const inferno = objectData.abilities.copy(
    constants.abilities.InfernoNeutralHostile, shared.BOSS_INFERNO_ABILITY)!;
  {
    inferno.levels = 1;
    inferno.heroAbility = false;
    inferno.cooldown = 20;
    inferno.manaCost = 200;
    // The summoned unit is NOT set here. "Data - Summoned Unit Type" is an
    // INTEGER field holding a rawcode, but the object-data library writes it as
    // a string -- which serialises cleanly, is ignored by the engine, and drops
    // a STOCK infernal instead (seen in game). boss.ts swaps the stock infernal
    // for the lesser one as it lands instead.
    inferno.name = 'Inferno';
    inferno.tooltipNormal = 'Inferno';
    inferno.tooltipNormalExtended =
      'Calls down a meteor that stuns nearby enemies and leaves a lesser infernal behind.';
  }

  // The Strange Key's throw: a COPY of Transmute, so the Alchemist's own
  // Transmute -- which can turn up on a hero in play -- is left exactly as it
  // is. The copy is what the key casts: the peasant throws, the missile flies,
  // and the Strange Rock breaks when it lands.
  const keyThrow = objectData.abilities.copy(constants.abilities.Transmute, shared.KEY_THROW_ABILITY)!;
  {
    keyThrow.levels = 1;
    keyThrow.heroAbility = false;
    keyThrow.castRange = 300;
    // Mana, cooldown and Transmute's gold payout are zeroed in forcedMods under
    // KEY_THROW_ABILITY: assigning 0 here writes nothing, because 0 is what the library
    // thinks the default is -- and the real defaults are 150 mana (a peasant
    // has none, so the key was simply refused) and a gold payout (56-64 per
    // throw, measured on the copy before it was zeroed).
    //
    // Targets: an ANCIENT STRUCTURE, which is only ever the Strange Rock. No
    // flag can name one unit type, so the rock is given a classification
    // nothing else in the map has -- Night Elf ancients are the only stock
    // ancient buildings, and there are none here. Creeps and heroes are not
    // structures; tracks, the shop, the dealer, crates and circles are not
    // ancients. Anything else gets the engine's own "invalid target" refusal,
    // cursor and message both, rather than a cast stopped after the fact.
    keyThrow.targetsAllowed = 'structure,ancient,neutral,allies,friend,vulnerable,invulnerable';
    keyThrow.name = 'Use Strange Key';
    keyThrow.tooltipNormal = 'Use Strange Key';
    keyThrow.tooltipNormalExtended = 'Throw the key at the Strange Rock to break it open.';
  }

  // Vacuum Resources (Q): a third Channel, granted by holding either Resource
  // Vacuum. No target -- it works around the caster (vacuum.ts). Every ability
  // item's spell goes on Q, so a peasant only ever has one there.
  const vacuum = objectData.abilities.copy(constants.abilities.Channel, shared.VACUUM_ABILITY) as ChannelAbility | undefined;
  if (vacuum != null) {
    vacuum.heroAbility = false;
    vacuum.levels = 1;
    // Target type (none), mana and the disabling of other abilities are forced
    // to 0 under A013: 0 is what the library thinks the default is.
    vacuum.options = 1; // visible on the command card
    // Not 0: Channel reads 0 as "channel until interrupted" (see the dash).
    vacuum.followThroughTime = 0.01;
    vacuum.castingTime = 0;
    vacuum.cooldown = shared.ABILITY_ITEM_COOLDOWN;
    // Its own order string: give/take is 'channel' and the dash 'flare', and
    // two abilities on one unit sharing an order is one of them never firing.
    vacuum.baseOrderIDundefined = 'whirlwind';
    vacuum.animationNames = 'spell';
    vacuum.caster = '';
    vacuum.target = '';
    vacuum.effect = '';
    vacuum.name = 'Vacuum Resources';
    vacuum.tooltipNormal = 'Vacuum Resources';
    vacuum.tooltipNormalExtended = 'Pull the wood and stone lying near you into one pile of each: within one tile with a Resource Vacuum, two with a Greater Resource Vacuum.|n|cffffcc00Cooldown:|r 60 seconds.';
    vacuum.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNTornado.blp';
    vacuum.hotkeyNormal = 'Q';
    vacuum.buttonPositionNormalX = 0;
    vacuum.buttonPositionNormalY = 2;
  }

  // Unholy Frenzy (Q), from the Unholy Bones: faster attacks -- which for a
  // peasant means faster chopping and mining -- for a drain on hit points. A
  // peasant is invulnerable, so the drain only bites when it is cast on a
  // hero or a mercenary. Stock duration (45s).
  type FrenzyAbility = NonNullable<ReturnType<typeof objectData.abilities.get>>
    & { attackSpeedBonusPercent: number; damagePerSecondundefined: number };
  const frenzies: [string, number, number, string][] = [
    [shared.UNHOLY_FRENZY_ABILITY, 0.5, 2, 'Unholy Frenzy'],
    [shared.GREATER_UNHOLY_FRENZY_ABILITY, 0.75, 4, 'Unholy Frenzy'],
  ];
  for (const [rawcode, attackRate, drain, name] of frenzies) {
    const frenzy = objectData.abilities.copy(constants.abilities.UnholyFrenzy, rawcode) as FrenzyAbility | undefined;
    if (frenzy == null) continue;
    frenzy.heroAbility = false;
    frenzy.levels = 1;
    frenzy.attackSpeedBonusPercent = attackRate;
    frenzy.damagePerSecondundefined = drain;
    frenzy.durationNormal = 45;
    frenzy.durationHero = 45;
    frenzy.cooldown = shared.ABILITY_ITEM_COOLDOWN;
    frenzy.castRange = 500;
    // invulnerable: peasants are, and casting it on a peasant is the point.
    frenzy.targetsAllowed = 'air,ground,friend,self,vulnerable,invulnerable,organic';
    frenzy.name = name;
    frenzy.tooltipNormal = name;
    frenzy.tooltipNormalExtended = 'Increases a friendly unit\'s attack rate by ' + String(Math.round(attackRate * 100))
      + '%, but drains ' + String(drain) + ' hit points per second. A peasant chops and mines faster. Lasts 45 seconds.|n|cffffcc00Cooldown:|r 60 seconds.';
    frenzy.hotkeyNormal = 'Q';
    frenzy.buttonPositionNormalX = 0;
    frenzy.buttonPositionNormalY = 2;
  }

  // Imbue With Horse (Q), from the Horse Essences: Wind Walk's top speed
  // (+70%), on the caster, another peasant, a hero or a mercenary. 10 seconds, 20
  // with the Greater. A copy of Bloodlust with the attack rate and the growth
  // taken out (forced above).
  type BloodlustAbility = NonNullable<ReturnType<typeof objectData.abilities.get>>
    & { movementSpeedIncreasePercentundefined: number };
  const imbues: [string, number][] = [[shared.IMBUE_HORSE_ABILITY, 10], [shared.GREATER_IMBUE_HORSE_ABILITY, 20]];
  for (const [rawcode, seconds] of imbues) {
    const imbue = objectData.abilities.copy(constants.abilities.Bloodlust, rawcode) as BloodlustAbility | undefined;
    if (imbue == null) continue;
    imbue.heroAbility = false;
    imbue.levels = 1;
    imbue.movementSpeedIncreasePercentundefined = 0.7;
    imbue.durationNormal = seconds;
    imbue.durationHero = seconds;
    imbue.cooldown = shared.ABILITY_ITEM_COOLDOWN;
    imbue.castRange = 500;
    // Self, other peasants (invulnerable), heroes and mercenaries.
    imbue.targetsAllowed = 'air,ground,friend,self,vulnerable,invulnerable,organic';
    imbue.name = 'Imbue With Horse';
    imbue.tooltipNormal = 'Imbue With Horse';
    imbue.tooltipNormalExtended = 'A friendly unit moves 70% faster for ' + String(seconds)
      + ' seconds.|n|cffffcc00Cooldown:|r 60 seconds.';
    imbue.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNRiderlessHorse.blp';
    imbue.hotkeyNormal = 'Q';
    imbue.buttonPositionNormalX = 0;
    imbue.buttonPositionNormalY = 2;
  }

  const clap = objectData.abilities.copy(constants.abilities.ThunderClap, shared.ADD_THUNDER_CLAP_ABILITY)!;
  {
    // One level, on a unit that is not a hero -- both have to be said, or the
    // button is drawn but the ability never fires.
    clap.levels = 1;
    clap.heroAbility = false;
    clap.manaCost = THUNDER_CLAP_MANA;
  }

  // The lesser infernal the boss drops: half the damage and a quarter of the
  // health of a stock one, and a mana pool of exactly two Thunder Claps. Mana
  // regeneration is zeroed so "two casts" is the whole of it rather than the
  // opening pair.
  const bossAdd = objectData.units.copy(constants.units.Infernal, shared.BOSS_ADD_UNIT)!;
  {
    bossAdd.name = 'Lesser Infernal';
    // A quarter of the stock 1500, then a fifth again on top: the adds were
    // dying too fast to matter in the balance runs.
    bossAdd.hitPointsMaximumBase = 450;
    // Stock is 48 + 1d12, averaging 54.5. Half of that is 27.5; a fifth again
    // on top rounds to 33, which is 30 + 1d6.
    bossAdd.attack1DamageBase = 30;
    bossAdd.attack1DamageNumberOfDice = 1;
    bossAdd.attack1DamageSidesPerDie = 6;
    bossAdd.manaMaximum = THUNDER_CLAP_MANA * 2;
    bossAdd.manaInitialAmount = THUNDER_CLAP_MANA * 2;
    bossAdd.manaRegeneration = 0;
    // Permanent immolation and the clap. Spell immunity and resistant skin are
    // deliberately gone: with spell immunity no hero AoE could touch the adds
    // at all, so clearing them meant attacking each one down by hand.
    bossAdd.normal = [constants.abilities.PermanentImmolationNeutralHostile1, shared.ADD_THUNDER_CLAP_ABILITY].join(',');
  }

  const boss = objectData.units.copy(constants.units.Infernal, shared.BOSS_UNIT)!;
  {
    boss.name = 'Infernal Colossus';
    boss.scalingValueundefined = UNIT_SCALE * 2;
    // Twice the peasant's 32, which is what makes a peasant fill a 128 tile --
    // so twice it is the 2x2 footprint.
    boss.collisionSize = 64;
    boss.manaMaximum = 3000;
    boss.manaInitialAmount = 3000;
    // Red rather than the stock orange-yellow, so the boss reads as its own
    // thing next to the lesser infernals it drops -- they keep the stock
    // colour. Tinting multiplies, so holding red at full and pulling the other
    // two right down turns the flames deep red without touching the model.
    boss.tintingColor1Redundefined = 255;
    boss.tintingColor2Greenundefined = 50;
    boss.tintingColor3Blueundefined = 50;
    // NOTE: the stock infernal's spell immunity (ACmi) is deliberately NOT
    // carried over. Resistant Skin stays -- it is what makes spells use their
    // shorter HERO durations on the boss -- but spell immunity would make every
    // stun, slow and nuke in the game simply miss, and a fight nobody can cast
    // into is not the fight this boss is meant to be.
    boss.normal = [
      constants.abilities.PermanentImmolationNeutralHostile1,
      constants.abilities.ResistantSkinNeutralHostile1,
      shared.BOSS_INFERNO_ABILITY,
    ].join(',');
    // Set by balance testing, not guessed. At 15000 HP and 120+1d20 the boss
    // lost to nine of ten AI-run hero compositions -- the best of them killed
    // it in 63 seconds without losing anybody -- so both numbers went up.
    // Measured hero output across those ten runs was 77-240 DPS.
    boss.hitPointsMaximumBase = 30000;
    boss.attack1DamageBase = 300;
    boss.attack1DamageNumberOfDice = 1;
    boss.attack1DamageSidesPerDie = 60;
  }

  objectData.save();
});
