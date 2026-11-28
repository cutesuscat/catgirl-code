import { describe, expect, it } from "vite-plus/test";

import {
  type CatPetEnvironment,
  type CatPetMemory,
  type CatPetThreadState,
  type CatPetUsageLimit,
  EMPTY_CAT_PET_MEMORY,
  sameCatPetSnapshot,
  summarizeCatPet,
} from "./catPet.ts";

interface TestThread {
  readonly environmentId: string;
  readonly id: string;
  readonly title: string;
  readonly lineage: {
    readonly relationshipToParent: "fork" | "subagent" | null;
    readonly rootThreadId: string;
    readonly sideChat?: boolean;
  };
  readonly settledOverride: "settled" | "active" | null;
  readonly snoozedUntil: string | null;
  readonly archivedAt: string | null;
  readonly working: boolean;
  readonly state: CatPetThreadState;
}

const idle: CatPetThreadState = {
  status: "other",
  failureUnseen: false,
  completionUnseen: false,
  runId: null,
  runStatus: null,
  activeRunId: null,
  snoozed: false,
};

const thread = (
  id: string,
  overrides: Partial<CatPetThreadState> & {
    environmentId?: string;
    working?: boolean;
    subagentOf?: string;
    archived?: boolean;
  } = {},
): TestThread => {
  const { environmentId = "mac", working = false, subagentOf, archived, ...state } = overrides;
  return {
    environmentId,
    id,
    title: `Thread ${id}`,
    lineage: {
      relationshipToParent: subagentOf === undefined ? null : "subagent",
      rootThreadId: subagentOf ?? id,
    },
    settledOverride: null,
    snoozedUntil: null,
    archivedAt: archived ? "2026-11-01T00:00:00.000Z" : null,
    working,
    state: { ...idle, ...state },
  };
};

const machines: CatPetEnvironment[] = [
  { environmentId: "mac", label: "kitchen-mac", connected: true, live: true },
  { environmentId: "box", label: "tae-box", connected: true, live: true },
];

const summarize = (
  threads: readonly TestThread[],
  options: {
    memory?: CatPetMemory;
    environments?: readonly CatPetEnvironment[];
    openThreadKey?: string | null;
    usageLimits?: readonly CatPetUsageLimit[];
    now?: number;
  } = {},
) =>
  summarizeCatPet({
    memory: options.memory ?? EMPTY_CAT_PET_MEMORY,
    now: options.now ?? 1_000,
    environments: options.environments ?? machines,
    threads,
    isWorking: (t) => t.working,
    classify: (t) => t.state,
    openThreadKey: options.openThreadKey ?? null,
    usageLimits: options.usageLimits ?? [],
  });

describe("summarizeCatPet", () => {
  it("picks the most urgent mood: needs-you > limited > error > working > idle", () => {
    const all = [
      thread("work", { working: true }),
      thread("fail", { status: "failed", failureUnseen: true }),
      thread("lim", { status: "limited", failureUnseen: true }),
      thread("ask", { status: "approval" }),
    ];
    expect(summarize(all).snapshot.mood).toBe("needs-you");
    expect(summarize(all.slice(0, 3)).snapshot.mood).toBe("limited");
    expect(summarize(all.slice(0, 2)).snapshot.mood).toBe("error");
    expect(summarize(all.slice(0, 1)).snapshot.mood).toBe("working");
    expect(summarize([]).snapshot.mood).toBe("idle");
  });

  it("is limited when a provider window is full, with the earliest reset", () => {
    const { snapshot } = summarize([thread("work", { working: true })], {
      usageLimits: [
        { label: "Codex", resetsAt: "2026-11-28T20:00:00.000Z" },
        { label: "Claude", resetsAt: "2026-11-28T18:40:00.000Z" },
      ],
    });
    expect(snapshot.mood).toBe("limited");
    expect(snapshot.limit).toEqual({ label: "Claude", resetsAt: "2026-11-28T18:40:00.000Z" });
    expect(snapshot.working).toBe(1);
  });

  it("ignores failures she has seen, snoozed requests, and archived or sub-agent rows", () => {
    const { snapshot } = summarize([
      thread("seen", { status: "failed", failureUnseen: false }),
      thread("snoozed", { status: "input", snoozed: true }),
      thread("archived", { status: "approval", archived: true }),
      thread("sub", { status: "approval", subagentOf: "root" }),
    ]);
    expect(snapshot.mood).toBe("idle");
    expect(snapshot.needsYou).toBe(0);
    expect(snapshot.threads).toEqual([]);
  });

  it("counts sub-agents as working on their root thread", () => {
    const { snapshot } = summarize([
      thread("root", { working: true }),
      thread("sub-1", { working: true, subagentOf: "root" }),
      thread("sub-2", { working: true, subagentOf: "root" }),
    ]);
    expect(snapshot.working).toBe(3);
    expect(snapshot.threads.map((t) => t.threadId)).toEqual(["root"]);
  });

  it("only lets live machines drive the mood, and lists offline ones", () => {
    const { snapshot } = summarize(
      [thread("cached", { environmentId: "box", status: "approval" })],
      {
        environments: [
          machines[0]!,
          { environmentId: "box", label: "tae-box", connected: false, live: false },
        ],
      },
    );
    expect(snapshot.mood).toBe("idle");
    expect(snapshot.machines).toEqual({ total: 2, connected: 1, offline: ["tae-box"] });
  });

  it("sleeps when no machine is connected", () => {
    const { snapshot } = summarize([], {
      environments: machines.map((m) => ({ ...m, connected: false, live: false })),
    });
    expect(snapshot.mood).toBe("sleeping");
  });

  it("orders the thread list by kind, then by the order threads arrive in", () => {
    const { snapshot } = summarize([
      thread("w", { working: true }),
      thread("f", { status: "failed", failureUnseen: true }),
      thread("i", { status: "input", environmentId: "box" }),
      thread("a", { status: "approval" }),
    ]);
    expect(snapshot.threads.map((t) => [t.kind, t.threadId, t.machine])).toEqual([
      ["approval", "a", "kitchen-mac"],
      ["input", "i", "tae-box"],
      ["failed", "f", "kitchen-mac"],
      ["working", "w", "kitchen-mac"],
    ]);
  });

  describe("done", () => {
    const running = thread("t", { working: true, runId: "r1", runStatus: "running" });
    const finished = (runId: string, extra: Partial<CatPetThreadState> = {}) =>
      thread("t", { runId, runStatus: "completed", completionUnseen: true, ...extra });

    it("stays quiet on the first sighting, then celebrates each finished run once", () => {
      const first = summarize([finished("r0")]);
      expect(first.snapshot.celebrateSeq).toBe(0);
      const working = summarize([running], { memory: first.memory });
      expect(working.snapshot.mood).toBe("working");
      const done = summarize([finished("r1")], { memory: working.memory });
      expect(done.snapshot.celebrateSeq).toBe(1);
      expect(done.snapshot.mood).toBe("idle");
      expect(done.snapshot.unreadDone).toBe(1);
      expect(done.snapshot.threads).toEqual([
        expect.objectContaining({ threadId: "t", kind: "done" }),
      ]);
      const again = summarize([finished("r1")], { memory: done.memory });
      expect(again.snapshot.celebrateSeq).toBe(1);
      expect(again.snapshot.unreadDone).toBe(1);
    });

    it("drops the unread dot once she opens the thread", () => {
      const base = summarize([running]);
      const done = summarize([finished("r1")], { memory: base.memory });
      const opened = summarize([finished("r1")], { memory: done.memory, openThreadKey: "mac:t" });
      expect(opened.snapshot.unreadDone).toBe(0);
      const visited = summarize([finished("r1", { completionUnseen: false })], {
        memory: done.memory,
      });
      expect(visited.snapshot.unreadDone).toBe(0);
    });

    it("does not celebrate while another run on the thread still works, or in the open thread", () => {
      const base = summarize([running]);
      const busy = summarize([finished("r1", { activeRunId: "r2" })], { memory: base.memory });
      expect(busy.snapshot.celebrateSeq).toBe(0);
      const open = summarize([finished("r1")], { memory: base.memory, openThreadKey: "mac:t" });
      expect(open.snapshot.celebrateSeq).toBe(0);
    });

    it("sets a new baseline after a machine reconnects", () => {
      const base = summarize([running]);
      const offline = summarize([running], {
        memory: base.memory,
        environments: [{ ...machines[0]!, live: false }],
      });
      const back = summarize([finished("r1")], { memory: offline.memory });
      expect(back.snapshot.celebrateSeq).toBe(0);
    });
  });

  it("remembers when it went idle, and forgets once something happens", () => {
    const first = summarize([], { now: 5_000 });
    expect(first.snapshot.idleSince).toBe(5_000);
    const later = summarize([], { now: 9_000, memory: first.memory });
    expect(later.snapshot.idleSince).toBe(5_000);
    const busy = summarize([thread("w", { working: true })], { memory: later.memory });
    expect(busy.snapshot.idleSince).toBeNull();
  });

  it("clips long titles and compares snapshots by value", () => {
    const long = { ...thread("x", { status: "input" }), title: "y".repeat(200) };
    const { snapshot } = summarize([long]);
    expect(snapshot.threads[0]!.title.length).toBe(80);
    expect(sameCatPetSnapshot(snapshot, { ...snapshot })).toBe(true);
    expect(sameCatPetSnapshot(null, snapshot)).toBe(false);
  });
});
