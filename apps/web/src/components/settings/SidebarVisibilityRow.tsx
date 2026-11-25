/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code setting, English only: upstream's catalogs stay untouched */
import type { EnvironmentId } from "@t3tools/contracts";

import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";

/** Per device: whether this machine's threads are listed in the sidebar. */
export function SidebarVisibilityRow({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const hiddenEnvironmentIds = useClientSettings((s) => s.sidebarHiddenEnvironmentIds);
  const shown = !hiddenEnvironmentIds.includes(environmentId);
  return (
    <SettingsRow
      title="Show threads in sidebar"
      description="Off keeps this machine's threads out of the sidebar on this device. Search, links and open threads still reach them."
      control={
        <Switch
          checked={shown}
          aria-label="Show this machine's threads in the sidebar"
          onCheckedChange={(checked) =>
            void updateClientSettings({
              sidebarHiddenEnvironmentIds: checked
                ? hiddenEnvironmentIds.filter((id) => id !== environmentId)
                : [...hiddenEnvironmentIds, environmentId],
            })
          }
        />
      }
    />
  );
}
