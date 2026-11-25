export interface CatFleetBody {
  /** The thread's id. A body keeps its orbit, place and colour for as long as it is shown. */
  readonly key: string;
  readonly title: string;
  readonly running: boolean;
  /** Sub-agents of this thread that are running now. */
  readonly subagents: number;
}

export interface CatFleetMachine {
  readonly environmentId: string;
  readonly label: string;
  readonly offline: boolean;
  /** Running threads first, then the stopped ones that are not settled yet. */
  readonly bodies: readonly CatFleetBody[];
}

interface FleetThread {
  readonly environmentId: string;
  readonly id: string;
  readonly title: string;
  readonly lineage: {
    readonly relationshipToParent: "fork" | "subagent" | null;
    readonly rootThreadId: string;
    readonly sideChat?: boolean | undefined;
  };
  readonly settledOverride: "settled" | "active" | null;
  readonly snoozedUntil: string | null;
  readonly archivedAt: string | null;
}

/**
 * One entry per machine in catalog order, hidden machines included: the fleet is the overview
 * the thread list's filters leave out. Sub-agents count on the thread that started them.
 */
export function summarizeCatFleet<T extends FleetThread>(input: {
  readonly environmentLabelById: ReadonlyMap<string, string>;
  readonly connectedEnvironmentIds: readonly string[];
  readonly threads: readonly T[];
  readonly isWorking: (thread: T) => boolean;
}): readonly CatFleetMachine[] {
  type Body = { title: string; running: boolean; subagents: number };
  const titleByThread = new Map<string, string>();
  const bodiesByMachine = new Map<string, Map<string, Body>>();
  const bodiesOf = (environmentId: string) => {
    const bodies = bodiesByMachine.get(environmentId) ?? new Map<string, Body>();
    bodiesByMachine.set(environmentId, bodies);
    return bodies;
  };
  const runningSubagentRoots: Array<{ environmentId: string; rootThreadId: string }> = [];
  for (const thread of input.threads) {
    titleByThread.set(`${thread.environmentId}:${thread.id}`, thread.title);
    const working = input.isWorking(thread);
    if (thread.lineage.relationshipToParent === "subagent") {
      if (working) {
        runningSubagentRoots.push({
          environmentId: thread.environmentId,
          rootThreadId: thread.lineage.rootThreadId,
        });
      }
      continue;
    }
    if (thread.lineage.sideChat === true || thread.archivedAt !== null) continue;
    const waiting = thread.settledOverride !== "settled" && thread.snoozedUntil === null;
    if (working || waiting) {
      bodiesOf(thread.environmentId).set(thread.id, {
        title: thread.title,
        running: working,
        subagents: 0,
      });
    }
  }
  for (const { environmentId, rootThreadId } of runningSubagentRoots) {
    const bodies = bodiesOf(environmentId);
    // A settled thread whose sub-agent still runs shows as stopped, with that moon round it.
    const body = bodies.get(rootThreadId) ?? {
      title: titleByThread.get(`${environmentId}:${rootThreadId}`) ?? "",
      running: false,
      subagents: 0,
    };
    body.subagents += 1;
    bodies.set(rootThreadId, body);
  }
  return [...input.environmentLabelById].map(([environmentId, label]) => {
    const bodies = [...(bodiesByMachine.get(environmentId) ?? [])].map(([key, body]) => ({
      key,
      ...body,
    }));
    return {
      environmentId,
      label,
      offline: !input.connectedEnvironmentIds.includes(environmentId),
      bodies: [...bodies.filter((body) => body.running), ...bodies.filter((body) => !body.running)],
    };
  });
}

/** Running threads and running sub-agents: how busy a machine is right now. */
export function catFleetActivity(machine: CatFleetMachine): number {
  if (machine.offline) return 0;
  return machine.bodies.reduce((total, body) => total + (body.running ? 1 : 0) + body.subagents, 0);
}

/**
 * Busiest machines first, then those with the most threads waiting, then idle ones, with
 * offline machines last. Equal machines keep catalog order. The fleet fills at most `limit`
 * cells: when machines are left over, the last cell is kept for the "+N" that stands for them.
 */
export function arrangeCatFleet(
  machines: readonly CatFleetMachine[],
  limit: number,
): { readonly shown: readonly CatFleetMachine[]; readonly hidden: readonly CatFleetMachine[] } {
  const ranked = machines
    .map((machine, index) => ({
      machine,
      index,
      activity: catFleetActivity(machine),
      waiting: machine.offline ? 0 : machine.bodies.length,
    }))
    // Sorted in place: the map above made this array, and Hermes has no toSorted.
    .sort(
      (left, right) =>
        Number(left.machine.offline) - Number(right.machine.offline) ||
        right.activity - left.activity ||
        right.waiting - left.waiting ||
        left.index - right.index,
    )
    .map((entry) => entry.machine);
  const cells = Math.max(0, Math.floor(limit));
  if (ranked.length <= cells) return { shown: ranked, hidden: [] };
  const kept = Math.max(Math.min(cells, 1), cells - 1);
  return { shown: ranked.slice(0, kept), hidden: ranked.slice(kept) };
}

/** A stable number in [0, 1) for a key, so a body keeps its place and colour across renders. */
export function fleetHashUnit(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  // Without a final mix, keys that differ only at the end land almost on top of each other.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

/** A body stays in the sky while it runs or while a sub-agent of it does. */
export function isCatFleetBodyInOrbit(body: CatFleetBody): boolean {
  return body.running || body.subagents > 0;
}

/** Which of `count` orbits a body circles on. */
export function catFleetOrbitOf(key: string, count: number): number {
  return Math.floor(fleetHashUnit(key) * 7919) % count;
}

/** Which of `count` moon colours a body wears. */
export function catFleetMoonToneOf(key: string, count: number): number {
  return Math.floor(fleetHashUnit(key) * 997) % count;
}

/**
 * Where a stopped thread lies under its cat. Each gets its own share of the arc so they do not
 * stack: `along` is its place on the arc, from -0.5 to 0.5 about the middle, and `drift` is how
 * far off the cat it lies, from 0 to 1. Its key sets both within its share.
 */
export function catFleetScatterOf(
  key: string,
  index: number,
  total: number,
): { readonly along: number; readonly drift: number } {
  return {
    along: (index + 0.5 - total / 2 + (fleetHashUnit(key) - 0.5) * 0.9) / total,
    drift: fleetHashUnit(`${key}:drift`),
  };
}

// Each cat's coat leans up to this far from the icon's orange, towards honey or towards rust.
const COAT_LEAN = 55;
/** A cat with nothing running is paled with cream, to this share of its own colour. */
export const CAT_FLEET_RESTING_SHARE = 52;

/** A cat's own shade, picked by its machine's id: the tint it leans to and the orange it keeps. */
export function catFleetCoat(environmentId: string): {
  readonly tint: "honey" | "rust";
  readonly ownShare: number;
} {
  const lean = fleetHashUnit(`${environmentId}:coat`) * 2 - 1;
  return {
    tint: lean < 0 ? "rust" : "honey",
    ownShare: 100 - Math.round(Math.abs(lean) * COAT_LEAN),
  };
}
