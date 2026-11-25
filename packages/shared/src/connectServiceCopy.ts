import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import type {
  ConnectServiceCheck,
  ConnectServiceField,
  ConnectServiceSource,
} from "./connectService.ts";

const INVALID_FIELD_COPY: Readonly<Record<ConnectServiceField, string>> = {
  relayUrl: msg("Enter the address as https://, with no path."),
  clerkPublishableKey: msg("The sign-in key should start with pk_live_ or pk_test_."),
  clerkJwtTemplate: msg("Enter the token template name, such as t3-relay."),
  clerkCliOAuthClientId: msg("The command-line client ID has characters it cannot contain."),
};

/** Why a Connect service could not be saved, in the order a person would fix it. */
export function connectServiceCheckProblem(
  check: Exclude<ConnectServiceCheck, { readonly _tag: "Ready" }>,
  resolve: MFunctionType = mFallback,
): string {
  switch (check._tag) {
    case "InvalidFields":
      return resolve(INVALID_FIELD_COPY[check.fields[0] ?? "relayUrl"]);
    case "Unreachable":
      return resolve(
        msg("Could not reach a T3 Connect service at this address. Check it and your connection."),
      );
    case "NotARelay":
      return resolve(msg("This address answers, but it is not a T3 Connect service."));
    case "RelayAddressMismatch":
      return resolve(
        msg("This service is known by another address. Use {relayUrl} instead.", {
          relayUrl: check.relayUrl,
        }),
      );
    case "NotPublished":
      return resolve(
        msg("This service does not publish its sign-in values. Enter them under Advanced."),
      );
    case "UnreadableDocument":
      return resolve(
        msg(
          "This app cannot read the sign-in values this service publishes. Enter them under Advanced.",
        ),
      );
  }
}

export function connectServiceSourceLabel(
  source: ConnectServiceSource,
  resolve: MFunctionType = mFallback,
): string {
  switch (source) {
    case "built-in":
      return resolve(msg("Built into this app"));
    case "discovered":
      return resolve(msg("Sign-in values published by the service"));
    case "manual":
      return resolve(msg("Sign-in values entered on this device"));
    case "none":
      return resolve(msg("Not set up"));
  }
}
