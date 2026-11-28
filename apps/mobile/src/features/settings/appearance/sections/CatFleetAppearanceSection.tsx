/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
import { useAtomValue } from "@effect/atom-react";
import { MAX_SIDEBAR_CAT_FLEET_LIMIT } from "@t3tools/contracts/settings";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { ListRowLayout } from "../../../../components/ui/ListRowLayout";
import { SegmentedControl } from "../../../../components/ui/SegmentedControl";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../../../state/preferences";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { HOME_CAT_FLEET_LIMITS, homeCatFleetLimitOf } from "../../../home/home-cat-fleet";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";

const LIMIT_OPTIONS = HOME_CAT_FLEET_LIMITS.map((value) =>
  value >= MAX_SIDEBAR_CAT_FLEET_LIMIT
    ? { value, label: "All", accessibilityLabel: "Every machine" }
    : { value, label: String(value), accessibilityLabel: `Up to ${value} machines` },
);

/** Shows or hides the row of cat planets above the thread list, and how many it holds, on this device. */
export function CatFleetAppearanceSection() {
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferences);
  const enabled = loaded && preferences.value.catFleetEnabled !== false;

  return (
    <SettingsSection
      title="Thread list"
      footer="Your busiest machines as one row of cats above the threads. Tap a cat to list only that machine's threads."
    >
      <SettingsSwitchRow
        disabled={!loaded}
        label="Cat planets"
        onValueChange={(next) => {
          void savePreferences({ catFleetEnabled: next });
        }}
        value={enabled}
      />
      {enabled ? (
        <ListRowLayout
          accessory={
            <View className="w-48">
              <SegmentedControl
                onSelect={(value) => {
                  void savePreferences({ catFleetLimit: value });
                }}
                options={LIMIT_OPTIONS}
                selected={homeCatFleetLimitOf(preferences.value.catFleetLimit)}
                size="compact"
                variant="card"
              />
            </View>
          }
          label="How many"
        />
      ) : null}
    </SettingsSection>
  );
}
