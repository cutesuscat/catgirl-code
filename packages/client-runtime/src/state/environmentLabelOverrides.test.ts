import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { RelayConnectionTarget } from "../connection/model.ts";
import { createEnvironmentLabelOverrider, type EnvironmentCatalogState } from "./connections.ts";

const DEV = EnvironmentId.make("env-dev");
const CFH = EnvironmentId.make("env-cfh");

function entry(environmentId: EnvironmentId, label: string): ConnectionCatalogEntry {
  return {
    target: new RelayConnectionTarget({ environmentId, label }),
    enabled: true,
    profile: Option.none(),
  };
}

function catalog(...entries: ReadonlyArray<ConnectionCatalogEntry>): EnvironmentCatalogState {
  return {
    isReady: true,
    entries: new Map(entries.map((item) => [item.target.environmentId, item])),
  };
}

describe("createEnvironmentLabelOverrider", () => {
  it("tells two machines with the same name apart", () => {
    const override = createEnvironmentLabelOverrider();
    const saved = catalog(entry(DEV, "research-box"), entry(CFH, "research-box"));

    const shown = override(saved, { [DEV]: "slop dev", [CFH]: " slop cfh " });

    expect(shown.entries.get(DEV)?.target.label).toBe("slop dev");
    expect(shown.entries.get(CFH)?.target.label).toBe("slop cfh");
    expect(shown.entries.get(DEV)?.target).toBeInstanceOf(RelayConnectionTarget);
    expect(shown.entries.get(DEV)?.target.environmentId).toBe(DEV);
    expect(saved.entries.get(DEV)?.target.label).toBe("research-box");
  });

  it("returns the saved catalog when no name applies", () => {
    const override = createEnvironmentLabelOverrider();
    const saved = catalog(entry(DEV, "research-box"));

    expect(override(saved, {})).toBe(saved);
    expect(override(saved, { [DEV]: "research-box" })).toBe(saved);
    expect(override(saved, { [DEV]: "   " })).toBe(saved);
    expect(override(saved, { "env-gone": "old laptop" })).toBe(saved);
  });

  it("keeps identities until an entry or its name changes", () => {
    const override = createEnvironmentLabelOverrider();
    const saved = catalog(entry(DEV, "research-box"), entry(CFH, "research-box"));

    const first = override(saved, { [DEV]: "slop dev" });
    expect(override(saved, { [DEV]: "slop dev" })).toBe(first);
    expect(first.entries.get(CFH)).toBe(saved.entries.get(CFH));

    const renamed = override(saved, { [DEV]: "slop" });
    expect(renamed).not.toBe(first);
    expect(renamed.entries.get(DEV)?.target.label).toBe("slop");

    const cleared = override(saved, {});
    expect(cleared).toBe(saved);
  });

  it("follows a saved entry that changes under a name", () => {
    const override = createEnvironmentLabelOverrider();
    const before = catalog(entry(DEV, "research-box"));
    const after = catalog({ ...entry(DEV, "research-box-2"), enabled: false });

    const first = override(before, { [DEV]: "slop dev" });
    const second = override(after, { [DEV]: "slop dev" });

    expect(second).not.toBe(first);
    expect(second.entries.get(DEV)?.enabled).toBe(false);
    expect(second.entries.get(DEV)?.target.label).toBe("slop dev");
  });
});
