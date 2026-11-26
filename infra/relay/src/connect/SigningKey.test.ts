import { describe, expect, it } from "@effect/vitest";
import { connectFingerprintEmoji } from "@t3tools/shared/connectFingerprintEmoji";
import * as Redacted from "effect/Redacted";

import * as ServiceDocument from "./ServiceDocument.ts";
import { reconcileCatFirstSigningKey, signingKeyResource } from "./SigningKey.ts";

const publicKeyOf = (text: string) => {
  const seed = ServiceDocument.parseSigningSeed(text);
  if (seed === undefined) throw new Error("not a seed");
  return ServiceDocument.publicKeyOf(seed);
};

describe("a cat-first signing key", () => {
  it("is made at the first deploy, reads as a seed, and starts with the cat", () => {
    const made = reconcileCatFirstSigningKey(undefined);
    const text = Redacted.value(made.text);
    expect(text).toMatch(/^[0-9a-f]{64}$/u);
    const fingerprint = ServiceDocument.fingerprintOf(publicKeyOf(text));
    expect(connectFingerprintEmoji(fingerprint)?.[0]).toEqual({ emoji: "🐈", name: "Cat" });
    // Six zero bits: the hex starts with 0, then 0 to 3.
    expect(fingerprint).toMatch(/^0[0-3]/u);
  });

  it("is kept by every later deploy", () => {
    const made = reconcileCatFirstSigningKey(undefined);
    expect(reconcileCatFirstSigningKey(made)).toBe(made);
  });

  it("is a new key on another instance or generation", () => {
    const first = Redacted.value(reconcileCatFirstSigningKey(undefined).text);
    const second = Redacted.value(reconcileCatFirstSigningKey(undefined).text);
    expect(first).not.toBe(second);
  });
});

describe("which deploy-state value holds each generation", () => {
  it("is cat-first for every generation of a new instance", () => {
    expect(signingKeyResource(1, 1)).toEqual({ kind: "cat-first", id: "ConnectCatSigningKey1" });
    expect(signingKeyResource(2, 1)).toEqual({ kind: "cat-first", id: "ConnectCatSigningKey2" });
  });

  it("keeps an older instance's earlier keys where its deploys left them", () => {
    // Staging was at generation 2 with plain random keys, then rotated to a cat-first 3.
    expect(signingKeyResource(2, 3)).toEqual({ kind: "random", id: "ConnectSigningKey2" });
    expect(signingKeyResource(3, 3)).toEqual({ kind: "cat-first", id: "ConnectCatSigningKey3" });
    expect(signingKeyResource(4, 3)).toEqual({ kind: "cat-first", id: "ConnectCatSigningKey4" });
  });
});
