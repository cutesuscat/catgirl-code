import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_CAT_PET_POSITIONS,
  catPetDisplayKey,
  forgetCatPetPosition,
  layoutCatPetWindow,
  rememberCatPetPosition,
  resolveCatPetPosition,
  type CatPetDisplay,
} from "./catPetPosition.ts";

const display = (id: number, x: number, label = "", width = 1440, height = 900): CatPetDisplay => ({
  id,
  label,
  scaleFactor: 2,
  bounds: { x, y: 0, width, height },
  workArea: { x, y: 25, width, height: height - 25 - 70 },
});
const laptop = display(1, 0, "Built-in Retina Display");
const monitor = display(2, 1440, "", 2560, 1440);
const size = { width: 128, height: 139 };

describe("resolveCatPetPosition", () => {
  it("starts in the bottom-right corner of the primary work area", () => {
    expect(resolveCatPetPosition(EMPTY_CAT_PET_POSITIONS, [laptop], laptop, size)).toEqual({
      x: 1440 - 128 - 24,
      y: 25 + 805 - 139 - 24,
    });
  });

  it("restores a dropped spot on the display it was dropped on", () => {
    const { saved, clamped } = rememberCatPetPosition(
      EMPTY_CAT_PET_POSITIONS,
      { x: 2000, y: 300, ...size },
      [laptop, monitor],
    );
    expect(saved.lastDisplayKey).toBe(catPetDisplayKey(monitor));
    expect(clamped).toEqual({ x: 2000, y: 300 });
    expect(resolveCatPetPosition(saved, [laptop, monitor], laptop, size)).toEqual({
      x: 2000,
      y: 300,
    });
  });

  it("falls back to the primary display when that display is gone, and scales with resolution", () => {
    const onLaptop = rememberCatPetPosition(EMPTY_CAT_PET_POSITIONS, { x: 100, y: 100, ...size }, [
      laptop,
      monitor,
    ]).saved;
    const onMonitor = rememberCatPetPosition(onLaptop, { x: 3000, y: 900, ...size }, [
      laptop,
      monitor,
    ]).saved;
    expect(resolveCatPetPosition(onMonitor, [laptop], laptop, size)).toEqual({ x: 100, y: 100 });
    const bigger = display(1, 0, "Built-in Retina Display", 2880, 1800);
    const moved = resolveCatPetPosition(onLaptop, [bigger], bigger, size);
    expect(moved.x).toBeGreaterThan(100);
  });

  it("clamps a drop that hangs off the work area", () => {
    const { clamped } = rememberCatPetPosition(
      EMPTY_CAT_PET_POSITIONS,
      { x: 1400, y: 880, ...size },
      [laptop],
    );
    expect(clamped).toEqual({ x: 1440 - 128, y: 25 + 805 - 139 });
  });

  it("names unlabelled displays by size and scale, and forgets a spot", () => {
    expect(catPetDisplayKey(monitor)).toBe("2560x1440@2");
    const { saved } = rememberCatPetPosition(EMPTY_CAT_PET_POSITIONS, { x: 10, y: 40, ...size }, [
      laptop,
    ]);
    expect(forgetCatPetPosition(saved, catPetDisplayKey(laptop)).spots).toEqual({});
  });
});

describe("layoutCatPetWindow", () => {
  const area = laptop.workArea;
  it("is just the pet with no panel", () => {
    const pet = { x: 500, y: 600, ...size };
    expect(layoutCatPetWindow(pet, null, area)).toEqual({
      window: pet,
      pet: { x: 0, y: 0 },
      panel: null,
    });
  });

  it("puts the panel above the pet, centred, without moving the pet on screen", () => {
    const pet = { x: 500, y: 600, ...size };
    const layout = layoutCatPetWindow(pet, { width: 296, height: 120 }, area);
    expect(layout.panel?.above).toBe(true);
    expect(layout.window.x + layout.pet.x).toBe(500);
    expect(layout.window.y + layout.pet.y).toBe(600);
    expect(layout.window.width).toBe(296);
  });

  it("goes below when there is no room above, and stays inside the work area", () => {
    const pet = { x: 1300, y: 40, ...size };
    const layout = layoutCatPetWindow(pet, { width: 296, height: 120 }, area);
    expect(layout.panel?.above).toBe(false);
    expect(layout.window.x + layout.window.width).toBeLessThanOrEqual(1440);
    expect(layout.window.x + layout.pet.x).toBe(1300);
  });
});
