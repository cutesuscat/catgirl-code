// Catgirl Connect version 2, English only: upstream's catalogs stay untouched.
import type {
  ConnectDiagnosticsKind,
  ConnectRefreshProblem,
  ConnectServiceChange,
} from "@t3tools/contracts";

import type { ConnectDocumentProblem } from "./connectDocument.ts";

export function connectDocumentProblemText(problem: ConnectDocumentProblem | "missing"): string {
  switch (problem) {
    case "bad-signature":
      return "This service's signed document failed its signature check. Nothing was saved.";
    case "fingerprint-mismatch":
      return "This service's identity does not match the fingerprint in the setup link. Nothing was saved.";
    case "relay-mismatch":
      return "This service's signed document is for a different address. Nothing was saved.";
    case "expired":
      return "This service's signed document has expired. Ask its operator to renew it.";
    case "not-yet-valid":
    case "lifetime":
      return "This service's signed document has dates this app cannot accept. Check this device's clock.";
    case "missing":
      return "This service no longer publishes its signed document. Remove it and add it again to use it without one.";
    case "malformed":
    case "unsupported-version":
      return "This app cannot read this service's signed document.";
  }
}

export const CONNECT_DIAGNOSTICS_LABELS: Readonly<
  Record<ConnectDiagnosticsKind, { readonly noun: string; readonly verb: (name: string) => string }>
> = {
  analytics: { noun: "Usage data", verb: (name) => `Send usage data to ${name}` },
  crashReports: { noun: "Crash reports", verb: (name) => `Send crash reports to ${name}` },
  traces: { noun: "Connection traces", verb: (name) => `Send connection traces to ${name}` },
};

export function connectRefreshProblemText(problem: ConnectRefreshProblem): string {
  switch (problem) {
    case "unreachable":
      return "Could not refresh: the service did not answer. The last settings it sent stay in use.";
    case "expired":
      return "Could not refresh: the service's document has expired. The last settings it sent stay in use.";
    case "invalid":
      return "Could not refresh: the service's document failed its check. The last settings it sent stay in use.";
  }
}

const quoted = (value: string | undefined) => (value ? `"${value}"` : "none");

/** A line about a new key, without its two fingerprints, for screens that show them as emoji. */
export function connectKeyChangeText(change: ConnectServiceChange): string | null {
  switch (change.kind) {
    case "key-rotated":
      return "Signing key rotated, endorsed by the old one.";
    case "identity-trusted":
      return "New identity trusted on this device.";
    default:
      return null;
  }
}

/** One line of "Recent changes". */
export function connectChangeText(change: ConnectServiceChange): string {
  const offer = change.diagnostics ? CONNECT_DIAGNOSTICS_LABELS[change.diagnostics].noun : "";
  switch (change.kind) {
    case "name":
      return `Name changed from ${quoted(change.from)} to ${quoted(change.to)}.`;
    case "contact":
      return `Operator contact changed to ${change.to ?? "none"}.`;
    case "privacy":
      return `Privacy policy changed to ${change.to ?? "none"}.`;
    case "sign-in":
      return "Sign-in values changed.";
    case "hosted-app":
      return change.to
        ? `Hosted app changed to ${change.to}.`
        : "Hosted app removed: machines sign in with a code.";
    case "offer-added":
      return `Now offers to receive ${offer.toLowerCase()} at ${change.to ?? "?"}. Off until you turn it on.`;
    case "offer-removed":
      return `No longer offers to receive ${offer.toLowerCase()}.`;
    case "offer-changed":
      return `${offer} address changed to ${change.to ?? "?"}.`;
    case "key-rotated":
      return `Signing key rotated, endorsed by the old one: ${change.from ?? "?"} → ${change.to ?? "?"}.`;
    case "identity-trusted":
      return `New identity trusted on this device: ${change.from ?? "?"} → ${change.to ?? "?"}.`;
  }
}
