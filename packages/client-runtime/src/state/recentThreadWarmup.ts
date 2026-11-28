import type {
  EnvironmentId,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { type EnvironmentCatalogState, enabledEnvironmentIds } from "./connections.ts";
import type { EnvironmentShellState } from "./shell.ts";
import type { EnvironmentThreadState } from "./threadState.ts";

/** How many of each machine's latest threads keep their messages on this device. */
const RECENT_THREADS_TO_WARM = 3;

/** An environment's latest updated top-level threads that are not archived or deleted. */
export function recentThreadsToWarm(
  snapshot: OrchestrationV2ShellSnapshot,
  limit = RECENT_THREADS_TO_WARM,
): ReadonlyArray<OrchestrationV2ThreadShell> {
  return snapshot.threads
    .filter(
      (thread) =>
        thread.lineage.parentThreadId === null &&
        thread.archivedAt === null &&
        thread.deletedAt === null,
    )
    .sort(
      (left, right) =>
        DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
    )
    .slice(0, limit);
}

function sameThreadIds(left: ReadonlyArray<ThreadId>, right: ReadonlyArray<ThreadId>): boolean {
  return left.length === right.length && left.every((threadId, index) => threadId === right[index]);
}

function isSynced<E>(result: AsyncResult.AsyncResult<EnvironmentThreadState, E>): boolean {
  if (AsyncResult.isFailure(result)) return true;
  if (!AsyncResult.isSuccess(result)) return false;
  const { status, error } = result.value;
  return status === "live" || status === "deleted" || Option.isSome(error);
}

const NO_THREADS: ReadonlyArray<ThreadId> = [];

/**
 * Loads each live environment's latest threads once a session and lets them go when they are
 * live, so their messages reach the device cache: a later launch opens them at once, even
 * before or without that machine connecting. Mount the atom where the app starts.
 */
export function createRecentThreadWarmupAtom<E>(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly shellStateValueAtom: (environmentId: EnvironmentId) => Atom.Atom<EnvironmentShellState>;
  readonly threadStateAtom: (
    environmentId: EnvironmentId,
    threadId: ThreadId,
  ) => Atom.Atom<AsyncResult.AsyncResult<EnvironmentThreadState, E>>;
  readonly limit?: number;
}) {
  // Rows stream in constantly; this changes only when the chosen threads do.
  const candidatesAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous = NO_THREADS;
    return Atom.make((get) => {
      const shell = get(input.shellStateValueAtom(environmentId));
      const next =
        shell.status === "live" && Option.isSome(shell.snapshot)
          ? recentThreadsToWarm(shell.snapshot.value, input.limit).map((thread) => thread.id)
          : NO_THREADS;
      if (!sameThreadIds(previous, next)) previous = next;
      return previous;
    }).pipe(Atom.withLabel(`recent-thread-warmup-candidates:${environmentId}`));
  });
  // Warmed once per session: a thread opened later catches up from its cached sequence.
  const warmed = new Set<string>();
  return Atom.make((get) => {
    let loading = 0;
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      for (const threadId of get(candidatesAtom(environmentId))) {
        const key = JSON.stringify([environmentId, threadId]);
        if (warmed.has(key)) continue;
        const stateAtom = input.threadStateAtom(environmentId, threadId);
        if (isSynced(get.once(stateAtom))) {
          warmed.add(key);
          continue;
        }
        get.subscribe(stateAtom, (state) => {
          if (isSynced(state)) get.refreshSelf();
        });
        get.mount(stateAtom);
        loading += 1;
      }
    }
    return loading;
  }).pipe(Atom.withLabel("recent-thread-warmup"));
}
