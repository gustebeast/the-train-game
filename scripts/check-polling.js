// Fails the build on polling nobody has justified.
//
// The map reacts to events: a trigger on the engine event, or a listener on
// one of our own signals (on*/note* -- see "Events, not polling" in
// SUBAGENT_README.md). A repeating timer that checks whether something has
// changed is polling, and it was the map's single biggest source of bugs:
// the check runs late, runs during the wrong phase, misses a change that
// came and went between two ticks, and costs every tick for the whole game.
// A lot of work went into moving systems off it, and this keeps it off.
//
// Some things really are periodic -- a countdown, damage over time, a rate
// measured over a window, a setting the engine lets players drift away from
// with no event to say so. Those are allowed, but each one must say why with
// a `// periodic: <reason>` comment on the line itself or one of the three
// lines above. Tests (src/tests/) are exempt.
//
// Usage: node scripts/check-polling.js [root]   (also run by `npm run build`)
const fs = require('fs');
const path = require('path');

/** Calls that make something run again and again on a clock. */
const PERIODIC = [
  /\.start\(\s*[^,]+,\s*true\b/,               // w3ts Timer.start(t, true, ...)
  /\bTimerStart\([^,]+,[^,]+,\s*true\b/,       // native TimerStart(t, s, true, ...)
  /\bTriggerRegisterTimerEvent(Periodic)?\(/,  // periodic trigger events
  /\.registerTimerEvent\(/,
  /\bonGlobalTick\(/,                          // the shared half-second tick
];
const MARKER = /\/\/\s*periodic:\s*\S/;
const LOOKBACK = 3;

function tsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests') out.push(...tsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every periodic call in src/ without a `// periodic:` reason, as
 *  "file:line: text". */
function findUnjustifiedPolling(root) {
  const problems = [];
  for (const file of tsFiles(path.join(root, 'src'))) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*(\*|\/\*)/.test(line) || /^\s*export function onGlobalTick\(/.test(line)) return;
      if (!PERIODIC.some(re => re.test(code))) return;
      for (let j = Math.max(0, i - LOOKBACK); j <= i; j++) {
        if (MARKER.test(lines[j])) return;
      }
      problems.push(path.relative(root, file).replace(/\\/g, '/') + ':' + (i + 1) + ': ' + line.trim());
    });
  }
  return problems;
}

module.exports = { findUnjustifiedPolling };

if (require.main === module) {
  const problems = findUnjustifiedPolling(process.argv[2] || process.cwd());
  if (problems.length > 0) {
    console.error('Polling without a reason. Use an event, or say why it must be periodic');
    console.error('with a `// periodic: <reason>` comment (SUBAGENT_README.md, "Events, not polling"):');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log('No unjustified polling.');
}
