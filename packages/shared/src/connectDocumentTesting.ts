// Test helper only: signs a Connect document as a relay would, with a TEST-ONLY seed.
import { ed25519 } from "@noble/curves/ed25519";
import { hexToBytes } from "@noble/hashes/utils";
import type { ConnectDocumentEnvelope } from "@t3tools/contracts";
import * as Base64Url from "effect/encoding/Base64Url";

/** The coordinator's test vector seeds (32 x 0x01 and 32 x 0x02). Never use them for real. */
export const TEST_CONNECT_SEEDS = {
  old: "01".repeat(32),
  new: "02".repeat(32),
} as const;

export function signConnectDocumentForTests(
  payload: unknown,
  seedHex: string,
): ConnectDocumentEnvelope {
  const seed = hexToBytes(seedHex);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    payload: Base64Url.encode(bytes),
    signature: Base64Url.encode(ed25519.sign(bytes, seed)),
    key: Base64Url.encode(ed25519.getPublicKey(seed)),
  };
}

export function endorseConnectKeyForTests(newKey: Uint8Array, previousSeedHex: string): string {
  return Base64Url.encode(ed25519.sign(newKey, hexToBytes(previousSeedHex)));
}
