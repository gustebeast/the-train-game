compiletime(({ objectData, constants }) => {
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

  const peasant = objectData.units.get(constants.units.Peasant)!;
  peasant.modelFile = 'war3mapImported\\WeaponlessPeasant.mdx';
  peasant.structuresBuilt = '';
  peasant.normal = [constants.abilities.InventoryHero, constants.abilities.Channel].join(',');
  // Normalize damage to exactly 5 so trees/rocks always take exactly 3 hits
  peasant.attack1CooldownTime = 1;
  peasant.attack1DamageBase = 4; // base + 1 = 5 (WC3 adds 1 to base)
  peasant.attack1DamageNumberOfDice = 1;
  peasant.attack1DamageSidesPerDie = 1;

  // Build track spell (BuildTinyFarm — repurposed for one-click track placement)
  const buildTrack = objectData.abilities.get(constants.abilities.BuildTinyFarm)!;
  buildTrack.tooltipNormal = 'Build track piece';
  buildTrack.tooltipNormalExtended = 'Consume a track piece item and build new rail for your train to follow.';
  buildTrack.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
  buildTrack.hotkeyNormal = 'D';

  // Give/Take spell (Channel — unit or point target)
  type ChannelAbility = NonNullable<ReturnType<typeof objectData.abilities.get>> & { targetType: number; options: number };
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
  function fixAbilityLevels(w3a: any) {
    for (const table of [w3a.originalTable, w3a.customTable]) {
      for (const obj of table.objects) {
        for (const mod of obj.modifications) {
          if (mod.levelOrVariation !== 0) continue;
          if (perLevelFields.has(mod.id)) {
            mod.levelOrVariation = 1;
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
  // Forced mods: fields whose real WC3 default differs from what the library stores
  const forcedMods: { [rawcode: string]: { id: string; variableType: number; dataPointer: number; value: number }[] } = {
    ANcl: [ // Channel
      { id: 'Ncl1', variableType: 2, dataPointer: 1, value: 0 }, // followThroughTime
      { id: 'Ncl4', variableType: 2, dataPointer: 4, value: 0 }, // artDuration
      { id: 'Ncl5', variableType: 0, dataPointer: 5, value: 0 }, // disableOtherAbilities
    ],
    ANab: [ // AcidBomb (bridge spell)
      { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 }, // manaCost
      { id: 'acdn', variableType: 2, dataPointer: 0, value: 0 }, // cooldown
      { id: 'adur', variableType: 2, dataPointer: 0, value: 0 }, // duration
      { id: 'ahdu', variableType: 2, dataPointer: 0, value: 0 }, // heroDuration
      { id: 'aare', variableType: 2, dataPointer: 0, value: 0 }, // areaOfEffect
    ],
    ANdh: [ // DrunkenHaze (water train spell)
      { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 }, // manaCost
      { id: 'acdn', variableType: 2, dataPointer: 0, value: 0 }, // cooldown
      { id: 'adur', variableType: 2, dataPointer: 0, value: 0 }, // duration
      { id: 'ahdu', variableType: 2, dataPointer: 0, value: 0 }, // heroDuration
      { id: 'aare', variableType: 2, dataPointer: 0, value: 0 }, // areaOfEffect
    ],
    AEsh: [ // ShadowStrike (fill bucket spell)
      { id: 'amcs', variableType: 0, dataPointer: 0, value: 0 }, // manaCost
      { id: 'acdn', variableType: 2, dataPointer: 0, value: 0 }, // cooldown
      { id: 'adur', variableType: 2, dataPointer: 0, value: 0 }, // duration
      { id: 'ahdu', variableType: 2, dataPointer: 0, value: 0 }, // heroDuration
      { id: 'aare', variableType: 2, dataPointer: 0, value: 0 }, // areaOfEffect
    ],
  };
  const originalSave = objectData.save.bind(objectData);
  objectData.save = () => {
    const result = originalSave();
    if (result.w3a) {
      fixAbilityLevels(result.w3a);
      for (const obj of result.w3a.originalTable.objects) {
        const mods = forcedMods[obj.oldId];
        if (mods != null) {
          for (const forced of mods) {
            if (!obj.modifications.some((m: any) => m.id === forced.id)) {
              const mod = new Modification();
              Object.assign(mod, forced, { levelOrVariation: 1, u1: 0 });
              obj.modifications.push(mod);
            }
          }
        }
      }
    }
    if (result.w3aSkin) fixAbilityLevels(result.w3aSkin);
    return result;
  };

  // Axe attachment ability (passive, shows axe model on caster's left hand)
  const axeAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus1)!;
  axeAttach.target = 'war3mapImported\\Axe.mdx';
  axeAttach.targetAttachments = 1;
  axeAttach.targetAttachmentPoint1 = 'left,hand';

  // Pickaxe attachment ability (passive, shows pickaxe model on caster's left hand)
  const pickAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus2)!;
  pickAttach.target = 'war3mapImported\\Pickaxe.mdx';
  pickAttach.targetAttachments = 1;
  pickAttach.targetAttachmentPoint1 = 'left,hand';

  // Track piece attachment ability (passive, shows track model in left hand)
  const trackAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus3)!;
  trackAttach.target = 'war3mapImported\\OmniTrackSmall.mdx';
  trackAttach.targetAttachments = 1;
  trackAttach.targetAttachmentPoint1 = 'left,hand';

  // Empty bucket attachment ability
  const bucketAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus4)!;
  bucketAttach.target = 'war3mapImported\\Bucket.mdx';
  bucketAttach.targetAttachments = 1;
  bucketAttach.targetAttachmentPoint1 = 'left,hand';

  // Full bucket attachment ability
  const bucketFullAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus5)!;
  bucketFullAttach.target = 'war3mapImported\\BucketFull.mdx';
  bucketFullAttach.targetAttachments = 1;
  bucketFullAttach.targetAttachmentPoint1 = 'left,hand';

  // Ready orb attachment ability (passive, shows orb model on caster's head)
  const readyOrbAttach = objectData.abilities.get(constants.abilities.ItemDamageBonusPlus6)!;
  readyOrbAttach.target = 'war3mapImported\\ReadyOrb.mdx';
  readyOrbAttach.targetAttachments = 1;
  readyOrbAttach.targetAttachmentPoint1 = 'head';

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

  // Bridge spell: AcidBomb repurposed as a no-mana, unit+building-targeting spell
  const bridge = objectData.abilities.get(constants.abilities.AcidBomb)!;
  bridge.heroAbility = false;
  bridge.levels = 1;
  bridge.castRange = 80;
  bridge.targetsAllowed = 'alive,allies,friend,ground,hero,invulnerable,mechanical,neutral,nonhero,notself,organic,player,structure,vulnerable';
  bridge.tooltipNormal = 'Build Bridge';
  bridge.tooltipNormalExtended = 'Consumes one wood to convert a water block into a tile you can walk and build on';
  bridge.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
  bridge.hotkeyNormal = 'D';

  // Water train spell: DrunkenHaze repurposed as a no-mana, train-targeting spell
  const waterTrain = objectData.abilities.get(constants.abilities.DrunkenHaze)!;
  waterTrain.heroAbility = false;
  waterTrain.levels = 1;
  waterTrain.castRange = 80;
  waterTrain.targetsAllowed = 'alive,allies,friend,ground,hero,invulnerable,mechanical,neutral,nonhero,notself,organic,player,structure,vulnerable';
  waterTrain.tooltipNormal = 'Water Train';
  waterTrain.tooltipNormalExtended = 'Pours water on the train to restore it to full HP.';
  waterTrain.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
  waterTrain.hotkeyNormal = 'D';

  // Fill bucket spell: ShadowStrike repurposed as a no-mana, water-targeting spell
  const fillBucket = objectData.abilities.get(constants.abilities.ShadowStrike)!;
  fillBucket.heroAbility = false;
  fillBucket.levels = 1;
  fillBucket.castRange = 80;
  fillBucket.targetsAllowed = 'alive,allies,friend,ground,hero,invulnerable,mechanical,neutral,nonhero,notself,organic,player,structure,vulnerable';
  fillBucket.tooltipNormal = 'Fill Bucket';
  fillBucket.tooltipNormalExtended = 'Fills a bucket with water from a water block.';
  fillBucket.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNHumanBuild.blp';
  fillBucket.hotkeyNormal = 'D';

  // Shop: Goblin Merchant scaled to 1x1 grid square, no default items
  const shop = objectData.units.get(constants.units.GoblinMerchant)!;
  shop.name = 'Shop';
  shop.scalingValueundefined = 0.5;
  shop.selectionScale = 1;
  shop.groundTexture = 'HSMA'; // Same texture as a human farm
  shop.pathingMap = 'PathTextures\\4x4simplesolid.tga';
  shop.collisionSize = 32;
  shop.itemsSold = [constants.items.TomeOfStrength, constants.items.TomeOfIntelligence].join(',');
  shop.itemsMade = '';
  shop.sightRadiusDay = 400;
  shop.sightRadiusNight = 400;

  // Flame Resistance upgrade (TomeOfStrength — purchased from shop)
  const flameResistance = objectData.items.get(constants.items.TomeOfStrength)!;
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

  // Track Manufacturing upgrade (TomeOfIntelligence — purchased from shop)
  const trackManufacturing = objectData.items.get(constants.items.TomeOfIntelligence)!;
  trackManufacturing.name = 'Track Manufacturing';
  trackManufacturing.tooltipBasic = trackManufacturing.name;
  trackManufacturing.description = 'Reduces train mana by 10, allowing it to convert stone and wood to tracks more quickly.';
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

  objectData.save();
});
