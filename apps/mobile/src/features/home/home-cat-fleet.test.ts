import { describe, expect, it } from "vite-plus/test";

import {
  CAT_HEAD,
  CAT_ORBITS,
  CAT_ORBIT_CENTER,
  CAT_PLANET,
  CAT_SCALE,
  CAT_SUBAGENT_ORBIT,
  DEFAULT_HOME_CAT_FLEET_LIMIT,
  HOME_CAT_FLEET_GUTTER,
  HOME_CAT_FLEET_LIMITS,
  catCoatStops,
  catOrbitPaceOf,
  catOrbitPoint,
  catOrbitTurn,
  catStoppedPoint,
  catSubagentOffset,
  createHomeListScrollWatch,
  homeCatFleetCells,
  homeCatFleetLimitOf,
  isHomeCatCellInView,
  mixHexColors,
  pickHomeCatFleet,
  rankHomeCatFleet,
} from "./home-cat-fleet";

const machine = (environmentId: string, running: number, stopped: number, offline = false) => ({
  environmentId,
  label: environmentId,
  offline,
  bodies: [
    ...Array.from({ length: running }, (_, index) => ({
      key: `${environmentId}-run-${index}`,
      title: "",
      running: true,
      subagents: 0,
    })),
    ...Array.from({ length: stopped }, (_, index) => ({
      key: `${environmentId}-stop-${index}`,
      title: "",
      running: false,
      subagents: 0,
    })),
  ],
});

describe("rankHomeCatFleet", () => {
  it("lists every machine, busiest first and offline last, with none held back for a +N", () => {
    const fleet = [
      machine("idle", 0, 0),
      machine("offline-busy", 4, 0, true),
      machine("waiting", 0, 3),
      machine("busy", 2, 0),
      machine("busier", 3, 1),
    ];

    expect(rankHomeCatFleet(fleet).map((entry) => entry.environmentId)).toEqual([
      "busier",
      "busy",
      "waiting",
      "idle",
      "offline-busy",
    ]);
  });

  it("shows nothing for no machines, or for a single machine with nothing on it", () => {
    expect(rankHomeCatFleet([])).toEqual([]);
    expect(rankHomeCatFleet([machine("only", 0, 0)])).toEqual([]);
    expect(rankHomeCatFleet([machine("only", 2, 1, true)])).toEqual([]);
    expect(rankHomeCatFleet([machine("only", 0, 1)])).toHaveLength(1);
    expect(rankHomeCatFleet([machine("one", 0, 0), machine("two", 0, 0)])).toHaveLength(2);
  });
});

describe("pickHomeCatFleet", () => {
  const ranked = [machine("a", 3, 0), machine("b", 2, 0), machine("c", 1, 0), machine("d", 0, 0)];
  const ids = (count: number, selected: string | null) =>
    pickHomeCatFleet(ranked, count, selected).map((entry) => entry.environmentId);

  it("takes the first cats that fit", () => {
    expect(ids(3, null)).toEqual(["a", "b", "c"]);
    expect(ids(9, null)).toEqual(["a", "b", "c", "d"]);
    expect(ids(0, null)).toEqual([]);
    // A row that is not measured yet has no cells.
    expect(ids(-1, "d")).toEqual([]);
  });

  it("keeps the machine the list is narrowed to in the row, in the last cell if need be", () => {
    expect(ids(3, "b")).toEqual(["a", "b", "c"]);
    expect(ids(3, "d")).toEqual(["a", "b", "d"]);
    expect(ids(1, "d")).toEqual(["d"]);
    expect(ids(3, "gone")).toEqual(["a", "b", "c"]);
  });
});

describe("homeCatFleetCells", () => {
  const cellMin = CAT_PLANET.width * CAT_SCALE;

  it("shares the row between whole cells when every cat fits, and does not scroll", () => {
    // A 411-point phone less the list's own margins: five cells between the gutters.
    expect(homeCatFleetCells(411, 5)).toEqual({ width: 387 / 5, scrolls: false });
    expect(homeCatFleetCells(411, 1)).toEqual({ width: 387 / 5, scrolls: false });
    expect(homeCatFleetCells(360, 4)).toEqual({ width: 84, scrolls: false });
  });

  it("scrolls when there are more cats, with the last one in view cut about in half", () => {
    for (const rowWidth of [360, 411, 600]) {
      const fit = Math.floor((rowWidth - 2 * HOME_CAT_FLEET_GUTTER) / cellMin);
      const cells = homeCatFleetCells(rowWidth, fit + 1);
      const visible = rowWidth - HOME_CAT_FLEET_GUTTER;
      const peek = (visible / cells.width) % 1;

      expect(cells.scrolls).toBe(true);
      expect(peek).toBeCloseTo(0.45);
      // Cells are squeezed a little at most, never below 92% of a planet.
      expect(cells.width).toBeGreaterThanOrEqual(cellMin * 0.92);
      expect(homeCatFleetCells(rowWidth, 48)).toEqual(cells);
    }
  });

  it("has no cells before the row is measured or when not one cat fits", () => {
    expect(homeCatFleetCells(0, 3)).toEqual({ width: 0, scrolls: false });
    expect(homeCatFleetCells(90, 3)).toEqual({ width: 0, scrolls: false });
    expect(homeCatFleetCells(-24, 0)).toEqual({ width: 0, scrolls: false });
  });

  it("counts a cell as in view from half a cell before it shows to half a cell after", () => {
    const width = 80;
    const rowWidth = 400;
    // The first cell starts at the gutter; the sixth starts at 412, past the row's end.
    expect(isHomeCatCellInView(0, width, 0, rowWidth)).toBe(true);
    expect(isHomeCatCellInView(4, width, 0, rowWidth)).toBe(true);
    expect(isHomeCatCellInView(5, width, 0, rowWidth)).toBe(true);
    expect(isHomeCatCellInView(6, width, 0, rowWidth)).toBe(false);
    // Scrolled two and a half cells along, the first has gone and the eighth is coming.
    expect(isHomeCatCellInView(0, width, 200, rowWidth)).toBe(false);
    expect(isHomeCatCellInView(1, width, 200, rowWidth)).toBe(true);
    expect(isHomeCatCellInView(7, width, 200, rowWidth)).toBe(true);
    expect(isHomeCatCellInView(8, width, 200, rowWidth)).toBe(false);
  });
});

describe("how many cats the row holds", () => {
  it("defaults to 12 and offers the desktop's whole fleet as its last choice", () => {
    expect(DEFAULT_HOME_CAT_FLEET_LIMIT).toBe(12);
    expect(HOME_CAT_FLEET_LIMITS).toContain(DEFAULT_HOME_CAT_FLEET_LIMIT);
    expect(HOME_CAT_FLEET_LIMITS.at(-1)).toBe(48);
    expect([...HOME_CAT_FLEET_LIMITS].sort((a, b) => a - b)).toEqual([...HOME_CAT_FLEET_LIMITS]);
  });

  it("reads the stored choice, and falls back to the default for anything unusable", () => {
    expect(homeCatFleetLimitOf(undefined)).toBe(12);
    expect(homeCatFleetLimitOf(6)).toBe(6);
    expect(homeCatFleetLimitOf(48)).toBe(48);
    expect(homeCatFleetLimitOf(500)).toBe(48);
    expect(homeCatFleetLimitOf(0)).toBe(12);
    expect(homeCatFleetLimitOf(-3)).toBe(12);
    expect(homeCatFleetLimitOf(2.5)).toBe(12);
    expect(homeCatFleetLimitOf(Number.NaN)).toBe(12);
  });

  it("holds at most the limit, busiest first, keeping a picked machine past it", () => {
    const fleet = rankHomeCatFleet(
      Array.from({ length: 20 }, (_, index) =>
        machine(`m${String(index).padStart(2, "0")}`, 20 - index, 0),
      ),
    );
    const ids = (selected: string | null) =>
      pickHomeCatFleet(fleet, 6, selected).map((entry) => entry.environmentId);

    expect(ids(null)).toEqual(["m00", "m01", "m02", "m03", "m04", "m05"]);
    expect(ids("m15")).toEqual(["m00", "m01", "m02", "m03", "m04", "m15"]);
    expect(pickHomeCatFleet(fleet, 48, null)).toHaveLength(20);
  });
});

describe("motion", () => {
  it("starts every body where the still picture puts it, and turns it once a period", () => {
    expect(catOrbitTurn(0.3, 0, 7.5)).toBeCloseTo(0.3);
    expect(catOrbitTurn(0.3, 7.5, 7.5)).toBeCloseTo(0.3);
    expect(catOrbitTurn(0.3, 3.75, 7.5)).toBeCloseTo(0.8);
    expect(catOrbitTurn(0.9, 1.5, 7.5)).toBeCloseTo(0.1);
    // Hours in, the turn stays a fraction.
    const late = catOrbitTurn(0.3, 36_000.25, 10.5);
    expect(late).toBeGreaterThanOrEqual(0);
    expect(late).toBeLessThan(1);
  });

  it("turns outer orbits more slowly, and each machine at its own pace", () => {
    expect(CAT_ORBITS.map((orbit) => orbit.period)).toEqual([7.5, 10.5, 14]);
    for (const id of ["slop-box", "nickybox", "this Mac", "i9"]) {
      expect(catOrbitPaceOf(id)).toBeGreaterThanOrEqual(0.9);
      expect(catOrbitPaceOf(id)).toBeLessThanOrEqual(1.2);
      expect(catOrbitPaceOf(id)).toBe(catOrbitPaceOf(id));
    }
    expect(catOrbitPaceOf("slop-box")).not.toBe(catOrbitPaceOf("nickybox"));
  });

  it("goes clockwise on screen, as on the desktop: from the right-hand end down in front", () => {
    const orbit = CAT_ORBITS[1];
    const start = catOrbitPoint(orbit, catOrbitTurn(0, 0, orbit.period));
    const later = catOrbitPoint(orbit, catOrbitTurn(0, 1, orbit.period));

    expect(start.x).toBeGreaterThan(CAT_ORBIT_CENTER.x);
    expect(later.y).toBeGreaterThan(start.y);
    expect(later.near).toBe(true);
  });

  it("keeps a sub-agent on a small orbit squashed and tilted like its thread's", () => {
    for (let step = 0; step < 8; step++) {
      const offset = catSubagentOffset(0, step / 8);
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(CAT_SUBAGENT_ORBIT.radius + 1e-9);
      expect(Math.abs(offset.y)).toBeLessThan(CAT_SUBAGENT_ORBIT.radius / 2);
    }
    expect(catSubagentOffset(0, 0).x).toBeCloseTo(CAT_SUBAGENT_ORBIT.radius);
    expect(catSubagentOffset(90, 0).y).toBeCloseTo(CAT_SUBAGENT_ORBIT.radius);
  });
});

describe("createHomeListScrollWatch", () => {
  it("tells the row when the list moves, and only then", () => {
    const watch = createHomeListScrollWatch();
    let calls = 0;
    const stop = watch.subscribe(() => calls++);

    expect(watch.offset()).toBe(0);
    watch.note(120);
    watch.note(120);
    expect(watch.offset()).toBe(120);
    expect(calls).toBe(1);
    stop();
    watch.note(0);
    expect(calls).toBe(1);
    expect(watch.offset()).toBe(0);
  });
});

describe("the coat", () => {
  it("mixes two colours channel by channel", () => {
    expect(mixHexColors("#ff0000", "#0000ff", 100)).toBe("#ff0000");
    expect(mixHexColors("#ff0000", "#0000ff", 0)).toBe("#0000ff");
    expect(mixHexColors("#ffffff", "#000000", 50)).toBe("#808080");
  });

  it("gives each machine its own shade and pales a resting cat", () => {
    const awake = catCoatStops("slop-box", false);
    const resting = catCoatStops("slop-box", true);

    expect(awake).toEqual(catCoatStops("slop-box", false));
    expect(awake).not.toEqual(catCoatStops("nickybox", false));
    expect(awake).toHaveLength(3);
    const red = (hex: string) => Number.parseInt(hex.slice(1, 3), 16);
    const blue = (hex: string) => Number.parseInt(hex.slice(5, 7), 16);
    for (const [index, stop] of resting.entries()) {
      expect(stop).toMatch(/^#[\da-f]{6}$/);
      expect(blue(stop)).toBeGreaterThan(blue(awake[index]!));
      expect(red(stop)).toBeGreaterThanOrEqual(red(awake[index]!) - 1);
    }
  });
});

describe("where bodies are drawn", () => {
  it("puts the lower half of an orbit in front of the cat and keeps every point in the picture", () => {
    for (const orbit of CAT_ORBITS) {
      expect(catOrbitPoint(orbit, 0.25).near).toBe(true);
      expect(catOrbitPoint(orbit, 0.75).near).toBe(false);
      expect(catOrbitPoint(orbit, 0.25).y).toBeGreaterThan(CAT_ORBIT_CENTER.y);
      for (let step = 0; step < 16; step++) {
        const point = catOrbitPoint(orbit, step / 16);
        expect(point.x).toBeGreaterThan(0);
        expect(point.x).toBeLessThan(CAT_PLANET.width);
        expect(point.y).toBeGreaterThan(0);
        expect(point.y).toBeLessThan(CAT_PLANET.height);
      }
    }
  });

  it("lays stopped threads just under the cat, inside the picture", () => {
    const keys = Array.from({ length: 16 }, (_, index) => `thread-${index}`);
    for (const [index, key] of keys.entries()) {
      const point = catStoppedPoint(key, index, keys.length);
      const distance = Math.hypot(point.x - CAT_HEAD.x, point.y - CAT_HEAD.y);

      expect(point.y).toBeGreaterThan(CAT_HEAD.y);
      expect(point.y + point.radius).toBeLessThanOrEqual(CAT_PLANET.height);
      expect(distance).toBeGreaterThan(CAT_HEAD.radius);
      expect(distance).toBeLessThan(CAT_HEAD.radius + 5);
    }
  });
});
