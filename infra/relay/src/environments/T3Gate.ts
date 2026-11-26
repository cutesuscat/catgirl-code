import type * as Cloudflare from "@alchemy.run/cloudflare";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Base64Url from "effect/encoding/Base64Url";

import {
  type ManagedEndpointTunnel,
  type ManagedEndpointTunnelClient,
  ManagedEndpointTunnelClientError,
} from "./ManagedEndpointProvider.ts";

/**
 * Optional "t3gate" mode, off unless `T3GATE_SECRET` is set. Machines are then reached
 * through the operator's own TLS gateway instead of Cloudflare tunnels: the relay hands
 * out t3gate tokens in place of tunnel tokens and points each machine's hostname at the
 * gateway with a DNS-only A record, so Cloudflare never terminates the machine's TLS.
 */
export interface T3GateSettings {
  readonly secret: Redacted.Redacted<string>;
  /** The gateway machines dial, such as `gate.example.com`. */
  readonly gate: string;
  /** Where machine hostnames resolve: the gateway's public address. */
  readonly proxyIp: string;
  /** Client certificate pins the gateway accepts. */
  readonly pins: ReadonlyArray<string>;
  /** Source addresses the gateway trusts without a certificate. */
  readonly trusted: ReadonlyArray<string>;
}

const TUNNEL_PREFIX = "t3coderelay-managedendpoint-";
/** The same fixed creation time the hand-applied patch reported. */
const GATE_TUNNEL_CREATED_AT = "2026-11-04T00:00:00Z";

const splitList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

/** Undefined (mode off) without a secret; a secret without a gateway or address is refused. */
export function readSettings(input: {
  readonly secret: string | undefined;
  readonly gate: string | undefined;
  readonly proxyIp: string | undefined;
  readonly pins: string | undefined;
  readonly trusted: string | undefined;
}): T3GateSettings | undefined | "incomplete" {
  const secret = (input.secret ?? "").trim();
  if (secret === "") return undefined;
  const gate = (input.gate ?? "").trim();
  const proxyIp = (input.proxyIp ?? "").trim();
  if (gate === "" || proxyIp === "") return "incomplete";
  return {
    secret: Redacted.make(secret),
    gate,
    proxyIp,
    pins: splitList(input.pins),
    trusted: splitList(input.trusted),
  };
}

const isGateTunnel = (tunnelId: string) => tunnelId.startsWith(TUNNEL_PREFIX);

/** The managed endpoint zone's name; machine hostnames sit below it. */
export function hostnameForTunnel(zone: string, tunnelId: string): string {
  return `${tunnelId.slice(TUNNEL_PREFIX.length)}.${zone.toLowerCase()}`.toLowerCase();
}

/** What a machine's t3gate client needs: its hostname, the gateway, and a per-host key. */
export function tokenForTunnel(settings: T3GateSettings, zone: string, tunnelId: string): string {
  const host = hostnameForTunnel(zone, tunnelId);
  const key = Array.from(
    hmac(
      sha256,
      new TextEncoder().encode(Redacted.value(settings.secret)),
      new TextEncoder().encode(host),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const token = {
    v: 1,
    host,
    gate: settings.gate,
    key,
    pins: settings.pins,
    trust: settings.trusted,
  };
  return `t3gate1.${Base64Url.encode(JSON.stringify(token))}`;
}

const gateTunnel = (name: string, status: string): ManagedEndpointTunnel => ({
  id: name,
  name,
  status,
  createdAt: GATE_TUNNEL_CREATED_AT,
  connsInactiveAt: null,
  deletedAt: null,
});

const unknownTunnel = (
  operation: "get" | "get-token",
  tunnelId: string,
): ManagedEndpointTunnelClientError =>
  new ManagedEndpointTunnelClientError({
    operation,
    tunnelId,
    cause: { _tag: "NotFound", status: 404, message: `t3gate: unknown tunnel ${tunnelId}` },
  });

/** Stands in for Cloudflare's tunnel API: every tunnel of ours "exists" and is healthy. */
export function tunnelClient(
  settings: T3GateSettings,
  zone: string,
): ManagedEndpointTunnelClient["Service"] {
  return {
    get: (tunnelId) =>
      isGateTunnel(tunnelId)
        ? Effect.succeed(gateTunnel(tunnelId, "healthy"))
        : Effect.fail(unknownTunnel("get", tunnelId)),
    list: (request) =>
      Effect.succeed(
        request.name !== undefined && isGateTunnel(request.name)
          ? {
              result: [gateTunnel(request.name, "healthy")],
              resultInfo: { page: 1, perPage: 1, totalCount: 1 },
            }
          : { result: [], resultInfo: { page: 1, perPage: request.perPage ?? 20, totalCount: 0 } },
      ),
    create: (request) => Effect.succeed(gateTunnel(request.name, "inactive")),
    putConfiguration: () => Effect.succeed({}),
    getConfiguration: () => Effect.succeed({ ingress: [] }),
    getToken: (tunnelId) =>
      isGateTunnel(tunnelId)
        ? Effect.succeed(tokenForTunnel(settings, zone, tunnelId))
        : Effect.fail(unknownTunnel("get-token", tunnelId)),
    delete: () => Effect.succeed({}),
    disconnect: () => Effect.void,
  };
}

/** Reads the T3GATE_* settings; a secret without a gateway or address stops the deploy. */
export const config = Effect.gen(function* () {
  const text = (name: string) =>
    Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));
  const secret = yield* Config.Redacted("T3GATE_SECRET").pipe(Config.option);
  const settings = readSettings({
    secret: Option.match(secret, { onNone: () => undefined, onSome: Redacted.value }),
    gate: yield* text("T3GATE_GATE"),
    proxyIp: yield* text("T3GATE_PROXY_IP"),
    pins: yield* text("T3GATE_PINS"),
    trusted: yield* text("T3GATE_TRUSTED"),
  });
  if (settings === "incomplete") {
    return yield* new T3GateConfigError({
      message: "T3GATE_SECRET is set, so T3GATE_GATE and T3GATE_PROXY_IP are needed too.",
    });
  }
  return settings;
}).pipe(Effect.orDie);

export class T3GateConfigError extends Schema.TaggedError<T3GateConfigError>()(
  "T3GateConfigError",
  { message: Schema.String },
) {}

/** Machine hostnames become DNS-only A records for the gateway instead of proxied tunnel CNAMEs. */
export function dnsClient(
  settings: T3GateSettings,
  client: Cloudflare.DNS.ReadWriteDnsClient,
): Cloudflare.DNS.ReadWriteDnsClient {
  const toGateRecord = (name: string) =>
    ({ type: "A", name, content: settings.proxyIp, ttl: 1, proxied: false }) as const;
  return {
    ...client,
    createDnsRecord: (request) => client.createDnsRecord(toGateRecord(request.name)),
    updateDnsRecord: (dnsRecordId, request) =>
      client.updateDnsRecord(dnsRecordId, toGateRecord(request.name)),
  };
}
