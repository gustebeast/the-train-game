// Launches a map straight into a game in the user's own WC3 (3.0, online),
// for checks the VMs cannot make -- chiefly HD / Definitive graphics, which
// the VMs (2.0.4, classic) never render. The lead then drives it with the
// computer-use tools: screenshots, chat commands, clicks.
//
// This takes over the user's screen while it runs, and the game only
// simulates while it is the foreground window. Only with the user's go-ahead.
//
// Usage: node scripts/host-launch.js [map.w3x]   (default: the dev build in dist/bin)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const map = path.resolve(process.argv[2] || path.join('dist', 'bin', 'TheTrainGame.w3x'));
if (!fs.existsSync(map)) throw new Error('No map at ' + map);
if (!fs.existsSync(config.gameExecutable)) throw new Error('No WC3 at ' + config.gameExecutable);

const child = spawn(config.gameExecutable, ['-loadfile', map, ...config.launchArgs], {
  detached: true,
  stdio: 'ignore',
});
child.unref();
console.log('Launched ' + map);
