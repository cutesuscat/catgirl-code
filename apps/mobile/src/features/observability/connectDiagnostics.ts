// @effect-diagnostics globalFetch:off globalDate:off - Called from fetch inside the OTLP exporter, outside an Effect runtime.
// Catgirl Connect: what this phone sends to its service's diagnostics offers, after its own yes.
import {
  connectDiagnosticsAllowed,
  connectDiagnosticsOffers,
} from "@t3tools/shared/connectDocument";

import { currentConnectService, savedConnectService } from "../cloud/connectService";

const TOKEN_MARGIN_MS = 60_000;

async function relayCredential(): Promise<string> {
  // Loaded on use: this module sits under tracing, which tests import without native modules.
  const { getClerkInstance } = require("@clerk/expo") as typeof import("@clerk/expo");
  const { resolveCloudPublicConfig, resolveRelayClerkTokenOptions } =
    require("../cloud/publicConfig") as typeof import("../cloud/publicConfig");
  const { publishableKey } = resolveCloudPublicConfig().clerk;
  const session = publishableKey ? getClerkInstance({ publishableKey }).session : null;
  const token = session ? await session.getToken(resolveRelayClerkTokenOptions()) : null;
  if (!token) throw new Error("Not signed in to Catgirl Connect.");
  return token;
}

/** A short-lived token from `<relay>/v1/collect/token`, asked for with this phone's Connect sign-in. */
async function requestCollectToken(relayUrl: string, credential: () => Promise<string>) {
  const response = await globalThis.fetch(`${relayUrl}/v1/collect/token`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await credential()}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const body: unknown = response.ok ? await response.json() : null;
  const token = typeof body === "object" && body !== null ? Reflect.get(body, "token") : undefined;
  const expiresAt =
    typeof body === "object" && body !== null ? Reflect.get(body, "expiresAt") : undefined;
  if (typeof token !== "string" || typeof expiresAt !== "string") {
    throw new Error("The Connect service gave no collect token.");
  }
  return { token, until: Date.parse(expiresAt) - TOKEN_MARGIN_MS };
}

/** Sends with a collect token in place of a build's own trace token, reused until it nearly expires. */
export function fetchWithCollectToken(
  relayUrl: string,
  credential: () => Promise<string> = relayCredential,
): typeof fetch {
  let cached: { readonly token: string; readonly until: number } | null = null;
  return async (input, init) => {
    if (cached === null || cached.until <= Date.now()) {
      cached = await requestCollectToken(relayUrl, credential);
    }
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${cached.token}`);
    headers.delete("x-axiom-dataset");
    return globalThis.fetch(input, { ...init, headers });
  };
}

/**
 * The service's connection-traces offer this app started with. The exporter is built once at
 * start; whether anything is sent follows the phone's answer as it is now.
 */
export function connectTracesOffer() {
  const saved = savedConnectService();
  const offer = connectDiagnosticsOffers(saved?.connect?.document).traces;
  if (!saved || !offer) return null;
  return {
    relayUrl: saved.relayUrl,
    config: { tracesUrl: offer.url, tracesDataset: "connect", tracesToken: "connect" },
    isEnabled: () => connectDiagnosticsAllowed(currentConnectService()?.connect, "traces"),
  };
}
