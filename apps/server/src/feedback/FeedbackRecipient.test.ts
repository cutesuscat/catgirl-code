// Catgirl Code: where agent feedback goes. Off sends nothing, T3 Code's team gets upstream's
// analytics event, Catgirl Code gets nothing from this server, and nothing goes unapproved.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type AgentFeedbackRecipient,
  DEFAULT_SERVER_SETTINGS,
  type ManagedPolicyDocument,
  type OrchestrationV2Run,
  ProviderInstanceId,
  RunId,
  type ServerProvider,
  type ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import { CATGIRL_FEEDBACK_TITLE } from "@t3tools/shared/agentFeedbackRecipient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ServerConfig from "../config.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as Settings from "../serverSettings.ts";
import * as AnalyticsDestination from "../telemetry/AnalyticsDestination.ts";
import * as Analytics from "../telemetry/AnalyticsService.ts";
import { listFeedbackReports } from "./FeedbackList.ts";
import {
  awaitingApprovalNote,
  describeT3Delivery,
  FEEDBACK_CLI_DESCRIPTION,
  feedbackToolDescription,
  layerT3TeamAnalytics,
  T3_FEEDBACK_TITLE,
  T3_TEAM_TARGET,
} from "./FeedbackRecipient.ts";
import { FEEDBACK_AWAITING_APPROVAL_NOTE, type FeedbackInput } from "./FeedbackReport.ts";
import * as Feedback from "./FeedbackService.ts";
import * as Store from "./FeedbackStore.ts";

type Setting = ServerSettings["agentFeedback"];
type CardRecord = Extract<
  Parameters<Threads.ThreadManagementService["Service"]["dispatch"]>[0],
  { readonly type: "feedback_request.record" }
>;

const threadId = ThreadId.make("thread:recipient");
const instanceId = ProviderInstanceId.make("work-codex");
const runId = RunId.make("run:1");
const run = {
  id: runId,
  ordinal: 1,
  providerInstanceId: instanceId,
  modelSelection: { instanceId, model: "gpt-5.5" },
  rootNodeId: "node:1",
  startedAt: null,
} as unknown as OrchestrationV2Run;

/** The real service and store over an in-memory database, with the thread, settings and analytics faked. */
const harness = (initial: Setting) =>
  Effect.gen(function* () {
    const setting = yield* Ref.make(initial);
    const events = yield* Ref.make<ReadonlyArray<readonly [string, unknown]>>([]);
    const cards = yield* Queue.unbounded<CardRecord>();
    const shown = yield* Ref.make(new Map<string, CardRecord>());
    const threads = Layer.unwrap(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO orchestration_v2_projection_runs ${sql.insert({
          run_id: runId,
          thread_id: threadId,
          ordinal: 1,
          provider: "codex",
          status: "running",
          requested_at: "2026-01-01T00:00:00.000Z",
          payload_json: "{}",
        })}`;
        // The answer reads whether the card still waits from the projection, as in the server.
        const project = (card: CardRecord) => sql`
          INSERT INTO orchestration_v2_projection_turn_items ${sql.insert({
            turn_item_id: card.turnItemId,
            thread_id: threadId,
            run_id: card.runId,
            ordinal: 0,
            type: "feedback_request",
            status:
              card.feedbackStatus === "pending"
                ? "waiting"
                : card.feedbackStatus === "sent"
                  ? "completed"
                  : "cancelled",
            updated_at: "2026-01-01T00:00:00.000Z",
            payload_json: "{}",
          })}
          ON CONFLICT (turn_item_id) DO UPDATE SET status = excluded.status
          WHERE orchestration_v2_projection_turn_items.status = 'waiting'`;
        return Layer.mock(Threads.ThreadManagementService)({
          dispatch: (command) =>
            Effect.gen(function* () {
              const card = command as CardRecord;
              yield* Ref.update(shown, (all) => new Map(all).set(card.turnItemId, card));
              yield* project(card).pipe(Effect.orDie);
              yield* Queue.offer(cards, card);
              return {};
            }) as never,
          getThreadRecords: (_threadId, fields, filter) =>
            Effect.gen(function* () {
              const wanted = fields as ReadonlyArray<string>;
              const cardsShown = [...(yield* Ref.get(shown)).values()].map(
                ({ type: _type, commandId: _id, turnItemId, ...card }) => ({
                  ...card,
                  type: "feedback_request",
                  id: turnItemId,
                }),
              );
              return {
                ...(wanted.includes("runs") ? { runs: [run] } : {}),
                ...(wanted.includes("turnItems")
                  ? {
                      turnItems: filter?.turnItemTypes?.includes("feedback_request")
                        ? cardsShown
                        : [],
                    }
                  : {}),
              };
            }) as never,
          getThreadShell: () =>
            Effect.succeed({
              ...liveThreadShell(threadId, { activeRunId: runId }),
              modelSelection: { instanceId, model: "gpt-5.5" },
            }),
        });
      }),
    );
    const read = Ref.get(setting).pipe(
      Effect.map((agentFeedback) => ({ ...DEFAULT_SERVER_SETTINGS, agentFeedback })),
    );
    const layer = Feedback.layer(() => ["t3_thread_read", "t3_feedback"]).pipe(
      Layer.provideMerge(Store.layer),
      Layer.provideMerge(
        Layer.mergeAll(
          threads,
          Layer.mock(Settings.ServerSettingsService)({
            getSettings: read,
            withSettingsSnapshot: (use) => read.pipe(Effect.flatMap(use)),
          }),
          Layer.mock(Analytics.AnalyticsService)({
            record: (event, properties) =>
              Ref.update(events, (rows) => [...rows, [event, properties] as const]).pipe(
                Effect.as(true),
              ),
          }),
          Layer.mock(Projects.ProjectService)({ getById: () => Effect.succeedNone }),
          Layer.mock(Providers.ProviderRegistry)({
            getProviders: Effect.succeed([
              {
                instanceId,
                driver: "codex",
                auth: { status: "authenticated" },
                models: [{ slug: "gpt-5.5", isCustom: false }],
              } as unknown as ServerProvider,
            ]),
          }),
          SecureRandom.layerWebCrypto,
        ),
      ),
      Layer.provideMerge(SqlitePersistence.layerMemory),
    );
    return { setting, events, cards, layer };
  });

const input = {
  kind: "bug" as const,
  subject: "t3_thread_read",
  expected: "Items for a completed thread.",
  actual: "No items.",
  workaround: "",
  userRequested: false,
  turns: 1,
} satisfies FeedbackInput;
const requested = { ...input, userRequested: true };
const fromThread = { source: "mcp" as const, threadId };

const show = (cards: Queue.Queue<CardRecord>, recipient: AgentFeedbackRecipient) =>
  Effect.gen(function* () {
    const feedback = yield* Feedback.FeedbackService;
    expect(yield* feedback.submit(requested, fromThread)).toEqual({
      status: "awaiting_approval",
      note: awaitingApprovalNote(recipient),
    });
    const card = yield* Queue.take(cards);
    expect(card.feedbackStatus).toBe("pending");
    return card;
  });

const answer = (card: CardRecord, reply: "send" | "decline", recipient?: AgentFeedbackRecipient) =>
  Effect.gen(function* () {
    const store = yield* Store.FeedbackStore;
    return yield* store
      .answer({
        threadId,
        turnItemId: card.turnItemId,
        answer: reply,
        ...(recipient === undefined ? {} : { recipient }),
      })
      .pipe(Effect.exit);
  });

const failureReason = (exit: unknown) =>
  (exit as { readonly cause?: { readonly reasons?: ReadonlyArray<{ readonly error?: unknown }> } })
    .cause?.reasons?.[0]?.error;

it.effect("Off sends nothing and shows no card, whichever recipient is chosen", () =>
  Effect.gen(function* () {
    for (const recipient of ["t3code", "catgirl-code"] as const) {
      const { events, cards, layer } = yield* harness({ mode: "off", recipient });
      yield* Effect.gen(function* () {
        const feedback = yield* Feedback.FeedbackService;
        for (const report of [input, requested]) {
          const error = yield* Effect.flip(feedback.submit(report, fromThread));
          expect(error._tag).toBe("FeedbackOffError");
        }
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(events)).toEqual([]);
      expect(yield* Queue.size(cards)).toBe(0);
    }
  }),
);

it.effect("T3 Code's team gets upstream's event, only after Send", () =>
  Effect.gen(function* () {
    const { events, cards, layer } = yield* harness({ mode: "on-request", recipient: "t3code" });
    yield* Effect.gen(function* () {
      const card = yield* show(cards, "t3code");
      // Upstream's card and note, unchanged.
      expect(card.title).toBe(T3_FEEDBACK_TITLE);
      expect(awaitingApprovalNote("t3code")).toBe(FEEDBACK_AWAITING_APPROVAL_NOTE);
      expect(yield* Ref.get(events)).toEqual([]);
      expect((yield* answer(card, "send", "t3code"))._tag).toBe("Success");
      const closed = yield* Queue.take(cards);
      expect(closed).toMatchObject({ feedbackStatus: "sent" });
      expect(closed.title).toBe(T3_FEEDBACK_TITLE);
      expect(yield* Ref.get(events)).toMatchObject([
        [
          "agent.feedback",
          {
            kind: "bug",
            subject: "t3_thread_read",
            expected: "Items for a completed thread.",
            actual: "No items.",
            userRequested: true,
            source: "mcp",
          },
        ],
      ]);
      const [stored] = yield* listFeedbackReports;
      expect(stored).toMatchObject({ userRequested: true, sent: true });
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("an app that names no recipient can approve a report only for T3 Code's team", () =>
  Effect.gen(function* () {
    const t3 = yield* harness({ mode: "on-request", recipient: "t3code" });
    yield* Effect.gen(function* () {
      const card = yield* show(t3.cards, "t3code");
      expect((yield* answer(card, "send"))._tag).toBe("Success");
      expect((yield* Queue.take(t3.cards)).feedbackStatus).toBe("sent");
    }).pipe(Effect.provide(t3.layer));
    expect(yield* Ref.get(t3.events)).toHaveLength(1);

    const catgirl = yield* harness({ mode: "on-request", recipient: "catgirl-code" });
    yield* Effect.gen(function* () {
      const card = yield* show(catgirl.cards, "catgirl-code");
      const refused = yield* answer(card, "send");
      expect(failureReason(refused)).toMatchObject({ reason: "recipient_changed" });
      // The card stays open and nothing is stored.
      expect(yield* Queue.size(catgirl.cards)).toBe(0);
      expect(yield* listFeedbackReports).toEqual([]);
    }).pipe(Effect.provide(catgirl.layer));
    expect(yield* Ref.get(catgirl.events)).toEqual([]);
  }),
);

it.effect(
  "Catgirl Code: Send hands the report to the user's browser and this server sends nothing",
  () =>
    Effect.gen(function* () {
      const { events, cards, layer } = yield* harness({
        mode: "on-request",
        recipient: "catgirl-code",
      });
      yield* Effect.gen(function* () {
        const card = yield* show(cards, "catgirl-code");
        expect(card.title).toBe(CATGIRL_FEEDBACK_TITLE);
        expect(awaitingApprovalNote("catgirl-code")).toContain("Catgirl Code");
        expect(awaitingApprovalNote("catgirl-code")).toContain("nickypro/catgirl-code");
        expect((yield* answer(card, "send", "catgirl-code"))._tag).toBe("Success");
        const closed = yield* Queue.take(cards);
        expect(closed).toMatchObject({ feedbackStatus: "sent", title: CATGIRL_FEEDBACK_TITLE });
        const [stored] = yield* listFeedbackReports;
        expect(stored).toMatchObject({ userRequested: true, sent: true });
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(events)).toEqual([]);
    }),
);

it.effect("a card answered after the recipient changed sends nothing until it is read again", () =>
  Effect.gen(function* () {
    const { setting, events, cards, layer } = yield* harness({
      mode: "on-request",
      recipient: "t3code",
    });
    yield* Effect.gen(function* () {
      // Shown for T3 Code's team; the user then picks Catgirl Code before answering.
      const card = yield* show(cards, "t3code");
      yield* Ref.set(setting, { mode: "on-request", recipient: "catgirl-code" } satisfies Setting);
      const stale = yield* answer(card, "send", "t3code");
      expect(failureReason(stale)).toMatchObject({ reason: "recipient_changed" });
      expect(yield* Ref.get(events)).toEqual([]);
      expect(yield* Queue.size(cards)).toBe(0);
      // The card, read again, names Catgirl Code.
      expect((yield* answer(card, "send", "catgirl-code"))._tag).toBe("Success");
      expect(yield* Queue.take(cards)).toMatchObject({
        feedbackStatus: "sent",
        title: CATGIRL_FEEDBACK_TITLE,
      });

      // And back: a card shown for Catgirl Code is not sent to T3 Code's team.
      const other = yield* show(cards, "catgirl-code");
      yield* Ref.set(setting, { mode: "on-request", recipient: "t3code" } satisfies Setting);
      const refused = yield* answer(other, "send", "catgirl-code");
      expect(failureReason(refused)).toMatchObject({ reason: "recipient_changed" });
      expect(yield* Ref.get(events)).toEqual([]);
      expect((yield* answer(other, "send", "t3code"))._tag).toBe("Success");
      expect((yield* Queue.take(cards)).title).toBe(T3_FEEDBACK_TITLE);
    }).pipe(Effect.provide(layer));
    expect(yield* Ref.get(events)).toHaveLength(1);
  }),
);

it.effect("approval is still required: Catgirl Code takes no unprompted report", () =>
  Effect.gen(function* () {
    // Automatic, as another app could set it: with Catgirl Code it acts as When I ask.
    const catgirl = yield* harness({ mode: "auto", recipient: "catgirl-code" });
    yield* Effect.gen(function* () {
      const feedback = yield* Feedback.FeedbackService;
      const unprompted = yield* Effect.flip(feedback.submit(input, fromThread));
      expect(unprompted._tag).toBe("FeedbackNotRequestedError");
      const cli = yield* Effect.flip(feedback.submit(input, { source: "cli" }));
      expect(cli._tag).toBe("FeedbackNotRequestedError");
      // A requested report still needs a thread whose user can see the card.
      const outside = yield* Effect.flip(feedback.submit(requested, { source: "mcp" }));
      expect(outside._tag).toBe("FeedbackApprovalError");
      expect(yield* listFeedbackReports).toEqual([]);
      expect(yield* Queue.size(catgirl.cards)).toBe(0);
    }).pipe(Effect.provide(catgirl.layer));
    expect(yield* Ref.get(catgirl.events)).toEqual([]);

    // T3 Code's team in Automatic is upstream's: unprompted reports go at once, without text.
    const t3 = yield* harness({ mode: "auto", recipient: "t3code" });
    yield* Effect.gen(function* () {
      const feedback = yield* Feedback.FeedbackService;
      const sent = yield* feedback.submit(input, fromThread);
      expect("sent" in sent && sent.sent).toBe(true);
    }).pipe(Effect.provide(t3.layer));
    const [[event, properties]] = (yield* Ref.get(t3.events)) as [[string, object]];
    expect(event).toBe("agent.feedback");
    expect(properties).toMatchObject({ userRequested: false, kind: "bug" });
    expect(properties).not.toHaveProperty("expected");
  }),
);

it.effect("Don't send stores and sends nothing, whoever the recipient", () =>
  Effect.gen(function* () {
    for (const recipient of ["t3code", "catgirl-code"] as const) {
      const { events, cards, layer } = yield* harness({ mode: "on-request", recipient });
      yield* Effect.gen(function* () {
        const card = yield* show(cards, recipient);
        expect((yield* answer(card, "decline"))._tag).toBe("Success");
        expect((yield* Queue.take(cards)).feedbackStatus).toBe("declined");
        expect(yield* listFeedbackReports).toEqual([]);
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(events)).toEqual([]);
    }
  }),
);

describe("the texts that name the recipient", () => {
  it("tell the agent who reads the report", () => {
    const t3 = feedbackToolDescription("t3code");
    const catgirl = feedbackToolDescription("catgirl-code");
    expect(t3).toContain("Send feedback to the T3 Code team");
    expect(t3).toContain("unofficial fork they did not make");
    expect(catgirl).toContain("Send feedback to Catgirl Code");
    expect(catgirl).toContain("public GitHub issue");
    expect(catgirl).not.toMatch(/T3 (Code )?team/u);
    expect(awaitingApprovalNote("catgirl-code")).not.toMatch(/T3 (Code )?team/u);
  });

  it("say that `t3 feedback` reaches only T3 Code's team", () => {
    expect(FEEDBACK_CLI_DESCRIPTION).toContain("to the T3 Code team");
    expect(FEEDBACK_CLI_DESCRIPTION).toContain("send one to Catgirl Code, ask your agent");
  });
});

// What leaves through the analytics instance agent feedback for T3 Code's team uses.
const SentBody = Schema.fromJsonString(
  Schema.Struct({
    api_key: Schema.String,
    batch: Schema.Array(
      Schema.Struct({
        event: Schema.String,
        uuid: Schema.String,
        distinct_id: Schema.String,
        properties: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ),
  }),
);
const decodeSentBody = Schema.decodeUnknownEffect(SentBody);

const sendThrough = (
  instance: "exported" | "beside-the-server" | "t3-team" | "machine",
  env: Record<string, string>,
  policy?: ManagedPolicyDocument,
) =>
  Effect.gen(function* () {
    const sent: Array<{
      readonly url: string;
      readonly apiKey: string;
      readonly event: string;
      readonly anonymous: boolean;
      readonly installId: boolean;
    }> = [];
    const client = HttpClient.make((request) =>
      Effect.gen(function* () {
        if (request.body._tag === "Uint8Array") {
          const body = yield* decodeSentBody(new TextDecoder().decode(request.body.body)).pipe(
            Effect.orDie,
          );
          for (const event of body.batch) {
            sent.push({
              url: request.url,
              apiKey: body.api_key,
              event: event.event,
              anonymous: event.distinct_id === event.uuid,
              installId: "installId" in event.properties,
            });
          }
        }
        return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
      }),
    );
    // As in the server: its own analytics are built first and memoized, then the store's.
    const serverAnalytics = Layer.effectDiscard(Effect.asVoid(Analytics.AnalyticsService)).pipe(
      Layer.provide(Analytics.layer.pipe(Layer.provide(ManagedPolicy.layerTest(policy)))),
    );
    const analytics =
      instance === "exported"
        ? layerT3TeamAnalytics
        : instance === "beside-the-server"
          ? layerT3TeamAnalytics.pipe(Layer.provide(serverAnalytics))
          : instance === "t3-team"
            ? Analytics.layer.pipe(
                Layer.provide(ManagedPolicy.layerTest(policy)),
                Layer.provide(Layer.succeed(AnalyticsDestination.FixedTarget, T3_TEAM_TARGET)),
              )
            : Analytics.layer.pipe(Layer.provide(ManagedPolicy.layerTest(policy)));
    const queued = yield* Effect.gen(function* () {
      const service = yield* Analytics.AnalyticsService;
      const queued = yield* service.record(
        "agent.feedback",
        { kind: "bug", subject: "general", userRequested: true },
        { anonymous: true },
      );
      yield* service.flush;
      return queued;
    }).pipe(
      Effect.provide(
        analytics.pipe(
          Layer.provideMerge(
            ServerConfig.ServerConfig.layerTest(process.cwd(), {
              prefix: "t3-feedback-recipient-",
            }),
          ),
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(HostProcess.Platform, "linux"),
              Layer.succeed(HostProcess.Architecture, "x64"),
              Layer.succeed(HttpClient.HttpClient, client),
            ),
          ),
          Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
      Effect.provideService(HostProcess.Environment, env),
    );
    // What the setting is told must agree with what the instance for T3 Code's team did.
    const summary = yield* Effect.map(ManagedPolicy.ManagedPolicy, ({ summary }) => summary).pipe(
      Effect.provide(ManagedPolicy.layerTest(policy)),
    );
    if (instance !== "machine") {
      expect(describeT3Delivery(env, summary)).toEqual({ agentFeedbackT3Sends: queued });
    }
    return { queued, sent };
  });

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "the analytics instance for T3 Code's team",
  (it) => {
    it.effect("posts upstream's anonymous event to upstream's ingest with its key", () =>
      Effect.gen(function* () {
        const { queued, sent } = yield* sendThrough("exported", {});
        expect(queued).toBe(true);
        expect(sent).toEqual([
          {
            url: "https://ingest.t3.codes/batch/",
            apiKey: T3_TEAM_TARGET.key,
            event: "agent.feedback",
            anonymous: true,
            installId: false,
          },
        ]);
      }),
    );

    it.effect("is an instance of its own when the server's analytics are built beside it", () =>
      Effect.gen(function* () {
        expect((yield* sendThrough("beside-the-server", {})).sent).toMatchObject([
          { url: "https://ingest.t3.codes/batch/", event: "agent.feedback" },
        ]);
      }),
    );

    it.effect("leaves usage analytics with no destination", () =>
      Effect.gen(function* () {
        expect(yield* sendThrough("machine", {})).toEqual({ queued: false, sent: [] });
      }),
    );

    it.effect("sends nothing when this machine says no to usage data", () =>
      Effect.gen(function* () {
        const silent = { queued: false, sent: [] };
        expect(yield* sendThrough("t3-team", { T3CODE_TELEMETRY_ENABLED: "false" })).toEqual(
          silent,
        );
        expect(yield* sendThrough("t3-team", { DO_NOT_TRACK: "1" })).toEqual(silent);
        expect(yield* sendThrough("t3-team", { CI: "true" })).toEqual(silent);
        const policy = { schemaVersion: 1, organization: "Example Corp" } as const;
        expect(
          yield* sendThrough("t3-team", {}, { ...policy, limits: { telemetry: false } }),
        ).toEqual(silent);
        expect(
          (yield* sendThrough("t3-team", {}, { ...policy, limits: { telemetry: true } })).queued,
        ).toBe(true);
      }),
    );
  },
);
