// Writes the map in formats the WC3 2.0.4 client reads, whatever editor saved it.
//
// Why: the test VMs run WC3 2.0.4 offline. WC3 3.0 (Sep 2026) is always-online
// -- it dropped offline and LAN play -- so the VMs cannot move to it without
// going online, which they must never do. But the World Editor that ships with
// 3.0 saves in newer formats that 2.0.4 does not list at all. A newer client
// still reads the older formats, so one map written this way loads everywhere:
// the players' 3.0 and the VMs' 2.0.4.
//
// What changes between them, found by diffing the same map saved by both
// editors (and nothing else is touched):
//
// - war3map.w3i, format 39 -> 33. 39 is 33 with four additions, all dropped:
//     an int after the loading-screen index (128 in practice);
//     24 bytes of height fog after the weather id;
//     40 bytes of HD water parameters before the player count;
//     an int per player after its race: the race skin (64 =
//     RACE_PREF_USER_SELECTABLE).
//   Everything after the players (forces, upgrades, tech, random tables) is
//   identical. The version stamps are set back to a 2.0.4 save's.
// - war3map.doo, version 13 -> 8. Only an EMPTY one is converted -- the map
//   places no doodads in the editor (spawn.ts builds the board's wall by
//   script). One with doodads in it fails the build, loudly, rather than
//   being guessed at.
// - war3map.lua: the 3.0 editor's script calls SetPlayerRaceSkin and
//   SetHDWaterParamsEx, which 2.0.4 does not have. They are stubbed as no-ops
//   only where the client lacks them, so 3.0 still runs them.
//
// Files only the editor reads (war3mapUnits.doo, war3map.w3c, war3map.w3r,
// war3map.w3grp, war3map.w3l) are left as they are: the game builds units,
// cameras and regions from war3map.lua.
const fs = require('fs');
const path = require('path');

/** A 2.0.4 World Editor's stamps, from the last map that editor saved. */
const LEGACY = { w3i: 33, editorVersion: 6117, game: [2, 0, 4, 23745], doo: 8 };

class Reader {
  constructor(buf) { this.buf = buf; this.at = 0; }
  bytes(n) { const b = this.buf.subarray(this.at, this.at + n); this.at += n; return b; }
  int() { const v = this.buf.readInt32LE(this.at); this.at += 4; return v; }
  /** A NUL-terminated string, terminator included. */
  str() {
    const end = this.buf.indexOf(0, this.at);
    if (end < 0) throw new Error('w3i: unterminated string at ' + this.at);
    return this.bytes(end - this.at + 1);
  }
}

function int32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; }

/** war3map.w3i in format 33, from 33 (returned as is) or 39. */
function downgradeW3i(buf) {
  const r = new Reader(buf);
  const version = r.int();
  if (version === LEGACY.w3i) return buf;
  if (version !== 39) throw new Error(`war3map.w3i is format ${version}; only 33 and 39 are known`);
  const out = [];
  const keep = (b) => out.push(b);
  keep(int32(LEGACY.w3i));
  keep(r.bytes(4));                      // save count
  r.int(); keep(int32(LEGACY.editorVersion));
  for (let i = 0; i < 4; i++) { r.int(); keep(int32(LEGACY.game[i])); }
  for (let i = 0; i < 4; i++) keep(r.str()); // name, author, description, players
  keep(r.bytes(8 * 4));                  // camera bounds
  keep(r.bytes(4 * 4));                  // camera bound complements
  keep(r.bytes(4 + 4));                  // playable width, height
  keep(r.bytes(4));                      // flags
  keep(r.bytes(1));                      // main ground type
  keep(r.bytes(4));                      // loading screen index
  r.bytes(4);                            // 39 only
  for (let i = 0; i < 4; i++) keep(r.str()); // loading screen model, text, title, subtitle
  keep(r.bytes(4));                      // game data set
  for (let i = 0; i < 4; i++) keep(r.str()); // prologue path, text, title, subtitle
  keep(r.bytes(4 + 4 + 4 + 4 + 4));      // fog type, start, end, density, colour
  keep(r.bytes(4));                      // weather id
  r.bytes(24);                           // 39 only: height fog
  keep(r.str());                         // sound environment
  keep(r.bytes(1));                      // light environment
  keep(r.bytes(4));                      // water tint
  keep(r.bytes(4 + 4 + 4));              // script language, supported modes, game data version
  keep(r.bytes(3 * 4));                  // camera distances
  r.bytes(40);                           // 39 only: HD water parameters
  const players = r.int(); keep(int32(players));
  for (let p = 0; p < players; p++) {
    keep(r.bytes(4 + 4 + 4));            // number, controller, race
    r.bytes(4);                          // 39 only: race skin
    keep(r.bytes(4));                    // fixed start location
    keep(r.str());                       // name
    keep(r.bytes(4 + 4));                // start x, y
    keep(r.bytes(4 * 4));                // ally low/high, enemy low/high priority flags
  }
  keep(buf.subarray(r.at));              // forces onward: unchanged
  return Buffer.concat(out);
}

/** war3map.doo at version 8, from 8 (returned as is) or an empty 13. */
function downgradeDoo(buf) {
  if (buf.toString('latin1', 0, 4) !== 'W3do') throw new Error('war3map.doo: bad magic');
  const version = buf.readInt32LE(4);
  if (version === LEGACY.doo) return buf;
  if (version !== 13) throw new Error(`war3map.doo is version ${version}; only 8 and 13 are known`);
  const doodads = buf.readInt32LE(12);
  if (doodads !== 0) {
    throw new Error(`war3map.doo holds ${doodads} editor-placed doodad(s), and only an empty version-13 file `
      + 'can be written for WC3 2.0.4 (scripts/legacy-format.js). Place them by script instead, '
      + 'as spawn.ts does for the board wall, or teach the converter the record layout.');
  }
  const out = Buffer.from(buf);
  out.writeInt32LE(LEGACY.doo, 4);
  return out;
}

/** Natives the 3.0 editor's script calls that 2.0.4 lacks, stubbed only when
 *  missing, so 3.0 keeps its own. Prepended to war3map.lua. */
const LUA_SHIM =
  '-- 3.0-only natives the editor calls; no-ops on clients without them (scripts/legacy-format.js)\n'
  + 'if SetPlayerRaceSkin == nil then SetPlayerRaceSkin = function() end end\n'
  + 'if SetHDWaterParamsEx == nil then SetHDWaterParamsEx = function() end end\n';

/** Convert the map folder at `dir` in place. */
function writeLegacyFormats(dir) {
  const w3i = path.join(dir, 'war3map.w3i');
  fs.writeFileSync(w3i, downgradeW3i(fs.readFileSync(w3i)));
  const doo = path.join(dir, 'war3map.doo');
  if (fs.existsSync(doo)) fs.writeFileSync(doo, downgradeDoo(fs.readFileSync(doo)));
  const lua = path.join(dir, 'war3map.lua');
  const script = fs.readFileSync(lua, 'utf8');
  if (!script.startsWith(LUA_SHIM)) fs.writeFileSync(lua, LUA_SHIM + script);
}

module.exports = { downgradeW3i, downgradeDoo, writeLegacyFormats, LUA_SHIM };
