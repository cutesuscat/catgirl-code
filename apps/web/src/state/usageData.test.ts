import type { ServerObservability } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { usageDataFor, usageDataSentTo } from "./usageData";

const base: ServerObservability = {
  logsDirectoryPath: "/tmp/logs",
  localTracingEnabled: true,
  otlpTracesEnabled: false,
  otlpMetricsEnabled: false,
  otlpLogsEnabled: false,
};

describe("usageDataFor", () => {
  it("names the host a Catgirl Code server sends usage data to", () => {
    const usageData = usageDataFor({
      ...base,
      analyticsEnabled: true,
      analyticsUrl: "https://eu.i.posthog.example:8443/ingest",
      analyticsUrlSource: "settings",
      analyticsKeySource: "settings",
    });
    expect(usageData).toEqual({ off: false, host: "eu.i.posthog.example:8443" });
    expect(usageDataSentTo(usageData.host!)).toContain("eu.i.posthog.example:8443");
    expect(usageDataSentTo(usageData.host!)).not.toContain("T3 Code");
  });

  it("is off for a Catgirl Code server that sends none, whatever relay tracing says", () => {
    expect(usageDataFor({ ...base, analyticsEnabled: false, relayTracingAllowed: true })).toEqual({
      off: true,
      host: undefined,
    });
    expect(
      usageDataFor({
        ...base,
        analyticsEnabled: false,
        analyticsUrl: "https://collector.example",
        analyticsUrlSource: "settings",
        analyticsKeySource: "settings",
      }),
    ).toEqual({ off: true, host: undefined });
  });

  it("reads upstream's server by its relay tracing flag and names no host for it", () => {
    expect(usageDataFor(base)).toEqual({ off: false, host: undefined });
    expect(usageDataFor({ ...base, relayTracingAllowed: true })).toEqual({
      off: false,
      host: undefined,
    });
    expect(usageDataFor({ ...base, relayTracingAllowed: false })).toEqual({
      off: true,
      host: undefined,
    });
    expect(usageDataFor(undefined)).toEqual({ off: false, host: undefined });
  });
});
