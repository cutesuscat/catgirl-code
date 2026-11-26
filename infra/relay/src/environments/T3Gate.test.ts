import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type * as Alchemy from "alchemy";
import type * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import * as RelayConfiguration from "../Config.ts";
import * as CloudflareApiPause from "./CloudflareApiPause.ts";
import * as ManagedEndpointAllocations from "./ManagedEndpointAllocations.ts";
import * as ManagedEndpointProvider from "./ManagedEndpointProvider.ts";
import type * as ManagedTunnelBinding from "./ManagedTunnelBinding.ts";
import * as ManagedTunnelLimits from "./ManagedTunnelLimits.ts";
import * as T3Gate from "./T3Gate.ts";

/**
 * Expected values come from running the hand-applied `t3gate-patch.js` (the live relay's
 * patch, unchanged) with the same inputs; see the connect-v2 relay report for the script.
 */
const PATCH_OUTPUT = {
  token:
    "t3gate1.eyJ2IjoxLCJob3N0IjoicHJvZC0wMTIzNDU2Nzg5YWJjZGVmLmV4YW1wbGUudGVzdCIsImdhdGUiOiJnYXRlLmV4YW1wbGUudGVzdCIsImtleSI6IjUzYzI0YzNhZDI4ZjU5ZTcyOTgyNjQ0MzRiMjNmNDU1MTUxMjE3YThkNzkyM2I0ZTBiOGM3ZGY1ODhjNzEzYzQiLCJwaW5zIjpbInBpbkEiLCJwaW5CIl0sInRydXN0IjpbIjE5OC41MS4xMDAuOSJdfQ",
  tunnel: (status: string) => ({
    id: TUNNEL,
    name: TUNNEL,
    status,
    createdAt: "2026-11-04T00:00:00Z",
    connsInactiveAt: null,
    deletedAt: null,
  }),
  gateRecord: {
    type: "A",
    name: "prod-0123456789abcdef.example.test",
    content: "192.0.2.7",
    ttl: 1,
    proxied: false,
  },
};

const TUNNEL = "t3coderelay-managedendpoint-prod-0123456789abcdef";
const HOST = "prod-0123456789abcdef.example.test";
const tunnelCname = {
  type: "CNAME",
  name: HOST,
  content: `${TUNNEL}.cfargotunnel.com`,
  ttl: 1,
  proxied: true,
} as const;

const settings = T3Gate.readSettings({
  secret: "test-gate-secret",
  gate: "gate.example.test",
  proxyIp: "192.0.2.7",
  pins: " pinA ,pinB,",
  trusted: "198.51.100.9",
});
const ZONE = "Example.Test";

describe("t3gate settings", () => {
  it("is off without a secret, and refuses a secret without a gateway", () => {
    const base = { gate: "g", proxyIp: "192.0.2.1", pins: undefined, trusted: undefined };
    expect(T3Gate.readSettings({ ...base, secret: undefined })).toBeUndefined();
    expect(T3Gate.readSettings({ ...base, secret: "  " })).toBeUndefined();
    expect(T3Gate.readSettings({ ...base, secret: "s", gate: undefined })).toBe("incomplete");
    expect(T3Gate.readSettings({ ...base, secret: "s", proxyIp: "" })).toBe("incomplete");
  });
});

const gate = () => {
  if (settings === undefined || settings === "incomplete") throw new Error("settings");
  return settings;
};

describe("t3gate mode does what the hand-applied patch does", () => {
  it.effect("hands out the same t3gate token for a machine's tunnel", () =>
    Effect.gen(function* () {
      const tunnels = T3Gate.tunnelClient(gate(), ZONE);
      expect(yield* tunnels.getToken(TUNNEL)).toBe(PATCH_OUTPUT.token);
      expect(T3Gate.hostnameForTunnel(ZONE, TUNNEL)).toBe(HOST);
      const unknown = yield* Effect.flip(tunnels.getToken("other-tunnel"));
      expect(unknown.cause).toEqual({
        _tag: "NotFound",
        status: 404,
        message: "t3gate: unknown tunnel other-tunnel",
      });
    }),
  );

  it.effect("reports every tunnel of ours as existing, and nothing else", () =>
    Effect.gen(function* () {
      const tunnels = T3Gate.tunnelClient(gate(), ZONE);
      expect(yield* tunnels.get(TUNNEL)).toEqual(PATCH_OUTPUT.tunnel("healthy"));
      expect((yield* Effect.flip(tunnels.get("other-tunnel"))).cause).toMatchObject({
        _tag: "NotFound",
        status: 404,
      });
      expect(yield* tunnels.list({ isDeleted: false, name: TUNNEL })).toEqual({
        result: [PATCH_OUTPUT.tunnel("healthy")],
        resultInfo: { page: 1, perPage: 1, totalCount: 1 },
      });
      expect(yield* tunnels.list({ isDeleted: false, name: "x", perPage: 50 })).toEqual({
        result: [],
        resultInfo: { page: 1, perPage: 50, totalCount: 0 },
      });
      expect(yield* tunnels.list({ isDeleted: false })).toEqual({
        result: [],
        resultInfo: { page: 1, perPage: 20, totalCount: 0 },
      });
      expect(yield* tunnels.create({ name: TUNNEL, configSrc: "cloudflare" })).toEqual(
        PATCH_OUTPUT.tunnel("inactive"),
      );
      expect(yield* tunnels.getConfiguration(TUNNEL)).toEqual({ ingress: [] });
      expect(yield* tunnels.putConfiguration(TUNNEL, { ingress: [] })).toEqual({});
      expect(yield* tunnels.delete(TUNNEL)).toEqual({});
    }),
  );
});

const config = RelayConfiguration.RelayConfiguration.of({
  relayIssuer: "https://relay.example.test",
  apns: null,
  apnsDeliveryJobSigningSecret: Redacted.make("job-secret"),
  clerkSecretKey: Redacted.make("clerk-secret"),
  clerkPublishableKey: "pk_test_test",
  clerkJwtAudience: "t3-code-relay",
  cloudMintPrivateKey: Redacted.make("cloud-private-key"),
  cloudMintPublicKey: "cloud-public-key",
  managedEndpointBaseDomain: "Example.Test",
  managedEndpointNamespace: "prod",
});

type Call = readonly [string, ...ReadonlyArray<unknown>];

/** Cloudflare's tunnel and DNS APIs as the Worker binds them, recording every call. */
const cloudflareFakes = () => {
  const calls: Array<Call> = [];
  const record =
    <A>(name: string, result: A) =>
    (...args: ReadonlyArray<unknown>) =>
      Effect.sync(() => {
        calls.push([name, ...args]);
        return result;
      });
  const tunnelClient = {
    get: record("tunnel.get", { id: "cf-tunnel", name: TUNNEL, status: "healthy" }),
    list: record("tunnel.list", { result: [] }),
    create: record("tunnel.create", { id: "cf-tunnel", name: TUNNEL }),
    putConfiguration: record("tunnel.putConfiguration", {}),
    getConfiguration: record("tunnel.getConfiguration", { config: { ingress: [] } }),
    getToken: record("tunnel.getToken", "cloudflare-connector-token"),
    delete: record("tunnel.delete", {}),
    disconnect: record("tunnel.disconnect", undefined),
  } as unknown as ManagedTunnelBinding.ManagedTunnelClient;
  const dnsClient = {
    listDnsRecords: record("dns.list", { result: [] }),
    createDnsRecord: record("dns.create", { id: "record-1" }),
    updateDnsRecord: record("dns.update", { id: "record-1" }),
    deleteDnsRecord: record("dns.delete", {}),
  } as unknown as Cloudflare.DNS.ReadWriteDnsClient;
  return { calls, tunnelClient, dnsClient };
};

/** The provider's tunnel and DNS seams as the Worker builds them, with t3gate on or off. */
const seams = (mode: "off" | "on") => {
  const fakes = cloudflareFakes();
  const layer = ManagedEndpointProvider.layerCloudflareBindings(
    fakes.tunnelClient,
    mode === "on" ? T3Gate.dnsClient(gate(), fakes.dnsClient) : fakes.dnsClient,
    {} as Alchemy.BaseRuntimeContext,
    mode === "on"
      ? (relay: RelayConfiguration.RelayConfiguration["Service"]) =>
          T3Gate.tunnelClient(gate(), relay.managedEndpointBaseDomain ?? "")
      : undefined,
  ).pipe(
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    Layer.provide(RelayConfiguration.layer(config)),
    Layer.provide(
      Layer.succeed(
        ManagedEndpointAllocations.ManagedEndpointAllocations,
        {} as ManagedEndpointAllocations.ManagedEndpointAllocations["Service"],
      ),
    ),
    Layer.provide(
      Layer.succeed(
        ManagedTunnelLimits.ManagedTunnelLimits,
        {} as ManagedTunnelLimits.ManagedTunnelLimits["Service"],
      ),
    ),
    Layer.provide(
      Layer.succeed(
        CloudflareApiPause.CloudflareApiPause,
        CloudflareApiPause.CloudflareApiPause.of({
          pausedUntilMillis: Effect.succeed(0),
          pauseUntil: () => Effect.void,
        }),
      ),
    ),
  );
  const run = Effect.gen(function* () {
    const tunnels = yield* ManagedEndpointProvider.ManagedEndpointTunnelClient;
    const dns = yield* ManagedEndpointProvider.ManagedEndpointDnsClient;
    const created = yield* tunnels.create({ name: TUNNEL, configSrc: "cloudflare" });
    const token = yield* tunnels.getToken(created.id ?? "");
    yield* dns.createRecord(tunnelCname);
    yield* dns.updateRecord("record-1", tunnelCname);
    yield* tunnels.disconnect(created.id ?? "");
    return { token, calls: fakes.calls };
  }).pipe(Effect.provide(layer));
  return run;
};

describe("the provider's tunnel and DNS seams", () => {
  it.effect("with t3gate off, use Cloudflare tunnels and proxied CNAMEs as upstream does", () =>
    Effect.gen(function* () {
      const { token, calls } = yield* seams("off");
      expect(token).toBe("cloudflare-connector-token");
      expect(calls.map(([name]) => name)).toEqual([
        "tunnel.create",
        "tunnel.getToken",
        "dns.create",
        "dns.update",
        "tunnel.disconnect",
      ]);
      expect(calls[2]).toEqual(["dns.create", tunnelCname]);
    }),
  );

  it.effect(
    "with t3gate on, never call Cloudflare's tunnel API and point the host at the gateway",
    () =>
      Effect.gen(function* () {
        const { token, calls } = yield* seams("on");
        expect(token).toBe(PATCH_OUTPUT.token);
        expect(calls).toEqual([
          ["dns.create", PATCH_OUTPUT.gateRecord],
          ["dns.update", "record-1", PATCH_OUTPUT.gateRecord],
        ]);
      }),
  );
});
