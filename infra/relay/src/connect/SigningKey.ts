import * as Alchemy from "alchemy";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy";
import { bytesToHex } from "@noble/hashes/utils";
import { generateCatFirstConnectSeed } from "@t3tools/shared/connectFingerprintEmoji";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

/**
 * The service document's signing key, made at deploy and kept in the deploy state as Alchemy's
 * own random values are. Its fingerprint starts with the cat 🐈: the deploy tries random seeds
 * until one does, about 64 tries, so the first emoji is the same on every instance.
 */
export type CatFirstSigningKey = Resource<
  "Catgirl.ConnectSigningKey",
  Record<string, never>,
  { text: Redacted.Redacted<string> }
>;

const CatFirstSigningKey = Resource<CatFirstSigningKey>("Catgirl.ConnectSigningKey");

/** 64 hex digits, as Alchemy writes its random values, so one parser reads both. */
const newCatFirstSeedText = (): string => bytesToHex(generateCatFirstConnectSeed().seed);

/** Made once; every later deploy keeps it, so the fingerprint stays until a rotation. */
export function reconcileCatFirstSigningKey(
  output: { readonly text: Redacted.Redacted<string> } | undefined,
): { readonly text: Redacted.Redacted<string> } {
  return output?.text ? output : { text: Redacted.make(newCatFirstSeedText()) };
}

export const CatFirstSigningKeyProvider = () =>
  Provider.succeed(
    CatFirstSigningKey,
    CatFirstSigningKey.Provider.of({
      reconcile: ({ output }) => Effect.sync(() => reconcileCatFirstSigningKey(output)),
      delete: () => Effect.void,
      read: ({ output }) => Effect.succeed(output),
      // Like Alchemy's random values, it lives only in the deploy state: nothing remote to list.
      list: () => Effect.succeed([]),
    }),
  );

/**
 * Which deploy-state value holds generation `generation`'s seed. Generations from
 * `catFirstSince` on are cat-first; earlier ones are the plain random keys instances deployed
 * before cat-first keys still have pinned, read from where those deploys left them.
 */
export function signingKeyResource(
  generation: number,
  catFirstSince: number,
): { readonly kind: "cat-first" | "random"; readonly id: string } {
  return generation >= catFirstSince
    ? { kind: "cat-first", id: `ConnectCatSigningKey${generation}` }
    : { kind: "random", id: `ConnectSigningKey${generation}` };
}

/** The seed of one generation, as 64 hex digits, resolved from the Worker's bindings at run time. */
export const makeSigningSeed = (generation: number, catFirstSince: number) => {
  const { kind, id } = signingKeyResource(generation, catFirstSince);
  return kind === "random"
    ? Alchemy.makeRandom(id, { bytes: 32 })
    : CatFirstSigningKey(id, {}).pipe(Effect.map((key) => key.text));
};
