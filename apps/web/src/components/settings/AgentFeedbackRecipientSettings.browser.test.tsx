import { render } from "../../../test/render";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import type { ServerSettings } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ScopedSettingsPatch } from "./scopedSettings";

type Machine = {
  readonly label: string;
  readonly recipients?: boolean;
  readonly t3Sends?: boolean;
};

const state = vi.hoisted(() => ({
  agentFeedback: { mode: "off", recipient: "t3code" } as ServerSettings["agentFeedback"],
  machines: [] as ReadonlyArray<Machine>,
  mixed: false,
  updateSettings: vi.fn<(patch: ScopedSettingsPatch) => void>(),
}));

vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    scope: { kind: "environment" },
    connectedEnvironments: state.machines.map((machine) => ({
      label: machine.label,
      serverConfig: {
        environment: {
          capabilities: {
            agentFeedback: true,
            ...(machine.recipients === undefined
              ? {}
              : { agentFeedbackRecipient: machine.recipients }),
          },
        },
        observability:
          machine.t3Sends === undefined ? {} : { agentFeedbackT3Sends: machine.t3Sends },
      },
    })),
  })) as never,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => ({
    ...DEFAULT_UNIFIED_SETTINGS,
    agentFeedback: state.agentFeedback,
  })) as never,
  useScopedSettingsMixed: () => state.mixed,
  useUpdateScopedSettings: () => state.updateSettings,
}));
vi.mock(import("./settingsSearch"), async (original) => ({
  ...(await original()),
  useSearchableSetting: () => () => ({ id: "agent-feedback", title: "Agent feedback" }) as never,
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsRow: ({
    title,
    description,
    status,
    control,
  }: {
    readonly title: ReactNode;
    readonly description?: ReactNode;
    readonly status?: ReactNode;
    readonly control?: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      {status ? <p>{status}</p> : null}
      {control}
    </section>
  ),
}));

import { AgentFeedbackRecipientRows } from "./AgentFeedbackRecipientSettings";

function setup(
  agentFeedback: ServerSettings["agentFeedback"],
  machines: ReadonlyArray<Machine> = [{ label: "slop-box", recipients: true }],
) {
  state.agentFeedback = agentFeedback;
  state.machines = machines;
  state.mixed = false;
  state.updateSettings.mockReset();
}

const UPSTREAM = <p>Upstream's own row</p>;

describe("AgentFeedbackRecipientRows", () => {
  it("is off by default and offers the T3 Code team and Catgirl Code", async () => {
    setup({ mode: "off", recipient: "t3code" });
    await using screen = await render(<AgentFeedbackRecipientRows upstream={UPSTREAM} />, {
      router: false,
    });
    const choice = screen.getByRole("combobox", { name: "Agent feedback" });
    await expect.element(choice).toHaveTextContent("Off");
    await expect.element(screen.getByText(/^Agents send no feedback\./u)).toBeInTheDocument();
    await expect.element(screen.getByText("When agents report")).not.toBeInTheDocument();
    await choice.click();
    await expect.element(screen.getByRole("option", { name: "T3 Code team" })).toBeVisible();
    await screen.getByRole("option", { name: "Catgirl Code" }).click();
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({
      agentFeedback: { mode: "on-request", recipient: "catgirl-code" },
    });
  });

  it("says plainly that T3 Code's team did not make this build, and asks when agents report", async () => {
    setup({ mode: "auto", recipient: "t3code" });
    await using screen = await render(<AgentFeedbackRecipientRows upstream={UPSTREAM} />, {
      router: false,
    });
    await expect
      .element(screen.getByRole("combobox", { name: "Agent feedback" }))
      .toHaveTextContent("T3 Code team");
    await expect
      .element(
        screen.getByText(/They did not make Catgirl Code, so keep reports to T3 Code itself/u),
      )
      .toBeInTheDocument();
    const when = screen.getByRole("combobox", { name: "When agents report" });
    await expect.element(when).toHaveTextContent("Automatic");
    await when.click();
    await screen.getByRole("option", { name: "When I ask" }).click();
    expect(state.updateSettings).toHaveBeenLastCalledWith({
      agentFeedback: { mode: "on-request", recipient: "t3code" },
    });
  });

  it("names Catgirl Code's GitHub and offers no Automatic for it", async () => {
    setup({ mode: "on-request", recipient: "catgirl-code" });
    await using screen = await render(<AgentFeedbackRecipientRows upstream={UPSTREAM} />, {
      router: false,
    });
    await expect
      .element(screen.getByRole("combobox", { name: "Agent feedback" }))
      .toHaveTextContent("Catgirl Code");
    await expect
      .element(screen.getByText(/opens a new issue on Catgirl Code's GitHub/u))
      .toBeInTheDocument();
    await expect.element(screen.getByText("When agents report")).not.toBeInTheDocument();
    await screen.getByRole("combobox", { name: "Agent feedback" }).click();
    await screen.getByRole("option", { name: "Off" }).click();
    expect(state.updateSettings).toHaveBeenLastCalledWith({
      agentFeedback: { mode: "off", recipient: "catgirl-code" },
    });
  });

  it("says which machines keep reports for T3 Code's team because usage data is off there", async () => {
    setup({ mode: "on-request", recipient: "t3code" }, [
      { label: "slop-box", recipients: true, t3Sends: false },
    ]);
    await using screen = await render(<AgentFeedbackRecipientRows upstream={UPSTREAM} />, {
      router: false,
    });
    await expect
      .element(screen.getByText(/Usage data is turned off on slop-box .*so reports stay there/u))
      .toBeInTheDocument();
  });

  it("keeps upstream's row for machines that run T3 Code's own server", async () => {
    setup({ mode: "on-request", recipient: "t3code" }, [{ label: "i9" }]);
    await using screen = await render(<AgentFeedbackRecipientRows upstream={UPSTREAM} />, {
      router: false,
    });
    await expect.element(screen.getByText("Upstream's own row")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("combobox", { name: "Agent feedback" }))
      .not.toBeInTheDocument();
  });

  it("does not let a choice reach a machine that cannot honor it", async () => {
    setup({ mode: "off", recipient: "t3code" }, [
      { label: "slop-box", recipients: true },
      { label: "i9" },
    ]);
    await using screen = await render(<AgentFeedbackRecipientRows upstream={UPSTREAM} />, {
      router: false,
    });
    await expect
      .element(screen.getByText(/run T3 Code's own server, which sends feedback only to its team/u))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("combobox", { name: "Agent feedback" })).toBeDisabled();
  });
});
