// Catgirl Code: `t3_feedback`'s description names the recipient the setting names now, and the
// tool still works after a change of recipient registers it again.
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  type ServerSettings as ServerSettingsType,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { HttpBody, HttpClient, HttpRouter } from "effect/http";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";
import * as FeedbackHandlers from "../mcp/toolkits/feedback/handlers.ts";
import { FeedbackToolkit } from "../mcp/toolkits/feedback/tools.ts";
import * as ServerSettings from "../serverSettings.ts";
import { feedbackToolDescription, withToolDescription } from "./FeedbackRecipient.ts";
import * as Feedback from "./FeedbackService.ts";

const environmentId = EnvironmentId.make("environment-feedback-description");

it.effect(
  "names the chosen recipient in t3_feedback's description, and keeps the tool working",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const scope: McpInvocationContext.McpThreadInvocationScope = {
          environmentId,
          requestNamespace: "agentToken",
          thread: {
            threadId: ThreadId.make("thread-feedback"),
            providerSessionId: "agentToken",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration"]),
          issuedAt: 1,
        };
        const base = Context.get(
          yield* Layer.build(
            ServerSettings.layerTest({
              agentFeedback: { mode: "on-request", recipient: "t3code" },
            }),
          ),
          ServerSettings.ServerSettingsService,
        );
        // The test settings announce no changes; these do. Each read of the next change is a sign the
        // one before it was handled, since the description layer reads them one at a time.
        const updates = yield* Queue.unbounded<ServerSettingsType>();
        const waiting = yield* Queue.unbounded<void>();
        const settings: ServerSettings.ServerSettingsService["Service"] = {
          ...base,
          updateSettings: (patch) =>
            base.updateSettings(patch).pipe(Effect.tap((next) => Queue.offer(updates, next))),
          subscribeChanges: Effect.succeed(
            Stream.fromEffectRepeat(
              Queue.offer(waiting, undefined).pipe(Effect.andThen(Queue.take(updates))),
            ),
          ),
        };
        const settingsContext = Context.make(ServerSettings.ServerSettingsService, settings);
        const serverLayer = McpHttpServer.layerMcpTransport(
          withToolDescription(
            McpHttpServer.toolkitRegistration(FeedbackToolkit, FeedbackHandlers.layer),
          ),
        ).pipe(
          Layer.provide(Layer.succeedContext(settingsContext)),
          Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
          Layer.provide(
            Layer.mock(Feedback.FeedbackService)({
              submit: () => Effect.succeed({ status: "awaiting_approval", note: "shown" } as const),
            }),
          ),
          Layer.provide(
            Layer.mock(McpSessionRegistry.McpSessionRegistry)({
              resolve: (token) => Effect.succeed(token === "agentToken" ? scope : undefined),
            }),
          ),
        );
        yield* HttpRouter.serve(serverLayer, { disableListenLog: true, disableLogger: true }).pipe(
          Layer.build,
        );
        const httpClient = yield* HttpClient.HttpClient;
        const rpc = (method: string, params: object) =>
          Effect.gen(function* () {
            const headers = {
              accept: "application/json, text/event-stream",
              authorization: "Bearer agentToken",
            };
            const initialize = yield* httpClient.post("/mcp", {
              headers,
              body: HttpBody.text(
                `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}`,
                "application/json",
              ),
            });
            const response = yield* httpClient.post("/mcp", {
              headers: {
                ...headers,
                "mcp-session-id": initialize.headers["mcp-session-id"]!,
                "mcp-protocol-version": "2025-06-18",
              },
              body: HttpBody.text(
                JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
                "application/json",
              ),
            });
            const text = yield* response.text;
            const messages = text.startsWith("data:")
              ? text
                  .split("\n")
                  .filter((line) => line.startsWith("data:"))
                  .map((line) => JSON.parse(line.slice(5)) as { readonly id?: number })
              : [JSON.parse(text) as { readonly id?: number }];
            return messages.find((message) => message.id === 2) as {
              readonly result?: {
                readonly tools?: ReadonlyArray<{
                  readonly name: string;
                  readonly description?: string;
                }>;
                readonly structuredContent?: unknown;
              };
            };
          });
        const described = rpc("tools/list", {}).pipe(
          Effect.map(
            (body) => body.result?.tools?.find((tool) => tool.name === "t3_feedback")?.description,
          ),
        );
        const call = rpc("tools/call", {
          name: "t3_feedback",
          arguments: {
            kind: "bug",
            subject: "general",
            expected: "a",
            actual: "b",
            workaround: "",
            userRequested: true,
          },
        });

        yield* Queue.take(waiting);
        expect(yield* described).toBe(feedbackToolDescription("t3code"));
        yield* settings.updateSettings({
          agentFeedback: { mode: "on-request", recipient: "catgirl-code" },
        });
        yield* Queue.take(waiting);
        expect(yield* described).toBe(feedbackToolDescription("catgirl-code"));
        expect((yield* call).result?.structuredContent).toMatchObject({
          status: "awaiting_approval",
        });

        yield* settings.updateSettings({ agentFeedback: { mode: "auto", recipient: "t3code" } });
        yield* Queue.take(waiting);
        expect(yield* described).toBe(feedbackToolDescription("t3code"));
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
