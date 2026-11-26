/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
// Catgirl Code: what the clients need to name an agent feedback report's recipient, and the GitHub
// issue a report for Catgirl Code becomes. The card builds the issue from exactly what it shows.
import type {
  AgentFeedbackPreview,
  AgentFeedbackRecipient,
  OrchestrationV2TurnItem,
  ServerConfig,
  ServerSettings,
} from "@t3tools/contracts";
import {
  CATGIRL_CODE_REPOSITORY,
  CATGIRL_FEEDBACK_TITLE,
  T3_CODE,
} from "@t3tools/shared/agentFeedbackRecipient";

import {
  feedbackPreviewFields,
  feedbackTraceLines,
  feedbackTraceSummary,
} from "./feedbackRequest.ts";

/**
 * Who a machine's reports go to. A server that does not report the choice is upstream's own, and
 * sends only to T3 Code's team.
 */
export function feedbackRecipientOf(
  config:
    | {
        readonly environment: Pick<ServerConfig["environment"], "capabilities">;
        readonly settings?: Pick<ServerSettings, "agentFeedback"> | undefined;
      }
    | null
    | undefined,
): AgentFeedbackRecipient {
  return config?.environment.capabilities.agentFeedbackRecipient === true
    ? (config.settings?.agentFeedback.recipient ?? "t3code")
    : "t3code";
}

/** Whether an answered card went to Catgirl Code, by the title the server recorded on it. */
export const isCatgirlFeedbackCard = (item: Pick<OrchestrationV2TurnItem, "title">) =>
  item.title === CATGIRL_FEEDBACK_TITLE;

/** The card's words when it is addressed to Catgirl Code; T3 Code's team keeps upstream's. */
export const CATGIRL_FEEDBACK_CARD = {
  title: CATGIRL_FEEDBACK_TITLE,
  heading: "Open this report as a Catgirl Code issue?",
  detail: `This opens a new issue on GitHub (${CATGIRL_CODE_REPOSITORY}) with this report filled in. Issues there are public and carry your GitHub name. Nothing leaves your machine until you submit it there.`,
  send: "Open on GitHub",
  sentLabel: "Opened on GitHub",
  openAgain: "Open the issue on GitHub again",
} as const;

/** Settings text that has to name T3 Code itself, which the build's rename would otherwise change. */
export const T3_TEAM_LABEL = `${T3_CODE} team`;

const ISSUE_URL = `https://github.com/${CATGIRL_CODE_REPOSITORY}/issues/new`;
// GitHub refuses a new-issue link much past 8,000 characters.
const MAX_URL_LENGTH = 8_000;
const SHORTENED_NOTE = "Shortened to fit a GitHub link; the full report is in the card.";

// A fence longer than any run of backticks inside, so agent text cannot close it. Inside one, an
// `@name` mentions nobody and Markdown stays text.
const fenced = (text: string) => {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/gu), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
};

type Trace = NonNullable<AgentFeedbackPreview["trace"]>;

const traceBlock = (trace: Trace) =>
  feedbackTraceLines(trace)
    .map(({ line, text }) =>
      text === undefined ? line : `${line}\n${text.replace(/^/gmu, "    ")}`,
    )
    .join("\n");

const issueBody = (
  preview: AgentFeedbackPreview,
  version: string | undefined,
  shortened: boolean,
) => {
  const [kind, about, ...texts] = feedbackPreviewFields(preview);
  const trace = preview.trace;
  return [
    `_An agent in Catgirl Code${version === undefined ? "" : ` ${version}`} wrote this report, and the user approved it. File paths, names and anything shaped like a secret were removed before it was shown._`,
    `**${kind?.label}:** ${kind?.value}\n**${about?.label}:** \`${about?.value.replaceAll("`", "'")}\``,
    ...texts.map((field) => `**${field.label}**\n\n${fenced(field.value)}`),
    ...(trace === null || trace.entries.length === 0
      ? []
      : [
          `<details>\n<summary>${feedbackTraceSummary(trace)}</summary>\n\n${fenced(traceBlock(trace))}\n\n</details>`,
        ]),
    ...(shortened ? [`_${SHORTENED_NOTE}_`] : []),
  ].join("\n\n");
};

const issueUrl = (title: string, body: string) => {
  const url = new URL(ISSUE_URL);
  url.searchParams.set("title", title);
  url.searchParams.set("body", body);
  url.searchParams.set("labels", "agent-feedback");
  return url.toString();
};

type Entry = Trace["entries"][number];

const withoutOldestText = (entries: ReadonlyArray<Entry>) => {
  const at = entries.findIndex((entry) => entry.text !== undefined);
  if (at === -1) return entries.slice(1);
  return entries.map((entry, index) => {
    if (index !== at) return entry;
    const { text: _dropped, ...rest } = entry;
    return rest;
  });
};

const cut = (text: string, codePoints: number) => {
  const points = Array.from(text);
  return points.length <= codePoints ? text : `${points.slice(0, codePoints).join("")}…`;
};

/**
 * The new-issue link for a report going to Catgirl Code. Too long for a link, it drops message
 * text, then outline entries, oldest first, then shortens the written fields, and says so.
 */
export function catgirlFeedbackIssueUrl(
  preview: AgentFeedbackPreview,
  options: { readonly version?: string | undefined } = {},
): string {
  const [kind] = feedbackPreviewFields(preview);
  const title = `Agent feedback (${kind?.value}): ${preview.subject}`;
  let entries: ReadonlyArray<Entry> = preview.trace?.entries ?? [];
  let fieldLength = Number.POSITIVE_INFINITY;
  const build = (shortened: boolean) => {
    const written = {
      expected: cut(preview.expected, fieldLength),
      actual: cut(preview.actual, fieldLength),
      workaround: cut(preview.workaround, fieldLength),
    };
    const trace = preview.trace === null ? null : { ...preview.trace, entries: [...entries] };
    return issueUrl(
      title,
      issueBody({ ...preview, ...written, trace }, options.version, shortened),
    );
  };
  let url = build(false);
  while (url.length > MAX_URL_LENGTH && entries.length > 0) {
    entries = withoutOldestText(entries);
    url = build(true);
  }
  for (const length of [200, 100, 40, 0]) {
    if (url.length <= MAX_URL_LENGTH) break;
    fieldLength = length;
    url = build(true);
  }
  return url;
}
