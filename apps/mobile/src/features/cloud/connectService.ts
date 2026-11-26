import type { ConnectServiceSettings } from "@t3tools/contracts";
import { connectRefreshDue } from "@t3tools/shared/connectDocument";
import {
  type BuiltInConnectService,
  type ConnectServiceDraft,
  checkConnectService,
  connectServiceNeedsRestart,
  parseConnectServiceSettings,
  readConnectServiceSettings,
  refreshConnectService,
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

const fetchWithoutCredentials: Parameters<typeof checkConnectService>[1]["fetch"] = (url, init) =>
  globalThis.fetch(url, { ...init, credentials: "omit" });

export function checkConnectServiceDraft(draft: ConnectServiceDraft) {
  return checkConnectService(draft, {
    fetch: fetchWithoutCredentials,
    saved: currentConnectService(),
  });
}

let liveConnectService: ConnectServiceSettings | null | undefined;
const liveListeners = new Set<() => void>();

/** The saved record as it is now: what started the app, plus later checks of its document. */
export function currentConnectService(): ConnectServiceSettings | null {
  if (liveConnectService === undefined) liveConnectService = savedConnectService();
  return liveConnectService;
}

export function subscribeConnectService(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

/** Saves a later check of the service the app started with; refused if sign-in values would change. */
export function updateConnectService(settings: ConnectServiceSettings): boolean {
  if (connectServiceNeedsRestart(savedConnectService(), settings)) return false;
  secureStore().setItem(STORAGE_KEY, JSON.stringify(settings));
  liveConnectService = settings;
  for (const listener of liveListeners) listener();
  return true;
}

let refreshing: Promise<void> | null = null;

/** At start, at most once a day: re-check a signed service's document against its pinned key. */
export function refreshConnectServiceIfDue(now = new Date()): Promise<void> {
  const saved = currentConnectService();
  if (!saved?.connect || !connectRefreshDue(saved.connect, now)) return Promise.resolve();
  refreshing ??= refreshConnectService(saved, { fetch: fetchWithoutCredentials, now })
    .then((refreshed) => {
      if (refreshed !== null) updateConnectService(refreshed.settings);
    })
    .catch(() => undefined)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Stores the service for the next start, or clears it to return to the built-in one. */
export function storeConnectService(settings: ConnectServiceSettings | null): void {
  if (settings === null)
    secureStore()
      .deleteItemAsync(STORAGE_KEY)
      .catch(() => undefined);
  else secureStore().setItem(STORAGE_KEY, JSON.stringify(settings));
}
