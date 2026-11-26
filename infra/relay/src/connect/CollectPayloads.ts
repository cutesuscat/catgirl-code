import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

/**
 * Turns what apps and servers send into rows. A row keeps only the random install or
 * device id the sender already puts in its events, a UTC day, and a capped payload.
 */
export type CollectKind = "analytics" | "logs" | "traces" | "metrics";
export type OtlpSignal = Exclude<CollectKind, "analytics">;

export interface CollectRow {
  readonly day: string;
  readonly kind: CollectKind;
  readonly event: string;
  readonly appVersion: string;
  readonly installId: string;
  readonly payload: string;
}

export interface ParsedRows {
  readonly rows: ReadonlyArray<CollectRow>;
  /** Records the request carried beyond the per-request cap. */
  readonly skipped: number;
  /** The PostHog write key field, which a sender may use for the collect token. */
  readonly apiKey?: string | undefined;
}

export const MAX_ROWS_PER_REQUEST = 500;
export const MAX_PAYLOAD_BYTES: Readonly<Record<CollectKind, number>> = {
  analytics: 2048,
  logs: 8192,
  traces: 1024,
  metrics: 1024,
};
const MAX_EVENT_LENGTH = 128;
const MAX_ID_LENGTH = 128;
const MAX_VERSION_LENGTH = 64;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Days a sender may backdate or postdate an event before the receipt day is used. */
const ACCEPTED_SKEW_DAYS = 2;

/** Properties that could name an account, dropped before anything is stored. */
const IDENTITY_PROPERTIES = new Set([
  "installId",
  "ownerId",
  "$ip",
  "$set",
  "$set_once",
  "$user_id",
  "email",
  "userId",
  "accountId",
]);

const encoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const arrayAt = (value: unknown, key: string): ReadonlyArray<unknown> => {
  const child = isRecord(value) ? value[key] : undefined;
  return Array.isArray(child) ? child : [];
};

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

const textOf = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? clip(value.trim(), max) : undefined;

export function utcDay(epochMillis: number): string {
  return DateTime.formatIsoDateUtc(DateTime.makeUnsafe(epochMillis));
}

const isoMillis = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined;
  const parsed = DateTime.make(value);
  return Option.isSome(parsed) ? DateTime.toEpochMillis(parsed.value) : undefined;
};

/** The event's own day when it is believable, otherwise the day it arrived. */
function dayFor(eventMillis: number | undefined, nowMillis: number): string {
  if (
    eventMillis !== undefined &&
    Number.isFinite(eventMillis) &&
    Math.abs(eventMillis - nowMillis) <= ACCEPTED_SKEW_DAYS * DAY_MS
  ) {
    return utcDay(eventMillis);
  }
  return utcDay(nowMillis);
}

function cappedJson(value: unknown, kind: CollectKind): string {
  const text = JSON.stringify(value) ?? "null";
  const bytes = encoder.encode(text).length;
  return bytes <= MAX_PAYLOAD_BYTES[kind] ? text : JSON.stringify({ truncated: true, bytes });
}

export function parseJsonBody(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return undefined;
  }
}

/** A PostHog `/batch/` body, as the server's analytics service sends it. */
export function parseAnalyticsBatch(payload: unknown, nowMillis: number): ParsedRows | undefined {
  if (!isRecord(payload)) return undefined;
  const events = Array.isArray(payload.batch) ? payload.batch : [payload];
  const apiKey = textOf(payload.api_key, 512);
  const rows: Array<CollectRow> = [];
  let skipped = 0;
  for (const entry of events) {
    if (!isRecord(entry)) continue;
    const event = textOf(entry.event, MAX_EVENT_LENGTH);
    if (event === undefined) continue;
    if (rows.length >= MAX_ROWS_PER_REQUEST) {
      skipped += 1;
      continue;
    }
    const properties = isRecord(entry.properties) ? entry.properties : {};
    const kept = Object.fromEntries(
      Object.entries(properties).filter(([key]) => !IDENTITY_PROPERTIES.has(key)),
    );
    rows.push({
      day: dayFor(isoMillis(entry.timestamp), nowMillis),
      kind: "analytics",
      event,
      appVersion:
        textOf(properties.t3CodeVersion, MAX_VERSION_LENGTH) ??
        textOf(properties.serverAppVersion, MAX_VERSION_LENGTH) ??
        textOf(properties.$app_version, MAX_VERSION_LENGTH) ??
        "",
      installId:
        textOf(properties.installId, MAX_ID_LENGTH) ??
        textOf(entry.distinct_id, MAX_ID_LENGTH) ??
        "",
      payload: cappedJson(kept, "analytics"),
    });
  }
  if (rows.length === 0 && skipped === 0) return undefined;
  return { rows, skipped, apiKey };
}

/** An OTLP `AnyValue` as plain JSON. */
function plainValue(value: unknown, depth = 0): unknown {
  if (!isRecord(value) || depth > 4) return undefined;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.boolValue === "boolean") return value.boolValue;
  if (typeof value.intValue === "string" || typeof value.intValue === "number") {
    return Number(value.intValue);
  }
  if (typeof value.doubleValue === "number") return value.doubleValue;
  if (isRecord(value.arrayValue)) {
    return arrayAt(value.arrayValue, "values").map((item) => plainValue(item, depth + 1));
  }
  if (isRecord(value.kvlistValue)) {
    return plainAttributes(arrayAt(value.kvlistValue, "values"), depth + 1);
  }
  return undefined;
}

function plainAttributes(attributes: ReadonlyArray<unknown>, depth = 0): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const attribute of attributes) {
    if (!isRecord(attribute) || typeof attribute.key !== "string") continue;
    result[attribute.key] = plainValue(attribute.value, depth);
  }
  return result;
}

const nanosToMillis = (value: unknown): number | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const nanos = Number(value);
  return Number.isFinite(nanos) && nanos > 0 ? nanos / 1e6 : undefined;
};

const RESOURCE_KEYS: Readonly<Record<OtlpSignal, string>> = {
  logs: "resourceLogs",
  traces: "resourceSpans",
  metrics: "resourceMetrics",
};
const SCOPE_KEYS: Readonly<Record<OtlpSignal, string>> = {
  logs: "scopeLogs",
  traces: "scopeSpans",
  metrics: "scopeMetrics",
};
const RECORD_KEYS: Readonly<Record<OtlpSignal, string>> = {
  logs: "logRecords",
  traces: "spans",
  metrics: "metrics",
};

function recordEvent(signal: OtlpSignal, record: Record<string, unknown>): string {
  if (signal !== "logs") return textOf(record.name, MAX_EVENT_LENGTH) ?? signal;
  const attributes = plainAttributes(arrayAt(record, "attributes"));
  return (
    textOf(attributes["event.name"], MAX_EVENT_LENGTH) ??
    textOf(attributes["expo.error.source"], MAX_EVENT_LENGTH) ??
    textOf(record.severityText, MAX_EVENT_LENGTH) ??
    "log"
  );
}

function recordTime(signal: OtlpSignal, record: Record<string, unknown>): number | undefined {
  if (signal === "logs")
    return nanosToMillis(record.timeUnixNano) ?? nanosToMillis(record.observedTimeUnixNano);
  if (signal === "traces") return nanosToMillis(record.startTimeUnixNano);
  return undefined;
}

/** An OTLP/HTTP JSON export request, as expo-observe and OpenTelemetry exporters send it. */
export function parseOtlp(
  signal: OtlpSignal,
  payload: unknown,
  nowMillis: number,
): ParsedRows | undefined {
  if (!isRecord(payload) || !Array.isArray(payload[RESOURCE_KEYS[signal]])) return undefined;
  const rows: Array<CollectRow> = [];
  let skipped = 0;
  for (const resourceEntry of arrayAt(payload, RESOURCE_KEYS[signal])) {
    const resource = plainAttributes(
      arrayAt(isRecord(resourceEntry) ? resourceEntry.resource : undefined, "attributes"),
    );
    const installId =
      textOf(resource["expo.eas_client.id"], MAX_ID_LENGTH) ??
      textOf(resource["service.instance.id"], MAX_ID_LENGTH) ??
      textOf(resource["device.id"], MAX_ID_LENGTH) ??
      "";
    const appVersion = textOf(resource["service.version"], MAX_VERSION_LENGTH) ?? "";
    for (const scope of arrayAt(resourceEntry, SCOPE_KEYS[signal])) {
      for (const record of arrayAt(scope, RECORD_KEYS[signal])) {
        if (!isRecord(record)) continue;
        if (rows.length >= MAX_ROWS_PER_REQUEST) {
          skipped += 1;
          continue;
        }
        rows.push({
          day: dayFor(recordTime(signal, record), nowMillis),
          kind: signal,
          event: recordEvent(signal, record),
          appVersion,
          installId,
          payload: cappedJson(
            {
              resource,
              record: { ...record, attributes: plainAttributes(arrayAt(record, "attributes")) },
            },
            signal,
          ),
        });
      }
    }
  }
  return { rows, skipped };
}

/** The success answer each OTLP signal expects, with a partial-success note for skipped records. */
export function otlpResponse(signal: OtlpSignal, rejected: number): Record<string, unknown> {
  if (rejected === 0) return {};
  const field =
    signal === "logs"
      ? "rejectedLogRecords"
      : signal === "traces"
        ? "rejectedSpans"
        : "rejectedDataPoints";
  return {
    partialSuccess: {
      [field]: rejected,
      errorMessage:
        "This Catgirl Connect instance stores a limited number of records per request and per day.",
    },
  };
}
