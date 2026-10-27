// Puts the current main into the user's WC3 Download folder, as the map they
// host: a RELEASE build (no chat cheats, no -test runner; see buildFlags.ts).
// Then rebuilds the dev map, so dist/ is back to what the VM runs expect.
//
// The lead runs this after every commit to main (LEAD_README.md, step 2).
// Usage: npm run publish:download
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEST = 'C:\\Users\\gus\\Documents\\Warcraft III\\Maps\\Download\\TheTrainGame.w3x';
const BUILT = path.join('dist', 'bin', 'TheTrainGame.w3x');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

const head = execSync('git rev-parse --short HEAD').toString().trim();
// Fail loudly rather than copy whatever map is lying in dist from earlier.
if (fs.existsSync(BUILT)) fs.unlinkSync(BUILT);
run('npm run build:release');
if (!fs.existsSync(BUILT)) throw new Error('release build produced no ' + BUILT);
fs.copyFileSync(BUILT, DEST);
console.log('Release map for ' + head + ' written to ' + DEST);
run('npm run build');
