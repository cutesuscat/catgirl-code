import { CONNECT_SERVICE_DISCOVERY_PATH } from "@t3tools/contracts";
import {
  connectServiceDiscoveryDocument,
  validateConnectServiceValues,
} from "@t3tools/shared/connectService";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

export interface ConnectServiceDiscoverySettings {
  readonly relayUrl: string;
  readonly clerkPublishableKey: string;
  readonly clerkJwtTemplate: string | undefined;
  readonly clerkCliOAuthClientId: string | undefined;
}

/**
 * Publishes the public sign-in values an app needs to use this relay. A relay that was not
 * given its token template name answers 404, and apps then ask for the values by hand.
 */
function connectServiceDiscoveryResponse(settings: ConnectServiceDiscoverySettings) {
  const validated = validateConnectServiceValues({
    relayUrl: settings.relayUrl,
    clerkPublishableKey: settings.clerkPublishableKey,
    clerkJwtTemplate: settings.clerkJwtTemplate ?? null,
    clerkCliOAuthClientId: settings.clerkCliOAuthClientId ?? null,
  });
  return validated.ok
    ? HttpServerResponse.jsonUnsafe(connectServiceDiscoveryDocument(validated.values), {
        headers: { "cache-control": "public, max-age=300" },
      })
    : HttpServerResponse.empty({ status: 404 });
}

export const layerRoute = (settings: ConnectServiceDiscoverySettings) =>
  HttpRouter.add("GET", CONNECT_SERVICE_DISCOVERY_PATH, connectServiceDiscoveryResponse(settings));
