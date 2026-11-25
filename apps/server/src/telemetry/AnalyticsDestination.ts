// Catgirl Code: where product usage analytics go is set on the machine, never built in.
import type { ManagedPolicySummary, ServerObservability } from "@t3tools/contracts";
import { isAnalyticsAllowed } from "@t3tools/shared/otelEnvironment";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";

type Source = "environment" | "settings";

export type SavedAnalytics = NonNullable<ServerConfig.ServerConfig["Service"]["savedAnalytics"]>;

/** Each half with where it came from. A half that is missing or unusable is absent. */
export interface AnalyticsTarget {
  /** Events are posted to `${url}/batch/`. */
  readonly url?: string;
  readonly urlSource?: Source;
  readonly key?: string;
  readonly keySource?: Source;
}

const blankAsUnset = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const httpUrl = (raw: string) => {
  const url = URL.canParse(raw) ? new URL(raw) : undefined;
  if (url?.protocol !== "http:" && url?.protocol !== "https:") return undefined;
  return raw.replace(/\/+$/, "");
};

/**
 * The environment wins over the saved setting, one half at a time. A variable that is set claims
 * its half even when unusable, so a bad value sends nothing rather than falling back.
 */
export const resolveAnalyticsTarget = (
  environment: { readonly url: string | undefined; readonly key: string | undefined },
  saved: SavedAnalytics | undefined,
): AnalyticsTarget => {
  const environmentUrl = blankAsUnset(environment.url);
  const environmentKey = blankAsUnset(environment.key);
  const url = httpUrl(environmentUrl ?? blankAsUnset(saved?.analyticsUrl) ?? "");
  const key = environmentKey ?? blankAsUnset(saved?.analyticsKey);
  return {
    ...(url === undefined
      ? {}
      : { url, urlSource: environmentUrl === undefined ? "settings" : "environment" }),
    ...(key === undefined
      ? {}
      : { key, keySource: environmentKey === undefined ? "settings" : "environment" }),
  };
};

/** Both halves, or there is nowhere to send to. */
export const analyticsDestination = ({ url, key }: AnalyticsTarget) =>
  url === undefined || key === undefined ? undefined : { url, key };

/**
 * Whether this server sends usage analytics. Naming a destination is the opt-in; an environment
 * that says no, `DO_NOT_TRACK`, a managed policy and an unasked CI runner each still turn it off.
 */
export const analyticsEnabledFor = (
  env: Readonly<Record<string, string | undefined>>,
  policy: ManagedPolicySummary | undefined,
  target: AnalyticsTarget,
) =>
  analyticsDestination(target) !== undefined &&
  policy?.limits?.telemetry !== false &&
  env.T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING !== "1" &&
  isAnalyticsAllowed(env);

/** What clients are told: the address and where each half came from, never the key itself. */
export const describeAnalytics = (
  env: Readonly<Record<string, string | undefined>>,
  policy: ManagedPolicySummary | undefined,
  target: AnalyticsTarget,
): Pick<
  ServerObservability,
  "analyticsUrl" | "analyticsUrlSource" | "analyticsKeySource" | "analyticsEnabled"
> => ({
  ...(target.url === undefined
    ? {}
    : { analyticsUrl: target.url, analyticsUrlSource: target.urlSource }),
  ...(target.keySource === undefined ? {} : { analyticsKeySource: target.keySource }),
  analyticsEnabled: analyticsEnabledFor(env, policy, target),
});

const optionalString = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));

/** What the running server resolved at start: the environment over the setting saved then. */
export const resolved = Effect.gen(function* () {
  const environment = yield* Config.all({
    url: optionalString("T3CODE_POSTHOG_HOST"),
    key: optionalString("T3CODE_POSTHOG_KEY"),
  });
  const { savedAnalytics } = yield* ServerConfig.ServerConfig;
  return resolveAnalyticsTarget(environment, savedAnalytics);
}).pipe(Effect.orElseSucceed((): AnalyticsTarget => ({})));
