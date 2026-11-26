// Catgirl Code: where agent feedback goes, chosen in Settings > Labs > Agent feedback. T3 Code's
// team gets upstream's own delivery, through an analytics instance of its own. Catgirl Code gets a
// report as a GitHub issue that the user opens from the card and submits, so this server sends
// nothing for it.
import type {
  AgentFeedbackRecipient,
  ManagedPolicySummary,
  ServerObservability,
  ServerSettings,
} from "@t3tools/contracts";
import {
  CATGIRL_CODE_REPOSITORY,
  CATGIRL_FEEDBACK_TITLE,
  T3_CODE,
} from "@t3tools/shared/agentFeedbackRecipient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
// oxlint-disable-next-line t3code/no-raw-mcp-registration -- only re-adds McpHttpServer's own registration of t3_feedback, its checked handler unchanged
import { McpSchema, McpServer } from "effect/ai";

import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerSettingsService from "../serverSettings.ts";
import * as AnalyticsDestination from "../telemetry/AnalyticsDestination.ts";
import * as Analytics from "../telemetry/AnalyticsService.ts";
import { FEEDBACK_AWAITING_APPROVAL_NOTE } from "./FeedbackReport.ts";

type FeedbackSetting = ServerSettings["agentFeedback"];

/** Upstream's ingest and public project key, as v0.1.12 builds them in. Used for nothing else. */
export const T3_TEAM_TARGET = {
  url: "https://ingest.t3.codes",
  key: "phc_XOWci4oZP4VvLiEyrFqkFjP4CZn55mjYYBMREK5Wd6m",
} as const satisfies AnalyticsDestination.AnalyticsTarget;

/**
 * Whether a report for T3 Code's team would leave this machine. The same rule as that instance's:
 * `T3CODE_TELEMETRY_ENABLED=false`, `DO_NOT_TRACK`, a managed policy or a CI runner keep it here.
 */
export const describeT3Delivery = (
  env: Readonly<Record<string, string | undefined>>,
  policy: ManagedPolicySummary | undefined,
): Pick<ServerObservability, "agentFeedbackT3Sends"> => ({
  agentFeedbackT3Sends: AnalyticsDestination.analyticsEnabledFor(env, policy, T3_TEAM_TARGET),
});

/**
 * The analytics instance agent feedback for T3 Code's team leaves through, under upstream's rules.
 * A layer of its own: `Analytics.layer` is memoized, so wrapping it would return the server's.
 */
export const layerT3TeamAnalytics = Layer.effect(
  Analytics.AnalyticsService,
  Analytics.make.pipe(Effect.provideService(AnalyticsDestination.FixedTarget, T3_TEAM_TARGET)),
).pipe(Layer.provide(ManagedPolicy.layer));

/** Send refused: the setting no longer names the recipient the card did, so the card stays open. */
export class FeedbackRecipientChangedError extends Schema.TaggedError<FeedbackRecipientChangedError>()(
  "FeedbackRecipientChangedError",
  {},
) {}

/**
 * Whether Send may deliver now: the card named `approved`, or T3 Code's team when the client is one
 * that names no other, and the setting must still name the same recipient.
 */
export const approvedFor = (
  approved: AgentFeedbackRecipient | undefined,
  setting: FeedbackSetting,
): boolean => (approved ?? "t3code") === setting.recipient;

/**
 * Who delivers a report. T3 Code's team: upstream's analytics event. Catgirl Code: nothing leaves
 * this server. A report the user approved goes on in their browser, as an issue they submit
 * themselves, so it counts as handed over; any other stays on this machine.
 */
export const sender = (
  recipient: AgentFeedbackRecipient,
  analytics: Pick<Analytics.AnalyticsService["Service"], "record">,
): Pick<Analytics.AnalyticsService["Service"], "record"> =>
  recipient === "catgirl-code"
    ? { record: (_event, properties) => Effect.succeed(properties?.userRequested === true) }
    : analytics;

/** Upstream's title for a card, as `Orchestrator.ts` records it when given none. */
export const T3_FEEDBACK_TITLE = "Feedback for the T3 team";

/** The title a card is recorded with, naming its recipient. */
export const cardTitle = (recipient: AgentFeedbackRecipient) =>
  recipient === "catgirl-code" ? CATGIRL_FEEDBACK_TITLE : T3_FEEDBACK_TITLE;

export const awaitingApprovalNote = (recipient: AgentFeedbackRecipient) =>
  recipient === "catgirl-code"
    ? `The user sees this report in a card addressed to Catgirl Code, and chooses there whether to open it as a public issue on its GitHub repository (${CATGIRL_CODE_REPOSITORY}) and whether to include the conversation. Nothing is sent until they submit it there, and you will not learn their choice. Do not wait for it or send it another way. Call again only if the user asks to change it; that shows a new card.`
    : FEEDBACK_AWAITING_APPROVAL_NOTE;

const WRITING =
  "Not the user's own code. Use your own words; never quote the user's messages, code, files, or names.";

/** `t3_feedback`'s description, naming who reads what the agent writes. */
export const feedbackToolDescription = (recipient: AgentFeedbackRecipient) =>
  recipient === "catgirl-code"
    ? `Send feedback to Catgirl Code, the unofficial fork of ${T3_CODE} this app is: a T3 tool or \`t3\` command that misbehaved, a confusing instruction, a missing capability, or anything about this app the user asks you to send. ${WRITING} Only reports the user asks for are taken: one opens a card where they approve it and choose whether to include the conversation of the \`turns\` you set, then it becomes a public GitHub issue they submit themselves. So call this when asked without asking first, and never paste the conversation into it.`
    : `Send feedback to the ${T3_CODE} team, who make ${T3_CODE}. This app is Catgirl Code, an unofficial fork they did not make, so send only what is about ${T3_CODE} itself: a T3 tool or \`t3\` command that misbehaved, a confusing instruction, a missing capability, or anything about ${T3_CODE} the user asks you to send. ${WRITING} A report the user asks for opens a card where they approve it and choose whether to include the conversation of the \`turns\` you set, so call this when asked without asking first, and never paste the conversation into it.`;

/**
 * `t3 feedback`'s help. It sends only unprompted reports, which only T3 Code's team takes, so it
 * names that team; reports for Catgirl Code go through a thread.
 */
export const FEEDBACK_CLI_DESCRIPTION = `Send feedback about ${T3_CODE} itself to the ${T3_CODE} team, who did not make Catgirl Code. Needs Agent feedback set to the ${T3_CODE} team and Automatic in Settings > Labs. To approve a report first, or to send one to Catgirl Code, ask your agent in a thread.`;

const FEEDBACK_TOOL = "t3_feedback";

/** Re-adds `t3_feedback` with the description for `recipient`, keeping its handler. */
const describe = Effect.fn("FeedbackRecipient.describe")(function* (
  recipient: AgentFeedbackRecipient,
) {
  const server = yield* McpServer.McpServer;
  // The registry keeps each registration whole; its type names only the tool and annotations.
  const registered = server.tools.find(({ tool }) => tool.name === FEEDBACK_TOOL) as
    | Parameters<McpServer.McpServer["Service"]["addTool"]>[0]
    | undefined;
  const description = feedbackToolDescription(recipient);
  if (registered === undefined || registered.tool.description === description) return;
  // A tool added again under its name replaces it, and clients are told the list changed.
  // oxlint-disable-next-line t3code/no-raw-mcp-registration -- the same registration, McpToolAccess checks included; only the description is new
  yield* server.addTool({
    ...registered,
    tool: new McpSchema.Tool({ ...registered.tool, description }),
  });
});

/**
 * Keeps `t3_feedback`'s description naming the recipient the setting names now. MCP descriptions
 * are fixed per registration, so a change of recipient registers the tool again.
 */
const layerToolDescription = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService.ServerSettingsService;
    // Subscribed before the first read, so a change between the two is not missed.
    const changes = yield* settings.subscribeChanges;
    const current = yield* settings.getSettings.pipe(
      Effect.map(({ agentFeedback }) => agentFeedback.recipient),
      Effect.orElseSucceed(() => "t3code" as const),
    );
    yield* describe(current);
    yield* changes.pipe(
      Stream.map(({ agentFeedback }) => agentFeedback.recipient),
      Stream.changes,
      Stream.runForEach(describe),
      Effect.forkScoped,
    );
  }),
);

/** `registration`, the feedback toolkit's, then its description kept naming the recipient. */
export const withToolDescription = <E, R>(registration: Layer.Layer<never, E, R>) =>
  layerToolDescription.pipe(Layer.provide(McpServer.McpServer.layer), Layer.provide(registration));
