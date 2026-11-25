import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

/** The app's small mark: the cat head from the Catgirl Code icon. Keeps upstream's name so its uses need no change. */
export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 286 / 310;
  return (
    <Svg
      // oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark
      accessibilityLabel="Catgirl"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="113 91 286 310"
    >
      <ThemedPath
        d="M 222.92,132.18 L 163.87,99.37 Q 156.00,95.00 154.09,103.79 L 126.04,232.73 Z M 385.96,232.73 L 357.91,103.79 Q 356.00,95.00 348.13,99.37 L 289.08,132.18 Z M 123,261 A 133,133 0 1,0 389,261 A 133,133 0 1,0 123,261 Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
