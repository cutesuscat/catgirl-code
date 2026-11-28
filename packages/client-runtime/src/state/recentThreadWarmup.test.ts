import { EnvironmentId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { createRecentThreadWarmupAtom, recentThreadsToWarm } from "./recentThreadWarmup.ts";
import { EMPTY_SHELL_STATE, type EnvironmentShellState } from "./shell.ts";
import { EMPTY_ENVIRONMENT_THREAD_STATE, type EnvironmentThreadState } from "./threadState.ts";

const LIVE = EnvironmentId.make("live-machine");
const SLOW = EnvironmentId.make("slow-machine");

function thread(
  id: string,
  updatedAt: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell {
  return {
    ...v2ThreadShell,
    id: ThreadId.make(id),
    updatedAt: DateTime.makeUnsafe(updatedAt),
    lineage: { rootThreadId: ThreadId.make(id), parentThreadId: null, relationshipToParent: null },
    ...overrides,
  };
}

const THREADS = [
  thread("old", "2026-11-01T00:00:00.000Z"),
  thread("newest", "2026-11-27T10:00:00.000Z"),
  thread("archived", "2026-11-27T11:00:00.000Z", {
    archivedAt: DateTime.makeUnsafe("2026-11-27T11:00:00.000Z"),
  }),
  thread("child", "2026-11-27T12:00:00.000Z", {
    lineage: {
      rootThreadId: ThreadId.make("newest"),
      parentThreadId: ThreadId.make("newest"),
      relationshipToParent: null,
    },
  }),
  thread("middle", "2026-11-20T00:00:00.000Z"),
  thread("older", "2026-11-10T00:00:00.000Z"),
];

function shellState(status: EnvironmentShellState["status"]): EnvironmentShellState {
  return {
    ...EMPTY_SHELL_STATE,
    status,
    snapshot: Option.some({ ...v2ShellSnapshot, threads: THREADS }),
  };
}

function catalog(environmentIds: ReadonlyArray<EnvironmentId>): EnvironmentCatalogState {
  return {
    isReady: true,
    entries: new Map(
      environmentIds.map((environmentId) => [
        environmentId,
        {
          target: new PrimaryConnectionTarget({
            environmentId,
            label: environmentId,
            httpBaseUrl: `https://${environmentId}.example.test`,
            wsBaseUrl: `wss://${environmentId}.example.test`,
          }),
          profile: Option.none(),
          enabled: true,
        },
      ]),
    ),
  };
}

function makeHarness() {
  const shells = new Map([
    [LIVE, Atom.make(shellState("live"))],
    [SLOW, Atom.make(shellState("synchronizing"))],
  ]);
  const values = new Map<string, Atom.Writable<EnvironmentThreadState>>();
  const mounted = new Set<string>();
  const loaded: Array<string> = [];
  const valueAtom = (key: string) => {
    let atom = values.get(key);
    if (atom === undefined) {
      atom = Atom.make(EMPTY_ENVIRONMENT_THREAD_STATE).pipe(Atom.keepAlive);
      values.set(key, atom);
    }
    return atom;
  };
  const threadStateAtom = Atom.family((key: string) =>
    Atom.make((get) => {
      mounted.add(key);
      loaded.push(key);
      get.addFinalizer(() => mounted.delete(key));
      return AsyncResult.success(get(valueAtom(key)));
    }),
  );
  const warmup = createRecentThreadWarmupAtom({
    catalogValueAtom: Atom.make(catalog([LIVE, SLOW])),
    shellStateValueAtom: (environmentId) => shells.get(environmentId)!,
    threadStateAtom: (environmentId, threadId) => threadStateAtom(`${environmentId}/${threadId}`),
  });
  // The registry disposes an unmounted atom in a task; each check runs the tasks queued so far.
  const scheduled: Array<() => void> = [];
  const registry = AtomRegistry.make({
    scheduleTask: (task) => {
      scheduled.push(task);
      return () => undefined;
    },
  });
  const settle = () => {
    while (scheduled.length > 0) scheduled.shift()!();
  };
  const release = registry.mount(warmup);
  return {
    registry,
    release,
    settle,
    mounted,
    loaded,
    setThread: (key: string, status: EnvironmentThreadState["status"]) =>
      registry.set(valueAtom(key), { ...EMPTY_ENVIRONMENT_THREAD_STATE, status }),
    setShell: (environmentId: EnvironmentId, status: EnvironmentShellState["status"]) =>
      registry.set(shells.get(environmentId) as Atom.Writable<EnvironmentShellState>, {
        ...shellState(status),
      }),
  };
}

describe("recentThreadsToWarm", () => {
  it("picks the latest top-level threads that are not archived", () => {
    expect(
      recentThreadsToWarm({ ...v2ShellSnapshot, threads: THREADS }).map((row) => row.id),
    ).toEqual(["newest", "middle", "older"]);
  });
});

describe("createRecentThreadWarmupAtom", () => {
  it("loads a live machine's latest threads and lets each go once it is live", () => {
    const harness = makeHarness();
    harness.settle();
    // The machine still connecting is left alone; the live one loads its three latest.
    expect([...harness.mounted].sort()).toEqual([
      "live-machine/middle",
      "live-machine/newest",
      "live-machine/older",
    ]);

    harness.setThread("live-machine/newest", "live");
    harness.settle();
    expect(harness.mounted.has("live-machine/newest")).toBe(false);
    expect(harness.mounted.size).toBe(2);

    // A warmed thread is not loaded again in this session, even after a reconnect.
    harness.setShell(LIVE, "synchronizing");
    harness.settle();
    expect(harness.mounted.size).toBe(0);
    harness.setShell(LIVE, "live");
    harness.settle();
    expect([...harness.mounted].sort()).toEqual(["live-machine/middle", "live-machine/older"]);
    harness.release();
  });

  it("starts on a machine when it goes live, without waiting for the others", () => {
    const harness = makeHarness();
    harness.setShell(SLOW, "live");
    harness.settle();
    expect([...harness.mounted].filter((key) => key.startsWith("slow-machine/")).sort()).toEqual([
      "slow-machine/middle",
      "slow-machine/newest",
      "slow-machine/older",
    ]);
    harness.release();
  });
});
