import {
  connectFingerprintEmoji,
  connectFingerprintEmojiText,
} from "@t3tools/shared/connectFingerprintEmoji";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";

/**
 * A Connect service's identity as Matrix shows a key: emoji large enough to compare, in two rows
 * of four, each name under its emoji, then the hex fingerprint a setup link carries.
 */
export function ConnectIdentityView({
  fingerprint,
  label,
  compact = false,
}: {
  readonly fingerprint: string;
  readonly label?: string;
  /** Smaller emoji, for lists such as "Recent changes". */
  readonly compact?: boolean;
}) {
  const row = connectFingerprintEmoji(fingerprint);
  return (
    <View className="gap-1" testID="connect-identity">
      {label ? <Text className="text-xs text-foreground-muted">{label}</Text> : null}
      {row === null ? null : (
        <View
          accessible
          accessibilityLabel={`${label ?? "Identity"}: ${row.map(({ name }) => name).join(", ")}`}
          className="flex-row flex-wrap"
        >
          {row.map(({ emoji, name }, position) => (
            // oxlint-disable-next-line react/no-array-index-key -- 8 fixed cells that never move, and an emoji can repeat
            <View key={`${position}-${name}`} className="w-1/4 items-center gap-0.5 py-1">
              <Text className={compact ? "text-xl" : "text-3xl"}>{emoji}</Text>
              <Text className="text-center text-xs text-foreground-muted">{name}</Text>
            </View>
          ))}
        </View>
      )}
      <Text selectable className="font-mono text-xs text-foreground-muted">
        {fingerprint}
      </Text>
    </View>
  );
}

/** For a dialog's plain text: the emoji with their names on one line, then the hex. */
export function connectIdentityText(fingerprint: string): string {
  const emoji = connectFingerprintEmojiText(fingerprint);
  return emoji === null ? fingerprint : `${emoji}\n${fingerprint}`;
}

/** Inside a sentence: the emoji alone, then the hex. */
export function connectIdentityInline(fingerprint: string): string {
  const row = connectFingerprintEmoji(fingerprint);
  return row === null ? fingerprint : `${row.map(({ emoji }) => emoji).join("")} ${fingerprint}`;
}
