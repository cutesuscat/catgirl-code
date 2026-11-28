import type { CatPetThreadState } from "@t3tools/client-runtime/state/cat-pet";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { hasUnseenRunFailure } from "@t3tools/client-runtime/state/thread-settled";

import { resolveBackgroundThreadRunStatus } from "../components/backgroundThreadAnnouncement";
import {
  resolveSidebarShellSection,
  resolveSidebarThreadStatus,
} from "../components/Sidebar.logic";

type Shell = EnvironmentThreadShell;

/**
 * The threads the pet watches: those the sidebar shows outside its snoozed and settled shelves,
 * on machines it doesn't hide. Tag-hidden threads never get here (`quietThreadShellsAtom`).
 * Sub-agents follow the thread that started them.
 */
export function catPetListedThreads(
  threads: readonly Shell[],
  input: {
    readonly now: string;
    readonly hiddenEnvironmentIds: readonly string[];
    readonly configLoaded: (environmentId: Shell["environmentId"]) => boolean;
  },
): Shell[] {
  const byKey = new Map(threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread]));
  const shown = (thread: Shell) => {
    if (input.hiddenEnvironmentIds.includes(thread.environmentId)) return false;
    const section = resolveSidebarShellSection(thread, {
      now: input.now,
      configLoaded: input.configLoaded(thread.environmentId),
    });
    return section !== "snoozed" && section !== "settled";
  };
  return threads.filter((thread) =>
    thread.lineage.relationshipToParent === "subagent"
      ? shown(byKey.get(`${thread.environmentId}:${thread.lineage.rootThreadId}`) ?? thread)
      : shown(thread),
  );
}

/** One thread in the pet's terms, by the sidebar's own status rules. */
export function classifyCatPetThread(thread: Shell): CatPetThreadState {
  const status = resolveSidebarThreadStatus(thread);
  const run = thread.latestRun;
  const completedAt = run?.completedAt ? Date.parse(run.completedAt) : Number.NaN;
  const visitedAt = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : Number.NaN;
  return {
    status:
      status === "approval" ||
      status === "input" ||
      status === "request" ||
      status === "limited" ||
      status === "failed"
        ? status
        : "other",
    // A runtime failure with no failed run has nothing to date it, so it counts, as in the sidebar.
    failureUnseen: run?.status === "failed" ? hasUnseenRunFailure(thread) : true,
    completionUnseen:
      !Number.isNaN(completedAt) && (Number.isNaN(visitedAt) || completedAt > visitedAt),
    runId: run?.runId ?? null,
    runStatus: resolveBackgroundThreadRunStatus(thread),
    activeRunId: thread.runtime?.activeRunId ?? null,
  };
}
