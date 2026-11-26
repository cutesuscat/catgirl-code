import { render } from "../../../test/render";
import { DEFAULT_SERVER_SETTINGS, type ServerObservability } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const RUNNING: ServerObservability = {
  logsDirectoryPath: "/tmp/logs",
  localTracingEnabled: true,
  otlpTracesEnabled: false,
  otlpMetricsEnabled: false,
  otlpLogsEnabled: false,
  analyticsEnabled: false,
};

const { state, updateSettings } = vi.hoisted(() => ({
  state: {
    observability: {} as typeof DEFAULT_SERVER_SETTINGS.observability,
    serverConfig: {} as { observability?: ServerObservability },
  },
  updateSettings: vi.fn(async () => ({ _tag: "Success" as const, value: undefined })),
}));

vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => true) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => updateSettings) as never,
}));
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      updateSettings: "updateSettings",
      checkOtlpEndpoint: { permissionAtom: () => null },
    } as unknown as typeof actual.serverEnvironment,
  };
});
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    scope: { kind: "environment" },
    environment: { environmentId: "env", label: "MAC1", serverConfig: state.serverConfig },
  })) as never,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: ((select: (settings: typeof state) => unknown) => select(state)) as never,
}));

import { UsageAnalyticsSettings } from "./UsageAnalyticsSettings";

function setup(running: ServerObservability | undefined = RUNNING) {
  updateSettings.mockClear();
  state.observability = { ...DEFAULT_SERVER_SETTINGS.observability };
  state.serverConfig = running === undefined ? {} : { observability: running };
}

describe("UsageAnalyticsSettings", () => {
  it("is empty and off by default, and saves the address and key that are entered", async () => {
    setup();
    await using screen = await render(<UsageAnalyticsSettings />);

    const address = screen.getByLabelText("Address");
    const key = screen.getByLabelText("Project key");
    await expect.element(address).toHaveValue("");
    await expect.element(key).toHaveValue("");
    await expect.element(screen.getByText("Off", { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.fill(address, "https://collector.example");
    await expect
      .element(screen.getByText(/Nothing is sent until both the address and the project key/))
      .toBeInTheDocument();
    await userEvent.fill(key, "phc_mine");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      environmentId: "env",
      input: {
        patch: {
          observability: { analyticsUrl: "https://collector.example", analyticsKey: "phc_mine" },
        },
      },
    });
    await expect
      .element(screen.getByText("Saved. Restart the server to apply."))
      .toBeInTheDocument();
  });

  it("shows a Connect service's offer off, and saves only the machine's own yes", async () => {
    setup({
      ...RUNNING,
      connectAnalyticsOffer: {
        serviceName: "Example cats",
        url: "https://relay.example.com/v1/collect/analytics",
      },
    });
    await using screen = await render(<UsageAnalyticsSettings />);

    const label = screen.getByText("Send usage data to Example cats", { exact: true });
    await expect.element(label).toBeVisible();
    expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    await expect
      .element(screen.getByText(/offers to receive its usage data at relay\.example\.com/))
      .toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();

    await userEvent.click(label);
    expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
      environmentId: "env",
      input: { patch: { observability: { connectAnalytics: true } } },
    });
  });

  it("shows no offer from a server that reports none", async () => {
    setup();
    await using screen = await render(<UsageAnalyticsSettings />);
    await expect.element(screen.getByText("Address", { exact: true })).toBeVisible();
    expect(document.querySelector('[role="switch"]')).toBeNull();
  });

  it("says where the running address comes from when the environment sets it", async () => {
    setup({
      ...RUNNING,
      analyticsEnabled: true,
      analyticsUrl: "https://env.example",
      analyticsUrlSource: "environment",
      analyticsKeySource: "settings",
    });
    state.observability = { ...state.observability, analyticsKey: "phc_saved" };
    await using screen = await render(<UsageAnalyticsSettings />);

    await expect.element(screen.getByText("Sending to env.example")).toBeInTheDocument();
    await expect.element(screen.getByText("Set by environment")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Running: https://env.example from T3CODE_POSTHOG_HOST"))
      .toBeInTheDocument();
    await expect.element(screen.getByLabelText("Address")).toHaveValue("");
  });

  it("says when a configured destination is switched off on the machine", async () => {
    setup({
      ...RUNNING,
      analyticsUrl: "https://collector.example",
      analyticsUrlSource: "settings",
      analyticsKeySource: "settings",
    });
    state.observability = {
      ...state.observability,
      analyticsUrl: "https://collector.example",
      analyticsKey: "phc_saved",
    };
    await using screen = await render(<UsageAnalyticsSettings />);

    await expect.element(screen.getByText("Turned off on this machine")).toBeInTheDocument();
    await expect.element(screen.getByText("DO_NOT_TRACK")).toBeInTheDocument();
  });

  it("offers nothing to save on a server that does not have the setting", async () => {
    const { analyticsEnabled: _, ...upstream } = RUNNING;
    setup(upstream);
    await using screen = await render(<UsageAnalyticsSettings />);

    await expect
      .element(screen.getByText(/The server on MAC1 does not have this setting/))
      .toBeInTheDocument();
    expect(screen.container.querySelector("input")).toBeNull();
  });
});
