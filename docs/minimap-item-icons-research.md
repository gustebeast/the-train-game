# Research: Persistent minimap icons for ground items (axe, pickaxe, bucket)

Goal: the three special tools (`AXE_ID`, `PICKAXE_ID`, `BUCKET_ID` / `BUCKET_FULL_ID`)
should show a persistent marker on the minimap whenever they are lying on the
ground, and the marker should disappear when they are picked up.

## Options considered

### Option A — `CreateMinimapIcon` natives (RECOMMENDED)

WC3 1.32+ has first-class minimap icon natives, and they are present in our
`war3-types-strict@1.33.0` definitions (`common.j.d.ts:4821-4873`):

```ts
CreateMinimapIcon(x, y, red, green, blue, pingPath, fogVisibility): minimapicon | undefined
CreateMinimapIconOnUnit(unit, ...): minimapicon | undefined   // follows a unit
DestroyMinimapIcon(icon): void
SetMinimapIconVisible(icon, visible): void
SetMinimapIconOrphanDestroy(icon, doDestroy): void            // for unit-attached icons
```

Key facts:

- **Persistent** — the icon stays until explicitly destroyed. Not a ping.
- **`pingPath`** is a model path. Stock models live under `UI\Minimap\` and are
  resolved version-safely via `SkinManagerGetLocalPath(key)` (also in our types,
  `common.j.d.ts:4889`). Keys used by Blizzard's own `CampaignMinimapIconLocBJ`
  (confirmed from Blizzard.j source):
  - `"MinimapQuestObjectivePrimary"` — the classic "!" quest marker
  - `"MinimapQuestObjectiveBonus"` — bonus quest marker
  - `"MinimapQuestTurnIn"` — "?" turn-in marker
  - `"MinimapQuestBoss"` — boss skull
  - `"MinimapControlPoint"` — plain circle, best for tinting
- **RGB tint** — the model is tinted by the r/g/b args (255,255,255 = untinted).
  This is how Blizzard differentiates ally/neutral/enemy control points, and how
  we can differentiate axe vs pickaxe vs bucket with a single stock model.
- **`fogVisibility`** controls fog interaction:
  - `FOG_OF_WAR_MASKED` — always visible, even over unexplored (black) areas
  - `FOG_OF_WAR_FOGGED` — visible once the area is explored
  - `FOG_OF_WAR_VISIBLE` — only while actively visible
  Since the game re-masks the whole map each round (spawn.ts fog reset), pick
  MASKED (treasure-map style) or FOGGED (must scout first) — a design choice.
- Icons are **global** (all players see them) — fine for this co-op map.
- Icons **cannot be moved** after creation (no SetMinimapIconPosition native),
  but ground items never move, so create/destroy is sufficient.
- w3ts has **no wrapper class** for `minimapicon` — call the natives directly,
  as the codebase already does for `RemoveItem`, `UnitAddItem`, etc.
- Optional upgrade: import three tiny billboard `.mdx` models that use each
  item's icon texture for fully custom minimap markers. Works because
  `pingPath` accepts any model, but requires new imports; stock + tint needs none.

### Option B — dummy units as minimap dots (rejected)

Units render as dots on the minimap, so an invisible locust dummy per ground
item would produce a marker. Rejected: dots are tiny and indistinguishable,
neutral-owned dots barely show, fog hides them, and it adds dummy-unit
lifecycle management for a strictly worse visual.

### Option C — periodic `PingMinimapEx` (rejected)

Pings expire and blink; "persistent" would mean re-pinging on a timer, which is
visually noisy and spams the ping channel players use to communicate. Rejected.

### Option D — Frame API overlay (rejected)

`BlzCreateFrame` backdrops anchored over the minimap frame can show arbitrary
textures (the actual item icons). Requires world→minimap coordinate math,
resolution/UI-scale handling, and manual fog logic. Massive overkill vs Option A.

### Option E — object editor field (not possible)

Items have no "show on minimap" field; ground items never appear on the
minimap natively. No data-only solution exists.

## Recommended implementation sketch (Option A)

A small self-healing scanner module (`src/minimapIcons.ts`):

1. Keep a `Map<item, minimapicon>` of tracked ground items.
2. On a periodic raw `Timer` (~0.5 s, created once at init, **not** via
   `createTimer()` so `destroyAllTimers()` round resets don't kill it):
   - `EnumItemsInRect(getWorldBounds(), ...)` and collect items whose `typeId`
     is one of AXE/PICKAXE/BUCKET/BUCKET_FULL. Carried items are not on the
     map, so they are automatically excluded.
   - Diff against the tracked map: `CreateMinimapIcon` for new ground items,
     `DestroyMinimapIcon` + remove entry for items no longer found.

Why scan instead of hooking events: ground-item lifecycle has many paths —
terrain spawn (`terrain/spawn.ts:159-169`), player drop/pickup (`items.ts`),
carrier death (drops items with **no** manipulation event), round-reset wipe
(`spawn.ts:72` `RemoveItem`s every item with no event), and bucket↔full-bucket
swaps (`fill.ts` / `water.ts`). A 0.5 s diff scan covers all of them with one
code path and self-heals; per-event hooks would need five call sites and would
leak icons on any missed path. Scan cost is negligible (a few dozen items).
The bucket swap creates the new item and `UnitAddItem`s it in the same trigger
action, so the scanner never sees a false ground item.

Suggested styling (single stock model, tinted):

| Item        | pingPath key            | Tint            |
|-------------|-------------------------|-----------------|
| Axe         | MinimapControlPoint     | red (255,60,60) |
| Pickaxe     | MinimapControlPoint     | gray/white      |
| Bucket      | MinimapControlPoint     | light blue      |
| Full bucket | MinimapControlPoint     | deep blue       |

(Or `MinimapQuestObjectiveBonus` for a starrier "collectible" look.)
