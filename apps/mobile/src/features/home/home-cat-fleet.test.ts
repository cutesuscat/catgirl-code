import { describe, expect, it } from "vite-plus/test";

import {
  CAT_HEAD,
  CAT_ORBITS,
  CAT_ORBIT_CENTER,
  CAT_PLANET,
  catCoatStops,
  catOrbitPoint,
  catStoppedPoint,
  homeCatFleetCells,
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
  it("fits whole cats only and shares the row between them", () => {
    expect(homeCatFleetCells(387)).toEqual({ count: 5, width: 387 / 5 });
    expect(homeCatFleetCells(336)).toEqual({ count: 4, width: 84 });
    expect(homeCatFleetCells(70)).toEqual({ count: 0, width: 0 });
    // Before the row is measured its width is not known.
    expect(homeCatFleetCells(-24)).toEqual({ count: 0, width: 0 });
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
