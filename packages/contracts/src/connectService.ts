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

export const ConnectServiceSettingsSource = Schema.Literals(["discovered", "manual"]);
export type ConnectServiceSettingsSource = typeof ConnectServiceSettingsSource.Type;

/** The Connect service a device saved in place of the one its build ships with. */
export const ConnectServiceSettings = Schema.Struct({
  relayUrl: Schema.String,
  clerkPublishableKey: Schema.String,
  clerkJwtTemplate: Schema.String,
  clerkCliOAuthClientId: Schema.NullOr(Schema.String),
  source: ConnectServiceSettingsSource,
});
export type ConnectServiceSettings = typeof ConnectServiceSettings.Type;
