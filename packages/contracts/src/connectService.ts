import * as Schema from "effect/Schema";

/** Where a relay publishes the public sign-in values its clients need. */
export const CONNECT_SERVICE_DISCOVERY_PATH = "/.well-known/t3-connect.json";

export const CONNECT_SERVICE_DISCOVERY_VERSION = 1;

/**
 * Version 1 of the document. New optional fields keep the version; a change an old client
 * cannot read bumps it, and that client then asks for the values by hand.
 */
export const ConnectServiceDiscoveryDocument = Schema.Struct({
  version: Schema.Number,
  relayUrl: Schema.String,
  clerk: Schema.Struct({
    publishableKey: Schema.String,
    jwtTemplate: Schema.String,
    cliOAuthClientId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});
export type ConnectServiceDiscoveryDocument = typeof ConnectServiceDiscoveryDocument.Type;

/** Catgirl Connect version 2: one signed document per instance, beside version 1. */
export const CATGIRL_CONNECT_DOCUMENT_PATH = "/.well-known/catgirl-connect.json";

export const CATGIRL_CONNECT_DOCUMENT_VERSION = 2;

/** The payload is signed as bytes, so it travels as base64url and is parsed only once verified. */
export const ConnectDocumentEnvelope = Schema.Struct({
  payload: Schema.String,
  signature: Schema.String,
  key: Schema.String,
});
export type ConnectDocumentEnvelope = typeof ConnectDocumentEnvelope.Type;

export const ConnectDiagnosticsKind = Schema.Literals(["analytics", "crashReports", "traces"]);
export type ConnectDiagnosticsKind = typeof ConnectDiagnosticsKind.Type;

/** A destination the service offers. It never turns anything on by itself. */
export const ConnectDiagnosticsOffer = Schema.Struct({
  url: Schema.String,
  format: Schema.String,
  auth: Schema.optionalKey(Schema.String),
});
export type ConnectDiagnosticsOffer = typeof ConnectDiagnosticsOffer.Type;

export const ConnectDocumentPayload = Schema.Struct({
  version: Schema.Number,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
  relayUrl: Schema.String,
  service: Schema.optionalKey(
    Schema.Struct({
      name: Schema.optionalKey(Schema.String),
      operatorContact: Schema.optionalKey(Schema.String),
      privacyPolicyUrl: Schema.optionalKey(Schema.String),
    }),
  ),
  signIn: Schema.Struct({
    provider: Schema.String,
    publishableKey: Schema.String,
    jwtTemplate: Schema.String,
    cliOAuthClientId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    hostedAppUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
  diagnostics: Schema.optionalKey(
    Schema.Struct({
      analytics: Schema.optionalKey(ConnectDiagnosticsOffer),
      crashReports: Schema.optionalKey(ConnectDiagnosticsOffer),
      traces: Schema.optionalKey(ConnectDiagnosticsOffer),
    }),
  ),
  keyRotation: Schema.optionalKey(
    Schema.Struct({ previousKey: Schema.String, endorsement: Schema.String }),
  ),
});
export type ConnectDocumentPayload = typeof ConnectDocumentPayload.Type;

export const ConnectServiceChangeKind = Schema.Literals([
  "name",
  "contact",
  "privacy",
  "sign-in",
  "hosted-app",
  "offer-added",
  "offer-removed",
  "offer-changed",
  "key-rotated",
  "identity-trusted",
]);
export type ConnectServiceChangeKind = typeof ConnectServiceChangeKind.Type;

export const ConnectServiceChange = Schema.Struct({
  at: Schema.String,
  kind: ConnectServiceChangeKind,
  diagnostics: Schema.optionalKey(ConnectDiagnosticsKind),
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
});
export type ConnectServiceChange = typeof ConnectServiceChange.Type;

export const ConnectRefreshProblem = Schema.Literals(["unreachable", "expired", "invalid"]);
export type ConnectRefreshProblem = typeof ConnectRefreshProblem.Type;

/**
 * What a device or machine knows about a signed service: the key it pinned, the last document it
 * applied, and the person's own answer for each diagnostics offer.
 */
export const ConnectServiceTrust = Schema.Struct({
  key: Schema.String,
  document: ConnectDocumentPayload,
  checkedAt: Schema.String,
  refreshProblem: Schema.optionalKey(ConnectRefreshProblem),
  /** A newer verified document whose sign-in values differ: it applies only through a restart. */
  pending: Schema.optionalKey(
    Schema.Struct({ key: Schema.String, document: ConnectDocumentPayload }),
  ),
  /** A document signed by a key nobody endorsed. Nothing from it is used until a person trusts it. */
  identityChange: Schema.optionalKey(
    Schema.Struct({
      envelope: ConnectDocumentEnvelope,
      seenAt: Schema.String,
      declined: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  recentChanges: Schema.optionalKey(Schema.Array(ConnectServiceChange)),
  diagnostics: Schema.optionalKey(
    Schema.Struct({
      analytics: Schema.optionalKey(Schema.Boolean),
      crashReports: Schema.optionalKey(Schema.Boolean),
      traces: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});
export type ConnectServiceTrust = typeof ConnectServiceTrust.Type;

export const ConnectServiceSettingsSource = Schema.Literals(["discovered", "manual"]);
export type ConnectServiceSettingsSource = typeof ConnectServiceSettingsSource.Type;

/** The Connect service a device saved in place of the one its build ships with. */
export const ConnectServiceSettings = Schema.Struct({
  relayUrl: Schema.String,
  clerkPublishableKey: Schema.String,
  clerkJwtTemplate: Schema.String,
  clerkCliOAuthClientId: Schema.NullOr(Schema.String),
  source: ConnectServiceSettingsSource,
  /** Set when the values came from a signed version 2 document. Older apps ignore it. */
  connect: Schema.optionalKey(ConnectServiceTrust),
});
export type ConnectServiceSettings = typeof ConnectServiceSettings.Type;
