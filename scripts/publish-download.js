// Puts the current main into the user's WC3 Download folder: the ordinary dev
// build, chat cheats and -test commands included, because that is the map the
// user tests with. (A map for hosting real players is `npm run build:release`,
// built on request.)
//
// The lead runs this after every commit to main (LEAD_README.md, step 2).
// Usage: npm run publish:download
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEST = 'C:\\Users\\gus\\Documents\\Warcraft III\\Maps\\Download\\TheTrainGame.w3x';
const BUILT = path.join('dist', 'bin', 'TheTrainGame.w3x');

const head = execSync('git rev-parse --short HEAD').toString().trim();
// Fail loudly rather than copy whatever map is lying in dist from earlier.
if (fs.existsSync(BUILT)) fs.unlinkSync(BUILT);
execSync('npm run build', { stdio: 'inherit' });
if (!fs.existsSync(BUILT)) throw new Error('build produced no ' + BUILT);
fs.copyFileSync(BUILT, DEST);
console.log('Dev map for ' + head + ' written to ' + DEST);
