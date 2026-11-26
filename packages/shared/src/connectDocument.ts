// Catgirl Connect version 2: a service's signed document, the key a device pins, and what changed.
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import {
  CATGIRL_CONNECT_DOCUMENT_VERSION,
  ConnectDocumentEnvelope,
  ConnectDocumentPayload,
  type ConnectDiagnosticsKind,
  type ConnectDiagnosticsOffer,
  type ConnectServiceChange,
  type ConnectServiceTrust,
} from "@t3tools/contracts";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { normalizeSecureRelayUrl } from "./relayUrl.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LIFETIME_MS = 60 * DAY_MS;
/** A document dated further ahead than this would outlive its 60 days on a correct clock. */
const MAX_CLOCK_AHEAD_MS = DAY_MS;
const MAX_RECENT_CHANGES = 20;
const MAX_NAME_LENGTH = 64;

export const CONNECT_DIAGNOSTICS_KINDS: ReadonlyArray<ConnectDiagnosticsKind> = [
  "analytics",
  "crashReports",
  "traces",
];

/** The only format each kind is sent in today; an offer in any other is not shown. */
const OFFER_FORMATS: Readonly<Record<ConnectDiagnosticsKind, string>> = {
  analytics: "posthog-batch",
  crashReports: "otlp-http",
  traces: "otlp-http",
};

const decodeEnvelope = Schema.decodeUnknownOption(ConnectDocumentEnvelope);
const decodePayload = Schema.decodeUnknownOption(ConnectDocumentPayload);

function bytesFromBase64Url(value: string, length?: number): Uint8Array | null {
  const decoded = Base64Url.decode(value);
  if (Result.isFailure(decoded)) return null;
  return length === undefined || decoded.success.length === length ? decoded.success : null;
}

const keyBytes = (key: string) => bytesFromBase64Url(key, 32);

/** The same key always reads the same, whatever padding it arrived with. */
function canonicalConnectKey(key: string): string | null {
  const bytes = keyBytes(key);
  return bytes === null ? null : Base64Url.encode(bytes);
}

/** First 16 hex characters of SHA-256 over the 32 key bytes, in groups of four. */
export function connectKeyFingerprint(key: string): string | null {
  const bytes = keyBytes(key);
  if (bytes === null) return null;
  return bytesToHex(sha256(bytes)).slice(0, 16).match(/.{4}/gu)?.join(" ") ?? null;
}

const compactFingerprint = (value: string) => value.replace(/\s+/gu, "").toLowerCase();

export function sameConnectFingerprint(a: string, b: string): boolean {
  return compactFingerprint(a) === compactFingerprint(b);
}

export interface ConnectSetupLink {
  /** What was typed or scanned, without the fingerprint. */
  readonly address: string;
  /** From `#fp=`. A malformed one is kept as typed, so it can only ever refuse. */
  readonly fingerprint: string | null;
}

/** Reads an address, or a setup link `https://<relay>/#fp=3f2a91bc0d4e77aa` (the QR code is the same). */
export function parseConnectSetupLink(input: string): ConnectSetupLink {
  const trimmed = input.trim();
  const hashAt = trimmed.indexOf("#");
  if (hashAt === -1) return { address: trimmed, fingerprint: null };
  const fragment = new URLSearchParams(trimmed.slice(hashAt + 1));
  const fingerprint = fragment.get("fp");
  return {
    address: trimmed.slice(0, hashAt),
    fingerprint: fingerprint === null ? null : compactFingerprint(fingerprint),
  };
}

export type ConnectDocumentProblem =
  | "malformed"
  | "bad-signature"
  | "unsupported-version"
  | "relay-mismatch"
  | "expired"
  | "not-yet-valid"
  | "lifetime"
  | "fingerprint-mismatch";

export type ConnectDocumentCheck =
  | {
      readonly _tag: "Apply";
      readonly key: string;
      readonly document: ConnectDocumentPayload;
      /** The pinned key that endorsed this one, when the service rotated its key. */
      readonly rotatedFrom: string | null;
    }
  | {
      readonly _tag: "IdentityChanged";
      readonly key: string;
      readonly pinnedKey: string;
      readonly document: ConnectDocumentPayload;
      readonly envelope: ConnectDocumentEnvelope;
    }
  | { readonly _tag: "Rejected"; readonly problem: ConnectDocumentProblem };

export interface VerifyConnectDocumentOptions {
  /** The normalised address the document was fetched from. */
  readonly relayUrl: string;
  /** `null` on first use. */
  readonly pinnedKey: string | null;
  /** From a setup link, first use only: a different key is refused. */
  readonly expectedFingerprint?: string | null;
  readonly now: Date;
}

const rejected = (problem: ConnectDocumentProblem): ConnectDocumentCheck => ({
  _tag: "Rejected",
  problem,
});

function verifySignature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  // A malformed point throws; that is a failed check, not an error.
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

function parsePayloadJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

function timeProblem(document: ConnectDocumentPayload, now: Date): ConnectDocumentProblem | null {
  const issuedAt = Date.parse(document.issuedAt);
  const expiresAt = Date.parse(document.expiresAt);
  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) return "malformed";
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_LIFETIME_MS) return "lifetime";
  if (issuedAt > now.getTime() + MAX_CLOCK_AHEAD_MS) return "not-yet-valid";
  if (expiresAt <= now.getTime()) return "expired";
  return null;
}

/**
 * The signature is checked over the payload bytes before they are parsed. Then the rules of the
 * document itself, then whether its key is the pinned one, endorsed by it, or a stranger.
 */
export function verifyConnectDocument(
  envelope: unknown,
  options: VerifyConnectDocumentOptions,
): ConnectDocumentCheck {
  const decoded = decodeEnvelope(envelope);
  if (Option.isNone(decoded)) return rejected("malformed");
  const publicKey = keyBytes(decoded.value.key);
  const signature = bytesFromBase64Url(decoded.value.signature, 64);
  const payloadBytes = bytesFromBase64Url(decoded.value.payload);
  if (publicKey === null || signature === null || payloadBytes === null) {
    return rejected("malformed");
  }
  if (!verifySignature(signature, payloadBytes, publicKey)) return rejected("bad-signature");

  const json = parsePayloadJson(payloadBytes);
  if (typeof json !== "object" || json === null) return rejected("malformed");
  if (Reflect.get(json, "version") !== CATGIRL_CONNECT_DOCUMENT_VERSION) {
    return rejected("unsupported-version");
  }
  const payload = decodePayload(json);
  if (Option.isNone(payload)) return rejected("malformed");
  const document = payload.value;
  if (normalizeSecureRelayUrl(document.relayUrl) !== options.relayUrl) {
    return rejected("relay-mismatch");
  }
  const time = timeProblem(document, options.now);
  if (time !== null) return rejected(time);

  const key = Base64Url.encode(publicKey);
  const pinnedKey = options.pinnedKey === null ? null : canonicalConnectKey(options.pinnedKey);
  if (pinnedKey === null) {
    const expected = options.expectedFingerprint;
    const fingerprint = connectKeyFingerprint(key) ?? "";
    if (expected && !sameConnectFingerprint(expected, fingerprint)) {
      return rejected("fingerprint-mismatch");
    }
    return { _tag: "Apply", key, document, rotatedFrom: null };
  }
  if (key === pinnedKey) return { _tag: "Apply", key, document, rotatedFrom: null };

  const rotation = document.keyRotation;
  const previousKey = rotation ? canonicalConnectKey(rotation.previousKey) : null;
  const endorsement = rotation ? bytesFromBase64Url(rotation.endorsement, 64) : null;
  const pinnedBytes = keyBytes(pinnedKey);
  if (
    previousKey === pinnedKey &&
    endorsement !== null &&
    pinnedBytes !== null &&
    verifySignature(endorsement, publicKey, pinnedBytes)
  ) {
    return { _tag: "Apply", key, document, rotatedFrom: pinnedKey };
  }
  return { _tag: "IdentityChanged", key, pinnedKey, document, envelope: decoded.value };
}

/** The service's own name, or its host when it gives none. Never longer than one line. */
export function connectServiceName(document: ConnectDocumentPayload | undefined, relayUrl: string) {
  const name = document?.service?.name
    ?.replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name || relayUrl.replace(/^https:\/\//u, "");
}

function secureUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export type ConnectDiagnosticsOffers = Partial<
  Record<ConnectDiagnosticsKind, ConnectDiagnosticsOffer & { readonly url: string }>
>;

/** Offers this app can send in: an `https` address, a known format, and Connect sign-in or none. */
export function connectDiagnosticsOffers(
  document: ConnectDocumentPayload | undefined,
): ConnectDiagnosticsOffers {
  const offers: { -readonly [Kind in ConnectDiagnosticsKind]?: ConnectDiagnosticsOffers[Kind] } =
    {};
  for (const kind of CONNECT_DIAGNOSTICS_KINDS) {
    const offer = document?.diagnostics?.[kind];
    const url = secureUrl(offer?.url);
    if (!offer || url === null || offer.format !== OFFER_FORMATS[kind]) continue;
    if (offer.auth !== undefined && offer.auth !== "connect") continue;
    offers[kind] = { ...offer, url };
  }
  return offers;
}

/** The hosted app a machine opens for browser sign-in, if the service has one. */
export function connectHostedAppUrl(document: ConnectDocumentPayload | undefined): string | null {
  const url = secureUrl(document?.signIn.hostedAppUrl);
  return url === null ? null : new URL(url).origin;
}

const signInOf = (document: ConnectDocumentPayload) => [
  document.signIn.provider,
  document.signIn.publishableKey,
  document.signIn.jwtTemplate,
  document.signIn.cliOAuthClientId ?? null,
];

/** Sign-in values are read once when an app starts, so a change to them needs a restart. */
function connectSignInChanged(a: ConnectDocumentPayload, b: ConnectDocumentPayload) {
  return signInOf(a).some((value, index) => value !== signInOf(b)[index]);
}

/** What a person would want to know changed between two documents, for "Recent changes". */
export function connectDocumentChanges(
  previous: ConnectDocumentPayload,
  next: ConnectDocumentPayload,
  at: string,
): ReadonlyArray<ConnectServiceChange> {
  const changes: ConnectServiceChange[] = [];
  const text = (
    kind: ConnectServiceChange["kind"],
    from: string | null | undefined,
    to: string | null | undefined,
  ) => {
    if ((from ?? "") === (to ?? "")) return;
    changes.push({ at, kind, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  };
  text("name", previous.service?.name, next.service?.name);
  text("contact", previous.service?.operatorContact, next.service?.operatorContact);
  text("privacy", previous.service?.privacyPolicyUrl, next.service?.privacyPolicyUrl);
  if (connectSignInChanged(previous, next)) changes.push({ at, kind: "sign-in" });
  text("hosted-app", connectHostedAppUrl(previous), connectHostedAppUrl(next));
  const before = connectDiagnosticsOffers(previous);
  const after = connectDiagnosticsOffers(next);
  for (const diagnostics of CONNECT_DIAGNOSTICS_KINDS) {
    const from = before[diagnostics]?.url;
    const to = after[diagnostics]?.url;
    if (from === to) continue;
    const kind =
      from === undefined ? "offer-added" : to === undefined ? "offer-removed" : "offer-changed";
    changes.push({ at, kind, diagnostics, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }
  return changes;
}

const withChanges = (
  trust: ConnectServiceTrust,
  changes: ReadonlyArray<ConnectServiceChange>,
): ConnectServiceTrust =>
  changes.length === 0
    ? trust
    : {
        ...trust,
        recentChanges: [...changes, ...(trust.recentChanges ?? [])].slice(0, MAX_RECENT_CHANGES),
      };

/** Saving a service pins the key it was checked with. The person's answers start empty. */
export function pinConnectService(
  check: Extract<ConnectDocumentCheck, { readonly _tag: "Apply" }>,
  now: Date,
): ConnectServiceTrust {
  return { key: check.key, document: check.document, checkedAt: now.toISOString() };
}

export type ConnectRefreshOutcome =
  | "unchanged"
  | "applied"
  | "rotated"
  | "restart-needed"
  | "identity-changed"
  | "problem";

const keyChangeLine = (from: string, to: string, at: string): ConnectServiceChange => ({
  at,
  kind: "key-rotated",
  from: connectKeyFingerprint(from) ?? from,
  to: connectKeyFingerprint(to) ?? to,
});

/**
 * One later check against the pinned key. Anything but a valid document from the pinned or an
 * endorsed key keeps the last good document in use; sign-in changes wait for a restart.
 */
export function refreshConnectTrust(
  trust: ConnectServiceTrust,
  fetched:
    | { readonly _tag: "Envelope"; readonly envelope: unknown }
    | { readonly _tag: "Unreachable" },
  options: { readonly relayUrl: string; readonly now: Date },
): { readonly trust: ConnectServiceTrust; readonly outcome: ConnectRefreshOutcome } {
  const now = options.now.toISOString();
  if (fetched._tag === "Unreachable") {
    return { trust: { ...trust, refreshProblem: "unreachable" }, outcome: "problem" };
  }
  const check = verifyConnectDocument(fetched.envelope, {
    relayUrl: options.relayUrl,
    pinnedKey: trust.key,
    now: options.now,
  });
  if (check._tag === "Rejected") {
    const refreshProblem = check.problem === "expired" ? "expired" : "invalid";
    return { trust: { ...trust, refreshProblem }, outcome: "problem" };
  }
  const { refreshProblem: _cleared, ...rest } = trust;
  if (check._tag === "IdentityChanged") {
    const { envelope } = check;
    const sameAsBefore = canonicalConnectKey(rest.identityChange?.envelope.key ?? "") === check.key;
    return {
      trust: {
        ...rest,
        identityChange: {
          envelope,
          seenAt: now,
          ...(sameAsBefore && rest.identityChange?.declined ? { declined: true } : {}),
        },
      },
      outcome: "identity-changed",
    };
  }
  const { identityChange: _gone, ...current } = rest;
  if (Date.parse(check.document.issuedAt) < Date.parse(current.document.issuedAt)) {
    return { trust: { ...current, checkedAt: now }, outcome: "unchanged" };
  }
  if (connectSignInChanged(current.document, check.document)) {
    return {
      trust: { ...current, checkedAt: now, pending: { key: check.key, document: check.document } },
      outcome: "restart-needed",
    };
  }
  const { pending: _superseded, ...settled } = current;
  const changes = [
    ...(check.rotatedFrom === null ? [] : [keyChangeLine(check.rotatedFrom, check.key, now)]),
    ...connectDocumentChanges(settled.document, check.document, now),
  ];
  return {
    trust: withChanges(
      { ...settled, key: check.key, document: check.document, checkedAt: now },
      changes,
    ),
    outcome: check.rotatedFrom !== null ? "rotated" : changes.length > 0 ? "applied" : "unchanged",
  };
}

/** A waiting sign-in change becomes the document in use. Only a restart does this. */
export function applyPendingConnectDocument(
  trust: ConnectServiceTrust,
  now: Date,
): ConnectServiceTrust {
  if (!trust.pending) return trust;
  const { pending, refreshProblem: _cleared, ...rest } = trust;
  const at = now.toISOString();
  return withChanges({ ...rest, key: pending.key, document: pending.document, checkedAt: at }, [
    ...(pending.key === rest.key ? [] : [keyChangeLine(rest.key, pending.key, at)]),
    ...connectDocumentChanges(rest.document, pending.document, at),
  ]);
}

/**
 * "Trust the new identity": the stored document is checked again as on first use, and the
 * person's answers to its offers start over, since it may be someone else.
 */
export function trustNewConnectIdentity(
  trust: ConnectServiceTrust,
  options: { readonly relayUrl: string; readonly now: Date },
): Extract<ConnectDocumentCheck, { readonly _tag: "Apply" }> | null {
  if (!trust.identityChange) return null;
  const check = verifyConnectDocument(trust.identityChange.envelope, {
    relayUrl: options.relayUrl,
    pinnedKey: null,
    now: options.now,
  });
  return check._tag === "Apply" ? check : null;
}

export function trustedIdentityChange(
  previous: ConnectServiceTrust,
  check: Extract<ConnectDocumentCheck, { readonly _tag: "Apply" }>,
  now: Date,
): ConnectServiceTrust {
  const at = now.toISOString();
  return withChanges(pinConnectService(check, now), [
    {
      at,
      kind: "identity-trusted",
      from: connectKeyFingerprint(previous.key) ?? previous.key,
      to: connectKeyFingerprint(check.key) ?? check.key,
    },
    ...(previous.recentChanges ?? []),
  ]);
}

/** "Keep using the old settings": the notice stays visible but quiet until the key changes again. */
export function declineConnectIdentityChange(trust: ConnectServiceTrust): ConnectServiceTrust {
  return trust.identityChange
    ? { ...trust, identityChange: { ...trust.identityChange, declined: true } }
    : trust;
}

/** At most once a day, and whenever the last try did not succeed. */
export function connectRefreshDue(trust: ConnectServiceTrust, now: Date): boolean {
  const checkedAt = Date.parse(trust.checkedAt);
  return (
    trust.refreshProblem !== undefined ||
    Number.isNaN(checkedAt) ||
    now.getTime() - checkedAt >= DAY_MS
  );
}

/** The person's own yes for one kind. Anything else, including a missing answer, is no. */
export function connectDiagnosticsAllowed(
  trust: ConnectServiceTrust | undefined,
  kind: ConnectDiagnosticsKind,
): boolean {
  return (
    trust?.diagnostics?.[kind] === true &&
    connectDiagnosticsOffers(trust.document)[kind] !== undefined
  );
}

export function setConnectDiagnosticsAnswer(
  trust: ConnectServiceTrust,
  kind: ConnectDiagnosticsKind,
  allowed: boolean,
): ConnectServiceTrust {
  return { ...trust, diagnostics: { ...trust.diagnostics, [kind]: allowed } };
}
