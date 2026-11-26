import Constants from "expo-constants";
import { layerRemoteHttpClient } from "@t3tools/client-runtime/rpc";
import { type ReleaseChannel, releaseResourceAttributes } from "@t3tools/shared/releaseResource";
import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Layer from "effect/Layer";
import type * as HttpClient from "effect/http/HttpClient";

import { hasTracingPublicConfig, resolveCloudPublicConfig } from "../cloud/publicConfig";
import { connectTracesOffer, fetchWithCollectToken } from "./connectDiagnostics";
import { connectionTracesEnabled } from "./diagnosticsSetting";

export interface TracingConfig {
  readonly tracesUrl: string;
  readonly tracesDataset: string;
  readonly tracesToken: string;
}

export interface TracingResource {
  readonly serviceVersion?: string;
  readonly serviceInstanceId: string;
  readonly appVariant: string;
}

const RELEASE_CHANNEL_BY_VARIANT: Readonly<Record<string, ReleaseChannel | undefined>> = {
  development: "dev",
  preview: "preview",
  production: "stable",
};

export function resolveTracingConfig(): TracingConfig | null {
  const config = resolveCloudPublicConfig();
  if (!hasTracingPublicConfig(config)) {
    return null;
  }
  const { tracesUrl, tracesDataset, tracesToken } = config.observability;
  return { tracesUrl, tracesDataset, tracesToken };
}

export function layerFromConfig(
  config: TracingConfig | null,
  resource: TracingResource,
  isEnabled: () => boolean = connectionTracesEnabled,
) {
  const channel =
    typeof __DEV__ !== "undefined" && __DEV__
      ? "dev"
      : RELEASE_CHANNEL_BY_VARIANT[resource.appVariant];
  return RelayTracing.layer(
    config,
    {
      serviceName: "t3code-mobile",
      serviceVersion: resource.serviceVersion,
      runtime: "react-native",
      serviceInstanceId: resource.serviceInstanceId,
      client: `mobile-${resource.appVariant}`,
      attributes: channel && releaseResourceAttributes(channel),
    },
    { isEnabled },
  );
}

const resource: TracingResource = {
  serviceVersion: Constants.expoConfig?.version,
  serviceInstanceId: Constants.sessionId,
  appVariant:
    typeof Constants.expoConfig?.extra?.appVariant === "string"
      ? Constants.expoConfig.extra.appVariant
      : "unknown",
};

// A Catgirl Connect traces offer replaces the build's own address; sending waits for this phone's yes.
const connectOffer = connectTracesOffer();

export const layer: Layer.Layer<never, never, HttpClient.HttpClient> =
  connectOffer === null
    ? layerFromConfig(resolveTracingConfig(), resource)
    : layerFromConfig(connectOffer.config, resource, connectOffer.isEnabled).pipe(
        Layer.provide(layerRemoteHttpClient(fetchWithCollectToken(connectOffer.relayUrl))),
      );
