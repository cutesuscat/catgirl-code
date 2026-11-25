import type { ConnectServiceSettings } from "@t3tools/contracts";
import {
  type BuiltInConnectService,
  type ConnectServiceDraft,
  checkConnectService,
  parseConnectServiceSettings,
  readConnectServiceSettings,
  resolveConnectService,
  type ResolvedConnectService,
} from "@t3tools/shared/connectService";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";

const STORAGE_KEY = "t3code:connect-service:v1";

const trimmed = (value: string | undefined): string | null => value?.trim() || null;

/** The service this build ships with. An empty build has T3 Connect off until one is saved. */
export function builtInConnectService(): BuiltInConnectService {
  return {
    relayUrl: normalizeSecureRelayUrl(
      (import.meta.env.VITE_T3CODE_RELAY_URL as string | undefined) ?? "",
    ),
    clerkPublishableKey: trimmed(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined),
    clerkJwtTemplate: trimmed(import.meta.env.VITE_CLERK_JWT_TEMPLATE as string | undefined),
    clerkCliOAuthClientId: trimmed(
      import.meta.env.VITE_CLERK_CLI_OAUTH_CLIENT_ID as string | undefined,
    ),
  };
}

function readSavedConnectService(): ConnectServiceSettings | null {
  if (typeof window === "undefined") return null;
  // A value this app cannot read is the same as none: startup must never depend on it.
  try {
    const readFromDesktop = window.desktopBridge?.getConnectService;
    return readConnectServiceSettings(
      readFromDesktop
        ? readFromDesktop()
        : parseConnectServiceSettings(window.localStorage.getItem(STORAGE_KEY)),
    );
  } catch {
    return null;
  }
}

let savedAtStartup: ConnectServiceSettings | null | undefined;

/**
 * Read once. Sign-in and the relay client are built from it while the app loads, so a service
 * saved later takes effect on the next load and never half-applies to this one.
 */
function savedConnectService(): ConnectServiceSettings | null {
  if (savedAtStartup === undefined) savedAtStartup = readSavedConnectService();
  return savedAtStartup;
}

export function appliedConnectService(): ResolvedConnectService {
  return resolveConnectService(savedConnectService(), builtInConnectService());
}

export function checkConnectServiceDraft(draft: ConnectServiceDraft) {
  return checkConnectService(draft, {
    fetch: (url, init) => globalThis.fetch(url, { ...init, credentials: "omit" }),
  });
}

/** Saves the service, or returns to the built-in one for `null`, and reloads the app onto it. */
export async function saveConnectService(settings: ConnectServiceSettings | null): Promise<void> {
  if (window.desktopBridge?.setConnectService) {
    await window.desktopBridge.setConnectService(settings);
    return;
  }
  if (settings === null) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.location.reload();
}

export function __resetSavedConnectServiceForTests(): void {
  savedAtStartup = undefined;
}
