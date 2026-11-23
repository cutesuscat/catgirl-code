import { createEnvironmentCatalogAtoms } from "@t3tools/client-runtime/state/connections";

import { environmentLabelOverridesAtom } from "./environmentLabelOverrides";
import { connectionAtomRuntime } from "./runtime";

export const environmentCatalog = createEnvironmentCatalogAtoms(connectionAtomRuntime, {
  labelOverridesAtom: environmentLabelOverridesAtom,
});
