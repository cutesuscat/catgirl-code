import { describe, expect, it } from "@effect/vitest";

import * as CollectPayloads from "./CollectPayloads.ts";

const NOW = Date.parse("2026-11-26T12:00:00Z");

/** The body `AnalyticsService.sendBatch` in apps/server posts to `<address>/batch/`. */
const serverBatch = {
  api_key: "cgc1.token.mac",
  batch: [
    {
      uuid: "0b6f5a40-1d2c-4f7e-9a51-6d2b8f0c1a11",
      event: "server.boot.heartbeat",
      distinct_id: "a1b2c3d4e5f6",
      properties: {
        installId: "a1b2c3d4e5f6",
        $process_person_profile: false,
        platform: "linux",
        arch: "x64",
        t3CodeVersion: "1.12.3",
        telemetryChannel: "dev",
        clientType: "web",
        serverOs: "linux",
        serverArch: "x64",
        serverAppVersion: "1.12.3",
        serverMode: "web",
      },
      timestamp: "2026-11-26T11:59:58.123Z",
    },
    {
      uuid: "2a3b4c5d-0000-4000-8000-000000000002",
      event: "install.owner_observed",
      distinct_id: "a1b2c3d4e5f6",
      properties: {
        ownerSource: "connect",
        ownerId: "hashed-connect-account",
        observedBy: "server",
        installId: "a1b2c3d4e5f6",
        t3CodeVersion: "1.12.3",
      },
      timestamp: "2026-11-26T11:59:59.000Z",
    },
    {
      uuid: "3c4d5e6f-0000-4000-8000-000000000003",
      event: "feedback.submitted",
      distinct_id: "3c4d5e6f-0000-4000-8000-000000000003",
      properties: {
        $process_person_profile: false,
        t3CodeVersion: "1.12.3",
        telemetryChannel: "dev",
      },
      timestamp: "2020-01-01T00:00:00.000Z",
    },
  ],
};

describe("analytics batches", () => {
  it("keeps the install id, the day and the payload, and drops anything naming an account", () => {
    const parsed = CollectPayloads.parseAnalyticsBatch(serverBatch, NOW);
    expect(parsed?.apiKey).toBe("cgc1.token.mac");
    expect(parsed?.skipped).toBe(0);
    expect(parsed?.rows.map(({ payload: _payload, ...row }) => row)).toEqual([
      {
        day: "2026-11-26",
        kind: "analytics",
        event: "server.boot.heartbeat",
        appVersion: "1.12.3",
        installId: "a1b2c3d4e5f6",
      },
      {
        day: "2026-11-26",
        kind: "analytics",
        event: "install.owner_observed",
        appVersion: "1.12.3",
        installId: "a1b2c3d4e5f6",
      },
      // An anonymous event carries a random per-event id; a stale timestamp lands on the arrival day.
      {
        day: "2026-11-26",
        kind: "analytics",
        event: "feedback.submitted",
        appVersion: "1.12.3",
        installId: "3c4d5e6f-0000-4000-8000-000000000003",
      },
    ]);
    const owner = JSON.parse(parsed!.rows[1]!.payload);
    expect(owner).toEqual({
      ownerSource: "connect",
      observedBy: "server",
      t3CodeVersion: "1.12.3",
    });
    expect(parsed!.rows.some((row) => row.payload.includes("hashed-connect-account"))).toBe(false);
  });

  it("caps payloads and the number of events per request", () => {
    const big = { event: "x", distinct_id: "i", properties: { blob: "y".repeat(5000) } };
    const parsed = CollectPayloads.parseAnalyticsBatch(
      { batch: Array.from({ length: CollectPayloads.MAX_ROWS_PER_REQUEST + 3 }, () => big) },
      NOW,
    );
    expect(parsed?.rows.length).toBe(CollectPayloads.MAX_ROWS_PER_REQUEST);
    expect(parsed?.skipped).toBe(3);
    expect(JSON.parse(parsed!.rows[0]!.payload)).toEqual({ truncated: true, bytes: 5011 });
  });

  it("refuses bodies that are not a batch", () => {
    expect(CollectPayloads.parseAnalyticsBatch("nope", NOW)).toBeUndefined();
    expect(
      CollectPayloads.parseAnalyticsBatch({ batch: [{ properties: {} }] }, NOW),
    ).toBeUndefined();
    expect(CollectPayloads.parseJsonBody(new TextEncoder().encode("{not json"))).toBeUndefined();
  });
});

const attribute = (key: string, value: string) => ({ key, value: { stringValue: value } });

/** The shape expo-observe posts to `<endpoint>/<project>/v1/logs` (OTLP/HTTP JSON). */
const phoneLogs = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          attribute("service.name", "t3code-mobile"),
          attribute("service.version", "2.0.0-selfhost.10"),
          attribute("os.type", "linux"),
          attribute("expo.eas_client.id", "7d0c8c54-1f6e-4a28-9b0a-2f3e9b1c0d11"),
          { key: "expo.app.build_number", value: { intValue: "19" } },
        ],
      },
      scopeLogs: [
        {
          scope: { name: "expo-observe" },
          logRecords: [
            {
              timeUnixNano: "1795694340000000000",
              severityText: "ERROR",
              body: { stringValue: "TypeError: undefined is not a function" },
              attributes: [
                attribute("expo.error.source", "jsError"),
                attribute("exception.type", "TypeError"),
                attribute("exception.stacktrace", "at f (index.bundle:1:2)"),
                { key: "expo.error.is_fatal", value: { boolValue: true } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("OTLP exports", () => {
  it("reads crash reports the phone sends", () => {
    const parsed = CollectPayloads.parseOtlp("logs", phoneLogs, NOW);
    expect(parsed?.rows).toHaveLength(1);
    const row = parsed!.rows[0]!;
    expect({ ...row, payload: undefined }).toEqual({
      day: "2026-11-26",
      kind: "logs",
      event: "jsError",
      appVersion: "2.0.0-selfhost.10",
      installId: "7d0c8c54-1f6e-4a28-9b0a-2f3e9b1c0d11",
      payload: undefined,
    });
    const payload = JSON.parse(row.payload);
    expect(payload.resource["expo.app.build_number"]).toBe(19);
    expect(payload.record.attributes["expo.error.is_fatal"]).toBe(true);
    expect(payload.record.body).toEqual({ stringValue: "TypeError: undefined is not a function" });
  });

  it("names spans and metrics by their own names", () => {
    const traces = CollectPayloads.parseOtlp(
      "traces",
      {
        resourceSpans: [
          {
            resource: {
              attributes: [
                attribute("service.version", "1.12.3"),
                attribute("service.instance.id", "srv-1"),
              ],
            },
            scopeSpans: [
              { spans: [{ name: "relay.connect", startTimeUnixNano: String(NOW * 1e6) }] },
            ],
          },
        ],
      },
      NOW,
    );
    expect(traces?.rows.map((row) => [row.event, row.installId, row.day])).toEqual([
      ["relay.connect", "srv-1", "2026-11-26"],
    ]);
    const metrics = CollectPayloads.parseOtlp(
      "metrics",
      { resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: "app.startup" }] }] }] },
      NOW,
    );
    expect(metrics?.rows.map((row) => row.event)).toEqual(["app.startup"]);
    expect(CollectPayloads.parseOtlp("logs", { resourceSpans: [] }, NOW)).toBeUndefined();
  });

  it("answers what OTLP exporters expect, including partial success", () => {
    expect(CollectPayloads.otlpResponse("logs", 0)).toEqual({});
    expect(CollectPayloads.otlpResponse("traces", 2)).toMatchObject({
      partialSuccess: { rejectedSpans: 2 },
    });
  });
});
