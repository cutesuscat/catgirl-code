// @effect-diagnostics globalDate:off globalTimers:off -- A registry subscriber outside any Effect runtime; it throttles with a timer.
import {
  EMPTY_CAT_PET_MEMORY,
  sameCatPetSnapshot,
  summarizeCatPet,
  type CatPetThreadState,
  type CatPetUsageLimit,
} from "@t3tools/client-runtime/state/cat-pet";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import {
  effectiveSnoozed,
  hasUnseenRunFailure,
} from "@t3tools/client-runtime/state/thread-settled";
import type {
  CatgirlPetBridge,
  CatPetCommand,
  CatPetSettings,
  CatPetSnapshot,
  ServerConfig,
} from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import type { AtomRegistry } from "effect/reactivity";

import { openCommandPalette } from "../commandPaletteBus";
import { useComposerDraftStore } from "../composerDraftStore";
import { resolveBackgroundThreadRunStatus } from "../components/backgroundThreadAnnouncement";
import { resolveSidebarThreadStatus } from "../components/Sidebar.logic";
import {
  getClientSettings,
  subscribeClientSettings,
  updateClientSettings,
} from "../hooks/useSettings";
import { environmentSummaries } from "../state/presentation";
import { environmentServerConfigsAtom } from "../state/server";
import { liveShellEnvironmentIdsAtom } from "../state/shell";
import { environmentThreadShells } from "../state/threads";
import { resolveActiveThreadRouteRef, resolveThreadRouteTarget } from "../threadRoutes";
import { publishCatPetSnapshot } from "./catPetStore";

type Shell = EnvironmentThreadShell;

declare global {
  interface Window {
    /** Catgirl Code's desktop pet, beside upstream's `desktopBridge`; absent in the browser. */
    catgirlPet?: CatgirlPetBridge;
  }
}

const THROTTLE_MS = 250;

function readOpenThreadKey(router: AnyRouter): string | null {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const draft =
    target?.kind === "draft"
      ? useComposerDraftStore.getState().getDraftSession(target.draftId)
      : null;
  const ref = resolveActiveThreadRouteRef(target, draft);
  return ref === null ? null : `${ref.environmentId}:${ref.threadId}`;
}

function classify(thread: Shell, nowIso: string): CatPetThreadState {
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
    snoozed: effectiveSnoozed(thread, { now: nowIso }),
  };
}

/** Providers with a usage window at 100%, on machines that are connected now. */
function fullUsageLimits(
  configs: ReadonlyMap<string, ServerConfig>,
  connected: ReadonlySet<string>,
): CatPetUsageLimit[] {
  const limits: CatPetUsageLimit[] = [];
  for (const [environmentId, config] of configs) {
    if (!connected.has(environmentId)) continue;
    for (const provider of config.providers) {
      if (!provider.enabled) continue;
      const full = (provider.usageLimits?.windows ?? []).filter(
        (window) => window.usedPercent >= 100,
      );
      if (full.length === 0) continue;
      const resets = full
        .map((window) => window.resetsAt ?? null)
        .filter((at): at is string => at !== null)
        .toSorted();
      limits.push({
        label: provider.displayName ?? String(provider.driver),
        resetsAt: resets[0] ?? null,
      });
    }
  }
  return limits;
}

function runCommand(router: AnyRouter, command: CatPetCommand): void {
  switch (command.type) {
    case "open-thread":
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: command.environmentId, threadId: command.threadId },
      });
      return;
    case "new-thread":
      openCommandPalette({ open: "new-thread-in" });
      return;
    case "open-settings":
      void router.navigate({ to: "/settings/appearance" });
      return;
    case "update-settings":
      void updateCatPetSettings(command.patch);
      return;
  }
}

/** Pet settings are one object; a patch keeps the fields it doesn't name. */
export function updateCatPetSettings(patch: Partial<CatPetSettings>): Promise<void> {
  return updateClientSettings({ catPet: { ...getClientSettings().catPet, ...patch } });
}

/**
 * Sums every thread on every machine into the pet's snapshot and hands it to the desktop pet
 * (and the in-app one). Nothing is computed while the pet is off; nothing is sent unchanged.
 */
export function startCatPet(registry: AtomRegistry.AtomRegistry, router: AnyRouter): () => void {
  const bridge = typeof window === "undefined" ? undefined : window.catgirlPet;
  let memory = EMPTY_CAT_PET_MEMORY;
  let last: CatPetSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let openThreadKey = readOpenThreadKey(router);

  const compute = () => {
    timer = null;
    if (!getClientSettings().catPet.enabled) {
      memory = EMPTY_CAT_PET_MEMORY;
      last = null;
      return;
    }
    const overrides = getClientSettings().environmentLabelOverrides;
    const live = registry.get(liveShellEnvironmentIdsAtom);
    const environments = registry
      .get(environmentSummaries.environmentsAtom)
      .filter((environment) => environment.isEnabled)
      .map((environment) => ({
        environmentId: environment.environmentId,
        label: overrides[environment.environmentId] ?? environment.environmentLabel,
        connected: environment.connectionState === "connected",
        live: live.has(environment.environmentId),
      }));
    const connected = new Set(environments.filter((e) => e.connected).map((e) => e.environmentId));
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const result = summarizeCatPet({
      memory,
      now,
      environments,
      threads: registry.get(environmentThreadShells.quietThreadShellsAtom),
      isWorking: isThreadWorking,
      classify: (thread) => classify(thread, nowIso),
      openThreadKey,
      usageLimits: fullUsageLimits(registry.get(environmentServerConfigsAtom), connected),
    });
    memory = result.memory;
    if (sameCatPetSnapshot(last, result.snapshot)) return;
    last = result.snapshot;
    publishCatPetSnapshot(result.snapshot);
    void bridge?.setSnapshot(result.snapshot).catch(() => undefined);
  };
  const update = () => {
    timer ??= setTimeout(compute, THROTTLE_MS);
  };
  const updateOpenThread = () => {
    const next = readOpenThreadKey(router);
    if (next === openThreadKey) return;
    openThreadKey = next;
    update();
  };

  const unsubscribes = [
    registry.subscribe(environmentThreadShells.quietThreadShellsAtom, update),
    registry.subscribe(liveShellEnvironmentIdsAtom, update),
    registry.subscribe(environmentSummaries.environmentsAtom, update),
    registry.subscribe(environmentServerConfigsAtom, update),
    router.subscribe("onResolved", updateOpenThread),
    useComposerDraftStore.subscribe(updateOpenThread),
    subscribeClientSettings(update),
    bridge?.onCommand((command) => runCommand(router, command)) ?? (() => undefined),
  ];
  update();
  return () => {
    if (timer !== null) clearTimeout(timer);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
