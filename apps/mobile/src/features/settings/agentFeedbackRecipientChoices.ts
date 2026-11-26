/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
// Catgirl Code: the phone's Agent feedback choices for a machine that lets you pick who gets
// reports. One list, so a choice sets the recipient and when agents report together.
import { T3_TEAM_LABEL } from "@t3tools/client-runtime/catgirl-feedback";
import type { ServerSettings } from "@t3tools/contracts";
import { T3_CODE } from "@t3tools/shared/agentFeedbackRecipient";

type FeedbackSetting = ServerSettings["agentFeedback"];

interface AgentFeedbackRecipientChoice {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly selected: (setting: FeedbackSetting) => boolean;
  readonly patch: (setting: FeedbackSetting) => FeedbackSetting;
}

export const AGENT_FEEDBACK_RECIPIENT_CHOICES: ReadonlyArray<AgentFeedbackRecipientChoice> = [
  {
    key: "off",
    label: "Off",
    description: "Agents send no feedback.",
    selected: (setting) => setting.mode === "off",
    patch: (setting) => ({ mode: "off", recipient: setting.recipient }),
  },
  {
    key: "t3code-on-request",
    label: `${T3_TEAM_LABEL}, when I ask`,
    description: `Reports go to the ${T3_CODE} team, who did not make Catgirl Code, so keep them to ${T3_CODE} itself. You see each one first.`,
    selected: (setting) => setting.recipient === "t3code" && setting.mode === "on-request",
    patch: () => ({ mode: "on-request", recipient: "t3code" }),
  },
  {
    key: "t3code-auto",
    label: `${T3_TEAM_LABEL}, automatic`,
    description: `Agents also report ${T3_CODE} problems they hit on their own, with no text the agent wrote.`,
    selected: (setting) => setting.recipient === "t3code" && setting.mode === "auto",
    patch: () => ({ mode: "auto", recipient: "t3code" }),
  },
  {
    key: "catgirl-code",
    label: "Catgirl Code",
    description:
      "A report you ask for opens a new issue on Catgirl Code's GitHub for you to check and submit. Issues are public and show your GitHub name.",
    selected: (setting) => setting.recipient === "catgirl-code" && setting.mode !== "off",
    patch: () => ({ mode: "on-request", recipient: "catgirl-code" }),
  },
];

/** The note under the choices, once any machine there lets you pick the recipient. */
export const AGENT_FEEDBACK_RECIPIENT_NOTE =
  "Each machine sends its own reports. A report you ask for is shown to you first in a card, with an outline of recent turns. Turn on Include the conversation there to add the messages of the turns the report is about.";
