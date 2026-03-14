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
    const unit = objectData.units.get(unitName)!;
    unit.buildTime = 0;
    unit.defenseType = 'normal';
    unit.defenseBase = 0;
    unit.description = 'A section of railway track.';
    unit.hitPointsMaximumBase = 5;
    unit.name = 'Railway Track';
    unit.modelFile = `war3mapImported\\${orientation}Track.mdx`;
    unit.scalingValueundefined = 1;
    unit.shadowTextureBuilding = 'NONE';
    unit.groundTexture = 'NONE';
    unit.sightRadiusDay = 400;
    unit.sightRadiusNight = 400;
    unit.pathingMap = `PathTextures\\${
      orientation == 'Omni' ? '4x4simplesolid' : '4x4unbuildable'
    }.tga`;
  }

  const warWagon = objectData.units.get(constants.units.WarWagon)!;
  warWagon.scalingValueundefined = 0.6;
  warWagon.selectionScale = 1;
  warWagon.modelFile = 'war3mapImported\\WarWagon.mdx';
  warWagon.speedMaximum = 10;
  warWagon.sightRadiusDay = 400;
  warWagon.sightRadiusNight = 400;
  warWagon.collisionSize = 16;

  const peasant = objectData.units.get(constants.units.Peasant)!;
  peasant.structuresBuilt = [
    constants.units.Farm,
  ].join(',');
  peasant.normal = [constants.abilities.InventoryHero, constants.abilities.BuildHuman].join(',');
  // Normalize damage to exactly 5 so trees/rocks always take exactly 3 hits
  peasant.attack1CooldownTime = 1;
  peasant.attack1DamageBase = 4; // base + 1 = 5 (WC3 adds 1 to base)
  peasant.attack1DamageNumberOfDice = 1;
  peasant.attack1DamageSidesPerDie = 1;

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

  // Tree destructables (SummerTreeWall / LTlt)
  const tree = objectData.destructables.get(constants.destructables.SummerTreeWall)!;
  tree.hitPoints = 15;
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

  // Granite rocks: dark tint, unselectable, indestructible
  const granite = objectData.destructables.get(constants.destructables.RockChunks1)!;
  granite.tintingColor1Red = 80;
  granite.tintingColor2Green = 80;
  granite.tintingColor3Blue = 80;
  granite.selectableInGame = false;
  granite.hitPoints = 999999;

  objectData.save();
});
