import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import * as Result from "effect/Result";
import * as Base64Url from "effect/encoding/Base64Url";

/** Write keys for the collectors: one hour, one scope, one installation. */
export const COLLECT_TOKEN_TTL_SECONDS = 60 * 60;
export const COLLECT_TOKEN_SCOPE = "collect";
const TOKEN_PREFIX = "cgc1";
const MAX_TOKEN_LENGTH = 512;

export interface CollectTokenClaims {
  /** A hash of the caller's installation; never stored with what it sends. */
  readonly installation: string;
  readonly expiresAtSeconds: number;
}

const encoder = new TextEncoder();

function mac(secret: Uint8Array, signedPart: string): string {
  return Base64Url.encode(hmac(sha256, secret, encoder.encode(signedPart)));
}

function sameText(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** A short opaque label for what the relay knows the caller by, so a token cannot name an account. */
export function installationBinding(kind: string, id: string): string {
  return Base64Url.encode(sha256(encoder.encode(`${kind}:${id}`)).slice(0, 16));
}

export function mintCollectToken(
  secret: Uint8Array,
  claims: CollectTokenClaims,
): { readonly token: string; readonly expiresAtSeconds: number } {
  const body = Base64Url.encode(
    JSON.stringify({
      v: 1,
      s: COLLECT_TOKEN_SCOPE,
      i: claims.installation,
      e: claims.expiresAtSeconds,
    }),
  );
  const signedPart = `${TOKEN_PREFIX}.${body}`;
  return {
    token: `${signedPart}.${mac(secret, signedPart)}`,
    expiresAtSeconds: claims.expiresAtSeconds,
  };
}

function readClaims(text: string): CollectTokenClaims | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const v = Reflect.get(parsed, "v");
    const s = Reflect.get(parsed, "s");
    const i = Reflect.get(parsed, "i");
    const e = Reflect.get(parsed, "e");
    return v === 1 &&
      s === COLLECT_TOKEN_SCOPE &&
      typeof i === "string" &&
      i.length > 0 &&
      i.length <= 64 &&
      typeof e === "number" &&
      Number.isSafeInteger(e)
      ? { installation: i, expiresAtSeconds: e }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Undefined for anything this relay did not mint, or minted more than an hour ago. */
export function verifyCollectToken(
  secret: Uint8Array,
  token: string,
  nowSeconds: number,
): CollectTokenClaims | undefined {
  if (token.length > MAX_TOKEN_LENGTH) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return undefined;
  const [prefix, body, signature] = parts as [string, string, string];
  if (!sameText(mac(secret, `${prefix}.${body}`), signature)) return undefined;
  const decoded = Base64Url.decodeString(body);
  if (Result.isFailure(decoded)) return undefined;
  const claims = readClaims(decoded.success);
  if (claims === undefined) return undefined;
  if (claims.expiresAtSeconds <= nowSeconds) return undefined;
  if (claims.expiresAtSeconds > nowSeconds + COLLECT_TOKEN_TTL_SECONDS + 60) return undefined;
  return claims;
}
