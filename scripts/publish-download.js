// Publishes the current main: builds it, copies it into the user's WC3
// Download folder, and uploads it to the single "beta" GitHub release as
// TheTrainGameBETA.w3x.
//
// It is the ordinary dev build, chat cheats and -test commands included,
// because that is the map the user tests with. (A map for hosting real
// players is `npm run build:release`, built on request.)
//
// One release, updated in place, never a new one per build: the "beta" tag is
// moved to HEAD, the release notes name the commit, and the asset is replaced
// (--clobber). The lead runs this after every commit to main (LEAD_README.md,
// step 2), after pushing, so the commit the tag points at is on GitHub.
//
// Needs the GitHub CLI signed in (`gh auth login`, once). Fails loudly rather
// than skipping the upload when it is not.
//
// Usage: npm run publish:download
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEST = 'C:\\Users\\gus\\Documents\\Warcraft III\\Maps\\Download\\TheTrainGame.w3x';
const BUILT = path.join('dist', 'bin', 'TheTrainGame.w3x');
const TAG = 'beta';
const ASSET = path.join('dist', 'TheTrainGameBETA.w3x');
const GH_DEFAULT = 'C:\\Program Files\\GitHub CLI\\gh.exe';
const gh = fs.existsSync(GH_DEFAULT) ? GH_DEFAULT : 'gh';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}
function runGh(...args) {
  return execFileSync(gh, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const head = git('rev-parse', 'HEAD');
const short = head.slice(0, 7);
const subject = git('log', '-1', '--format=%s');
if (git('status', '--porcelain', '--untracked-files=no', '--', 'src', 'scripts', 'maps') !== '') {
  throw new Error('src/, scripts/ or maps/ has uncommitted changes; publish only committed code');
}
const remoteHead = git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0];
if (remoteHead !== head) {
  throw new Error(`HEAD ${short} is not origin/main (${remoteHead.slice(0, 7)}); push before publishing`);
}

// Fail loudly rather than copy whatever map is lying in dist from earlier.
if (fs.existsSync(BUILT)) fs.unlinkSync(BUILT);
execSync('npm run build', { stdio: 'inherit' });
if (!fs.existsSync(BUILT)) throw new Error('build produced no ' + BUILT);

fs.copyFileSync(BUILT, DEST);
console.log('Dev map for ' + short + ' written to ' + DEST);

// --- the beta release --------------------------------------------------------
try {
  runGh('auth', 'status');
} catch (e) {
  throw new Error('GitHub CLI is not signed in; run `gh auth login` once. (' + (e.stderr || e.message).trim() + ')');
}
fs.copyFileSync(BUILT, ASSET);
// The tag follows main: the release always describes the commit it was built from.
git('tag', '-f', TAG, head);
execFileSync('git', ['push', '-f', 'origin', `refs/tags/${TAG}`], { stdio: 'inherit' });
const notes = 'The latest build of main, replaced on every merge (dev build: chat cheats and '
  + '`-test` commands included).\n\n'
  + `Built from ${short}: ${subject}\n`;
let exists = true;
try { runGh('release', 'view', TAG); } catch { exists = false; }
if (exists) {
  runGh('release', 'edit', TAG, '--notes', notes, '--prerelease');
} else {
  runGh('release', 'create', TAG, '--title', 'Beta (latest main)', '--notes', notes, '--prerelease');
}
runGh('release', 'upload', TAG, ASSET, '--clobber');
console.log(`Uploaded ${path.basename(ASSET)} for ${short} to the "${TAG}" release`);
