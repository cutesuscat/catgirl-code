import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { environmentCatalog } from "~/connection/catalog";
import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { DraftInput } from "../ui/draft-input";
import { SettingsRow } from "./settingsLayout";

const NAME_MAX_LENGTH = 40;

/** Per device: the name this app shows for the machine. Empty goes back to the machine's own. */
export function DeviceNameRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const overrides = useClientSettings((s) => s.environmentLabelOverrides);
  const ownLabel = useAtomValue(environmentCatalog.savedCatalogValueAtom).entries.get(environmentId)
    ?.target.label;
  const saved = overrides[environmentId] ?? "";
  return (
    <SettingsRow
      title="Name on this device"
      description={
        saved === ""
          ? "Your own name for this machine. It shows everywhere in this app, on this device only."
          : `Shows in place of “${ownLabel ?? "the machine's own name"}” everywhere in this app, on this device only. Clear it to go back.`
      }
      control={
        <DraftInput
          size="sm"
          className="w-full @min-[32rem]/settings-row:w-56"
          aria-label="Name for this machine on this device"
          maxLength={NAME_MAX_LENGTH}
          placeholder={ownLabel ?? "Machine name"}
          spellCheck={false}
          value={saved}
          onCommit={(next) => {
            const { [environmentId]: _previous, ...others } = overrides;
            const name = next.trim();
            void updateClientSettings({
              environmentLabelOverrides:
                name === "" || name === ownLabel ? others : { ...others, [environmentId]: name },
            });
          }}
        />
      }
    />
  );
}
