import { describe, expect, it } from "@effect/vitest";

import * as CollectTokens from "./CollectTokens.ts";

const SECRET = new TextEncoder().encode("collect-token-test-secret-32-bytes!");
const NOW = 1_800_000_000;
const installation = CollectTokens.installationBinding("environment", "env-1");

describe("collect tokens", () => {
  it("verifies a token it minted, for its installation, until it expires", () => {
    const { token, expiresAtSeconds } = CollectTokens.mintCollectToken(SECRET, {
      installation,
      expiresAtSeconds: NOW + CollectTokens.COLLECT_TOKEN_TTL_SECONDS,
    });
    expect(token.startsWith("cgc1.")).toBe(true);
    expect(CollectTokens.verifyCollectToken(SECRET, token, NOW)).toEqual({
      installation,
      expiresAtSeconds,
    });
    expect(CollectTokens.verifyCollectToken(SECRET, token, expiresAtSeconds)).toBeUndefined();
  });

  it("refuses another relay's tokens, altered tokens and tokens that live too long", () => {
    const { token } = CollectTokens.mintCollectToken(SECRET, {
      installation,
      expiresAtSeconds: NOW + 600,
    });
    const other = new TextEncoder().encode("a different relay's secret value");
    expect(CollectTokens.verifyCollectToken(other, token, NOW)).toBeUndefined();
    const [prefix, body, mac] = token.split(".");
    const forged = `${prefix}.${body}x.${mac}`;
    expect(CollectTokens.verifyCollectToken(SECRET, forged, NOW)).toBeUndefined();
    expect(CollectTokens.verifyCollectToken(SECRET, `cgc2.${body}.${mac}`, NOW)).toBeUndefined();
    const longLived = CollectTokens.mintCollectToken(SECRET, {
      installation,
      expiresAtSeconds: NOW + 24 * 3600,
    });
    expect(CollectTokens.verifyCollectToken(SECRET, longLived.token, NOW)).toBeUndefined();
    expect(CollectTokens.verifyCollectToken(SECRET, "x".repeat(600), NOW)).toBeUndefined();
  });

  it("binds to an opaque label, never to the account or machine id itself", () => {
    expect(installation).not.toContain("env-1");
    expect(installation).toBe(CollectTokens.installationBinding("environment", "env-1"));
    expect(installation).not.toBe(CollectTokens.installationBinding("environment", "env-2"));
    expect(installation).not.toBe(CollectTokens.installationBinding("dpop", "env-1"));
  });
});
