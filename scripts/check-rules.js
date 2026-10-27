// Source rules the build enforces, each one a mistake the map has already made
// and paid for. Every rule flags a call in src/ (tests exempt) unless a marker
// comment on the same line, or one of the three lines above, says why it is
// fine here. The reason is for the reviewer: "it was easier" is not one.
//
// - Polling (`// periodic: <reason>`). The map reacts to events: a trigger on
//   the engine event, or a listener on one of our own signals (on*/note* --
//   see "Events, not polling" in SUBAGENT_README.md). A repeating timer that
//   checks whether something has changed is polling, and it was the map's
//   single biggest source of bugs: the check runs late, runs during the wrong
//   phase, misses a change that came and went between two ticks, and costs
//   every tick for the whole game. Some things really are periodic -- a
//   countdown, damage over time, a camera the engine lets drift -- and say so.
//
// - Untracked timers (`// untracked: <reason>`). A timer from timers.ts
//   (createTimer, startOneShot) is destroyed when the board is torn down. A
//   raw Timer.create() is not, so a round's pending work fires into the next
//   board -- a boss add dropping into the lobby. Raw timers are right when
//   something else owns them, or when they must fire whatever happens.
//
// Usage: node scripts/check-rules.js [root]   (also run by `npm run build`)
const fs = require('fs');
const path = require('path');

const LOOKBACK = 3;

const RULES = [
  {
    name: 'Polling without a reason',
    fix: 'use an event, or say why it must be periodic',
    marker: /\/\/\s*periodic:\s*\S/,
    calls: [
      /\.start\(\s*[^,]+,\s*true\b/,               // w3ts Timer.start(t, true, ...)
      /\bTimerStart\([^,]+,[^,]+,\s*true\b/,       // native TimerStart(t, s, true, ...)
      /\bTriggerRegisterTimerEvent(Periodic)?\(/,  // periodic trigger events
      /\.registerTimerEvent\(/,
      /\bonGlobalTick\(/,                          // the shared half-second tick
    ],
    skip: line => /^\s*export function onGlobalTick\(/.test(line),
  },
  {
    name: 'Timer the board teardown will not destroy',
    fix: 'use createTimer/startOneShot (timers.ts), or say why it must outlive the board',
    marker: /\/\/\s*untracked:\s*\S/,
    calls: [/\bTimer\.create\(\)/, /\bCreateTimer\(\)/],
    skip: (line, file) => file.endsWith(path.join('src', 'timers.ts')),
  },
];

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

/** Every rule broken in src/, as "<rule> (<fix>): file:line: text". */
function findRuleViolations(root) {
  const problems = [];
  for (const file of tsFiles(path.join(root, 'src'))) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\s*(\*|\/\*)/.test(line)) return;
      const code = line.replace(/\/\/.*$/, '');
      for (const rule of RULES) {
        if (rule.skip(line, file)) continue;
        if (!rule.calls.some(re => re.test(code))) continue;
        let marked = false;
        for (let j = Math.max(0, i - LOOKBACK); j <= i; j++) {
          if (rule.marker.test(lines[j])) marked = true;
        }
        if (!marked) {
          problems.push(rule.name + ' (' + rule.fix + '): '
            + path.relative(root, file).replace(/\\/g, '/') + ':' + (i + 1) + ': ' + line.trim());
        }
      }
    });
  }
  return problems;
}

module.exports = { findRuleViolations };

if (require.main === module) {
  const problems = findRuleViolations(process.argv[2] || process.cwd());
  if (problems.length > 0) {
    console.error('Source rules broken (see scripts/check-rules.js):');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log('Source rules hold.');
}
