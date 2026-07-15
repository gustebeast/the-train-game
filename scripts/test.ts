import {execSync, spawn} from "child_process";
import * as fs from "fs-extra";
import {loadJsonFile, logger, compileMap, IProjectConfig} from "./utils";

function main() {
  const config: IProjectConfig = loadJsonFile("config.json");
  const result = compileMap(config);

  if (!result) {
    logger.error(`Failed to compile map.`);
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const filename = `${cwd}/dist/${config.mapFolder}`;

  logger.info(`Launching map "${filename.replace(/\\/g, "/")}"...`);

  if(config.winePath) {
    const wineFilename = `"Z:${filename}"`
    const prefix = config.winePrefix ? `WINEPREFIX=${config.winePrefix}` : ''
    execSync(`${prefix} ${config.winePath} "${config.gameExecutable}" ${["-loadfile", wineFilename, ...config.launchArgs].join(' ')}`, { stdio: 'ignore' });
  } else {
    if (!fs.existsSync(config.gameExecutable)) {
      logger.error(`No such file or directory "${config.gameExecutable}". Make sure gameExecutable is configured properly in config.json.`);
      process.exitCode = 1;
      return;
    }

    // Detach so this process (and any wrapping console window) can exit
    // immediately instead of staying open for the whole game session.
    const child = spawn(config.gameExecutable, ["-loadfile", filename, ...config.launchArgs], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

main();
