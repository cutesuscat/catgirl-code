// Catgirl Code: every release's SHA256SUMS is signed on the maintainer's machine with an SSH key
// (`ssh-keygen -Y sign`), and everything that installs a server checks that signature with the
// key below before it trusts a checksum. The key never reaches GitHub, so a changed release fails.
import { ed25519 } from "@noble/curves/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2";

/**
 * The public half of the key that signs every release's SHA256SUMS. Never replace it: servers and
 * installers built with it refuse a release signed by any other key.
 */
export const CATGIRL_RELEASE_SIGNING_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK9KUKEMEXbU/UNwqlEyJ7+PB+kSVVIGul/6rMcEk9Cv";
/** As `ssh-keygen -l` prints it, for a person comparing keys. */
export const CATGIRL_RELEASE_SIGNING_KEY_FINGERPRINT =
  "SHA256:tw8iKtQmCGDNU37fS9cNRufU2X35TUFktaptxCRYUu4";
/** `ssh-keygen -Y`'s namespace: a signature made for anything else is not a release signature. */
export const CATGIRL_RELEASE_SIGNATURE_NAMESPACE = "catgirl-code-release";
/** The signer's name in an allowed-signers file. Only a label; the key is what is checked. */
export const CATGIRL_RELEASE_SIGNER = "catgirl-code-releases";
/** The release file that holds the signature of `SHA256SUMS`. */
export const CATGIRL_RELEASE_SIGNATURE_FILE = "SHA256SUMS.sig";

/** An allowed-signers line for `ssh-keygen -Y verify`. */
export const catgirlReleaseAllowedSigners = (publicKey = CATGIRL_RELEASE_SIGNING_KEY): string =>
  `${CATGIRL_RELEASE_SIGNER} ${publicKey.trim().split(/\s+/).slice(0, 2).join(" ")}\n`;

class Reader {
  private offset = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) throw new RangeError("short");
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  uint32(): number {
    const [a = 0, b = 0, c = 0, d = 0] = this.take(4);
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }
  string(): Uint8Array {
    return this.take(this.uint32());
  }
  text(): string {
    return new TextDecoder().decode(this.string());
  }
  get done(): boolean {
    return this.offset === this.bytes.length;
  }
}

const sshString = (value: Uint8Array): Uint8Array => {
  const out = new Uint8Array(4 + value.length);
  new DataView(out.buffer).setUint32(0, value.length);
  out.set(value, 4);
  return out;
};

const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

const MAGIC = new TextEncoder().encode("SSHSIG");
const ARMOR =
  /^-----BEGIN SSH SIGNATURE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END SSH SIGNATURE-----\s*$/;
const HASHES: Readonly<Record<string, (message: Uint8Array) => Uint8Array>> = { sha256, sha512 };

/** The 32-byte Ed25519 key in an `ssh-ed25519 AAAA…` line, or `undefined` for anything else. */
function ed25519Key(publicKey: string): Uint8Array | undefined {
  const [type, blob] = publicKey.trim().split(/\s+/);
  if (type !== "ssh-ed25519" || blob === undefined) return undefined;
  const reader = new Reader(fromBase64(blob));
  if (reader.text() !== "ssh-ed25519") return undefined;
  const key = reader.string();
  return key.length === 32 && reader.done ? key : undefined;
}

/**
 * Whether `armoredSignature` (what `ssh-keygen -Y sign` writes) is `publicKey`'s signature of
 * `message` in `namespace`, checked as `ssh-keygen -Y verify` does (the PROTOCOL.sshsig format).
 * Anything malformed is a failed check, never an error.
 */
export function verifyCatgirlReleaseSignature(
  message: Uint8Array,
  armoredSignature: string,
  publicKey: string = CATGIRL_RELEASE_SIGNING_KEY,
  namespace: string = CATGIRL_RELEASE_SIGNATURE_NAMESPACE,
): boolean {
  try {
    const expectedKey = ed25519Key(publicKey);
    const armored = ARMOR.exec(armoredSignature.trim());
    if (expectedKey === undefined || armored?.[1] === undefined) return false;
    const reader = new Reader(fromBase64(armored[1].replace(/\s+/g, "")));
    if (!sameBytes(reader.take(MAGIC.length), MAGIC) || reader.uint32() !== 1) return false;
    const signerKey = new Reader(reader.string());
    if (signerKey.text() !== "ssh-ed25519" || !sameBytes(signerKey.string(), expectedKey)) {
      return false;
    }
    const signedNamespace = reader.string();
    const reserved = reader.string();
    const hashName = reader.text();
    const signature = new Reader(reader.string());
    const hash = HASHES[hashName];
    if (!reader.done || hash === undefined) return false;
    if (new TextDecoder().decode(signedNamespace) !== namespace) return false;
    if (signature.text() !== "ssh-ed25519") return false;
    const signatureBytes = signature.string();
    const signed = concat([
      MAGIC,
      sshString(signedNamespace),
      sshString(reserved),
      sshString(new TextEncoder().encode(hashName)),
      sshString(hash(message)),
    ]);
    return ed25519.verify(signatureBytes, signed, expectedKey, { zip215: false });
  } catch {
    return false;
  }
}

/**
 * A POSIX sh function, `catgirl_release_signature SUMS SIGNATURE SCRATCH`, for the installers that
 * are shell scripts. Exit 0: signed by the release key. 1: not. 2: this machine cannot check, as
 * it has no `ssh-keygen` with `-Y` (OpenSSH 8.1 or newer). SCRATCH is a file it may overwrite.
 */
export const catgirlReleaseSignatureShellFunction = (
  publicKey: string = CATGIRL_RELEASE_SIGNING_KEY,
): string => `catgirl_release_signature() {
  command -v ssh-keygen >/dev/null 2>&1 || return 2
  # Before OpenSSH 8.1, -Y is an unknown option.
  if ssh-keygen -Y verify 2>&1 | grep -q 'option -- '; then return 2; fi
  printf '%s' '${catgirlReleaseAllowedSigners(publicKey)}' > "$3" || return 1
  ssh-keygen -Y verify -f "$3" -I ${CATGIRL_RELEASE_SIGNER} -n ${CATGIRL_RELEASE_SIGNATURE_NAMESPACE} -s "$2" < "$1" >/dev/null 2>&1 || return 1
}
`;
