import type { CatPetSnapshot } from "@t3tools/contracts";

let current: CatPetSnapshot | null = null;
const listeners = new Set<() => void>();

/** The latest pet snapshot, for the in-app pet (the desktop one gets it over IPC). */
export function publishCatPetSnapshot(snapshot: CatPetSnapshot): void {
  current = snapshot;
  for (const listener of listeners) listener();
}

export function getCatPetSnapshot(): CatPetSnapshot | null {
  return current;
}

export function subscribeCatPetSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
