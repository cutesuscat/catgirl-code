import { describe, expect, it } from "vite-plus/test";

import { feedbackModeFor, T3_CODE } from "./agentFeedbackRecipient.ts";

describe("the agent feedback recipient", () => {
  it("is named in words the build's rename leaves alone", () => {
    expect(T3_CODE).toBe("T3 Code");
  });

  it("takes only approved reports for Catgirl Code, whatever the mode says", () => {
    expect(feedbackModeFor({ mode: "auto", recipient: "catgirl-code" })).toBe("on-request");
    expect(feedbackModeFor({ mode: "on-request", recipient: "catgirl-code" })).toBe("on-request");
    expect(feedbackModeFor({ mode: "off", recipient: "catgirl-code" })).toBe("off");
  });

  it("leaves T3 Code's team on upstream's modes", () => {
    for (const mode of ["off", "on-request", "auto"] as const) {
      expect(feedbackModeFor({ mode, recipient: "t3code" })).toBe(mode);
    }
  });
});
