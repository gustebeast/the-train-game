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
    unit.defenseBase = -10;
    unit.description = 'A section of railway track.';
    unit.hitPointsMaximumBase = 5;
    unit.name = 'Railway Track';
    unit.modelFile = `war3mapImported\\${orientation}Track.mdx`;
    unit.scalingValueundefined = 1;
    unit.shadowTextureBuilding = 'NONE';
    unit.groundTexture = 'NONE';
    unit.pathingMap = `PathTextures\\${
      orientation == 'Omni' ? '4x4simplesolid' : '4x4unbuildable'
    }.tga`;
  }

  const warWagon = objectData.units.get(constants.units.WarWagon)!;
  warWagon.scalingValueundefined = 0.6;
  warWagon.selectionScale = 1;
  warWagon.modelFile = 'war3mapImported\\WarWagon.mdx';

  const peasant = objectData.units.get(constants.units.Peasant)!;
  peasant.structuresBuilt = [
    constants.units.Farm,
  ].join(',');

  objectData.save();
});
