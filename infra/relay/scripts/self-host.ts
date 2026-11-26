// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalFetchInEffect:off - A deploy command reads local files, runs the Alchemy CLI and checks the deployed instance over HTTPS.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as PgClient from "@effect/sql-pg/PgClient";
import {
  connectFingerprintEmoji,
  connectFingerprintEmojiLines,
} from "@t3tools/shared/connectFingerprintEmoji";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** One command for a Catgirl Connect instance: `deploy [--trial] [--smoke]`, `status`, `destroy`, each with `--env-file`. See SELF-HOSTING.md. */
const RELAY_DIR = NodePath.resolve(import.meta.dirname, "..");
const ALCHEMY_BIN = NodePath.join(RELAY_DIR, "node_modules", "alchemy", "bin", "alchemy.js");
const MIGRATIONS_DIR = NodePath.join(RELAY_DIR, "migrations", "postgres");
const MIGRATIONS_TABLE = "catgirl_relay_migrations";

class SelfHostError extends Schema.TaggedError<SelfHostError>()("SelfHostError", {
  message: Schema.String,
}) {}

const fail = (message: string) => Effect.fail(new SelfHostError({ message }));

interface Flags {
  readonly command: "deploy" | "status" | "destroy";
  readonly envFile: string;
  readonly trial: boolean;
  readonly smoke: boolean;
  readonly dryRun: boolean;
  readonly baseline: string | undefined;
}

function parseFlags(argv: ReadonlyArray<string>): Flags | string {
  const [command, ...rest] = argv;
  if (command !== "deploy" && command !== "status" && command !== "destroy") {
    return "Usage: node scripts/self-host.ts <deploy|status|destroy> [--env-file FILE] [--trial] [--smoke]";
  }
  let envFile = NodePath.join(RELAY_DIR, ".env.selfhost");
  let trial = false;
  let smoke = false;
  let dryRun = false;
  let baseline: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === "--env-file") envFile = NodePath.resolve(rest[++index] ?? "");
    else if (flag === "--trial") trial = true;
    else if (flag === "--smoke") smoke = true;
    else if (flag === "--dry-run") dryRun = true;
    else if (flag === "--baseline") baseline = rest[++index];
    else return `Unknown option ${flag}`;
  }
  return { command, envFile, trial, smoke, dryRun, baseline };
}

/** KEY=VALUE lines; `#` comments; optional single or double quotes. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match) continue;
    let value = match[2] ?? "";
    const quoted = /^(["'])([\s\S]*)\1$/u.exec(value);
    value = quoted ? (quoted[2] ?? "") : value.replace(/\s+#.*$/u, "");
    values[match[1] ?? ""] = value;
  }
  return values;
}

export interface Plan {
  readonly env: Record<string, string>;
  readonly stage: string;
  readonly relayUrl: string | undefined;
  readonly missing: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

const set = (value: string | undefined) => value !== undefined && value.trim() !== "";

/** Checks the inputs and fills in the profile; nothing here touches the network. */
export function planDeployment(input: Record<string, string>, trial: boolean): Plan {
  const env: Record<string, string> = { APNS_ENABLED: "false", ...input };
  const missing: Array<string> = [];
  const notes: Array<string> = [];
  for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLERK_PUBLISHABLE_KEY"]) {
    if (!set(env[name])) missing.push(name);
  }
  const stage = env.RELAY_STAGE?.trim() || "prod";
  env.RELAY_PROFILE = "self-host";
  env.RELAY_WORKER_NAME ||= stage === "prod" ? "catgirl-connect" : `catgirl-connect-${stage}`;
  env.CLERK_JWT_TEMPLATE ||= "t3-relay";
  env.CLERK_JWT_AUDIENCE ||= "t3-code-relay";
  if (!set(env.CLERK_SECRET_KEY)) {
    if (trial) {
      env.CLERK_SECRET_KEY = "sk_test_not_configured";
      notes.push("No CLERK_SECRET_KEY: sign-in is refused until you add it and deploy again.");
    } else missing.push("CLERK_SECRET_KEY");
  }
  if (!set(env.RELAY_DATABASE_URL) || env.RELAY_DATABASE_URL === "none") {
    if (trial) {
      env.RELAY_DATABASE_URL = "none";
      notes.push("No RELAY_DATABASE_URL: machines cannot link until you add a Postgres database.");
    } else missing.push("RELAY_DATABASE_URL");
  } else if (!/^postgres(?:ql)?:\/\//u.test(env.RELAY_DATABASE_URL ?? "")) {
    missing.push("RELAY_DATABASE_URL (must start with postgres://)");
  }
  if (set(env.RELAY_TUNNEL_ZONE_NAME) && !set(env.RELAY_API_ZONE_NAME)) {
    missing.push("RELAY_API_ZONE_NAME (a tunnel zone needs an API zone too)");
  }
  if (set(env.RELAY_API_ZONE_NAME)) {
    env.RELAY_TUNNEL_ZONE_NAME ||= env.RELAY_API_ZONE_NAME ?? "";
  } else {
    delete env.RELAY_API_ZONE_NAME;
    delete env.RELAY_TUNNEL_ZONE_NAME;
    notes.push(
      "No RELAY_API_ZONE_NAME: the instance lives at its workers.dev address and gives machines no endpoints.",
    );
  }
  if (env.RELAY_AXIOM === "on" && !(set(env.AXIOM_TOKEN) && set(env.AXIOM_ORG_ID))) {
    missing.push("AXIOM_TOKEN and AXIOM_ORG_ID (RELAY_AXIOM=on)");
  }
  if (set(env.T3GATE_SECRET) && !(set(env.T3GATE_GATE) && set(env.T3GATE_PROXY_IP))) {
    missing.push("T3GATE_GATE and T3GATE_PROXY_IP (T3GATE_SECRET is set)");
  }
  const zone = env.RELAY_API_ZONE_NAME;
  const relayDomain = set(env.RELAY_DOMAIN)
    ? env.RELAY_DOMAIN
    : zone === undefined
      ? undefined
      : `${stage === "prod" ? "relay" : `relay-${stage}`}.${zone}`;
  return {
    env,
    stage,
    relayUrl: relayDomain === undefined ? undefined : `https://${relayDomain}`,
    missing,
    notes,
  };
}

const cloudflare = Effect.fn("selfHost.cloudflare")(function* (
  env: Record<string, string>,
  path: string,
) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`, {
        headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      }).then((r) => r.json() as Promise<{ success?: boolean; result?: Record<string, unknown> }>),
    catch: () => new SelfHostError({ message: `Cloudflare's API did not answer for ${path}.` }),
  });
  if (!response.success)
    return yield* fail(`Cloudflare refused ${path}; check the token's permissions.`);
  return response.result ?? {};
});

/** The operator's key for /operator, made once per stage and kept beside the deploy state. */
function operatorKey(stage: string): {
  readonly key: string;
  readonly file: string;
  readonly created: boolean;
} {
  const dir = NodePath.join(RELAY_DIR, ".alchemy", "self-host", stage);
  const file = NodePath.join(dir, "operator-key");
  NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (NodeFS.existsSync(file)) {
    return { key: NodeFS.readFileSync(file, "utf8").trim(), file, created: false };
  }
  const key = NodeCrypto.randomBytes(32).toString("base64url");
  NodeFS.writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return { key, file, created: true };
}

/** Applies `migrations/postgres` in order, once each, recording them in their own table. */
const migrate = Effect.fn("selfHost.migrate")(function* (baseline: string | undefined) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), baselined boolean NOT NULL DEFAULT false)`,
  );
  const recorded = yield* sql.unsafe<{ readonly name: string }>(
    `SELECT name FROM ${MIGRATIONS_TABLE}`,
  );
  const done = new Set(recorded.map((row) => row.name));
  const names = NodeFS.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{14}_/u.test(name))
    .sort();
  if (baseline !== undefined && !names.includes(baseline)) {
    return yield* fail(`--baseline ${baseline} is not one of the migrations in ${MIGRATIONS_DIR}.`);
  }
  let applied = 0;
  for (const name of names) {
    if (done.has(name)) continue;
    const marked = baseline !== undefined && name <= baseline;
    const text = NodeFS.readFileSync(NodePath.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
    const statements = text
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => statement !== "");
    yield* Effect.gen(function* () {
      if (!marked) for (const statement of statements) yield* sql.unsafe(statement);
      yield* sql.unsafe(`INSERT INTO ${MIGRATIONS_TABLE} (name, baselined) VALUES ($1, $2)`, [
        name,
        marked,
      ]);
    }).pipe(sql.withTransaction);
    applied += 1;
    yield* Console.log(`  ${marked ? "marked as applied" : "applied"}: ${name}`);
  }
  yield* Console.log(
    applied === 0 ? "  database is up to date" : `  ${applied} migrations recorded`,
  );
});

const PLAN_PREFIXES = [
  "RELAY_",
  "CONNECT_",
  "CLERK_",
  "T3GATE_",
  "AXIOM_",
  "APNS_",
  "FCM_",
  "CLOUDFLARE_",
];

function runAlchemy(command: "deploy" | "destroy", plan: Plan, dryRun: boolean): number | null {
  // Alchemy reads `.env` when given no file; give it an empty one so only this plan counts.
  const dir = NodePath.join(RELAY_DIR, ".alchemy", "self-host", plan.stage);
  NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const emptyEnvFile = NodePath.join(dir, "empty.env");
  NodeFS.writeFileSync(emptyEnvFile, "", { mode: 0o600 });
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !PLAN_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
  return NodeChildProcess.spawnSync(
    process.execPath,
    [
      ALCHEMY_BIN,
      command,
      "--config",
      "selfhost.run.ts",
      "--stage",
      plan.stage,
      "--env-file",
      emptyEnvFile,
      "--yes",
      ...(dryRun ? ["--dry-run"] : []),
    ],
    // Alchemy's CLI reports usage to otel.alchemy.run unless told not to.
    {
      cwd: RELAY_DIR,
      stdio: "inherit",
      env: {
        ...inherited,
        ...plan.env,
        CI: "true",
        DO_NOT_TRACK: "1",
        ALCHEMY_TELEMETRY_DISABLED: "1",
      },
    },
  ).status;
}

const alchemy = (command: "deploy" | "destroy", plan: Plan, dryRun = false) =>
  Effect.sync(() => runAlchemy(command, plan, dryRun));

const spki = (raw: Uint8Array) =>
  NodeCrypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
    format: "der",
    type: "spki",
  });

/** Checks an envelope the way the apps do: the signature over the payload bytes, then the payload. */
export function readEnvelope(
  envelope: unknown,
  relayUrl: string,
):
  | {
      readonly document: Record<string, unknown>;
      readonly fingerprint: string;
      readonly setupLink: string;
    }
  | string {
  if (typeof envelope !== "object" || envelope === null)
    return "serves no signed document (is CLERK_JWT_TEMPLATE set?)";
  const { payload, signature, key } = envelope as Record<string, unknown>;
  if (typeof payload !== "string" || typeof signature !== "string" || typeof key !== "string") {
    return "serves no signed document (is CLERK_JWT_TEMPLATE set?)";
  }
  const bytes = Buffer.from(payload, "base64url");
  const keyBytes = Buffer.from(key, "base64url");
  if (!NodeCrypto.verify(null, bytes, spki(keyBytes), Buffer.from(signature, "base64url"))) {
    return "the signature does not verify";
  }
  const document = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (document.version !== 2 || document.relayUrl !== relayUrl) {
    return `version ${String(document.version)} for ${String(document.relayUrl)}`;
  }
  const hex = NodeCrypto.createHash("sha256").update(keyBytes).digest("hex").slice(0, 16);
  return {
    document,
    fingerprint: hex.replace(/(.{4})(?!$)/gu, "$1 "),
    setupLink: `${relayUrl}/#fp=${hex}`,
  };
}

/** The fingerprint as the apps show it: the emoji, each name under its emoji, then the hex. */
export function identityLines(fingerprint: string): ReadonlyArray<string> {
  const label = "Fingerprint  ";
  const indent = " ".repeat(label.length);
  const lines = connectFingerprintEmojiLines(fingerprint);
  const catFirst = connectFingerprintEmoji(fingerprint)?.[0]?.name === "Cat";
  return [
    ...(lines === null
      ? [`${label}${fingerprint}`]
      : [`${label}${lines.emoji}`, `${indent}${lines.names}`, `${indent}${fingerprint}`]),
    ...(catFirst
      ? []
      : [
          `${indent}(Not cat-first: a key from before cat-first keys, or one you brought. Apps accept it.)`,
        ]),
  ];
}

const getJson = (url: string, init?: RequestInit) =>
  Effect.tryPromise({
    try: () =>
      fetch(url, init).then(async (response) => ({
        status: response.status,
        body: (await response.json().catch(() => undefined)) as unknown,
      })),
    catch: () => new SelfHostError({ message: `${url} did not answer.` }),
  });

/** Fetches the instance's document and checks it before anything is printed as trusted. */
const checkDocument = Effect.fn("selfHost.checkDocument")(function* (relayUrl: string) {
  const url = `${relayUrl}/.well-known/catgirl-connect.json`;
  const response = yield* getJson(url);
  const checked = readEnvelope(response.status === 200 ? response.body : undefined, relayUrl);
  if (typeof checked === "string") return yield* fail(`${url}: ${checked}.`);
  return checked;
});

function testBatch(token: unknown): string {
  return JSON.stringify({
    api_key: token,
    batch: [
      {
        event: "catgirl.connect.smoke_test",
        distinct_id: "self-host-script",
        properties: { t3CodeVersion: "self-host-check" },
      },
    ],
  });
}

const fieldOf = (body: unknown, field: string): unknown =>
  typeof body === "object" && body !== null ? Reflect.get(body, field) : undefined;

/** One test event through the operator's own write key, then read back from the summary. */
const smokeTest = Effect.fn("selfHost.smokeTest")(function* (relayUrl: string, key: string) {
  const auth = { authorization: `Bearer ${key}` };
  const token = yield* getJson(`${relayUrl}/v1/collect/operator-token`, {
    method: "POST",
    headers: auth,
  });
  if (token.status !== 200) return yield* fail(`operator token: HTTP ${token.status}`);
  const sent = yield* getJson(`${relayUrl}/v1/collect/analytics/batch/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: testBatch(fieldOf(token.body, "token")),
  });
  if (sent.status !== 200) return yield* fail(`test event: HTTP ${sent.status}`);
  const summary = yield* getJson(`${relayUrl}/operator/summary.json`, { headers: auth });
  const rows = fieldOf(summary.body, "rows");
  const seen =
    Array.isArray(rows) &&
    rows.some((row) => fieldOf(row, "event") === "catgirl.connect.smoke_test");
  if (!seen) return yield* fail("the test event did not reach the summary.");
  yield* Console.log("  test event stored and counted on the operator page");
});

const program = Effect.gen(function* () {
  const flags = parseFlags(process.argv.slice(2));
  if (typeof flags === "string") return yield* fail(flags);
  if (!NodeFS.existsSync(flags.envFile)) {
    return yield* fail(
      `No ${flags.envFile}. Copy selfhost.env.example to .env.selfhost and fill it in.`,
    );
  }
  // Only a deploy needs every input; status and destroy need the account and the address.
  const plan = planDeployment(
    { ...parseEnvFile(NodeFS.readFileSync(flags.envFile, "utf8")) },
    flags.trial || flags.command !== "deploy",
  );
  if (plan.missing.length > 0) {
    return yield* fail(`Missing: ${plan.missing.join(", ")}. See SELF-HOSTING.md.`);
  }
  let relayUrl = plan.relayUrl;
  if (relayUrl === undefined) {
    const subdomain = (yield* cloudflare(plan.env, "/workers/subdomain")).subdomain;
    if (typeof subdomain !== "string") {
      return yield* fail(
        "This account has no workers.dev subdomain; pick one in the Cloudflare dashboard.",
      );
    }
    plan.env.RELAY_DOMAIN = `${plan.env.RELAY_WORKER_NAME}.${subdomain}.workers.dev`;
    relayUrl = `https://${plan.env.RELAY_DOMAIN}`;
  }
  if (flags.command === "destroy") {
    yield* Console.log(`Removing the instance at ${relayUrl} (stage ${plan.stage})...`);
    if ((yield* alchemy("destroy", plan)) !== 0) return yield* fail("alchemy destroy failed.");
    return;
  }
  if (flags.command === "deploy") {
    for (const note of plan.notes) yield* Console.log(`note: ${note}`);
    const operator = operatorKey(plan.stage);
    plan.env.CONNECT_OPERATOR_KEY = operator.key;
    if (plan.env.RELAY_DATABASE_URL !== "none" && !flags.dryRun) {
      yield* Console.log("Database migrations:");
      yield* migrate(flags.baseline).pipe(
        Effect.provide(PgClient.layer({ url: Redacted.make(plan.env.RELAY_DATABASE_URL ?? "") })),
        Effect.catchTags({ SqlError: (cause) => fail(`Database: ${cause.message}`) }),
      );
    }
    yield* Console.log(`Deploying stage ${plan.stage} to ${relayUrl}...`);
    if ((yield* alchemy("deploy", plan, flags.dryRun)) !== 0) {
      return yield* fail("alchemy deploy failed.");
    }
    if (flags.dryRun) return;
    yield* Console.log(
      `Operator key ${operator.created ? "created and saved" : "kept"} in ${operator.file}`,
    );
  }
  // A new workers.dev address can take a few seconds to answer.
  const checked = yield* checkDocument(relayUrl).pipe(
    Effect.retry({ times: 10, schedule: Schedule.spaced("3 seconds") }),
  );
  if (flags.command === "deploy" && flags.smoke)
    yield* smokeTest(relayUrl, operatorKey(plan.stage).key);
  yield* Console.log(
    [
      "",
      `Instance     ${relayUrl}`,
      `Service      ${String((checked.document.service as { name?: string } | undefined)?.name ?? "(no CONNECT_SERVICE_NAME)")}`,
      ...identityLines(checked.fingerprint),
      `Setup link   ${checked.setupLink}`,
      `Operator     ${relayUrl}/operator (any user name; the key is in .alchemy/self-host/${plan.stage}/operator-key)`,
      `Expires      ${String(checked.document.expiresAt)} (renewed every hour)`,
    ].join("\n"),
  );
});

if (process.argv[1] !== undefined && NodePath.resolve(process.argv[1]) === import.meta.filename) {
  program.pipe(
    Effect.catchTags({
      SelfHostError: (error) =>
        Console.error(`self-host: ${error.message}`).pipe(
          Effect.andThen(Effect.sync(() => process.exit(1))),
        ),
    }),
    NodeRuntime.runMain,
  );
}
