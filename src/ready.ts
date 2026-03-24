import { Rectangle, Region, Trigger, Unit } from 'w3ts';
import { Abilities } from '@objectdata/abilities';
import { Units } from '@objectdata/units';

const READY_ORB_ABILITY_ID = FourCC(Abilities.ItemDamageBonusPlus6);
const PEASANT_ID = FourCC(Units.Peasant);
const REGION_HALF = 192; // 3x3 grid cells = 384 world units, half = 192

let readyRect: Rectangle | null = null;
let readyRegion: Region | null = null;
let enterTrigger: Trigger | null = null;
let leaveTrigger: Trigger | null = null;

/** Initialize the ready system with a rectangle centered on the circle of power. */
export function initReady(cx: number, cy: number): void {
  cleanupReady();

  readyRect = Rectangle.create(
    cx - REGION_HALF, cy - REGION_HALF,
    cx + REGION_HALF, cy + REGION_HALF,
  );
  readyRegion = Region.create();
  readyRegion.addRect(readyRect);

  enterTrigger = Trigger.create();
  enterTrigger.registerEnterRegion(readyRegion.handle, undefined);
  enterTrigger.addAction(() => {
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    UnitAddAbility(u.handle, READY_ORB_ABILITY_ID);
  });

  leaveTrigger = Trigger.create();
  leaveTrigger.registerLeaveRegion(readyRegion.handle, undefined);
  leaveTrigger.addAction(() => {
    const u = Unit.fromEvent();
    if (u == null || u.typeId !== PEASANT_ID) return;
    UnitRemoveAbility(u.handle, READY_ORB_ABILITY_ID);
  });
}

/** Destroy all ready-system triggers and regions. */
export function cleanupReady(): void {
  if (enterTrigger != null) { enterTrigger.destroy(); enterTrigger = null; }
  if (leaveTrigger != null) { leaveTrigger.destroy(); leaveTrigger = null; }
  if (readyRegion != null) { readyRegion.destroy(); readyRegion = null; }
  if (readyRect != null) { readyRect.destroy(); readyRect = null; }
}
