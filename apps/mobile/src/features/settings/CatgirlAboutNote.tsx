import { CATGIRL_FORK_NOTICE } from "@t3tools/shared/catgirlRelease";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";

/** Says in the app itself that it is an unofficial fork. */
export function CatgirlAboutNote() {
  return (
    <View className="px-4 pb-4">
      <Text className="text-xs text-foreground-muted">{CATGIRL_FORK_NOTICE}</Text>
    </View>
  );
}
