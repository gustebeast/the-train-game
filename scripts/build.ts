import * as fs from "fs-extra";
import * as path from "path";
import War3Map from "mdx-m3-viewer-th/dist/cjs/parsers/w3x/map"
import { compileMap, getFilesInDirectory, loadJsonFile, logger, toArrayBuffer, IProjectConfig } from "./utils";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { findRuleViolations } = require("./check-rules.js");

function main() {
  // The source rules hold before anything is built (check-rules.js).
  const broken: string[] = findRuleViolations(process.cwd());
  if (broken.length > 0) {
    logger.error(`Source rules broken (see scripts/check-rules.js and SUBAGENT_README.md, "Events, not polling"):`);
    for (const p of broken) logger.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  const config: IProjectConfig = loadJsonFile("config.json");
  const args = process.argv.slice(2);
  const minify = args.includes('-minify') || config.minifyScript

  // A release map leaves out the cheats and the test runner (src/buildFlags.ts).
  if (args.includes('-release')) {
    process.env.TRAIN_RELEASE = '1';
    logger.info('Release build: no cheats, no test runner.');
  }

  if(minify !== config.minifyScript){
    logger.warn(`minifyScript has been overridden by command line argument "-minify"`)
    config.minifyScript = minify
  }


  const result = compileMap(config);

  if (!result) {
    logger.error(`Failed to compile map.`);
    process.exitCode = 1;
    return;
  }

  logger.info(`Creating w3x archive...`);
  if (!fs.existsSync(config.outputFolder)) {
    fs.mkdirSync(config.outputFolder);
  }

  createMapFromDir(`${config.outputFolder}/${config.mapFolder}`, `./dist/${config.mapFolder}`);
}

/**
 * Creates a w3x archive from a directory
 * @param output The output filename
 * @param dir The directory to create the archive from
 */
export function createMapFromDir(output: string, dir: string) {
  const map = new War3Map();
  const files = getFilesInDirectory(dir);

  map.archive.resizeHashtable(files.length);

  for (const fileName of files) {
    const contents = toArrayBuffer(fs.readFileSync(fileName));
    const archivePath = path.relative(dir, fileName);
    const imported = map.import(archivePath, contents);

    if (!imported) {
      logger.warn("Failed to import " + archivePath);
      continue;
    }
  }

  // The archive itself, not map.save(): that also parses war3map.w3i, only to
  // decide whether to prepend a pre-1.31 map header, and its parser cannot
  // read the w3i the current World Editor writes (format 39). This map is
  // never pre-1.31, so the header is never wanted.
  map.setImportsFile();
  const result = map.archive.save();

  if (!result) {
    logger.error("Failed to save archive.");
    return;
  }

  fs.writeFileSync(output, new Uint8Array(result));

  logger.info("Finished!");
}

main();