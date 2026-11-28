import {
  type CatPetMemory,
  EMPTY_CAT_PET_MEMORY,
  summarizeCatPet,
} from "@t3tools/client-runtime/state/cat-pet";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../test-fixtures";
import { catPetListedThreads, classifyCatPetThread } from "./catPetThreads";

const NOW = Date.parse("2026-11-28T12:00:00.000Z");
const MAC = EnvironmentId.make("mac");
const BOX = EnvironmentId.make("box");
const later = new Date(NOW + 60 * 60 * 1000).toISOString();
const earlier = new Date(NOW - 60 * 1000).toISOString();

function shell(
  id: string,
  options: {
    environmentId?: EnvironmentId;
    running?: boolean;
    needsInput?: boolean;
    subagentOf?: string;
  } & Partial<Pick<EnvironmentThreadShell, "settledOverride" | "snoozedUntil" | "snoozedAt">> = {},
): EnvironmentThreadShell {
  const { environmentId = MAC, running, needsInput, subagentOf, ...rest } = options;
  const base = makeThreadFixture({
    id: ThreadId.make(id),
    environmentId,
    title: `Thread ${id}`,
    ...(subagentOf === undefined
      ? {}
      : {
          lineage: {
            rootThreadId: ThreadId.make(subagentOf),
            parentThreadId: ThreadId.make(subagentOf),
            relationshipToParent: "subagent" as const,
          },
        }),
  });
  return {
    ...base,
    runtime: running
      ? {
          status: "running",
          activeRunId: null,
          providerInstanceId: base.providerInstanceId,
          providerName: null,
          lastError: null,
          updatedAt: earlier,
        }
      : null,
    hasPendingUserInput: needsInput === true,
    ...rest,
  };
}

function pet(
  threads: readonly EnvironmentThreadShell[],
  options: { hidden?: readonly string[]; memory?: CatPetMemory } = {},
) {
  return summarizeCatPet({
    memory: options.memory ?? EMPTY_CAT_PET_MEMORY,
    now: NOW,
    environments: [MAC, BOX].map((environmentId) => ({
      environmentId,
      label: environmentId,
      connected: true,
      live: true,
    })),
    threads: catPetListedThreads(threads, {
      now: new Date(NOW).toISOString(),
      hiddenEnvironmentIds: options.hidden ?? [],
      configLoaded: () => true,
    }),
    isWorking: isThreadWorking,
    classify: classifyCatPetThread,
    openThreadKey: null,
    usageLimits: [],
  });
}

describe("the pet watches only the threads the sidebar shows", () => {
  it("works and asks for her from listed threads", () => {
    expect(pet([shell("a", { running: true })]).snapshot).toMatchObject({
      mood: "working",
      working: 1,
    });
    expect(pet([shell("a", { needsInput: true })]).snapshot).toMatchObject({
      mood: "needs-you",
      needsYou: 1,
    });
  });

  it("ignores settled threads, running or asking", () => {
    const { snapshot } = pet([
      shell("run", { running: true, settledOverride: "settled" }),
      shell("ask", { needsInput: true, settledOverride: "settled" }),
    ]);
    expect(snapshot).toMatchObject({ mood: "idle", working: 0, needsYou: 0, threads: [] });
  });

  it("ignores snoozed threads until they raise a hand", () => {
    const snoozed = { snoozedUntil: later, snoozedAt: earlier };
    expect(pet([shell("run", { running: true, ...snoozed })]).snapshot).toMatchObject({
      mood: "idle",
      working: 0,
    });
    // A new question wakes a snoozed thread early, in the sidebar and for her.
    expect(pet([shell("ask", { needsInput: true, ...snoozed })]).snapshot.mood).toBe("needs-you");
  });

  it("ignores threads on machines hidden from the sidebar, and sees them again when shown", () => {
    const threads = [shell("ask", { environmentId: BOX, needsInput: true })];
    expect(pet(threads, { hidden: [BOX] }).snapshot).toMatchObject({
      mood: "idle",
      needsYou: 0,
      threads: [],
    });
    expect(pet(threads).snapshot).toMatchObject({ mood: "needs-you", needsYou: 1 });
  });

  it("ignores the running sub-agents of a settled thread", () => {
    const { snapshot } = pet([
      shell("root", { settledOverride: "settled" }),
      shell("sub", { running: true, subagentOf: "root" }),
    ]);
    expect(snapshot).toMatchObject({ mood: "idle", working: 0 });
  });

  it("sees a thread again once it is unsettled", () => {
    const settled = shell("a", { running: true, settledOverride: "settled" });
    const away = pet([settled]);
    expect(away.snapshot.mood).toBe("idle");
    const back = pet([{ ...settled, settledOverride: "active" }], { memory: away.memory });
    expect(back.snapshot).toMatchObject({ mood: "working", working: 1 });
  });
});
