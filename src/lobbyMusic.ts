import { W3TS_HOOK, addScriptHook } from 'w3ts/hooks';

/** Music for the WC3 pre-game lobby -- the screen where the host waits for
 *  players to join, before the map has loaded.
 *
 *  This runs from `config`, not from any of the map's own systems. war3map.lua
 *  defines two engine entry points: `main`, which runs once the map has loaded,
 *  and `config`, which runs while the LOBBY is open -- config is what supplies
 *  the map name, description, player count and start locations the lobby
 *  displays. So anything config does happens on that screen, and it is the only
 *  foothold a map has there. There is no w3i field for lobby music and no way
 *  to override the client's own menu track: a map simply plays its own.
 *
 *  Hooked through w3ts rather than by wrapping the global, because w3ts already
 *  replaces `config` with its own hookedConfig. A second wrapper would be a race
 *  over which of the two captured the other's version.
 *
 *  A sound handle rather than PlayMusic, exactly as the in-game tracks use, and
 *  for the same reason: the music channel loops by restarting the file and
 *  cannot do it seamlessly, while a sound handle loops internally. The file is
 *  block-aligned ADPCM with its decay tail folded over the start, so the loop
 *  has no click. See setMusic in terrain/load.ts for the full set of rules.
 */

/** Length of PregameLobby.wav in milliseconds. Told to the engine explicitly,
 *  which is what 8 BIT RAID does and the reason its loop behaves this early.
 *  1933 ADPCM blocks of 1017 samples at 44100 Hz. */
const PREGAME_MS = 44577;

const PREGAME_FILE = 'war3mapImported\\PregameLobby.wav';

addScriptHook(W3TS_HOOK.CONFIG_BEFORE, () => {
  // The client is playing its own menu theme; without this both play at once.
  StopMusic(false);
  // looping = true, is3D = false so it plays at full volume with no listener.
  const handle = CreateSound(PREGAME_FILE, true, false, false, 10, 10, 'DefaultEAXON');
  if (handle == null) return;
  SetSoundDuration(handle, PREGAME_MS);
  SetSoundChannel(handle, 0);
  SetSoundVolume(handle, 127);
  StartSound(handle);
});
