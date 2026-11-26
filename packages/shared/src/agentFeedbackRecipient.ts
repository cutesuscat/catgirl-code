// Catgirl Code: who receives agent feedback. The server, the web app and the phone app all name the
// recipient from here, so no surface tells an agent or the user one thing while another goes out.
import type { AgentFeedbackMode, ServerSettings } from "@t3tools/contracts";

// The build renames "T3 Code" in every bundle to this fork's name. Joined at run time, the name
// of the people a T3 Code report goes to survives that.
export const T3_CODE = ["T3", "Code"].join(" ");

/** Where Catgirl Code takes reports: new issues on its GitHub repository. */
export const CATGIRL_CODE_REPOSITORY = "nickypro/catgirl-code";

/** An answered card's title when its report went to Catgirl Code; T3 Code's keep upstream's. */
export const CATGIRL_FEEDBACK_TITLE = "Feedback for Catgirl Code";

/**
 * The mode the server acts on. Catgirl Code has no server of its own to receive reports nobody
 * approved, so with it Automatic acts as When I ask.
 */
export const feedbackModeFor = (
  setting: Pick<ServerSettings["agentFeedback"], "mode" | "recipient">,
): AgentFeedbackMode =>
  setting.recipient === "catgirl-code" && setting.mode === "auto" ? "on-request" : setting.mode;
