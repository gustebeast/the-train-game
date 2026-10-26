/**
 * Floating text that belongs to a unit, and goes when the unit goes.
 *
 * The ready circles used to have labels like this, and they were taken out
 * because they outlived their circles: each texttag was created once and never
 * destroyed, so regenerating the map removed every circle and left the words
 * hanging over empty ground.
 *
 * The fix is not "remember to destroy them" at every place that removes a
 * circle -- that is a counter kept in step with the world by hand, and the
 * first new removal path forgets it. A label's lifetime is DERIVED from its
 * unit instead: sweepUnitLabels drops every label whose unit is no longer on
 * the map, and it runs from two places.
 *
 *  - Synchronously in the terrain cleanup, straight after every unit is
 *    removed and BEFORE the new board is spawned. That makes regeneration
 *    clean in the same frame, and it matters for more than looks: WC3 recycles
 *    handles, so a removed circle's handle can come straight back as a new
 *    circle's. Sweeping before anything new exists closes that window.
 *  - On a raw periodic timer, as the backstop for any other way a circle can
 *    leave the map. Raw rather than a tracked Timer, because the cleanup's
 *    destroyAllTimers would otherwise kill the very thing guarding it.
 *
 * The same sweep keeps each label on its unit, so a label can never sit
 * anywhere its unit is not.
 */

interface Label {
  unit: unit;
  /** What the unit was when labelled. A different type under the same handle
   *  means the handle was recycled into some other unit. */
  typeId: number;
  tag: texttag;
  text: string;
  size: number;
}

let labels: Label[] = [];
let sweeper: timer | null = null;

const SWEEP_INTERVAL = 0.25;
/** Text size, in the units SetTextTagText takes. */
const LABEL_SIZE = 0.024;
/** World units per character at LABEL_SIZE, for centring. Texttags anchor at
 *  their left edge, so a label has to be shifted half its own width. Measured
 *  off a screenshot of the start lobby -- "New Game" spans about 115 world
 *  units -- after a guess of 6.5 left every label visibly right of centre. */
const CHAR_WIDTH = 14;

function place(l: Label): void {
  const width = string.len(l.text) * CHAR_WIDTH * (l.size / LABEL_SIZE);
  SetTextTagPos(l.tag, GetUnitX(l.unit) - width / 2, GetUnitY(l.unit) - 12, 0);
}

/** Reused for the presence check; one group for the life of the map. */
const probe = CreateGroup()!;

/** Whether the unit is still on the map, asked of the world itself.
 *
 *  Not GetUnitTypeId alone. RemoveUnit is deferred: for the rest of the frame
 *  a removed unit still reports its type and its life, so a sweep run straight
 *  after the cleanup -- the one sweep that has to work -- saw every removed
 *  circle as present and kept its label. Measured: 2 circles on the map, 5
 *  labels, 0 of them reported orphaned. World enumeration already leaves a
 *  removed unit out in that same frame, so presence is "the map still finds it
 *  where it stood", the same question anything counting circles would ask. */
function unitStillThere(l: Label): boolean {
  if (GetUnitTypeId(l.unit) !== l.typeId || GetWidgetLife(l.unit) <= 0.405) return false;
  GroupClear(probe);
  GroupEnumUnitsInRange(probe, GetUnitX(l.unit), GetUnitY(l.unit), 32, null!);
  return IsUnitInGroup(l.unit, probe);
}

/** Float `text` over `u` for as long as `u` exists. */
export function labelUnit(u: unit, text: string, red: number, green: number, blue: number): void {
  // One label per unit, always. If this handle already carries a label, it
  // belongs either to this same unit (relabelled) or to a removed unit whose
  // handle was recycled into this one before a sweep caught it. Either way it
  // is stale, and keeping it would stack two texts on one circle.
  const others: Label[] = [];
  for (const l of labels) {
    if (l.unit === u) DestroyTextTag(l.tag);
    else others.push(l);
  }
  labels = others;

  const tag = CreateTextTag();
  if (tag == null) return;
  SetTextTagText(tag, text, LABEL_SIZE);
  SetTextTagColor(tag, red, green, blue, 255);
  SetTextTagPermanent(tag, true);
  SetTextTagVisibility(tag, true);
  const l: Label = { unit: u, typeId: GetUnitTypeId(u), tag, text, size: LABEL_SIZE };
  place(l);
  labels.push(l);

  if (sweeper == null) {
    sweeper = CreateTimer();
    TimerStart(sweeper, SWEEP_INTERVAL, true, () => sweepUnitLabels());
  }
}

/** Drop every label whose unit has left the map, and re-seat the rest. */
export function sweepUnitLabels(): void {
  const kept: Label[] = [];
  for (const l of labels) {
    if (unitStillThere(l)) {
      place(l);
      kept.push(l);
    } else {
      DestroyTextTag(l.tag);
    }
  }
  labels = kept;
}

/** How many labels exist, and how many of those have lost their unit. The
 *  second must be zero after any sweep; tests hold it to that. */
export function unitLabelStats(): { total: number; orphaned: number } {
  let orphaned = 0;
  for (const l of labels) if (!unitStillThere(l)) orphaned += 1;
  return { total: labels.length, orphaned };
}
