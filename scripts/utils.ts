import { execSync } from "child_process";
import { writeFileSync } from "fs";
import * as fs from "fs-extra";
import * as path from "path";
import { createLogger, format, transports } from "winston";
const { combine, timestamp, printf } = format;
const luamin = require('luamin');

export interface IProjectConfig {
  mapFolder: string;
  minifyScript: boolean;
  gameExecutable: string;
  outputFolder: string;
  launchArgs: string[];
  winePath?: string;
  winePrefix?: string;
}

/**
 * Load an object from a JSON file.
 * @param fname The JSON file
 */
export function loadJsonFile(fname: string) {
  try {
    return JSON.parse(fs.readFileSync(fname).toString());
  } catch (e: any) {
    logger.error(e.toString());
    return {};
  }
}

/**
 * Convert a Buffer to ArrayBuffer
 * @param b
 */
export function toArrayBuffer(b: Buffer): ArrayBuffer {
  var ab = new ArrayBuffer(b.length);
  var view = new Uint8Array(ab);
  for (var i = 0; i < b.length; ++i) {
    view[i] = b[i];
  }
  return ab;
}

/**
 * Convert an ArrayBuffer to Buffer
 * @param ab
 */
export function toBuffer(ab: ArrayBuffer) {
  var buf = Buffer.alloc(ab.byteLength);
  var view = new Uint8Array(ab);
  for (var i = 0; i < buf.length; ++i) {
    buf[i] = view[i];
  }
  return buf;
}

/**
 * Recursively retrieve a list of files in a directory.
 * @param dir The path of the directory
 */
export function getFilesInDirectory(dir: string) {
  const files: string[] = [];
  fs.readdirSync(dir).forEach(file => {
    let fullPath = path.join(dir, file);
    if (fs.lstatSync(fullPath).isDirectory()) {
      const d = getFilesInDirectory(fullPath);
      for (const n of d) {
        files.push(n);
      }
    } else {
      files.push(fullPath);
    }
  });
  return files;
};

function updateTSConfig(mapFolder: string) {
  const tsconfig = loadJsonFile('tsconfig.json');
  const plugin = tsconfig.compilerOptions.plugins[0];

  plugin.mapDir = path.resolve('maps', mapFolder).replace(/\\/g, '/');
  plugin.entryFile = path.resolve(tsconfig.tstl.luaBundleEntry).replace(/\\/g, '/');
  plugin.outputDir = path.resolve('dist', mapFolder).replace(/\\/g, '/');

  writeFileSync('tsconfig.json', JSON.stringify(tsconfig, undefined, 2));
}

/**
 * Empty ./dist, tolerating files another process is holding open.
 *
 * `fs.removeSync('./dist')` throws EPERM when anything on the machine has a
 * file in there open -- an indexer or a sync client picking up an imported
 * asset is enough (observed repeatedly on war3mapImported/InGameLobby.mp3).
 * That failure was worse than it sounds: removeSync deletes depth-first, so by
 * the time it hit the locked file it had already removed dist/bin, and the
 * build then aborted. The visible symptom was the built map "disappearing" with
 * no build in sight, which is exactly how it was misdiagnosed for a day.
 *
 * So: retry briefly in case the holder lets go, then delete everything that CAN
 * be deleted and carry on. Leaving a locked file behind is safe -- the very
 * next step copies the map folder over the top -- and a build that completes
 * beats a build that destroys its own output and stops.
 */
function cleanDist(): void {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.removeSync("./dist");
      return;
    } catch (e) {
      if (attempt === 2) break;
      execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds 700"', { stdio: 'ignore' });
    }
  }
  // Still held. Remove what we can, and say what is stuck rather than failing.
  const stuck: string[] = [];
  const sweep = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (fs.statSync(full).isDirectory()) {
        sweep(full);
        try { fs.rmdirSync(full); } catch { stuck.push(full); }
      } else {
        try { fs.unlinkSync(full); } catch { stuck.push(full); }
      }
    }
  };
  sweep("./dist");
  logger.warn(
    `dist could not be fully cleaned -- ${stuck.length} item(s) are open in another ` +
    `process (e.g. ${stuck[0] ?? "unknown"}). Continuing; the map folder is copied over the top.`
  );
}

/**
 *
 */
export function compileMap(config: IProjectConfig) {
  if (!config.mapFolder) {
    logger.error(`Could not find key "mapFolder" in config.json`);
    return false;
  }

  logger.info("Cleaning dist directory...");
  cleanDist();

  logger.info(`Building "${config.mapFolder}"...`);
  // overwrite:false because cleanDist has just removed everything it was
  // allowed to. Whatever survived is a file some other process is holding open,
  // and it was copied from this same source folder on an earlier build, so the
  // copy already on disk is the one we would be writing. Overwriting it throws
  // EBUSY and kills the build; skipping it costs nothing.
  //
  // The gap this leaves is narrow and worth knowing: if an asset changed in
  // source WHILE a process held the old copy open, dist keeps the stale one.
  // The warning from cleanDist names the file when that can happen.
  fs.copySync(`./maps/${config.mapFolder}`, `./dist/${config.mapFolder}`, { overwrite: false });

  // Lock race selection in the dist copy without touching the source file
  const distMapLua = `./dist/${config.mapFolder}/war3map.lua`;
  if (fs.existsSync(distMapLua)) {
    const lua = fs.readFileSync(distMapLua).toString();
    fs.writeFileSync(distMapLua, lua.replace(/SetPlayerRaceSelectable\(([^,]+),\s*true\)/g, 'SetPlayerRaceSelectable($1, false)'));
  }

  logger.info("Modifying tsconfig.json to work with war3-transformer...");
  updateTSConfig(config.mapFolder);

  logger.info("Transpiling TypeScript to Lua...");
  execSync('tstl -p tsconfig.json', { stdio: 'inherit' });

  const tsLua = "./dist/tstl_output.lua";
  if (!fs.existsSync(tsLua)) {
    logger.error(`Could not find "${tsLua}"`);
    return false;
  }

  // Merge the TSTL output with war3map.lua
  const mapLua = `./dist/${config.mapFolder}/war3map.lua`;

  if (!fs.existsSync(mapLua)) {
    logger.error(`Could not find "${mapLua}"`);
    return false;
  }

  try {
    let contents = fs.readFileSync(mapLua).toString() + fs.readFileSync(tsLua).toString();

    if (config.minifyScript) {
      logger.info(`Minifying script...`);
      contents = luamin.minify(contents.toString());
    }

    fs.writeFileSync(mapLua, contents);
  } catch (err: any) {
    logger.error(err.toString());
    return false;
  }

  return true;
}

/**
 * Formatter for log messages.
 */
const loggerFormatFunc = printf(({ level, message, timestamp }) => {
  return `[${(timestamp as string).replace("T", " ").split(".")[0]}] ${level}: ${message}`;
});

/**
 * The logger object.
 */
export const logger = createLogger({
  transports: [
    new transports.Console({
      format: combine(
        format.colorize(),
        timestamp(),
        loggerFormatFunc
      ),
    }),
    new transports.File({
      filename: "project.log",
      format: combine(
        timestamp(),
        loggerFormatFunc
      ),
    }),
  ]
});
