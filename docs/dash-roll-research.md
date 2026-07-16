# Research: dash/roll ability from "Shooting Gay 0.6" (z1z1z1)

Source: decompiled `war3map.j` from `ShootingGay_0.6_english.w3x` (minified
JASS; function/variable names below are the obfuscated originals), confirmed
against gameplay video (`roll.mp4`). In that map the roll is the "dodge
bullets with D" ability — invincible while rolling.

## How it works — full algorithm

The map runs a tiny per-player physics engine and implements the dash as an
IMPULSE fed into it, not as a scripted slide. That's what produces the
"tuned acceleration / not constant velocity" feel.

### 1. Global physics tick (function `lN`, 0.02s periodic)

Each player has velocity accumulators `rr[i]` (x) and `ir[i]` (y),
world-units-per-tick. Every 0.02s, per axis:

```
v = clamp(v, -100, +100)          // hard speed cap per axis
if |v| < 2:
    v = 0                          // dead zone — motion ends crisply
else:
    v = v * 0.9                    // exponential decay (per tick, 50Hz)
    if pathable(pos + v):          // per-axis walkability check
        pos += v; SetUnitX/Y(unit) // move via SetUnitX/Y (no pathing push)
```

Notes:
- Decay applies BEFORE the move each tick, so the first applied step of a
  50-impulse is 45.
- The pathability check is per axis: blocked in x but free in y means the
  unit keeps its y motion — i.e. it SLIDES along walls.
- Everything that pushes units (dashes, knockbacks) feeds the same
  accumulators, so effects stack/compose naturally (impulses just add).

### 2. Roll cast (function `Gc`, fired on EVENT_PLAYER_UNIT_SPELL_CHANNEL)

Triggered on SPELL_CHANNEL (not EFFECT/cast point) → responds instantly on
keypress. The ability is a point-target spell ('Afla' flare-based, hotkey D)
so the dash goes toward the clicked point.

```
angle  = atan2(targetY - unitY, targetX - unitX)
impulse = 50            // 70 if carrying item 'rag1' (upgrade item)
rr[i] += impulse * cos(angle)
ir[i] += impulse * sin(angle)

invulnerable = true     // plus a flag enemies' hit-checks respect
PauseUnit(true)         // no orders during the roll
SetUnitAnimationByIndex(unit, 31)   // that model's roll/tumble anim
QueueUnitAnimation(unit, "stand")
SetUnitTimeScale(1.5)               // anim plays 1.5x fast
play RollSE.mp3 attached to unit    // 788ms clip
TimerStart(0.5s) -> roll end
```

### 3. Roll end (function `gc`, 0.5s later)

```
invulnerable = false
SetUnitTimeScale(1)
PauseUnit(false)
IssueImmediateOrderById("stop")
```

The residual velocity keeps decaying in the physics tick, so movement
slightly OUTLASTS the 0.5s roll state — a subtle part of the feel.

## Effective numbers

- Impulse 50/tick at 50Hz = instantaneous ~2500 u/s, decaying 10%/tick.
- Distance ≈ 45 × (1 − 0.9^n)/0.1 ≈ **~430 world units total**, ~80% of it
  in the first 0.3s; motion fully stops ~0.6s after cast (dead zone at 2).
- Video confirms: big burst first quarter-second, visible bleed-off, unit
  settles into stand.

## Mapping to TheTrainGame (implementation sketch)

- Physics: small module with per-unit vx/vy, one raw 0.02s Timer; apply
  clamp → dead-zone → ×0.9 → per-axis `IsTerrainWalkable`-style check →
  SetUnitX/Y. (Our walkability differs: tracks are walkable, water isn't —
  reuse whatever check the peasant movement rules imply.)
- Cast: point-target ability, handle on EVENT_PLAYER_UNIT_SPELL_CHANNEL for
  keypress-instant response; add impulse toward target point.
- Roll state: PauseUnit + invulnerable + 0.5s timer + restore; play a
  peasant-appropriate animation. ⚠️ Animation index 31 is specific to that
  map's hero model — our WeaponlessPeasant.mdx needs its own pick
  (enumerate indices in-game; peasants have no true roll, "spell slam" or a
  sped-up walk/spin may sell it).
- Tuning knobs: impulse (dash length), decay factor (snappiness), dead zone
  (stop crispness), roll duration, anim time scale.
