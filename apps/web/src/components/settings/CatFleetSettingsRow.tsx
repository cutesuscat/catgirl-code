/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code setting, English only: upstream's catalogs stay untouched */
import {
  DEFAULT_CLIENT_SETTINGS,
  MAX_SIDEBAR_CAT_FLEET_LIMIT,
  type SidebarCatFleetLimit,
} from "@t3tools/contracts/settings";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

// Whole rows of four at the usual sidebar width. The last choice shows every machine.
const LIMITS: readonly SidebarCatFleetLimit[] = [4, 8, 12, 16, MAX_SIDEBAR_CAT_FLEET_LIMIT];

/** Whether the sidebar draws machines as cat planets, and how many cells they may take. */
export function CatFleetSettingsRow() {
  const enabled = useClientSettings((s) => s.sidebarCatFleetEnabled);
  const limit = useClientSettings((s) => s.sidebarCatFleetLimit);
  const label = (value: number) =>
    value >= MAX_SIDEBAR_CAT_FLEET_LIMIT ? "All" : `Up to ${value}`;
  const isDefault =
    enabled === DEFAULT_CLIENT_SETTINGS.sidebarCatFleetEnabled &&
    limit === DEFAULT_CLIENT_SETTINGS.sidebarCatFleetLimit;
  return (
    <SettingsRow
      title="Cat planets"
      description="Show your machines as cats at the top of the sidebar, busiest first. Running threads orbit them."
      resetAction={
        isDefault ? null : (
          <SettingResetButton
            ariaLabel="Reset cat planets to default"
            onClick={() =>
              updateClientSettings({
                sidebarCatFleetEnabled: DEFAULT_CLIENT_SETTINGS.sidebarCatFleetEnabled,
                sidebarCatFleetLimit: DEFAULT_CLIENT_SETTINGS.sidebarCatFleetLimit,
              })
            }
          />
        )
      }
      control={
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <div className="min-w-0 flex-1 sm:w-28 sm:flex-none">
            <Select
              disabled={!enabled}
              value={String(limit)}
              onValueChange={(value) => {
                const next = LIMITS.find((candidate) => String(candidate) === value);
                if (next !== undefined) void updateClientSettings({ sidebarCatFleetLimit: next });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full min-w-0"
                aria-label="How many cat planets to show"
              >
                <SelectValue>{label(limit)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {LIMITS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {label(value)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              void updateClientSettings({ sidebarCatFleetEnabled: Boolean(checked) })
            }
            aria-label="Show cat planets"
          />
        </div>
      }
    />
  );
}
