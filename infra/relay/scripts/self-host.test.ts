import { describe, expect, it } from "@effect/vitest";

import vector from "../src/connect/catgirlConnectDocument.vector.json" with { type: "json" };
import { parseEnvFile, planDeployment, readEnvelope } from "./self-host.ts";

const BASE = {
  CLOUDFLARE_API_TOKEN: "token",
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLERK_PUBLISHABLE_KEY: "pk_test_x",
};

describe("self-host deploy plan", () => {
  it("reads env files the way people write them", () => {
    expect(
      parseEnvFile(
        "# comment\nexport A=1\nB=\"two words\"\nC='x#y'\nD=plain # note\n\nbroken line\n",
      ),
    ).toEqual({ A: "1", B: "two words", C: "x#y", D: "plain" });
  });

  it("needs a Clerk secret and a database, unless it is a trial", () => {
    expect(planDeployment(BASE, false).missing).toEqual(["CLERK_SECRET_KEY", "RELAY_DATABASE_URL"]);
    const trial = planDeployment(BASE, true);
    expect(trial.missing).toEqual([]);
    expect(trial.env).toMatchObject({
      RELAY_PROFILE: "self-host",
      RELAY_DATABASE_URL: "none",
      RELAY_WORKER_NAME: "catgirl-connect",
      APNS_ENABLED: "false",
      CLERK_JWT_TEMPLATE: "t3-relay",
    });
    expect(trial.relayUrl).toBeUndefined();
    expect(trial.notes).toHaveLength(3);
  });

  it("puts the relay at relay.<zone> once it has a domain", () => {
    const plan = planDeployment(
      {
        ...BASE,
        CLERK_SECRET_KEY: "sk",
        RELAY_DATABASE_URL: "postgres://u:p@db/x",
        RELAY_API_ZONE_NAME: "cats.example",
      },
      false,
    );
    expect(plan.missing).toEqual([]);
    expect(plan.relayUrl).toBe("https://relay.cats.example");
    expect(plan.env.RELAY_TUNNEL_ZONE_NAME).toBe("cats.example");
    expect(planDeployment({ ...BASE, RELAY_STAGE: "staging" }, true).env.RELAY_WORKER_NAME).toBe(
      "catgirl-connect-staging",
    );
  });

  it("refuses half a t3gate configuration", () => {
    expect(planDeployment({ ...BASE, T3GATE_SECRET: "s" }, true).missing).toEqual([
      "T3GATE_GATE and T3GATE_PROXY_IP (T3GATE_SECRET is set)",
    ]);
  });
});

describe("the deployed document check", () => {
  it("accepts the vector's valid envelope and prints its fingerprint and setup link", () => {
    const checked = readEnvelope(vector.cases.valid.envelope, "https://relay.example.com");
    expect(typeof checked === "string" ? checked : checked.fingerprint).toBe(
      vector.keys.old.fingerprint,
    );
    expect(typeof checked === "string" ? checked : checked.setupLink).toBe(
      `https://relay.example.com/#fp=${vector.keys.old.fingerprint.replaceAll(" ", "")}`,
    );
  });

  it("refuses an altered payload and a document for another address", () => {
    expect(readEnvelope(vector.cases.badSignature.envelope, "https://relay.example.com")).toBe(
      "the signature does not verify",
    );
    expect(readEnvelope(vector.cases.valid.envelope, "https://other.example.com")).toBe(
      "version 2 for https://relay.example.com",
    );
    expect(readEnvelope(undefined, "https://relay.example.com")).toContain("no signed document");
  });
});
