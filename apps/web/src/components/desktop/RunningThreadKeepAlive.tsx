import { useAtomMount } from "@effect/atom-react";

import { recentThreadWarmupAtom, runningThreadKeepAliveAtom } from "../../state/threads";

export function RunningThreadKeepAlive() {
  useAtomMount(runningThreadKeepAliveAtom);
  return null;
}

/** Keeps each machine's latest threads cached in this browser or desktop app. */
export function RecentThreadWarmup() {
  useAtomMount(recentThreadWarmupAtom);
  return null;
}
