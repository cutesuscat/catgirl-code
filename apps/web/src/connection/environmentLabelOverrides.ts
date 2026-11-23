import type { EnvironmentLabelOverrides } from "@t3tools/client-runtime/state/connections";
import { Atom } from "effect/reactivity";

/** Mirrors the client setting, so the catalog can read it without importing the settings store. */
export const environmentLabelOverridesAtom = Atom.make<EnvironmentLabelOverrides>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-environment-label-overrides"),
);
