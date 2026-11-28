import type { CatPetSnapshot, CatPetThread, CatPetThreadKind } from "@t3tools/contracts";

import { catFleetActivity, summarizeCatFleet } from "./catFleet.ts";

type FleetThread = Parameters<typeof summarizeCatFleet>[0]["threads"][number];

/** One thread as the pet sees it; the caller classifies with the app's own status rules. */
export interface CatPetThreadState {
  readonly status: "approval" | "input" | "request" | "limited" | "failed" | "other";
  /** A failed (or limited) run she has not opened since it failed. */
  readonly failureUnseen: boolean;
  /** The latest run finished after she last opened the thread. */
  readonly completionUnseen: boolean;
  readonly runId: string | null;
  /** How the latest run ended, null while it runs or when its ending doesn't count. */
  readonly runStatus: string | null;
  readonly activeRunId: string | null;
}

export interface CatPetEnvironment {
  readonly environmentId: string;
  readonly label: string;
  readonly connected: boolean;
  /** Its threads reflect the server now, not a cache. Only live machines drive moods. */
  readonly live: boolean;
}

export interface CatPetUsageLimit {
  readonly label: string;
  readonly resetsAt: string | null;
}

export interface CatPetMemory {
  /** Each live thread's last settled run, so each run's ending is celebrated once. */
  readonly settledRunIds: ReadonlyMap<string, string | null>;
  /** Threads whose finish the pet celebrated and she has not opened since. */
  readonly celebrated: ReadonlySet<string>;
  readonly celebrateSeq: number;
  readonly idleSince: number | null;
}

export const EMPTY_CAT_PET_MEMORY: CatPetMemory = {
  settledRunIds: new Map(),
  celebrated: new Set(),
  celebrateSeq: 0,
  idleSince: null,
};

const SETTLED_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "rolled_back",
]);
const MAX_THREADS = 12;
const MAX_TITLE = 80;
const MAX_OFFLINE = 8;
const KIND_ORDER: readonly CatPetThreadKind[] = [
  "approval",
  "input",
  "request",
  "limited",
  "failed",
  "working",
  "done",
];

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function earliestLimit(limits: readonly CatPetUsageLimit[]): CatPetUsageLimit | null {
  let best: CatPetUsageLimit | null = null;
  for (const limit of limits) {
    if (best === null) best = limit;
    else if (limit.resetsAt !== null && (best.resetsAt === null || limit.resetsAt < best.resetsAt))
      best = limit;
  }
  return best;
}

/**
 * The pet's one mood over every thread on every machine, most urgent first:
 * needs-you > limited > error > working > idle > sleeping. `done` is edge-triggered through
 * `celebrateSeq`; first sightings and reconnects only set a baseline, as the announcer does.
 * The caller passes only the threads the sidebar shows, so a thread coming back is a first sighting.
 */
export function summarizeCatPet<T extends FleetThread>(input: {
  readonly memory: CatPetMemory;
  readonly now: number;
  readonly environments: readonly CatPetEnvironment[];
  readonly threads: readonly T[];
  readonly isWorking: (thread: T) => boolean;
  readonly classify: (thread: T) => CatPetThreadState;
  readonly openThreadKey: string | null;
  readonly usageLimits: readonly CatPetUsageLimit[];
}): { readonly snapshot: CatPetSnapshot; readonly memory: CatPetMemory } {
  const live = new Set(input.environments.filter((e) => e.live).map((e) => e.environmentId));
  const labelOf = new Map(input.environments.map((e) => [e.environmentId, e.label] as const));
  const liveThreads = input.threads.filter((thread) => live.has(thread.environmentId));
  const fleet = summarizeCatFleet({
    environmentLabelById: new Map(
      input.environments.filter((e) => e.live).map((e) => [e.environmentId, e.label] as const),
    ),
    connectedEnvironmentIds: input.environments
      .filter((e) => e.connected)
      .map((e) => e.environmentId),
    threads: liveThreads,
    isWorking: input.isWorking,
  });
  const working = fleet.reduce((total, machine) => total + catFleetActivity(machine), 0);

  const settledRunIds = new Map<string, string | null>();
  const celebrated = new Set<string>();
  let celebrateSeq = input.memory.celebrateSeq;
  const listed: Array<CatPetThread & { readonly order: number }> = [];
  let needsYou = 0;
  let limited = 0;
  let failed = 0;
  let unreadDone = 0;
  liveThreads.forEach((thread, order) => {
    if (thread.lineage.relationshipToParent === "subagent") return;
    if (thread.lineage.sideChat === true || thread.archivedAt !== null) return;
    const key = `${thread.environmentId}:${thread.id}`;
    const state = input.classify(thread);
    const settled = state.runStatus !== null && SETTLED_RUN_STATUSES.has(state.runStatus);
    const before = input.memory.settledRunIds.get(key);
    settledRunIds.set(key, settled ? state.runId : (before ?? null));
    const anotherRunWorking = state.activeRunId !== null && state.activeRunId !== state.runId;
    if (
      before !== undefined &&
      state.runStatus === "completed" &&
      state.runId !== before &&
      !anotherRunWorking &&
      key !== input.openThreadKey
    ) {
      celebrateSeq += 1;
      celebrated.add(key);
    } else if (
      input.memory.celebrated.has(key) &&
      state.completionUnseen &&
      key !== input.openThreadKey
    ) {
      celebrated.add(key);
    }
    const entry = (kind: CatPetThreadKind) =>
      listed.push({
        environmentId: thread.environmentId,
        threadId: thread.id,
        title: clip(thread.title.trim(), MAX_TITLE),
        machine: clip(labelOf.get(thread.environmentId) ?? "", 40),
        kind,
        order,
      });
    if (state.status === "approval" || state.status === "input" || state.status === "request") {
      needsYou += 1;
      entry(state.status);
    } else if (state.status === "limited" && state.failureUnseen) {
      limited += 1;
      entry("limited");
    } else if (state.status === "failed" && state.failureUnseen) {
      failed += 1;
      entry("failed");
    } else if (input.isWorking(thread)) {
      entry("working");
    } else if (celebrated.has(key)) {
      unreadDone += 1;
      entry("done");
    }
  });

  const connected = input.environments.filter((e) => e.connected).length;
  const limit = earliestLimit(input.usageLimits);
  const mood: CatPetSnapshot["mood"] =
    needsYou > 0
      ? "needs-you"
      : limited > 0 || limit !== null
        ? "limited"
        : failed > 0
          ? "error"
          : working > 0
            ? "working"
            : connected === 0
              ? "sleeping"
              : "idle";
  const idleSince = mood === "idle" ? (input.memory.idleSince ?? input.now) : null;
  const threads = listed
    .sort(
      (left, right) =>
        KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) || left.order - right.order,
    )
    .slice(0, MAX_THREADS)
    .map(({ order: _order, ...thread }) => thread);
  return {
    snapshot: {
      mood,
      celebrateSeq,
      unreadDone,
      idleSince,
      working,
      needsYou,
      limited,
      failed,
      limit,
      machines: {
        total: input.environments.length,
        connected,
        offline: input.environments
          .filter((e) => !e.connected)
          .map((e) => clip(e.label, 40))
          .slice(0, MAX_OFFLINE),
      },
      threads,
    },
    memory: { settledRunIds, celebrated, celebrateSeq, idleSince },
  };
}

/** Whether two snapshots draw the same pet, so unchanged ones are not sent. */
export function sameCatPetSnapshot(left: CatPetSnapshot | null, right: CatPetSnapshot): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}
