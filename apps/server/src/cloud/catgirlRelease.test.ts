import { assert, describe, it } from "@effect/vitest";
import { CATGIRL_RELEASE_REPOSITORY } from "@t3tools/shared/catgirlRelease";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { lookupCatgirlRelease } from "./catgirlRelease.ts";

const releaseIndex = (
  pages: ReadonlyArray<ReadonlyArray<{ tag_name: string; draft?: boolean }>>,
) => {
  const requested: string[] = [];
  const client = HttpClient.make((request) => {
    requested.push(request.url);
    const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json(pages[page - 1] ?? [])),
    );
  });
  const lookup = (spec: string) =>
    lookupCatgirlRelease(spec).pipe(Effect.provideService(HttpClient.HttpClient, client));
  return { requested, lookup };
};

describe("release lookups for a Catgirl Code server", () => {
  it.effect("answers from the fork's GitHub releases and never asks npm", () =>
    Effect.gen(function* () {
      const { requested, lookup } = releaseIndex([
        [{ tag_name: "v1.12.3", draft: true }, { tag_name: "v1.12.2" }, { tag_name: "v1.12.1" }],
      ]);
      assert.deepStrictEqual(yield* lookup("latest"), { version: "1.12.2" });
      assert.deepStrictEqual(yield* lookup("1.12.1"), { version: "1.12.1" });
      assert.isNull(yield* lookup("1.12.3"));
      assert.isNull(yield* lookup("0.1.12"));
      for (const url of requested) {
        assert.include(url, `https://api.github.com/repos/${CATGIRL_RELEASE_REPOSITORY}/releases?`);
        assert.notInclude(url, "npmjs");
        assert.notInclude(url, "pingdotgg");
      }
    }),
  );

  it.effect("has no nightly track, and asks nobody about one", () =>
    Effect.gen(function* () {
      const { requested, lookup } = releaseIndex([[{ tag_name: "v1.12.1" }]]);
      assert.isNull(yield* lookup("nightly"));
      assert.deepStrictEqual(requested, []);
    }),
  );

  it.effect("reads further pages until the release is found", () =>
    Effect.gen(function* () {
      const full = Array.from({ length: 100 }, (_, index) => ({ tag_name: `android-${index}` }));
      const { requested, lookup } = releaseIndex([full, [{ tag_name: "v1.12.1" }]]);
      assert.deepStrictEqual(yield* lookup("latest"), { version: "1.12.1" });
      assert.lengthOf(requested, 2);
    }),
  );

  it.effect("reports a failed check instead of claiming there is no release", () =>
    Effect.gen(function* () {
      const failing = HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 403 }))),
      );
      const error = yield* lookupCatgirlRelease("latest").pipe(
        Effect.provideService(HttpClient.HttpClient, failing),
        Effect.flip,
      );
      assert.include(error.reason, "could not be reached");
    }),
  );
});
