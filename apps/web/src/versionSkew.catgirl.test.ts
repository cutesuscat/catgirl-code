import { CATGIRL_VERSION, catgirlVersion } from "@t3tools/shared/catgirlRelease";
import { describe, expect, it } from "vite-plus/test";

import { resolveVersionMismatch } from "./versionSkew";

// What decides whether the app offers "Update server" for a machine.
describe("Catgirl Code versions and the update offer", () => {
  const first = catgirlVersion("0.1.12", 1);
  const second = catgirlVersion("0.1.12", 2);
  const behind = (server: string, app: string) => resolveVersionMismatch(server, app) !== null;

  it("offers an update for T3 Code's own server, also on the same T3 Code release", () => {
    expect(behind("0.1.12", CATGIRL_VERSION)).toBe(true);
    expect(behind("0.1.10", CATGIRL_VERSION)).toBe(true);
    expect(behind("0.1.13-nightly.20261126.1", CATGIRL_VERSION)).toBe(true);
  });

  it("offers an update for an older Catgirl Code build", () => {
    expect(behind(first, second)).toBe(true);
    expect(behind(catgirlVersion("0.1.12", 99), catgirlVersion("0.1.13", 1))).toBe(true);
  });

  it("offers none for the same or a newer Catgirl Code build", () => {
    expect(behind(first, first)).toBe(false);
    expect(behind(second, first)).toBe(false);
    expect(behind(catgirlVersion("0.1.13", 1), second)).toBe(false);
  });
});
