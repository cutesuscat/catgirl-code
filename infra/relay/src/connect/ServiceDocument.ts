import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import {
  type ConnectServiceValues,
  validateConnectServiceValues,
} from "@t3tools/shared/connectService";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Base64Url from "effect/encoding/Base64Url";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/** Where every Catgirl Connect instance publishes its signed service document. */
export const SERVICE_DOCUMENT_PATH = "/.well-known/catgirl-connect.json";
export const SERVICE_DOCUMENT_VERSION = 2;
/** Apps refuse a document that claims to live longer than this. */
export const MAX_DOCUMENT_LIFETIME_HOURS = 60 * 24;
export const DEFAULT_DOCUMENT_LIFETIME_HOURS = 7 * 24;

const HOUR_MS = 60 * 60 * 1000;
const SEED_BYTES = 32;

export interface ServiceDocumentKeys {
  /** Ed25519 seed that signs the document. */
  readonly signingSeed: Uint8Array;
  /** The key the apps pinned before a rotation; it endorses the new one. */
  readonly previousSigningSeed?: Uint8Array | undefined;
}

export interface ServiceDocumentSettings {
  readonly relayUrl: string;
  readonly keys: ServiceDocumentKeys;
  readonly service?:
    | {
        readonly name: string;
        readonly operatorContact?: string | undefined;
        readonly privacyPolicyUrl?: string | undefined;
      }
    | undefined;
  readonly signIn: {
    readonly publishableKey: string;
    readonly jwtTemplate: string | undefined;
    readonly cliOAuthClientId?: string | undefined;
    readonly hostedAppUrl?: string | undefined;
  };
  /** The collectors of this relay offered to apps; each still needs the person's own yes. */
  readonly offerDiagnostics: ReadonlyArray<DiagnosticsKind>;
  readonly lifetimeHours?: number | undefined;
}

export type DiagnosticsKind = "analytics" | "crashReports" | "traces";

const DIAGNOSTICS_OFFERS: ReadonlyArray<{
  readonly kind: DiagnosticsKind;
  readonly path: string;
  readonly format: string;
}> = [
  { kind: "analytics", path: "/v1/collect/analytics", format: "posthog-batch" },
  { kind: "crashReports", path: "/v1/collect/otlp", format: "otlp-http" },
  { kind: "traces", path: "/v1/collect/otlp", format: "otlp-http" },
];

export interface ServiceDocumentEnvelope {
  readonly payload: string;
  readonly signature: string;
  readonly key: string;
}

/** Reads a 32-byte seed written as 64 hex digits (Alchemy's random values) or base64url. */
export function parseSigningSeed(value: string): Uint8Array | undefined {
  const text = value.trim();
  if (/^[0-9a-f]{64}$/iu.test(text)) {
    return Uint8Array.from(text.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
  }
  const decoded = Base64Url.decode(text);
  return Result.isSuccess(decoded) && decoded.success.length === SEED_BYTES
    ? decoded.success
    : undefined;
}

const publicKeys = new Map<string, Uint8Array>();

/** Memoised: the Worker rebuilds its routes per request, and a key derivation costs CPU time. */
export function publicKeyOf(seed: Uint8Array): Uint8Array {
  const id = Base64Url.encode(seed);
  const known = publicKeys.get(id);
  if (known !== undefined) return known;
  const derived = ed25519.getPublicKey(seed);
  if (publicKeys.size > 8) publicKeys.clear();
  publicKeys.set(id, derived);
  return derived;
}

/** First 16 hex digits of SHA-256 over the 32 key bytes, in groups of four. */
export function fingerprintOf(publicKey: Uint8Array): string {
  const hex = Array.from(sha256(publicKey).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return hex.replace(/(.{4})(?!$)/gu, "$1 ");
}

/** The link apps accept to pin this instance on first use; its QR code is the same text. */
export function setupLinkOf(relayUrl: string, publicKey: Uint8Array): string {
  return `${relayUrl.replace(/\/+$/u, "")}/#fp=${fingerprintOf(publicKey).replaceAll(" ", "")}`;
}

/** Seconds precision, as the contract's examples are written. */
export function isoSeconds(epochMillis: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(epochMillis)).replace(/\.\d{3}Z$/u, "Z");
}

function clampLifetimeHours(hours: number | undefined): number {
  if (hours === undefined || !Number.isFinite(hours)) return DEFAULT_DOCUMENT_LIFETIME_HOURS;
  return Math.min(Math.max(Math.floor(hours), 1), MAX_DOCUMENT_LIFETIME_HOURS);
}

function isHttpsUrl(value: string | undefined): value is string {
  if (value === undefined) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** The payload object, key order fixed so equal settings sign equal bytes. */
export function servicePayload(
  settings: ServiceDocumentSettings,
  signIn: ConnectServiceValues,
  issuedAtMillis: number,
): Record<string, unknown> {
  const relayUrl = signIn.relayUrl;
  const lifetime = clampLifetimeHours(settings.lifetimeHours);
  const service = settings.service;
  const hostedAppUrl = settings.signIn.hostedAppUrl?.trim().replace(/\/+$/u, "");
  const offers = DIAGNOSTICS_OFFERS.filter((offer) =>
    settings.offerDiagnostics.includes(offer.kind),
  );
  const previous = settings.keys.previousSigningSeed;
  return {
    version: SERVICE_DOCUMENT_VERSION,
    issuedAt: isoSeconds(issuedAtMillis),
    expiresAt: isoSeconds(issuedAtMillis + lifetime * HOUR_MS),
    relayUrl,
    ...(service && service.name.trim() !== ""
      ? {
          service: {
            name: service.name.trim(),
            ...(isHttpsUrl(service.operatorContact)
              ? { operatorContact: service.operatorContact }
              : {}),
            ...(isHttpsUrl(service.privacyPolicyUrl)
              ? { privacyPolicyUrl: service.privacyPolicyUrl }
              : {}),
          },
        }
      : {}),
    signIn: {
      provider: "clerk",
      publishableKey: signIn.clerkPublishableKey,
      jwtTemplate: signIn.clerkJwtTemplate,
      ...(signIn.clerkCliOAuthClientId ? { cliOAuthClientId: signIn.clerkCliOAuthClientId } : {}),
      ...(isHttpsUrl(hostedAppUrl) ? { hostedAppUrl } : {}),
    },
    ...(offers.length > 0
      ? {
          diagnostics: Object.fromEntries(
            offers.map((offer) => [
              offer.kind,
              { url: `${relayUrl}${offer.path}`, format: offer.format, auth: "connect" },
            ]),
          ),
        }
      : {}),
    ...(previous
      ? {
          keyRotation: {
            previousKey: Base64Url.encode(publicKeyOf(previous)),
            endorsement: Base64Url.encode(
              ed25519.sign(publicKeyOf(settings.keys.signingSeed), previous),
            ),
          },
        }
      : {}),
  };
}

/** Signs exactly the payload bytes it carries; apps verify before they parse. */
export function signPayload(payload: Uint8Array, signingSeed: Uint8Array): ServiceDocumentEnvelope {
  return {
    payload: Base64Url.encode(payload),
    signature: Base64Url.encode(ed25519.sign(payload, signingSeed)),
    key: Base64Url.encode(publicKeyOf(signingSeed)),
  };
}

/** Undefined when the relay lacks the sign-in values a document needs. */
export function makeEnvelope(
  settings: ServiceDocumentSettings,
  issuedAtMillis: number,
): ServiceDocumentEnvelope | undefined {
  const validated = validateConnectServiceValues({
    relayUrl: settings.relayUrl,
    clerkPublishableKey: settings.signIn.publishableKey,
    clerkJwtTemplate: settings.signIn.jwtTemplate ?? null,
    clerkCliOAuthClientId: settings.signIn.cliOAuthClientId ?? null,
  });
  if (!validated.ok) return undefined;
  const payload = servicePayload(settings, validated.values, issuedAtMillis);
  return signPayload(new TextEncoder().encode(JSON.stringify(payload)), settings.keys.signingSeed);
}

function cacheId(settings: ServiceDocumentSettings, hour: number): string {
  const previous = settings.keys.previousSigningSeed;
  return JSON.stringify([
    hour,
    Base64Url.encode(settings.keys.signingSeed),
    previous === undefined ? "" : Base64Url.encode(previous),
    settings.relayUrl,
    settings.service,
    settings.signIn,
    settings.offerDiagnostics,
    settings.lifetimeHours ?? null,
  ]);
}

let signed: { readonly id: string; readonly body: ServiceDocumentEnvelope | undefined } = {
  id: "",
  body: undefined,
};

/**
 * Serves the document signed for the current hour, so it renews itself while the
 * expiry stays short. The signature is kept for the hour across requests.
 */
export const layerRoute = (settings: ServiceDocumentSettings) => {
  const respond = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const hour = Math.floor(now / HOUR_MS);
    const id = cacheId(settings, hour);
    if (signed.id !== id) signed = { id, body: makeEnvelope(settings, hour * HOUR_MS) };
    const body = signed.body;
    return body === undefined
      ? HttpServerResponse.empty({ status: 404 })
      : HttpServerResponse.jsonUnsafe(body, {
          headers: { "cache-control": "public, max-age=300" },
        });
  });
  return HttpRouter.add("GET", SERVICE_DOCUMENT_PATH, respond);
};
