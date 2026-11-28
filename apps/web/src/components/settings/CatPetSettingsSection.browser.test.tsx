import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { __setClientSettingsForTests, getClientSettings } from "../../hooks/useSettings";
import { CatPetSettingsSection } from "./CatPetSettingsSection";

it("turns the pet on and changes its size and bubble titles, keeping the other fields", async () => {
  using stack = new DisposableStack();
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  await using screen = await render(<CatPetSettingsSection />);
  const shown = screen.getByRole("switch", { name: "Show the pet" });
  const size = screen.getByRole("combobox", { name: "Pet size" });
  await expect.element(size).toBeDisabled();

  // The section renders without the app stylesheet, so the switch has no size for a pointer to hit.
  shown.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(getClientSettings().catPet.enabled).toBe(true));
  await expect.element(size).toHaveTextContent("Medium");
  await size.click();
  await screen.getByRole("option", { name: "Large" }).click();
  await vi.waitFor(() => expect(getClientSettings().catPet.size).toBe("large"));

  screen
    .getByRole("switch", { name: "Show thread titles in the pet's bubble" })
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(getClientSettings().catPet.showTitles).toBe(false));
  expect(getClientSettings().catPet).toMatchObject({
    enabled: true,
    size: "large",
    petId: "meowtase",
    petPicked: false,
  });
});
