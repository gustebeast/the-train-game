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

  // Tree units: 6 variations using different building bases as skins
  const treeTypes: { [key: string]: string } = {
    '0': constants.units.ColdTower,
    '1': constants.units.DeathTower,
    '2': constants.units.EnergyTower,
    '3': constants.units.FlameTower,
    '4': constants.units.DalaranGuardTower,
    '5': constants.units.HighElvenGuardTower,
  };

  for (const [variation, unitName] of Object.entries(treeTypes)) {
    const treeUnit = objectData.units.get(unitName)!;
    treeUnit.name = 'Tree';
    treeUnit.modelFile = `war3mapImported\\Tree${variation}.mdx`;
    treeUnit.hitPointsMaximumBase = 15;
    treeUnit.defenseType = 'normal';
    treeUnit.defenseBase = 0;
    treeUnit.pathingMap = 'PathTextures\\4x4simplesolid.tga';
    treeUnit.shadowTextureBuilding = 'ShadowCannonTower';
    treeUnit.groundTexture = 'NONE';
    treeUnit.scalingValueundefined = 0.8;
    treeUnit.selectionScale = -1;
    treeUnit.buildTime = 0;
    treeUnit.tintingColor1Redundefined = 255;
    treeUnit.tintingColor2Greenundefined = 255;
    treeUnit.tintingColor3Blueundefined = 255;
    treeUnit.hideMinimapDisplay = true;
  }

  // Rock units: 6 variations using Advanced tower bases
  const rockTypes: { [key: string]: string } = {
    '0': constants.units.AdvancedBoulderTower,
    '1': constants.units.AdvancedColdTower,
    '2': constants.units.AdvancedDeathTower,
    '3': constants.units.AdvancedEnergyTower,
    '4': constants.units.AdvancedFlameTower,
    '5': constants.units.EarthFuryTower,
  };

  // Per-variation scales to normalize rock models to ~128-unit footprint
  const rockScales: { [key: string]: number } = {
    '0': 0.610, '1': 0.556, '2': 0.628,
    '3': 0.621, '4': 0.611, '5': 0.748,
  };

  for (const [variation, unitName] of Object.entries(rockTypes)) {
    const rockUnit = objectData.units.get(unitName)!;
    rockUnit.name = 'Rock';
    rockUnit.modelFile = `Doodads\\LordaeronSummer\\Rocks\\Lords_Rock\\Lords_Rock${variation}.mdx`;
    rockUnit.hitPointsMaximumBase = 15;
    rockUnit.defenseType = 'normal';
    rockUnit.defenseBase = 0;
    rockUnit.pathingMap = 'PathTextures\\4x4simplesolid.tga';
    rockUnit.shadowTextureBuilding = 'ShadowCannonTower';
    rockUnit.groundTexture = 'NONE';
    rockUnit.scalingValueundefined = rockScales[variation];
    rockUnit.selectionScale = -1;
    rockUnit.buildTime = 0;
    rockUnit.tintingColor1Redundefined = 255;
    rockUnit.tintingColor2Greenundefined = 255;
    rockUnit.tintingColor3Blueundefined = 255;
    rockUnit.hideMinimapDisplay = true;
  }

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
