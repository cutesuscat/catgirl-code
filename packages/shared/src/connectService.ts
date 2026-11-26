// @effect-diagnostics globalTimers:off globalDate:off - Settings screens call these relay requests outside an Effect runtime; each clears its own deadline and reads the clock for document dates.
import {
  CATGIRL_CONNECT_DOCUMENT_PATH,
  CONNECT_SERVICE_DISCOVERY_PATH,
  CONNECT_SERVICE_DISCOVERY_VERSION,
  type ConnectDocumentPayload,
  ConnectServiceDiscoveryDocument,
  ConnectServiceSettings,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  applyPendingConnectDocument,
  type ConnectDocumentProblem,
  type ConnectRefreshOutcome,
  parseConnectSetupLink,
  pinConnectService,
  refreshConnectTrust,
  trustedIdentityChange,
  trustNewConnectIdentity,
  verifyConnectDocument,
} from "./connectDocument.ts";
import { clerkFrontendApiHostnameFromPublishableKey } from "./relayAuth.ts";
import { normalizeSecureRelayUrl } from "./relayUrl.ts";

export interface ConnectServiceValues {
  readonly relayUrl: string;
  readonly clerkPublishableKey: string;
  readonly clerkJwtTemplate: string;
  readonly clerkCliOAuthClientId: string | null;
}

/** What a build ships with. Any value may be missing; a build with none has Connect off. */
export type BuiltInConnectService = {
  readonly [Key in keyof ConnectServiceValues]: string | null;
};

export type ConnectServiceSource = ConnectServiceSettings["source"] | "built-in" | "none";

export interface ResolvedConnectService extends BuiltInConnectService {
  readonly source: ConnectServiceSource;
}

export type ConnectServiceField = keyof ConnectServiceValues;

/** The text a person typed. Empty sign-in fields mean "ask the relay". */
export type ConnectServiceDraft = { readonly [Key in ConnectServiceField]: string };

const RELAY_METADATA_PATH = "/.well-known/oauth-authorization-server";
const DEFAULT_TIMEOUT_MS = 10_000;
const IDENTIFIER = /^[\w.:-]{1,128}$/u;

const decodeSettings = Schema.decodeUnknownOption(ConnectServiceSettings);
const decodeDiscoveryDocument = Schema.decodeUnknownOption(ConnectServiceDiscoveryDocument);
const decodeRelayMetadata = Schema.decodeUnknownOption(Schema.Struct({ issuer: Schema.String }));

/** Clerk keys are `pk_<test|live>_` followed by base64 of the Frontend API host and a `$`. */
export function isClerkPublishableKey(value: string): boolean {
  const encoded = /^pk_(?:test|live)_(.+)$/u.exec(value)?.[1];
  if (encoded === undefined) return false;
  try {
    if (!globalThis.atob(encoded).endsWith("$")) return false;
    return clerkFrontendApiHostnameFromPublishableKey(value).includes(".");
  } catch {
    return false;
  }
}

export function validateConnectServiceValues(input: {
  readonly [Key in ConnectServiceField]: string | null;
}):
  | { readonly ok: true; readonly values: ConnectServiceValues }
  | { readonly ok: false; readonly fields: ReadonlyArray<ConnectServiceField> } {
  const relayUrl = normalizeSecureRelayUrl(input.relayUrl ?? "");
  const clerkPublishableKey = input.clerkPublishableKey?.trim() ?? "";
  const clerkJwtTemplate = input.clerkJwtTemplate?.trim() ?? "";
  const clerkCliOAuthClientId = input.clerkCliOAuthClientId?.trim() || null;
  const fields: ConnectServiceField[] = [];
  if (relayUrl === null) fields.push("relayUrl");
  if (!isClerkPublishableKey(clerkPublishableKey)) fields.push("clerkPublishableKey");
  if (!IDENTIFIER.test(clerkJwtTemplate)) fields.push("clerkJwtTemplate");
  if (clerkCliOAuthClientId !== null && !IDENTIFIER.test(clerkCliOAuthClientId)) {
    fields.push("clerkCliOAuthClientId");
  }
  return relayUrl === null || fields.length > 0
    ? { ok: false, fields }
    : {
        ok: true,
        values: { relayUrl, clerkPublishableKey, clerkJwtTemplate, clerkCliOAuthClientId },
      };
}

/** Reads what a device stored. Anything unusable reads as "nothing saved", never as an error. */
export function readConnectServiceSettings(stored: unknown): ConnectServiceSettings | null {
  const decoded = decodeSettings(stored);
  if (Option.isNone(decoded)) return null;
  const validated = validateConnectServiceValues(decoded.value);
  if (!validated.ok) return null;
  const { connect } = decoded.value;
  return { ...validated.values, source: decoded.value.source, ...(connect ? { connect } : {}) };
}

export function parseConnectServiceSettings(json: string | null | undefined): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** A saved service replaces the built-in one whole, so the four values always belong together. */
export function resolveConnectService(
  saved: ConnectServiceSettings | null,
  builtIn: BuiltInConnectService,
): ResolvedConnectService {
  if (saved !== null) return saved;
  return {
    ...builtIn,
    source: builtIn.relayUrl && builtIn.clerkPublishableKey ? "built-in" : "none",
  };
}

/** Server and CLI configuration names for a saved service; the server reads these before its build values. */
export function connectServiceEnvironment(
  saved: ConnectServiceSettings | null,
): Record<string, string> {
  if (saved === null) return {};
  return {
    T3CODE_RELAY_URL: saved.relayUrl,
    T3CODE_CLERK_PUBLISHABLE_KEY: saved.clerkPublishableKey,
    T3CODE_CLERK_JWT_TEMPLATE: saved.clerkJwtTemplate,
    ...(saved.clerkCliOAuthClientId
      ? { T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: saved.clerkCliOAuthClientId }
      : {}),
  };
}

function connectServiceDiscoveryUrl(relayUrl: string): string {
  return `${relayUrl}${CONNECT_SERVICE_DISCOVERY_PATH}`;
}

export function connectServiceDiscoveryDocument(
  values: ConnectServiceValues,
): ConnectServiceDiscoveryDocument {
  return {
    version: CONNECT_SERVICE_DISCOVERY_VERSION,
    relayUrl: values.relayUrl,
    clerk: {
      publishableKey: values.clerkPublishableKey,
      jwtTemplate: values.clerkJwtTemplate,
      ...(values.clerkCliOAuthClientId ? { cliOAuthClientId: values.clerkCliOAuthClientId } : {}),
    },
  };
}

export type ConnectServiceFetch = (
  url: string,
  init: {
    readonly signal: AbortSignal;
    readonly redirect: "error";
    readonly headers: { readonly accept: string };
  },
) => Promise<{ readonly status: number; readonly json: () => Promise<unknown> }>;

export interface ConnectServiceRequestOptions {
  readonly fetch: ConnectServiceFetch;
  readonly timeoutMs?: number;
}

type JsonResponse =
  | { readonly _tag: "Json"; readonly body: unknown }
  | { readonly _tag: "Status"; readonly status: number }
  | { readonly _tag: "Unreachable" };

async function getJson(url: string, options: ConnectServiceRequestOptions): Promise<JsonResponse> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    // A relay never redirects these, so a redirect is some other host answering.
    const response = await options.fetch(url, {
      signal: abort.signal,
      redirect: "error",
      headers: { accept: "application/json" },
    });
    if (response.status !== 200) return { _tag: "Status", status: response.status };
    return { _tag: "Json", body: await response.json() };
  } catch {
    return { _tag: "Unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export type ConnectRelayProbe =
  | { readonly _tag: "Relay" }
  | { readonly _tag: "Unreachable" }
  | { readonly _tag: "NotARelay" }
  | { readonly _tag: "RelayAddressMismatch"; readonly relayUrl: string };

/** Every relay already serves this metadata, so it tells a relay from any other web server. */
async function probeConnectRelay(
  relayUrl: string,
  options: ConnectServiceRequestOptions,
): Promise<ConnectRelayProbe> {
  const response = await getJson(`${relayUrl}${RELAY_METADATA_PATH}`, options);
  if (response._tag === "Unreachable") return response;
  if (response._tag === "Status") return { _tag: "NotARelay" };
  const metadata = decodeRelayMetadata(response.body);
  const issuer = Option.isSome(metadata) ? normalizeSecureRelayUrl(metadata.value.issuer) : null;
  if (issuer === null) return { _tag: "NotARelay" };
  // Tokens are bound to the address the relay names itself, so an alias would fail at sign-in.
  return issuer === relayUrl
    ? { _tag: "Relay" }
    : { _tag: "RelayAddressMismatch", relayUrl: issuer };
}

export type ConnectServiceDiscovery =
  | { readonly _tag: "Discovered"; readonly values: ConnectServiceValues }
  | { readonly _tag: "NotPublished" }
  | { readonly _tag: "Unreachable" }
  | { readonly _tag: "UnreadableDocument" };

async function discoverConnectService(
  relayUrl: string,
  options: ConnectServiceRequestOptions,
): Promise<ConnectServiceDiscovery> {
  const response = await getJson(connectServiceDiscoveryUrl(relayUrl), options);
  if (response._tag === "Unreachable") return response;
  if (response._tag === "Status") {
    return response.status === 404 ? { _tag: "NotPublished" } : { _tag: "Unreachable" };
  }
  const document = decodeDiscoveryDocument(response.body);
  if (
    Option.isNone(document) ||
    document.value.version !== CONNECT_SERVICE_DISCOVERY_VERSION ||
    normalizeSecureRelayUrl(document.value.relayUrl) !== relayUrl
  ) {
    return { _tag: "UnreadableDocument" };
  }
  const validated = validateConnectServiceValues({
    relayUrl,
    clerkPublishableKey: document.value.clerk.publishableKey,
    clerkJwtTemplate: document.value.clerk.jwtTemplate,
    clerkCliOAuthClientId: document.value.clerk.cliOAuthClientId ?? null,
  });
  return validated.ok
    ? { _tag: "Discovered", values: validated.values }
    : { _tag: "UnreadableDocument" };
}

type FetchedConnectDocument =
  | { readonly _tag: "Envelope"; readonly envelope: unknown }
  | { readonly _tag: "NotPublished" }
  | { readonly _tag: "Unreachable" };

async function fetchConnectDocument(
  relayUrl: string,
  options: ConnectServiceRequestOptions,
): Promise<FetchedConnectDocument> {
  const response = await getJson(`${relayUrl}${CATGIRL_CONNECT_DOCUMENT_PATH}`, options);
  if (response._tag === "Json") return { _tag: "Envelope", envelope: response.body };
  return response._tag === "Status" && response.status === 404
    ? { _tag: "NotPublished" }
    : { _tag: "Unreachable" };
}

/** The four values a signed document names, if this app can use them. */
function connectDocumentValues(
  relayUrl: string,
  document: ConnectDocumentPayload,
): ConnectServiceValues | null {
  if (document.signIn.provider !== "clerk") return null;
  const validated = validateConnectServiceValues({
    relayUrl,
    clerkPublishableKey: document.signIn.publishableKey,
    clerkJwtTemplate: document.signIn.jwtTemplate,
    clerkCliOAuthClientId: document.signIn.cliOAuthClientId ?? null,
  });
  return validated.ok ? validated.values : null;
}

export type ConnectServiceCheck =
  | { readonly _tag: "Ready"; readonly settings: ConnectServiceSettings }
  | { readonly _tag: "InvalidFields"; readonly fields: ReadonlyArray<ConnectServiceField> }
  | Exclude<ConnectRelayProbe, { readonly _tag: "Relay" }>
  | Exclude<ConnectServiceDiscovery, { readonly _tag: "Discovered" | "Unreachable" }>
  | { readonly _tag: "DocumentRejected"; readonly problem: ConnectDocumentProblem | "missing" }
  | { readonly _tag: "IdentityChanged"; readonly settings: ConnectServiceSettings };

export interface ConnectServiceCheckOptions extends ConnectServiceRequestOptions {
  /** What this device has saved now: a pinned key for the same address is checked against. */
  readonly saved?: ConnectServiceSettings | null;
  readonly now?: Date;
}

async function checkSignedConnectService(
  relayUrl: string,
  fingerprint: string | null,
  options: ConnectServiceCheckOptions,
): Promise<ConnectServiceCheck | null> {
  const now = options.now ?? new Date();
  const saved = options.saved?.relayUrl === relayUrl ? options.saved : null;
  const pinned = saved?.connect;
  const fetched = await fetchConnectDocument(relayUrl, options);
  if (pinned !== undefined && saved !== null) {
    if (fetched._tag !== "Envelope") {
      return fetched._tag === "NotPublished"
        ? { _tag: "DocumentRejected", problem: "missing" }
        : { _tag: "Unreachable" };
    }
    const refreshed = refreshConnectTrust(pinned, fetched, { relayUrl, now });
    if (refreshed.outcome === "identity-changed") {
      return { _tag: "IdentityChanged", settings: { ...saved, connect: refreshed.trust } };
    }
    if (refreshed.outcome === "problem") {
      const check = verifyConnectDocument(fetched.envelope, {
        relayUrl,
        pinnedKey: pinned.key,
        now,
      });
      return {
        _tag: "DocumentRejected",
        problem: check._tag === "Rejected" ? check.problem : "malformed",
      };
    }
    return readyFromTrust(relayUrl, applyPendingConnectDocument(refreshed.trust, now));
  }
  if (fetched._tag !== "Envelope") return null;
  const check = verifyConnectDocument(fetched.envelope, {
    relayUrl,
    pinnedKey: null,
    expectedFingerprint: fingerprint,
    now,
  });
  if (check._tag === "Rejected") {
    // Another version is for other apps: this one falls back to version 1, then to typing.
    return check.problem === "unsupported-version"
      ? null
      : { _tag: "DocumentRejected", problem: check.problem };
  }
  if (check._tag === "IdentityChanged") return { _tag: "DocumentRejected", problem: "malformed" };
  return readyFromTrust(relayUrl, pinConnectService(check, now));
}

function readyFromTrust(
  relayUrl: string,
  trust: NonNullable<ConnectServiceSettings["connect"]>,
): ConnectServiceCheck {
  const values = connectDocumentValues(relayUrl, trust.document);
  return values === null
    ? { _tag: "UnreadableDocument" }
    : { _tag: "Ready", settings: { ...values, source: "discovered", connect: trust } };
}

/**
 * Turns what a person typed into settings that are safe to save: the address must be a relay
 * that answers. A signed document wins, then the version 1 values, unless any were typed in.
 */
export async function checkConnectService(
  draft: ConnectServiceDraft,
  options: ConnectServiceCheckOptions,
): Promise<ConnectServiceCheck> {
  const link = parseConnectSetupLink(draft.relayUrl);
  const relayUrl = normalizeSecureRelayUrl(link.address);
  if (relayUrl === null) return { _tag: "InvalidFields", fields: ["relayUrl"] };
  const manual =
    `${draft.clerkPublishableKey}${draft.clerkJwtTemplate}${draft.clerkCliOAuthClientId}`.trim()
      .length > 0;
  if (manual) {
    const validated = validateConnectServiceValues({ ...draft, relayUrl });
    if (!validated.ok) return { _tag: "InvalidFields", fields: validated.fields };
    const probe = await probeConnectRelay(relayUrl, options);
    return probe._tag === "Relay"
      ? { _tag: "Ready", settings: { ...validated.values, source: "manual" } }
      : probe;
  }
  const probe = await probeConnectRelay(relayUrl, options);
  if (probe._tag !== "Relay") return probe;
  const signed = await checkSignedConnectService(relayUrl, link.fingerprint, options);
  if (signed !== null) return signed;
  // A setup link names a key; an unsigned service cannot show one, so it cannot match.
  if (link.fingerprint !== null)
    return { _tag: "DocumentRejected", problem: "fingerprint-mismatch" };
  const discovery = await discoverConnectService(relayUrl, options);
  return discovery._tag === "Discovered"
    ? { _tag: "Ready", settings: { ...discovery.values, source: "discovered" } }
    : discovery;
}

/** The daily check of a saved signed service. `null` when there is nothing signed to check. */
export async function refreshConnectService(
  saved: ConnectServiceSettings,
  options: ConnectServiceRequestOptions & { readonly now?: Date },
): Promise<{
  readonly settings: ConnectServiceSettings;
  readonly outcome: ConnectRefreshOutcome;
} | null> {
  if (!saved.connect) return null;
  const fetched = await fetchConnectDocument(saved.relayUrl, options);
  const refreshed = refreshConnectTrust(
    saved.connect,
    fetched._tag === "Envelope" ? fetched : { _tag: "Unreachable" },
    { relayUrl: saved.relayUrl, now: options.now ?? new Date() },
  );
  return { settings: { ...saved, connect: refreshed.trust }, outcome: refreshed.outcome };
}

/** The settings a restart applies: a waiting sign-in change, or the identity a person trusted. */
export function connectServiceAfterRestart(
  saved: ConnectServiceSettings,
  change: "pending" | "trust-new-identity",
  now = new Date(),
): ConnectServiceSettings | null {
  const trust = saved.connect;
  if (!trust) return null;
  if (change === "pending") {
    if (!trust.pending) return null;
    const ready = readyFromTrust(saved.relayUrl, applyPendingConnectDocument(trust, now));
    return ready._tag === "Ready" ? ready.settings : null;
  }
  const check = trustNewConnectIdentity(trust, { relayUrl: saved.relayUrl, now });
  if (check === null) return null;
  const ready = readyFromTrust(saved.relayUrl, trustedIdentityChange(trust, check, now));
  return ready._tag === "Ready" ? ready.settings : null;
}

/** Whether moving from one saved record to another changes what the sign-in library starts with. */
export function connectServiceNeedsRestart(
  before: ConnectServiceSettings | null,
  after: ConnectServiceSettings | null,
): boolean {
  if (before === null || after === null) return before !== after;
  return (
    before.relayUrl !== after.relayUrl ||
    before.clerkPublishableKey !== after.clerkPublishableKey ||
    before.clerkJwtTemplate !== after.clerkJwtTemplate ||
    before.clerkCliOAuthClientId !== after.clerkCliOAuthClientId
  );
}
