// @effect-diagnostics globalDate:off globalTimers:off -- A registry subscriber outside any Effect runtime; it throttles with a timer.
import {
  EMPTY_CAT_PET_MEMORY,
  sameCatPetSnapshot,
  summarizeCatPet,
  type CatPetUsageLimit,
} from "@t3tools/client-runtime/state/cat-pet";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
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
import { catPetListedThreads, classifyCatPetThread } from "./catPetThreads";

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
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let openThreadKey = readOpenThreadKey(router);

  const compute = () => {
    timer = null;
    if (wakeTimer !== null) clearTimeout(wakeTimer);
    wakeTimer = null;
    const settings = getClientSettings();
    if (!settings.catPet.enabled) {
      memory = EMPTY_CAT_PET_MEMORY;
      last = null;
      return;
    }
    const overrides = settings.environmentLabelOverrides;
    const hiddenEnvironmentIds = settings.sidebarHiddenEnvironmentIds;
    const live = registry.get(liveShellEnvironmentIdsAtom);
    // Machines hidden from the sidebar are hidden from her too: no moods, limits or offline names.
    const environments = registry
      .get(environmentSummaries.environmentsAtom)
      .filter(
        (environment) =>
          environment.isEnabled && !hiddenEnvironmentIds.includes(environment.environmentId),
      )
      .map((environment) => ({
        environmentId: environment.environmentId,
        label: overrides[environment.environmentId] ?? environment.environmentLabel,
        connected: environment.connectionState === "connected",
        live: live.has(environment.environmentId),
      }));
    const connected = new Set(environments.filter((e) => e.connected).map((e) => e.environmentId));
    const configs = registry.get(environmentServerConfigsAtom);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const shells = registry.get(environmentThreadShells.quietThreadShellsAtom);
    const result = summarizeCatPet({
      memory,
      now,
      environments,
      threads: catPetListedThreads(shells, {
        now: nowIso,
        hiddenEnvironmentIds,
        configLoaded: (environmentId) => configs.has(environmentId),
      }),
      isWorking: isThreadWorking,
      classify: classifyCatPetThread,
      openThreadKey,
      usageLimits: fullUsageLimits(configs, connected),
    });
    memory = result.memory;
    // A snooze that ends changes no atom, so look again when the next one does.
    const nextWake = Math.min(
      ...shells.map((shell) => Date.parse(shell.snoozedUntil ?? "")).filter((at) => at > now),
    );
    if (Number.isFinite(nextWake)) {
      wakeTimer = setTimeout(update, Math.min(nextWake - now + 50, 2 ** 31 - 1));
    }
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
    if (wakeTimer !== null) clearTimeout(wakeTimer);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
