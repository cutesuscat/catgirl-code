import type { ConnectServiceSettings } from "@t3tools/contracts";
import {
  type BuiltInConnectService,
  type ConnectServiceDraft,
  checkConnectService,
  parseConnectServiceSettings,
  readConnectServiceSettings,
} from "@t3tools/shared/connectService";

const STORAGE_KEY = "t3code.connect-service.v1";

// Loaded on use: this module sits under the public config, which code without native modules imports.
const secureStore = () => require("expo-secure-store") as typeof import("expo-secure-store");

function readSavedConnectService(): ConnectServiceSettings | null {
  // A value this app cannot read is the same as none: startup must never depend on it.
  try {
    return readConnectServiceSettings(
      parseConnectServiceSettings(secureStore().getItem(STORAGE_KEY)),
    );
  } catch {
    return null;
  }
}

let savedAtStartup: ConnectServiceSettings | null | undefined;

/**
 * Read once. Clerk and the relay client are built from it while the app loads, so a service
 * saved later takes effect on the next start and never half-applies to this one.
 */
export function savedConnectService(): ConnectServiceSettings | null {
  if (savedAtStartup === undefined) savedAtStartup = readSavedConnectService();
  return savedAtStartup;
}

/** Mobile has no command-line sign-in, so its builds carry no client ID for it. */
export function builtInConnectService(config: {
  readonly clerk: { readonly publishableKey: string | null; readonly jwtTemplate: string | null };
  readonly relay: { readonly url: string | null };
}): BuiltInConnectService {
  return {
    relayUrl: config.relay.url,
    clerkPublishableKey: config.clerk.publishableKey,
    clerkJwtTemplate: config.clerk.jwtTemplate,
    clerkCliOAuthClientId: null,
  };
}

export function checkConnectServiceDraft(draft: ConnectServiceDraft) {
  return checkConnectService(draft, {
    fetch: (url, init) => globalThis.fetch(url, { ...init, credentials: "omit" }),
  });
}

/** Stores the service for the next start, or clears it to return to the built-in one. */
export function storeConnectService(settings: ConnectServiceSettings | null): void {
  if (settings === null)
    secureStore()
      .deleteItemAsync(STORAGE_KEY)
      .catch(() => undefined);
  else secureStore().setItem(STORAGE_KEY, JSON.stringify(settings));
}
