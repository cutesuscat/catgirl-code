// @effect-diagnostics nodeBuiltinImport:off

// Catgirl Code: a client that reaches a machine over SSH replaces an older server it started
// there, which stops every thread running on it. This asks first: the launch keeps a server that
// has work running, or whose database this build cannot run, and the update waits for a later launch.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, GlobalFlag } from "effect/cli";

import packageJson from "../../package.json" with { type: "json" };
import { BUILD_MIGRATION_HEAD, recordedMigrations } from "../persistence/databaseMigrationHead.ts";
import { resolveCliAuthConfig } from "./config.ts";
import { withThreadTools } from "./thread.ts";

/** A person drops this file into the T3 home's runtime folder to say "replace it now anyway". */
const REPLACE_BUSY_SERVER_FILE = "replace-busy-server";

// A thread in any of these has a run that a restart would cut short.
const ACTIVE_THREAD_STATUSES = ["preparing", "queued", "starting", "running", "waiting"] as const;
const ASK_TIMEOUT = Duration.seconds(20);

const ThreadCount = Schema.Struct({
  threads: Schema.Array(Schema.Unknown),
  total: Schema.optional(Schema.Number),
});
const RunningServer = Schema.Struct({
  pid: Schema.Number,
  serverVersion: Schema.optional(Schema.String),
});
const decodeRunningServer = Schema.decodeUnknownOption(Schema.fromJsonString(RunningServer));

export type UpdateDeferral =
  | { readonly reason: "busy"; readonly runningThreads: number }
  | { readonly reason: "unknown" }
  | { readonly reason: "newer-database"; readonly migrations: number };

/**
 * Why replacing the running server must wait, or `null` when it may go ahead. A database with
 * migrations this build does not know is never taken over; "replace it now" only overrides work.
 */
export function updateDeferral(input: {
  readonly unknownMigrations: number;
  /** `undefined` when the running server could not be asked. */
  readonly runningThreads: number | undefined;
  readonly replaceRequested: boolean;
}): UpdateDeferral | null {
  if (input.unknownMigrations > 0) {
    return { reason: "newer-database", migrations: input.unknownMigrations };
  }
  if (input.replaceRequested) return null;
  if (input.runningThreads === undefined) return { reason: "unknown" };
  return input.runningThreads > 0 ? { reason: "busy", runningThreads: input.runningThreads } : null;
}

/** The one line of JSON a launch records and hands to its client. */
export const deferralRecord = (deferral: UpdateDeferral, serverVersion: string | undefined) =>
  JSON.stringify({
    ...deferral,
    ...(serverVersion === undefined ? {} : { serverVersion }),
    wantedVersion: packageJson.version,
  });

/** Threads with a run in progress, asked of the running server as `t3 thread list` asks it. */
const countRunningThreads = (baseDir: string) =>
  withThreadTools(
    { baseDir: Option.some(baseDir), json: true, clientLabel: "t3 ssh launch" },
    (tools) =>
      tools
        .call(
          "t3_thread_list",
          {
            allProjects: true,
            statuses: ACTIVE_THREAD_STATUSES,
            includeSubagents: true,
            limit: 100,
          },
          ThreadCount,
        )
        .pipe(Effect.map((result) => result.total ?? result.threads.length)),
  ).pipe(
    Effect.timeout(ASK_TIMEOUT),
    Effect.map((count): number | undefined => count),
    Effect.catchCause(() => Effect.undefined),
  );

/** The running server's own version, and whether replacing it must wait. */
const decide = Effect.fn("cli.deferUpdate.decide")(function* (
  baseDir: string,
  pid: number,
  replaceRequested: boolean,
) {
  const config = yield* resolveCliAuthConfig(
    { baseDir: Option.some(baseDir) },
    yield* GlobalFlag.LogLevel,
    { quietLogs: true },
  );
  const runtimeJson = NodeFS.existsSync(config.serverRuntimeStatePath)
    ? NodeFS.readFileSync(config.serverRuntimeStatePath, "utf8")
    : "";
  const running = Option.getOrUndefined(decodeRunningServer(runtimeJson));
  const recorded = recordedMigrations(config.dbPath);
  const deferral = updateDeferral({
    unknownMigrations: (recorded ?? []).filter(({ id }) => id > BUILD_MIGRATION_HEAD).length,
    // A server that has not published itself as `pid` cannot be asked about its threads.
    runningThreads:
      replaceRequested || running?.pid !== pid ? undefined : yield* countRunningThreads(baseDir),
    replaceRequested,
  });
  return { deferral, serverVersion: running?.serverVersion };
});

/**
 * Exits 0 and prints the reason as one line of JSON when the managed server `pid` must be kept,
 * exits 1 when the launch may replace it. Older t3 builds have no such command, and so replace.
 */
export const deferUpdateCommand = Command.make("defer-update", {
  baseDir: Argument.String("base-dir"),
  pid: Argument.Int("pid"),
}).pipe(
  Command.withHandler(({ baseDir, pid }) =>
    Effect.gen(function* () {
      const marker = NodePath.join(baseDir, "runtime", REPLACE_BUSY_SERVER_FILE);
      const replaceRequested = NodeFS.existsSync(marker);
      // A check that breaks must not read as "idle": the server stays unless replacing was asked for.
      const { deferral, serverVersion } = yield* decide(baseDir, pid, replaceRequested).pipe(
        Effect.catchCause(() =>
          Effect.succeed({
            deferral: replaceRequested ? null : ({ reason: "unknown" } as const),
            serverVersion: undefined,
          }),
        ),
      );
      if (deferral === null) {
        // One request replaces one server, so the next update asks again.
        NodeFS.rmSync(marker, { force: true });
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${deferralRecord(deferral, serverVersion)}\n`);
    }),
  ),
);
