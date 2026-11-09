import { resolveCloudPublicConfig } from "../features/cloud/publicConfig";

/** `https://*.parent/` for an HTTPS address, so one certificate covers every sibling machine. */
export function wildcardCertificateOrigin(address: string): string | null {
  try {
    const url = new URL(address);
    if (url.protocol !== "https:" || (url.port && url.port !== "443")) return null;
    const labels = url.hostname.split(".");
    if (labels.length < 3 || labels.every((label) => /^\d+$/.test(label))) return null;
    return `https://*.${labels.slice(1).join(".")}/`;
  } catch {
    return null;
  }
}

/** The default certificate scope: every machine under the T3 Connect relay's parent domain. */
export function relayCertificateOrigin(): string | null {
  return wildcardCertificateOrigin(resolveCloudPublicConfig().relay.url ?? "");
}
