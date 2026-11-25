import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { CatFleetSettingsRow } from "./CatFleetSettingsRow";

it("picks how many cat planets show, and turns them off", async () => {
  using stack = new DisposableStack();
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  await using screen = await render(<CatFleetSettingsRow />);
  const count = screen.getByRole("combobox", { name: "How many cat planets to show" });
  const shown = screen.getByRole("switch", { name: "Show cat planets" });

  // The row renders without the app stylesheet, so the switch has no size for a pointer to hit.
  shown.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(getClientSettings().sidebarCatFleetEnabled).toBe(false));
  await expect.element(count).toBeDisabled();
  shown.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(getClientSettings().sidebarCatFleetEnabled).toBe(true));

  await expect.element(count).toHaveTextContent("Up to 8");
  await count.click();
  await screen.getByRole("option", { name: "Up to 4" }).click();
  await vi.waitFor(() => expect(getClientSettings().sidebarCatFleetLimit).toBe(4));
});
