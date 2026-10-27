import { isAlive } from './util';
/**
 * Floating text that belongs to a unit, and goes when the unit goes.
 *
 * The ready circles used to have labels like this, and they were taken out
 * because they outlived their circles: each texttag was created once and never
 * destroyed, so regenerating the map removed every circle and left the words
 * hanging over empty ground.
 *
 * The fix is not "remember to destroy them" at every place that removes a
 * circle; the first new removal path would forget. Instead the label hears
 * about its unit leaving, through the two ways a unit can leave:
 *
 *  - Death: an ordinary EVENT_UNIT_DEATH trigger.
 *  - Removal: WC3 has NO event for RemoveUnit, and RemoveUnit is how every
 *    board is cleared. So the native itself is wrapped: every RemoveUnit call
 *    in the map -- ours directly, and w3ts's Unit.destroy(), which calls the
 *    global at call time -- drops the unit's label in the same call, before
 *    the handle can be recycled into anything new.
 *
 * Event-driven both ways: nothing polls.
 *
 * Models attached to a unit -- the victory trophy -- ride the same hooks, for
 * the same reason: an attached effect is a handle of its own, and outlives a
 * removed unit unless something destroys it.
 */

declare const _G: { RemoveUnit: (this: void, u: unit) => void };

interface Label {
  tag: texttag;
}

/** Keyed by the unit, so a removal looks its label up in one step. */
const labels = new Map<unit, Label>();
/** Models attached to a unit by markUnit, likewise keyed by the unit. */
const marks = new Map<unit, effect>();
let hooked = false;
let deathTrigger: trigger | null = null;
/** Units the death trigger already listens to. A trigger cannot forget a
 *  registration, so relabelling or re-marking must not add another one. */
const watched = new Set<unit>();

/** Text size, in the units SetTextTagText takes. */
const LABEL_SIZE = 0.024;
/** World units per character at LABEL_SIZE, for centring. Texttags anchor at
 *  their left edge, so a label has to be shifted half its own width. Measured
 *  off a screenshot of the start lobby -- "New Game" spans about 115 world
 *  units -- after a guess of 6.5 left every label visibly right of centre. */
const CHAR_WIDTH = 14;

function dropLabel(u: unit): void {
  const l = labels.get(u);
  if (l == null) return;
  DestroyTextTag(l.tag);
  labels.delete(u);
}

function dropMark(u: unit): void {
  const fx = marks.get(u);
  if (fx == null) return;
  DestroyEffect(fx);
  marks.delete(u);
}

/** The unit has left the world: take everything that belongs to it. */
function release(u: unit): void {
  dropLabel(u);
  dropMark(u);
  watched.delete(u);
}

/** Make sure the death trigger hears about `u`, once. */
function watch(u: unit): void {
  if (deathTrigger == null || watched.has(u)) return;
  watched.add(u);
  TriggerRegisterUnitEvent(deathTrigger, u, EVENT_UNIT_DEATH);
}

/** Wrap RemoveUnit, and set up the death trigger, once.
 *
 *  Done on first use rather than at module load: natives are not reliable at
 *  module scope in this map (I2S returns "" there), and the wrapper must
 *  capture the real native, not whatever stands in for it that early. */
function install(): void {
  if (hooked) return;
  hooked = true;
  const nativeRemoveUnit = _G.RemoveUnit;
  _G.RemoveUnit = (u: unit) => {
    if (u != null) release(u);
    nativeRemoveUnit(u);
  };
  deathTrigger = CreateTrigger();
  TriggerAddAction(deathTrigger, () => {
    const u = GetTriggerUnit();
    if (u != null) release(u);
  });
}

/** Attach `model` to `u` at `point` for as long as `u` exists, at `scale`
 *  measured against the WORLD rather than the unit: an attached model grows
 *  and shrinks with its unit's own scale, so that is divided back out, and
 *  the same mark comes out the same size on a full-size peasant as on a
 *  shrunken hero. One mark per unit: marking again replaces it. */
export function markUnit(u: unit, model: string, point: string, scale: number): void {
  install();
  dropMark(u);
  const fx = AddSpecialEffectTarget(model, u, point);
  if (fx == null) return;
  const unitScale = BlzGetUnitRealField(u, UNIT_RF_SCALING_VALUE);
  BlzSetSpecialEffectScale(fx, scale / (unitScale > 0 ? unitScale : 1));
  marks.set(u, fx);
  watch(u);
}

/** Float `text` over `u` for as long as `u` exists. */
export function labelUnit(u: unit, text: string, red: number, green: number, blue: number): void {
  install();
  // One label per unit: relabelling replaces rather than stacks.
  dropLabel(u);
  const tag = CreateTextTag();
  if (tag == null) return;
  SetTextTagText(tag, text, LABEL_SIZE);
  SetTextTagColor(tag, red, green, blue, 255);
  SetTextTagPermanent(tag, true);
  SetTextTagVisibility(tag, true);
  const width = string.len(text) * CHAR_WIDTH;
  SetTextTagPos(tag, GetUnitX(u) - width / 2, GetUnitY(u) - 12, 0);
  labels.set(u, { tag });
  watch(u);
}

/** How many labels exist, and how many of those have lost their unit. The
 *  second must always be zero; tests hold it to that.
 *
 *  Presence is asked of the world by enumeration, not GetUnitTypeId: RemoveUnit
 *  is deferred, and for the rest of the frame a removed unit still reports its
 *  type and life. Enumeration already leaves it out. */
export function getUnitLabelStats(): { total: number; orphaned: number } {
  const probe = CreateGroup()!;
  let total = 0;
  let orphaned = 0;
  for (const [u] of labels) {
    total += 1;
    GroupClear(probe);
    GroupEnumUnitsInRange(probe, GetUnitX(u), GetUnitY(u), 32, undefined);
    if (!IsUnitInGroup(u, probe) || !isAlive(u)) orphaned += 1;
  }
  DestroyGroup(probe);
  return { total, orphaned };
}
