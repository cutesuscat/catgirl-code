// Catgirl Code publishes no npm package, so "which release is newest" is answered from the fork's
// own GitHub releases. This stands in for npmRelease.ts behind the same service.
import {
  type ServerNpmRelease,
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
} from "@t3tools/contracts";
import { cliReleaseIndexPageUrl, newestCliReleaseVersion } from "@t3tools/shared/cliRelease";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { NpmRelease } from "./npmRelease.ts";

const ReleaseIndex = Schema.Array(
  Schema.Struct({ tag_name: Schema.String, draft: Schema.optional(Schema.Boolean) }),
);
const decodeReleaseIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(ReleaseIndex));
const decodeInput = Schema.decodeUnknownEffect(ServerNpmReleaseInput);

const RELEASE_INDEX_MAX_PAGES = 10;
const RELEASE_INDEX_PAGE_SIZE = 100;

const unreachable = () =>
  new ServerNpmReleaseError({ reason: "Catgirl Code's releases could not be reached." });

/** The fork's release for `spec`, or `null` when it has none: it builds no nightlies. */
export const lookupCatgirlRelease = Effect.fn("CatgirlRelease.lookup")(function* (spec: string) {
  if (spec === "nightly") return null;
  const http = yield* HttpClient.HttpClient;
  for (let page = 1; page <= RELEASE_INDEX_MAX_PAGES; page += 1) {
    const request = HttpClientRequest.get(cliReleaseIndexPageUrl(page)).pipe(
      HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
    );
    const releases = yield* http.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.text),
      Effect.flatMap(decodeReleaseIndex),
      Effect.timeout(Duration.seconds(15)),
      Effect.mapError(unreachable),
    );
    const published = releases.filter((release) => release.draft !== true);
    const version =
      spec === "latest"
        ? newestCliReleaseVersion(published, "stable")
        : published.some((release) => release.tag_name === `v${spec}`)
          ? spec
          : undefined;
    if (version !== undefined) return { version } satisfies ServerNpmRelease;
    if (releases.length < RELEASE_INDEX_PAGE_SIZE) break;
  }
  return null;
});

const make = Effect.fn("CatgirlRelease.make")(function* () {
  const http = yield* HttpClient.HttpClient;
  const cache = yield* Cache.make({
    capacity: 32,
    timeToLive: Duration.minutes(1),
    lookup: (spec: string) =>
      lookupCatgirlRelease(spec).pipe(Effect.provideService(HttpClient.HttpClient, http)),
  });
  return NpmRelease.of({
    get: Effect.fn("CatgirlRelease.get")(function* (input) {
      const { spec } = yield* decodeInput(input).pipe(
        Effect.mapError(
          () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
        ),
      );
      return yield* Cache.get(cache, spec);
    }),
  });
});

export const layer = Layer.effect(NpmRelease, make()).pipe(Layer.provide(FetchHttpClient.layer));
