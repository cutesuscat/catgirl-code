import type { EnvironmentId, ServerObservability } from "@t3tools/contracts";

import { useServerConfigs } from "./entities";

export interface UsageData {
  /** The machine's server says it sends no usage data, so there is nothing to give notice of. */
  readonly off: boolean;
  /** Where a Catgirl Code server was told to send it. Undefined for a server that does not say. */
  readonly host: string | undefined;
}

const hostOf = (url: string | undefined) =>
  url !== undefined && URL.canParse(url) ? new URL(url).host : url;

/**
 * A Catgirl Code server says whether it sends usage data and where. Upstream's server says
 * neither, so its relay tracing flag stands in: it follows the same switches as its analytics.
 */
export function usageDataFor(observability: ServerObservability | undefined): UsageData {
  if (observability === undefined) return { off: false, host: undefined };
  if (observability.analyticsEnabled === undefined) {
    return { off: observability.relayTracingAllowed === false, host: undefined };
  }
  return observability.analyticsEnabled
    ? { off: false, host: hostOf(observability.analyticsUrl) }
    : { off: true, host: undefined };
}

export function useUsageData(environmentId: EnvironmentId | null | undefined): UsageData {
  const serverConfigs = useServerConfigs();
  return usageDataFor(
    environmentId == null ? undefined : serverConfigs.get(environmentId)?.observability,
  );
}

/** The notice for a machine that sends usage data to an address its owner chose. English only. */
export const usageDataSentTo = (host: string) =>
  `This machine sends anonymous usage data to ${host}, the address set for it under Usage analytics in Settings.`;
