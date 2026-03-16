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
    track.defenseType = 'normal';
    track.defenseBase = 0;
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
  train.speedMaximum = 10;
  train.manaMaximum = 100;
  train.manaInitialAmount = 0;
  train.manaRegeneration = 0;

  const peasant = objectData.units.get(constants.units.Peasant)!;
  peasant.structuresBuilt = '';
  peasant.normal = [constants.abilities.InventoryHero, constants.abilities.BuildTinyFarm, constants.abilities.HarvestGhoulsLumber, constants.abilities.Channel].join(',');
  // Normalize damage to exactly 5 so trees/rocks always take exactly 3 hits
  peasant.attack1CooldownTime = 1;
  peasant.attack1DamageBase = 4; // base + 1 = 5 (WC3 adds 1 to base)
  peasant.attack1DamageNumberOfDice = 1;
  peasant.attack1DamageSidesPerDie = 1;

  // Give/Place spell (Channel — unit or point target)
  type ChannelAbility = NonNullable<ReturnType<typeof objectData.abilities.get>> & { targetType: number; options: number };
  const give = objectData.abilities.get(constants.abilities.Channel)! as ChannelAbility;
  give.heroAbility = false;
  give.levels = 1;
  give.targetType = 3;
  give.options = 1;
  give.targetsAllowed = 'alive,allies,friend,ground,hero,invulnerable,item,mechanical,neutral,nonhero,notself,organic,player,structure,vulnerable';
  give.castRange = 80;
  give.iconNormal = 'ReplaceableTextures\\CommandButtons\\BTNLoad.blp';
  give.caster = '';
  give.target = '';
  give.effect = '';
  give.tooltipNormal = 'Give/Take Item';
  give.tooltipNormalExtended = 'When holding an item, can be used to drop it on the ground or give it to a building/unit. When not holding an item, can be used to pick up an item on the ground or pull from a building. When pulling items from buildings, tracks will be pulled first, then wood, then stone.';
  give.hotkeyNormal = 'W';

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
            const match = mod.id.match(/^[A-Za-z]{3}(\d)$/);
            if (match) {
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
  const forcedChannelMods = [
    { id: 'Ncl1', variableType: 2, dataPointer: 1, value: 0 }, // followThroughTime
    { id: 'Ncl4', variableType: 2, dataPointer: 4, value: 0 }, // artDuration
    { id: 'Ncl5', variableType: 0, dataPointer: 5, value: 0 }, // disableOtherAbilities
  ];
  const originalSave = objectData.save.bind(objectData);
  objectData.save = () => {
    const result = originalSave();
    if (result.w3a) {
      fixAbilityLevels(result.w3a);
      for (const obj of result.w3a.originalTable.objects) {
        if (obj.oldId === 'ANcl') {
          for (const forced of forcedChannelMods) {
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

  // Axe item
  const axe = objectData.items.get(constants.items.SturdyWarAxe)!;
  axe.name = 'Axe';
  axe.description = 'Allows chopping trees.';
  axe.goldCost = 0;
  axe.canBeDropped = true;
  axe.droppedWhenCarrierDies = true;
  axe.perishable = false;
  axe.canBeSoldToMerchants = false;
  axe.abilities = '';

  // Pickaxe item
  const pickaxe = objectData.items.get(constants.items.RustyMiningPick)!;
  pickaxe.name = 'Pickaxe';
  pickaxe.description = 'Allows mining rocks.';
  pickaxe.goldCost = 0;
  pickaxe.canBeDropped = true;
  pickaxe.droppedWhenCarrierDies = true;
  pickaxe.perishable = false;
  pickaxe.canBeSoldToMerchants = false;
  pickaxe.abilities = '';

  // Wood resource item (IronwoodBranch — normal holdable item)
  const wood = objectData.items.get(constants.items.IronwoodBranch)!;
  wood.name = 'Wood';
  wood.description = 'A bundle of wood harvested from trees.';
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
  stone.description = 'A chunk of stone mined from rocks.';
  stone.classification = 'Charged';
  stone.goldCost = 0;
  stone.canBeDropped = true;
  stone.droppedWhenCarrierDies = true;
  stone.perishable = false;
  stone.useAutomaticallyWhenAcquired = false;
  stone.canBeSoldToMerchants = false;
  stone.abilities = '';
  stone.numberOfCharges = 1;
  stone.interfaceIcon = 'ReplaceableTextures\\CommandButtons\\BTNStoneForm.blp';
  stone.modelUsed = 'Doodads\\LordaeronSummer\\Rocks\\Lords_Rock\\Lords_Rock6.mdx';
  stone.scalingValue = 0.4;

  // Tree destructables (SummerTreeWall / LTlt)
  const tree = objectData.destructables.get(constants.destructables.SummerTreeWall)!;
  tree.hitPoints = 3;
  tree.selectableInGame = false;

  // Rock destructables (RockChunks2 / LTrt — 6 variations, same model as granite)
  const rock = objectData.destructables.get(constants.destructables.RockChunks2)!;
  rock.hitPoints = 15;
  rock.selectableInGame = false;

  // Water: Burrow repurposed with WaterPlane model, targetable by spells, no shadow
  const water = objectData.units.get(constants.units.Burrow)!;
  water.name = 'Water';
  water.modelFile = 'war3mapImported\\WaterPlane.mdx';
  water.hitPointsMaximumBase = 999999;
  water.defenseBase = 99;
  water.pathingMap = 'PathTextures\\4x4simplesolid.tga';
  water.shadowTextureBuilding = 'NONE';
  water.groundTexture = 'NONE';
  water.scalingValueundefined = 1;
  water.collisionSize = 32;
  water.hideMinimapDisplay = true;

  // Storage crate: GrainWarehouse shrunk to 4x4 with crate model and inventory
  const crate = objectData.units.get(constants.units.GrainWarehouse)!;
  crate.name = 'Storage Crate';
  crate.modelFile = 'Buildings\\Other\\CratesUnit\\CratesUnit';
  crate.pathingMap = 'PathTextures\\4x4simplesolid.tga';
  crate.collisionSize = 32;
  crate.selectionScale = 2;
  crate.scalingValueundefined = 1;
  crate.shadowTextureBuilding = 'ShadowCrates';
  crate.normal = constants.abilities.InventoryHero;
  crate.hitPointsMaximumBase = 999999;
  crate.defenseBase = 99;

  // Track piece item (MechanicalCritter — placeholder for track building)
  const trackPiece = objectData.items.get(constants.items.MechanicalCritter)!;
  trackPiece.name = 'Track Piece';
  trackPiece.description = 'A section of railway track, ready to be placed.';
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

  // Granite rocks: dark tint, unselectable, indestructible
  const granite = objectData.destructables.get(constants.destructables.RockChunks1)!;
  granite.tintingColor1Red = 80;
  granite.tintingColor2Green = 80;
  granite.tintingColor3Blue = 80;
  granite.selectableInGame = false;
  granite.hitPoints = 999999;

  objectData.save();
});
