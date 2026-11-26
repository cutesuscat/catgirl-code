// @effect-diagnostics anyUnknownInErrorContext:off layerMergeAllWithDependencies:off - Alchemy provider helpers expose framework-owned any requirements.
import * as Alchemy from "alchemy";
import { localState } from "alchemy/State";
import * as Axiom from "@alchemy.run/axiom";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as Planetscale from "@alchemy.run/planetscale";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SelfHost from "./src/selfHost.ts";
import { CatFirstSigningKeyProvider } from "./src/connect/SigningKey.ts";
import * as RelayWorker from "./src/worker.ts";

/**
 * A self-hosted Catgirl Connect instance: the same relay Worker as `alchemy.run.ts`, under its
 * own stack name and state store, so it can never adopt or replace another relay's resources.
 * Deploy it with `node scripts/self-host.ts`, which sets the profile and checks the inputs.
 */
const stateStore = process.env.RELAY_STATE_STORE?.trim() || "catgirl-connect-state";

export default Alchemy.Stack(
  "CatgirlConnect",
  {
    providers: Layer.mergeAll(
      Axiom.providers(),
      Cloudflare.providers(),
      Drizzle.providers(),
      Planetscale.providers(),
      CatFirstSigningKeyProvider(),
    ),
    state:
      process.env.RELAY_STATE === "local"
        ? localState()
        : Cloudflare.state({ workerName: stateStore }),
  },
  Effect.gen(function* () {
    const selfHost = yield* SelfHost.profile;
    if (!selfHost.enabled) {
      return yield* Effect.die(
        new SelfHost.SelfHostConfigError({
          message: "Deploy a self-hosted instance with `node scripts/self-host.ts deploy`.",
        }),
      );
    }
    const api = yield* RelayWorker.Api;
    return { workerName: api.workerName, url: api.url };
  }).pipe(Effect.provide(RelayWorker.layer)),
);
