# VM test runner

Runs the map inside a Windows VM and pulls results back out, in ~50 seconds,
without touching the host desktop (no focus stealing, no stray keystrokes).

    npm run build
    powershell -File scripts/vmtest/run-test.ps1

Output goes to `C:\VMs\testout\` — the result file plus `lobby.png`,
`ingame.png` and `final.png` for diagnosing a failed run.

## How it works

The VM holds a live (memory) snapshot parked on WC3's **Create Game** screen,
sitting in the map-list root *above* the `Download` folder. Each run:

1. `revertToSnapshot` + `start` — back to that exact screen (~11s)
2. delete the old map, upload the new build **under a fresh random filename** (~5s)
3. drive the menus over VNC: Download → map → Create → name → Start (~8s)
4. dismiss the loading screen, send the `-damagetest` chat command (~18s)
5. poll `CustomMapData\TheTrainGame\damage_test.txt` until it ends with `done` (~8s)

No cleanup step is needed — the next revert discards everything.

## The unique-filename rule (important)

A WC3 process restored from a live snapshot will **not** load a map that
overwrites a filename it already knew about; it reports *"The map is unavailable
or corrupted"* no matter where the file lives or when it is written. The same
process loads a map that arrives under a filename which did not exist when the
snapshot was taken, and reads its metadata correctly.

So `run-test.ps1` uploads to `ZZ<random>.w3x` every run and clears the previous
one. Do not "optimise" this into a fixed filename — that is exactly the case
that fails.

## Other constraints

- `vmrun` needs `-T ws`; without it, guest file/program operations fail with
  the misleading *"A file was not found"*.
- `runProgramInGuest -interactive` runs unelevated, so guest scripts must write
  under `C:\Users\wc3\`, not `C:\`.
- Snapshot must be taken with the map list in the folder *above* `Download`.
  Entering the folder locks the map files and breaks the swap.
- Screenshots use LockBits/Marshal.Copy (`vnc-fast.ps1`). The earlier per-pixel
  `SetPixel` version took minutes per frame at 1656x1249; this one takes 0.3s.
