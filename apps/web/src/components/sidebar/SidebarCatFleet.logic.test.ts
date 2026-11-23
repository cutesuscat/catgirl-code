import { describe, expect, it } from "vite-plus/test";

import { summarizeCatFleet } from "./SidebarCatFleet.logic";

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
          { key: "running", running: true, subagents: 1 },
          { key: "stopped", running: false, subagents: 0 },
          { key: "settled-parent", running: false, subagents: 1 },
        ],
      },
      {
        environmentId: "box",
        label: "Box",
        offline: true,
        bodies: [{ key: "settled-running", running: true, subagents: 0 }],
      },
    ]);
  });
});
