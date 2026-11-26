// Catgirl Code: release signatures for tests, made the way `ssh-keygen -Y sign` makes them, with a
// key whose private half is public right here. Nothing outside tests may accept this key.
import { ed25519 } from "@noble/curves/ed25519";
import { sha512 } from "@noble/hashes/sha2";

import { CATGIRL_RELEASE_SIGNATURE_NAMESPACE } from "./catgirlReleaseSignature.ts";

const SEED = new Uint8Array(32).fill(7);
const encoder = new TextEncoder();

const sshString = (value: Uint8Array | string): Uint8Array => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
};

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const MAGIC = encoder.encode("SSHSIG");
const PUBLIC_KEY_BLOB = concat(sshString("ssh-ed25519"), sshString(ed25519.getPublicKey(SEED)));

/** The test key, as an `ssh-ed25519 AAAA…` line. */
export const TEST_RELEASE_SIGNING_KEY = `ssh-ed25519 ${toBase64(PUBLIC_KEY_BLOB)}`;

/** The test key's armored signature of `message`, as `ssh-keygen -Y sign` writes it. */
export function signReleaseForTest(
  message: Uint8Array | string,
  namespace: string = CATGIRL_RELEASE_SIGNATURE_NAMESPACE,
): string {
  const bytes = typeof message === "string" ? encoder.encode(message) : message;
  const fields = [sshString(namespace), sshString(""), sshString("sha512")];
  const signature = ed25519.sign(concat(MAGIC, ...fields, sshString(sha512(bytes))), SEED);
  const blob = concat(
    MAGIC,
    new Uint8Array([0, 0, 0, 1]),
    sshString(PUBLIC_KEY_BLOB),
    ...fields,
    sshString(concat(sshString("ssh-ed25519"), sshString(signature))),
  );
  const lines = toBase64(blob).match(/.{1,70}/g) ?? [];
  return ["-----BEGIN SSH SIGNATURE-----", ...lines, "-----END SSH SIGNATURE-----", ""].join("\n");
}
