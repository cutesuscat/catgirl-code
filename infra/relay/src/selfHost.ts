import type * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { RelayApi } from "@t3tools/contracts/relay";

import * as RelayDb from "./db.ts";

/**
 * The self-hosting profile (`RELAY_PROFILE=self-host`, set by `scripts/self-host.ts`).
 * Unset, the relay deploys exactly as upstream's: PlanetScale, Axiom, DNS zones. Set, an
 * instance needs only a Cloudflare account and a Clerk application; a Postgres database,
 * a domain and Axiom are optional extras.
 */
export interface SelfHostProfile {
  readonly enabled: boolean;
  readonly workerName: string | undefined;
  readonly placementRegion: string | undefined;
  /** Without zones the relay lives at its workers.dev address and cannot give machines endpoints. */
  readonly zones: boolean;
  readonly axiom: boolean;
  readonly database: "planetscale" | "none" | Redacted.Redacted<string>;
}

const UPSTREAM: SelfHostProfile = {
  enabled: false,
  workerName: undefined,
  placementRegion: undefined,
  zones: true,
  axiom: true,
  database: "planetscale",
};

const optionalText = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Config.map(
      Option.flatMap((value) => (value.trim() === "" ? Option.none() : Option.some(value.trim()))),
    ),
    Config.map(Option.getOrUndefined),
  );

export class SelfHostConfigError extends Schema.TaggedError<SelfHostConfigError>()(
  "SelfHostConfigError",
  { message: Schema.String },
) {}

export const profile = Effect.gen(function* () {
  if ((yield* optionalText("RELAY_PROFILE")) !== "self-host") return UPSTREAM;
  const workerName = yield* optionalText("RELAY_WORKER_NAME");
  if (workerName === undefined || !/^[a-z0-9][a-z0-9-]{0,53}$/u.test(workerName)) {
    return yield* new SelfHostConfigError({
      message: "RELAY_WORKER_NAME must be 1-54 lowercase letters, digits and dashes.",
    });
  }
  const databaseUrl = yield* Config.Redacted("RELAY_DATABASE_URL").pipe(Config.option);
  const database = Option.match(databaseUrl, {
    onNone: () => "none" as const,
    onSome: (url) => (Redacted.value(url).trim() === "none" ? ("none" as const) : url),
  });
  return {
    enabled: true,
    workerName,
    placementRegion: yield* optionalText("RELAY_PLACEMENT_REGION"),
    zones: (yield* optionalText("RELAY_API_ZONE_NAME")) !== undefined,
    axiom: (yield* optionalText("RELAY_AXIOM")) === "on",
    database,
  } satisfies SelfHostProfile;
}).pipe(Effect.orDie);

/** Worker settings the profile decides; upstream keeps its own region and custom domain. */
export function workerProps(selfHost: SelfHostProfile, relayPublicDomain: string) {
  if (!selfHost.enabled) {
    // Requests run several Postgres queries in sequence. At the user's edge
    // each one paid the round trip to the database (~300 ms from JNB); next
    // to PlanetScale `us-west` the request pays that distance once.
    return { placement: { region: "aws:us-west-2" }, domain: relayPublicDomain } as const;
  }
  return {
    ...(selfHost.workerName === undefined ? {} : { name: selfHost.workerName }),
    ...(selfHost.placementRegion === undefined
      ? {}
      : { placement: { region: selfHost.placementRegion } }),
    ...(selfHost.zones ? { domain: relayPublicDomain } : {}),
  };
}

/** A URL that parses and never resolves (RFC 6761), for an instance with no database yet. */
const NO_DATABASE_URL = "postgres://relay@database.invalid:5432/relay";

function originOf(url: Redacted.Redacted<string>) {
  const parsed = new URL(Redacted.value(url));
  return {
    scheme: "postgres" as const,
    host: parsed.hostname,
    port: parsed.port === "" ? 5432 : Number(parsed.port),
    database: decodeURIComponent(parsed.pathname.replace(/^\//u, "")) || "postgres",
    user: decodeURIComponent(parsed.username),
    password: Redacted.make(decodeURIComponent(parsed.password)),
  };
}

type ConnectionString = Effect.Effect<Redacted.Redacted<string>, never, Alchemy.RuntimeContext>;

/** Upstream reaches PlanetScale through Hyperdrive; a self-hosted relay any Postgres, or none. */
export const relayDatabaseUrl = Effect.gen(function* () {
  const selfHost = yield* profile;
  if (selfHost.database === "none") {
    const placeholder: ConnectionString = Effect.succeed(Redacted.make(NO_DATABASE_URL));
    return placeholder;
  }
  const hyperdrive =
    selfHost.database === "planetscale"
      ? yield* RelayDb.RelayHyperdrive
      : yield* Cloudflare.Hyperdrive.Connection("RelayHyperdrive", {
          origin: originOf(selfHost.database),
          caching: { disabled: true },
        });
  const connection: ConnectionString = (yield* Cloudflare.Hyperdrive.Connect(hyperdrive))
    .connectionString;
  return connection;
});

const noZone = () =>
  Effect.die(
    new SelfHostConfigError({ message: "This relay has no tunnel zone (RELAY_TUNNEL_ZONE_NAME)." }),
  );

/** A relay without a tunnel zone provisions no machine endpoints; nothing reaches this client. */
export const noTunnelZoneDns: Cloudflare.DNS.ReadWriteDnsClient = {
  getDnsRecord: noZone,
  listDnsRecords: noZone,
  createDnsRecord: noZone,
  updateDnsRecord: noZone,
  patchDnsRecord: noZone,
  deleteDnsRecord: noZone,
  batchDnsRecords: noZone,
};

/** Without Axiom there is nowhere to forward the phone's legacy telemetry route. */
export const layerMobileTelemetryOff = HttpApiBuilder.group(
  RelayApi,
  "mobileTelemetry",
  (handlers) =>
    Effect.succeed(
      handlers.handleRaw("ingest", () =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "not_configured" }, { status: 404 })),
      ),
    ),
);
