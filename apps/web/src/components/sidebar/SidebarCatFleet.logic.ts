export interface CatFleetBody {
  /** The thread's id. A body keeps its orbit, place and colour for as long as it is shown. */
  readonly key: string;
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
  type Body = { running: boolean; subagents: number };
  const bodiesByMachine = new Map<string, Map<string, Body>>();
  const bodiesOf = (environmentId: string) => {
    const bodies = bodiesByMachine.get(environmentId) ?? new Map<string, Body>();
    bodiesByMachine.set(environmentId, bodies);
    return bodies;
  };
  const runningSubagentRoots: Array<{ environmentId: string; rootThreadId: string }> = [];
  for (const thread of input.threads) {
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
      bodiesOf(thread.environmentId).set(thread.id, { running: working, subagents: 0 });
    }
  }
  for (const { environmentId, rootThreadId } of runningSubagentRoots) {
    const bodies = bodiesOf(environmentId);
    // A settled thread whose sub-agent still runs shows as stopped, with that moon round it.
    const body = bodies.get(rootThreadId) ?? { running: false, subagents: 0 };
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
