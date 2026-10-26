import { W3TS_HOOK, addScriptHook } from 'w3ts/hooks';

/** Every piece of music the map plays: the WC3 pre-game lobby's track, and the
 *  in-game tracks setMusic switches between (below).
 *
 *  The pre-game lobby is the screen where the host waits for players to join,
 *  before the map has loaded.
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
 *  has no click. See setMusic below for the full set of rules.
 */

/** Length of PregameLobby.wav in milliseconds. Told to the engine explicitly,
 *  which is what 8 BIT RAID does and the reason its loop behaves this early.
 *  1933 ADPCM blocks of 1017 samples at 44100 Hz. */
const PREGAME_MS = 44577;

const PREGAME_FILE = 'war3mapImported\\PregameLobby.wav';

/** The lobby track, kept so it can be stopped. It has to be reachable from
 *  outside config: the sound does not end when the map loads -- it plays on
 *  through the loading screen and into the game, underneath whatever the map
 *  starts next -- and a sound can only be stopped through its own handle. */
let pregameHandle: sound | null = null;

/** Stop the lobby track. Safe to call at any time and more than once; it does
 *  nothing once the track has been stopped, and nothing if it never started. */
function stopPregameMusic(): void {
  if (pregameHandle == null) return;
  StopSound(pregameHandle, false, false);
  pregameHandle = null;
}

addScriptHook(W3TS_HOOK.CONFIG_BEFORE, () => {
  // Silence the client's menu theme. StopMusic alone is not enough -- measured
  // in game, the theme comes back on its own after config returns, and the
  // lobby gives a map no second moment to stop it again: no timer runs there,
  // and config is called once. Taking the music channel's volume to zero holds
  // however many times the client restarts it.
  //
  // Our own track is untouched by that because it plays on channel 0, whose
  // volume group is not the music one. That is also why this track cannot sit
  // on channel 7 the way the in-game tracks do: muting the channel it played on
  // would mute it too.
  SetMusicVolume(0);
  StopMusic(false);
  // looping = true, is3D = false so it plays at full volume with no listener.
  const handle = CreateSound(PREGAME_FILE, true, false, false, 10, 10, 'DefaultEAXON');
  if (handle == null) return;
  SetSoundDuration(handle, PREGAME_MS);
  SetSoundChannel(handle, 0);
  SetSoundVolume(handle, 127);
  StartSound(handle);
  pregameHandle = handle;
});

// Give the music channel back the moment the map loads. The mute above is for
// the lobby only, and leaving it in place would silence the default gameplay
// music that setMusic(null) hands the channel back to -- trading one silent
// path for another. 127 is full volume; the player's own music slider still
// scales it, so this restores rather than overrides their setting.
addScriptHook(W3TS_HOOK.MAIN_BEFORE, () => {
  // The map has loaded, so the lobby is over. Stopping here rather than leaving
  // it to the first setMusic call means there is no window where the map's own
  // music and the lobby's can both be playing.
  stopPregameMusic();
  SetMusicVolume(127);
});

// Every track: IMA ADPCM in a WAV container, on a sound handle.
// WC3 decodes ADPCM fine (verified in game). Chosen over PCM because MPQ was
// measured to recover only ~5% on PCM, so a 24-bit master would cost its full
// size in the archive.
//
// The masters live outside the repo with the other bounces, in
// Documents/Music/Bounces/TheTrainGame. Re-encode from there rather than from
// these files -- the difference between one lossy generation and two.
/** Warcraft's own playlist, named the way war3map.lua's main() names it when
 *  it calls SetMapMusic("Music", true, 0). Asking for it again is what gives
 *  ordinary gameplay its default music back after a lobby has taken the
 *  channel. Keep this in step with that call. */
const DEFAULT_MUSIC = 'Music';

const TRACK_FILES = {
  startLobby: 'war3mapImported\\StartLobby.wav',
  interRound: 'war3mapImported\\InterRoundLobby.wav',
  defeat: 'war3mapImported\\Purgatory.wav',
  boss: 'war3mapImported\\BossBattle.wav',
  victory: 'war3mapImported\\VictoryLobby.wav',
};

export type MusicTrack = keyof typeof TRACK_FILES;

/** Which track SHOULD be playing: one of ours, 'silence' for nothing at all,
 *  or null for Warcraft's own playlist. */
let currentTrack: MusicTrack | 'silence' | null = null;
/** Built on first play and kept, so a track that stops can start again
 *  without re-reading the file. Keyed off TRACK_FILES, so adding a track is
 *  one line up there and nothing else. */
const trackHandles: { [K in MusicTrack]?: sound } = {};

/**
 * Say which track should be playing. Declarative on purpose.
 *
 * Callers state the desired end state rather than issuing stop/start pairs, so
 * asking for the track that is ALREADY playing does nothing at all. That is
 * what makes a whole class of bug impossible: "Resetting purchases" re-enters
 * the inter-round lobby while the inter-round lobby track is already running, and the previous
 * stop-then-start version left it silent, because it tore down a playing sound
 * and could not reliably restart it in the same frame. Nothing here can produce
 * silence unless silence was asked for.
 *
 * Three conditions make the loops seamless, and each is easy to undo:
 *
 *  1. The FILE must not carry padding. ADPCM pads to whole blocks, so each loop
 *     length is an exact multiple of 1017 samples. Re-encode off that multiple
 *     and a click comes straight back.
 *  2. The CHANNEL must be 7. A sound's volume group is derived from its
 *     channel, and 7 is music -- without it a track ignores the music slider
 *     and answers to sound effects instead.
 *  3. Only ONE track plays at a time, which is this function's job.
 *
 * Asking for null does NOT mean silence -- it means "this is not one of our
 * scenes", and Warcraft's own playlist takes the channel back. That playlist is
 * the one war3map.lua sets up in main(), so restoring it is a matter of asking
 * for it again by the same name. Real silence is asked for by name: 'silence'.
 *
 * Why sound handles and not PlayMusic: the music channel loops by restarting
 * the file and cannot do it seamlessly. A sound handle loops internally.
 */
export function setMusic(track: MusicTrack | 'silence' | null): void {
  if (track === currentTrack) return;   // already in the requested state

  // Our own handles first. StopMusic does not touch them, and whichever way
  // this call goes none of them should still be playing afterwards. (The
  // pre-game track is already stopped by the time anything can call this:
  // MAIN_BEFORE above.)
  for (const key in TRACK_FILES) {
    const h = trackHandles[key as MusicTrack];
    if (h != null) StopSound(h, false, false);
  }
  currentTrack = track;

  if (track == null) {
    // Hand the channel back rather than leaving it empty. ClearMapMusic with
    // nothing to follow is what made ordinary rounds silent: the map's own
    // playlist was thrown away when the first lobby track started and never
    // put back, so the engine had nothing to play for the rest of the session.
    SetMapMusic(DEFAULT_MUSIC, true, 0);
    ResumeMusic();
    return;
  }

  // One of ours is taking over, or nothing is, so silence the engine's
  // playlist. Without this the two stack: StartSound does not stop what the
  // music channel is doing.
  StopMusic(false);
  ClearMapMusic();
  if (track === 'silence') return;

  let handle = trackHandles[track] ?? null;
  if (handle == null) {
    // looping = true; is3D = false so it plays at full volume everywhere.
    handle = CreateSound(TRACK_FILES[track], true, false, false, 10, 10, '') ?? null;
    if (handle != null) {
      SetSoundChannel(handle, 7);   // must be set before StartSound
      SetSoundVolume(handle, 127);
    }
    trackHandles[track] = handle ?? undefined;
  }
  if (handle != null) StartSound(handle);
}
