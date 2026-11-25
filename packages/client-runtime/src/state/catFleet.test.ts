import { describe, expect, it } from "vite-plus/test";

import {
  arrangeCatFleet,
  catFleetCoat,
  catFleetMoonToneOf,
  catFleetOrbitOf,
  catFleetScatterOf,
  isCatFleetBodyInOrbit,
  summarizeCatFleet,
} from "./catFleet.ts";

describe("summarizeCatFleet", () => {
  it("lists each machine's running and unsettled threads and counts sub-agents on their thread", () => {
    const thread = (
      environmentId: string,
      id: string,
      overrides: Partial<{
        working: boolean;
        subagentOf: string;
        settled: boolean;
        snoozedUntil: string;
        archivedAt: string;
      }> = {},
    ) => ({
      environmentId,
      id,
      title: `Thread ${id}`,
      working: overrides.working ?? false,
      lineage: {
        relationshipToParent: overrides.subagentOf === undefined ? null : ("subagent" as const),
        rootThreadId: overrides.subagentOf ?? id,
      },
      settledOverride: overrides.settled ? ("settled" as const) : null,
      snoozedUntil: overrides.snoozedUntil ?? null,
      archivedAt: overrides.archivedAt ?? null,
    });
    const fleet = summarizeCatFleet({
      environmentLabelById: new Map([
        ["mac", "Mac"],
        ["box", "Box"],
      ]),
      connectedEnvironmentIds: ["mac"],
      threads: [
        thread("mac", "stopped"),
        thread("mac", "running", { working: true }),
        thread("mac", "sub-1", { working: true, subagentOf: "running" }),
        thread("mac", "sub-idle", { subagentOf: "running" }),
        thread("mac", "settled", { settled: true }),
        thread("mac", "settled-parent", { settled: true }),
        thread("mac", "sub-2", { working: true, subagentOf: "settled-parent" }),
        thread("mac", "snoozed", { snoozedUntil: "2030-01-01T00:00:00.000Z" }),
        thread("mac", "archived", { archivedAt: "2026-01-01T00:00:00.000Z" }),
        thread("box", "settled-running", { settled: true, working: true }),
      ],
      isWorking: (candidate) => candidate.working,
    });

    expect(fleet).toEqual([
      {
        environmentId: "mac",
        label: "Mac",
        offline: false,
        bodies: [
          { key: "running", title: "Thread running", running: true, subagents: 1 },
          { key: "stopped", title: "Thread stopped", running: false, subagents: 0 },
          { key: "settled-parent", title: "Thread settled-parent", running: false, subagents: 1 },
        ],
      },
      {
        environmentId: "box",
        label: "Box",
        offline: true,
        bodies: [
          { key: "settled-running", title: "Thread settled-running", running: true, subagents: 0 },
        ],
      },
    ]);
  });
});

describe("arrangeCatFleet", () => {
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

  it("puts the busiest machines first and offline ones last", () => {
    const fleet = [
      machine("idle", 0, 0),
      machine("offline-busy", 4, 0, true),
      machine("waiting", 0, 3),
      machine("busy", 2, 0),
      machine("busier", 3, 1),
      machine("idle-too", 0, 0),
    ];
    const { shown, hidden } = arrangeCatFleet(fleet, 6);

    expect(shown.map((entry) => entry.environmentId)).toEqual([
      "busier",
      "busy",
      "waiting",
      "idle",
      "idle-too",
      "offline-busy",
    ]);
    expect(hidden).toEqual([]);
  });

  it("keeps the last cell for the machines that do not fit", () => {
    const fleet = [
      machine("a", 0, 0),
      machine("b", 5, 0),
      machine("c", 0, 2),
      machine("d", 1, 0),
      machine("e", 0, 0),
    ];
    const { shown, hidden } = arrangeCatFleet(fleet, 4);

    expect(shown.map((entry) => entry.environmentId)).toEqual(["b", "d", "c"]);
    expect(hidden.map((entry) => entry.environmentId)).toEqual(["a", "e"]);
    expect(arrangeCatFleet(fleet, 1).shown.map((entry) => entry.environmentId)).toEqual(["b"]);
    expect(arrangeCatFleet(fleet, 0).shown).toEqual([]);
  });

  it("counts a running sub-agent as activity", () => {
    const delegating = {
      ...machine("delegating", 0, 0),
      bodies: [{ key: "parent", title: "", running: false, subagents: 2 }],
    };
    const { shown } = arrangeCatFleet([machine("one", 1, 5), delegating], 8);

    expect(shown.map((entry) => entry.environmentId)).toEqual(["delegating", "one"]);
  });
});

describe("how a cat and its bodies are drawn", () => {
  it("gives a machine one coat and a thread one orbit, colour and place, every time", () => {
    const machines = ["mac", "box", "slop-box", "nickybox", "i9", "cfh-box"];
    const coats = machines.map(catFleetCoat);

    expect(coats).toEqual(machines.map(catFleetCoat));
    expect(new Set(coats.map((coat) => `${coat.tint}:${coat.ownShare}`)).size).toBeGreaterThan(3);
    for (const coat of coats) {
      expect(coat.ownShare).toBeGreaterThanOrEqual(45);
      expect(coat.ownShare).toBeLessThanOrEqual(100);
    }
    expect(catFleetOrbitOf("thread-1", 3)).toBe(catFleetOrbitOf("thread-1", 3));
    for (const key of ["thread-1", "thread-2", "thread-3", "thread-4"]) {
      expect([0, 1, 2]).toContain(catFleetOrbitOf(key, 3));
      expect([0, 1, 2]).toContain(catFleetMoonToneOf(key, 3));
    }
  });

  it("keeps a stopped thread with a running sub-agent in the sky", () => {
    const body = { key: "a", title: "", running: false, subagents: 0 };

    expect(isCatFleetBodyInOrbit(body)).toBe(false);
    expect(isCatFleetBodyInOrbit({ ...body, running: true })).toBe(true);
    expect(isCatFleetBodyInOrbit({ ...body, subagents: 1 })).toBe(true);
  });

  it("scatters stopped threads across the arc in order, each within its own share", () => {
    const keys = ["a", "b", "c", "d", "e"];
    const spots = keys.map((key, index) => catFleetScatterOf(key, index, keys.length));

    for (const [index, spot] of spots.entries()) {
      const middle = (index + 0.5) / keys.length - 0.5;
      expect(Math.abs(spot.along - middle)).toBeLessThanOrEqual(0.45 / keys.length);
      expect(spot.drift).toBeGreaterThanOrEqual(0);
      expect(spot.drift).toBeLessThan(1);
    }
    expect(spots.map((spot) => spot.along)).toEqual(
      spots.map((spot) => spot.along).toSorted((left, right) => left - right),
    );
  });
});
