/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom, saveMobilePreferences } from "../../../../state/preferences";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";

/** Shows or hides the row of cat planets above the thread list, on this device. */
export function CatFleetAppearanceSection() {
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferences);

  return (
    <SettingsSection
      title="Thread list"
      footer="Your busiest machines as one row of cats above the threads. Tap a cat to list only that machine's threads."
    >
      <SettingsSwitchRow
        disabled={!loaded}
        label="Cat planets"
        onValueChange={(enabled) => {
          void savePreferences({ catFleetEnabled: enabled });
        }}
        value={loaded && preferences.value.catFleetEnabled !== false}
      />
    </SettingsSection>
  );
}
