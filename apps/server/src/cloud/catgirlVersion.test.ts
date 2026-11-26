import { assert, describe, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import { CATGIRL_VERSION, catgirlVersion, upstreamVersionOf } from "@t3tools/shared/catgirlRelease";

import { keepsRunningServer } from "../cli/sshHelper.ts";
import { resolveProviderCompatibility } from "../provider/providerCompatibility.ts";
import { compareExactServiceVersions, isExactServiceVersion } from "./serviceProtocol.ts";

describe("Catgirl Code versions under the server's own comparisons", () => {
  const runtime = (serverVersion: string) =>
    JSON.stringify({ version: 1, pid: 42, port: 3773, serverVersion });
  const first = catgirlVersion("0.1.12", 1);
  const second = catgirlVersion("0.1.12", 2);
  const nextUpstream = catgirlVersion("0.1.13", 1);

  it("is an exact version a runtime folder, an update and a service can be named after", () => {
    for (const version of [CATGIRL_VERSION, first, second, nextUpstream]) {
      assert.isTrue(isExactServiceVersion(version), version);
    }
  });

  it("orders builds the way the service launcher needs to accept an update", () => {
    // The launcher refuses a target that is not above the running version.
    assert.isAbove(compareExactServiceVersions(second, first), 0);
    assert.isAbove(compareExactServiceVersions(first, "0.1.12"), 0);
    assert.isAbove(compareExactServiceVersions(first, "0.1.10"), 0);
    assert.isAbove(compareExactServiceVersions(nextUpstream, catgirlVersion("0.1.12", 99)), 0);
    assert.strictEqual(compareExactServiceVersions(first, first), 0);
  });

  it("replaces T3 Code's own server and an older Catgirl Code one over SSH", () => {
    assert.isFalse(keepsRunningServer(runtime("0.1.12"), 42, first));
    assert.isFalse(keepsRunningServer(runtime("0.1.10"), 42, first));
    assert.isFalse(keepsRunningServer(runtime(first), 42, second));
    assert.isFalse(keepsRunningServer(runtime(catgirlVersion("0.1.12", 99)), 42, nextUpstream));
  });

  it("keeps the same or a newer Catgirl Code server", () => {
    assert.isTrue(keepsRunningServer(runtime(first), 42, first));
    assert.isTrue(keepsRunningServer(runtime(second), 42, first));
    assert.isTrue(keepsRunningServer(runtime(nextUpstream), 42, second));
  });

  it("is never kept out by T3 Code's own client of the same release", () => {
    assert.isTrue(keepsRunningServer(runtime(first), 42, "0.1.12"));
  });

  it("applies provider rules by the T3 Code release the build is based on", () => {
    const driver = ProviderDriverKind.make("codex");
    const policy = (t3CodeRange: string, status: "supported" | "broken") => ({
      driver: "codex",
      t3CodeRange,
      ranges: [{ range: ">=1.0.0", status }],
    });
    const policies = [policy(">=0.1.13", "broken"), policy(">=0.1.10 <0.1.13", "supported")];
    assert.strictEqual(
      resolveProviderCompatibility(policies, driver, "1.2.0", upstreamVersionOf(first))?.status,
      "supported",
    );
    // The raw number would pass for every T3 Code release still to come.
    assert.strictEqual(
      resolveProviderCompatibility(policies, driver, "1.2.0", first)?.status,
      "broken",
    );
  });
});
