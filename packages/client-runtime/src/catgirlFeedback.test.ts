import { DEFAULT_SERVER_SETTINGS, type AgentFeedbackPreview } from "@t3tools/contracts";
import { CATGIRL_FEEDBACK_TITLE } from "@t3tools/shared/agentFeedbackRecipient";
import { describe, expect, it } from "vite-plus/test";

import {
  catgirlFeedbackIssueUrl,
  feedbackRecipientOf,
  isCatgirlFeedbackCard,
  T3_TEAM_LABEL,
} from "./catgirlFeedback.ts";

const config = (
  agentFeedbackRecipient: boolean | undefined,
  recipient: "t3code" | "catgirl-code",
) =>
  ({
    environment: {
      capabilities: agentFeedbackRecipient === undefined ? {} : { agentFeedbackRecipient },
    },
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      agentFeedback: { mode: "on-request", recipient },
    },
  }) as never;

const preview: AgentFeedbackPreview = {
  kind: "bug",
  subject: "t3_thread_read",
  expected: "Items for a completed thread.",
  actual: "No items. Ask @someone, or see ```fenced``` text.",
  workaround: "",
  trace: {
    turns: 2,
    textTurns: 1,
    truncated: false,
    entries: [
      { turn: 1, type: "user", length: 12 },
      { turn: 2, type: "user", length: 20, text: "Please read it again" },
      { turn: 2, type: "tool", tool: "t3_thread_read", outcome: "error", durationMs: 1500 },
    ],
  },
};

const parts = (url: string) => {
  const parsed = new URL(url);
  return {
    origin: parsed.origin,
    path: parsed.pathname,
    title: parsed.searchParams.get("title"),
    body: parsed.searchParams.get("body") ?? "",
    labels: parsed.searchParams.get("labels"),
  };
};

describe("who a machine's reports go to", () => {
  it("is T3 Code's team on a server that does not report the choice", () => {
    expect(feedbackRecipientOf(config(undefined, "catgirl-code"))).toBe("t3code");
    expect(feedbackRecipientOf(config(false, "catgirl-code"))).toBe("t3code");
    expect(feedbackRecipientOf(undefined)).toBe("t3code");
    expect(feedbackRecipientOf(null)).toBe("t3code");
  });

  it("is the server's setting where it honors one", () => {
    expect(feedbackRecipientOf(config(true, "catgirl-code"))).toBe("catgirl-code");
    expect(feedbackRecipientOf(config(true, "t3code"))).toBe("t3code");
  });

  it("is told apart on an answered card by the title the server recorded", () => {
    expect(isCatgirlFeedbackCard({ title: CATGIRL_FEEDBACK_TITLE })).toBe(true);
    expect(isCatgirlFeedbackCard({ title: "Feedback for the T3 team" })).toBe(false);
  });

  it("names T3 Code's team in a way the build's rename cannot reach", () => {
    expect(T3_TEAM_LABEL).toBe("T3 Code team");
  });
});

describe("the GitHub issue a Catgirl Code report becomes", () => {
  it("is a new issue on the fork's repository, holding what the card shows", () => {
    const issue = parts(catgirlFeedbackIssueUrl(preview, { version: "0.1.12" }));
    expect(issue.origin).toBe("https://github.com");
    expect(issue.path).toBe("/cutesuscat/catgirl-code/issues/new");
    expect(issue.title).toBe("Agent feedback (Bug): t3_thread_read");
    expect(issue.labels).toBe("agent-feedback");
    expect(issue.body).toContain("Catgirl Code 0.1.12");
    expect(issue.body).toContain("Items for a completed thread.");
    expect(issue.body).toContain("Turn 2 · t3_thread_read · error · 1.5 s");
    expect(issue.body).toContain("    Please read it again");
    expect(issue.body).not.toContain("Shortened");
  });

  it("keeps agent text inside fences it cannot close, so it mentions nobody", () => {
    const { body } = parts(catgirlFeedbackIssueUrl(preview));
    const at = body.indexOf("Ask @someone");
    const before = body.slice(0, at);
    // The field's fence is longer than the backtick run inside it.
    expect(before.endsWith("````text\nNo items. ")).toBe(true);
    expect(body).toContain("```fenced```");
  });

  it("fits a GitHub link, dropping message text oldest first, and says so", () => {
    const long: AgentFeedbackPreview = {
      ...preview,
      trace: {
        turns: 12,
        textTurns: 12,
        truncated: false,
        entries: Array.from({ length: 12 }, (_, index) => ({
          turn: index + 1,
          type: "assistant" as const,
          length: 1_000,
          text: `${index + 1}:${"ä".repeat(999)}`,
        })),
      },
    };
    const url = catgirlFeedbackIssueUrl(long);
    expect(url.length).toBeLessThanOrEqual(8_000);
    const { body } = parts(url);
    expect(body).toContain("Shortened to fit a GitHub link");
    // The newest message text is the last to go.
    expect(body).toContain("12:ää");
    expect(body).not.toContain("1:ää");
  });

  it("fits even when the written fields alone are too long for a link", () => {
    const wide: AgentFeedbackPreview = {
      ...preview,
      expected: "😀".repeat(300),
      actual: "😀".repeat(300),
      workaround: "😀".repeat(300),
      trace: null,
    };
    const url = catgirlFeedbackIssueUrl(wide);
    expect(url.length).toBeLessThanOrEqual(8_000);
    expect(() => new URL(url)).not.toThrow();
    expect(parts(url).body).toContain("Shortened to fit a GitHub link");
  });
});
