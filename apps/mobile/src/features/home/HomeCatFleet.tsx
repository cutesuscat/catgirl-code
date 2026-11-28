/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
import { useAtomValue } from "@effect/atom-react";
import {
  catFleetActivity,
  catFleetMoonToneOf,
  catFleetOrbitOf,
  fleetHashUnit,
  isCatFleetBodyInOrbit,
  summarizeCatFleet,
  type CatFleetBody,
  type CatFleetMachine,
} from "@t3tools/client-runtime/state/cat-fleet";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";
import { useResolveClassNames } from "uniwind";

import { CAT_HEAD_PATH } from "../../components/T3Wordmark";
import { AppText } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentThreadShells } from "../../state/threads";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  CAT_COLORS,
  CAT_HEAD,
  CAT_ORBITS,
  CAT_ORBIT_CENTER,
  CAT_ORBIT_SQUASH,
  CAT_PLANET,
  CAT_SCALE,
  catCoatStops,
  catOrbitPoint,
  catStoppedPoint,
  homeCatFleetCells,
  homeCatFleetLimitOf,
  pickHomeCatFleet,
  rankHomeCatFleet,
} from "./home-cat-fleet";
import { useAtomValueWhileVisible } from "./home-route-visibility";

const HEAD_SCALE = CAT_HEAD.radius / 133;
const HEAD_TRANSFORM = `translate(${CAT_HEAD.x} ${CAT_HEAD.y}) scale(${HEAD_SCALE}) translate(-256 -261)`;
const MOON_RADIUS = 3;
const HELD_RADIUS = 2.1;
const SUBAGENT = { radius: 1.1, distance: 4.8, max: 3 };
// Orbit lines: thin where they pass round the cat, dotted where they pass behind it.
const LINE = { width: 0.7, dot: 1.1, gap: 2.5 };
// A cat with work running glows, fully once this many threads and sub-agents run on it.
const GLOW = { radius: 21, full: 5 };
const HALO_RADIUS = 7.5;
// The picture is drawn this much wider than its place in the row, so a glow at the end of an
// orbit fades out instead of being cut off.
const BLEED = 6;
const MAX_BODIES = 14;
const MAX_STOPPED = 16;
const ROW_GUTTER = 12;

interface HomeCatFleetProps {
  /** Whether the home list is on screen. A covered list holds its last picture. */
  readonly visible: boolean;
  readonly pane: "screen" | "sidebar";
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly connectionState: EnvironmentConnectionPhase;
  }>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
}

/**
 * One row of the busiest machines as cat planets, above the thread list: as many as fit. A
 * running thread is a moon on an orbit and a stopped one a dim ring under the cat. Tapping a
 * cat lists that machine's threads only, and tapping it again lists every machine's.
 */
export function HomeCatFleet(props: HomeCatFleetProps) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  // Unset means on. Nothing is drawn until the choice is known, so a hidden row never flashes.
  if (!AsyncResult.isSuccess(preferences) || preferences.value.catFleetEnabled === false) {
    return null;
  }
  return (
    <HomeCatFleetRow {...props} limit={homeCatFleetLimitOf(preferences.value.catFleetLimit)} />
  );
}

function HomeCatFleetRow(props: HomeCatFleetProps & { readonly limit: number }) {
  // Every thread, not the listed ones: the fleet also counts sub-agents and settled threads.
  const threads = useAtomValueWhileVisible(
    environmentThreadShells.quietThreadShellsAtom,
    props.visible,
  );
  const { themeAppearance } = useAppearancePreferences();
  const ink = colorOf(useResolveClassNames("text-foreground"));
  const faded = colorOf(useResolveClassNames("text-foreground-muted"));
  const [rowWidth, setRowWidth] = useState(0);
  const machines = rankHomeCatFleet(
    summarizeCatFleet({
      environmentLabelById: new Map(
        props.environments.map((environment) => [environment.environmentId, environment.label]),
      ),
      connectedEnvironmentIds: props.environments
        .filter((environment) => environment.connectionState === "connected")
        .map((environment) => environment.environmentId),
      threads,
      isWorking: isThreadWorking,
    }),
  );
  if (machines.length === 0) return null;
  const cells = homeCatFleetCells(rowWidth - 2 * ROW_GUTTER);
  const sidebar = props.pane === "sidebar";

  return (
    <View
      className="mb-1 flex-row"
      onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      style={{ minHeight: CAT_PLANET.height * CAT_SCALE + 18, paddingHorizontal: ROW_GUTTER }}
    >
      {pickHomeCatFleet(
        machines,
        Math.min(cells.count, props.limit),
        props.selectedEnvironmentId,
      ).map((machine) => {
        const environment = props.environments.find(
          (candidate) => candidate.environmentId === machine.environmentId,
        );
        const selected = environment?.environmentId === props.selectedEnvironmentId;
        return (
          <Pressable
            accessibilityHint={
              selected ? "Shows threads from every machine" : "Shows only this machine's threads"
            }
            accessibilityLabel={`${machine.label}: ${describeMachine(machine)}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            className={cn(
              "items-center rounded-xl border pt-0.5 pb-0.5",
              selected ? "border-border bg-subtle-strong" : "border-transparent",
            )}
            key={machine.environmentId}
            onPress={() => {
              if (environment) {
                props.onEnvironmentChange(selected ? null : environment.environmentId);
              }
            }}
            style={({ pressed }) => ({ width: cells.width, opacity: pressed ? 0.6 : 1 })}
          >
            <CatPlanet
              dark={themeAppearance === "dark"}
              faded={faded}
              ink={ink}
              machine={machine}
            />
            <AppText
              className={cn(
                "max-w-full px-1 text-3xs",
                selected
                  ? sidebar
                    ? "font-t3-medium text-drawer-foreground"
                    : "font-t3-medium text-foreground"
                  : sidebar
                    ? "text-drawer-foreground-muted"
                    : "text-foreground-muted",
                machine.offline && !selected && "opacity-60",
              )}
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
            >
              {machine.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function colorOf(style: ReturnType<typeof useResolveClassNames>): string {
  return String(StyleSheet.flatten(style)?.color ?? "transparent");
}

function describeMachine(machine: CatFleetMachine): string {
  if (machine.offline) return "offline";
  const running = machine.bodies.filter((body) => body.running).length;
  const subagents = machine.bodies.reduce((total, body) => total + body.subagents, 0);
  const subagentNote =
    subagents === 0 ? "" : ` (+${subagents} ${subagents === 1 ? "sub-agent" : "sub-agents"})`;
  return `${running} running${subagentNote}, ${machine.bodies.length - running} stopped`;
}

interface PlacedBody {
  readonly body: CatFleetBody;
  readonly orbit: number;
  readonly x: number;
  readonly y: number;
  readonly near: boolean;
}

/**
 * The desktop's cat planet as a still picture. Moons that would pass behind the cat show
 * through it as dotted outlines, so every running thread can be counted.
 */
function CatPlanet(props: {
  readonly machine: CatFleetMachine;
  /** The theme's text colour, for lines, rings and sub-agents. */
  readonly ink: string;
  /** The theme's muted text colour, for a cat that is offline. */
  readonly faded: string;
  readonly dark: boolean;
}) {
  const { machine, ink, dark } = props;
  const drawn = machine.offline ? [] : machine.bodies;
  const placed: PlacedBody[] = drawn
    .filter(isCatFleetBodyInOrbit)
    .slice(0, MAX_BODIES)
    .map((body) => {
      const orbit = catFleetOrbitOf(body.key, CAT_ORBITS.length);
      return { body, orbit, ...catOrbitPoint(CAT_ORBITS[orbit]!, fleetHashUnit(body.key)) };
    });
  const stopped = drawn.filter((body) => !isCatFleetBodyInOrbit(body)).slice(0, MAX_STOPPED);
  const active = catFleetActivity(machine);
  const glow = 0.3 + 0.5 * Math.min(1, active / GLOW.full);
  const coat = catCoatStops(machine.environmentId, active === 0);
  const busyOrbits = new Set(placed.map((entry) => entry.orbit));
  const lineOpacity = (orbit: number) =>
    busyOrbits.has(orbit) ? (dark ? 0.34 : 0.45) : dark ? 0.16 : 0.2;
  const far = placed.filter((entry) => !entry.near);
  const near = placed.filter((entry) => entry.near);

  return (
    <Svg
      accessible={false}
      color={ink}
      height={(CAT_PLANET.height + 2 * BLEED) * CAT_SCALE}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ margin: -BLEED * CAT_SCALE }}
      viewBox={`${-BLEED} ${-BLEED} ${CAT_PLANET.width + 2 * BLEED} ${CAT_PLANET.height + 2 * BLEED}`}
      width={(CAT_PLANET.width + 2 * BLEED) * CAT_SCALE}
    >
      <Defs>
        <LinearGradient id="coat" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0" stopColor={coat[0]} />
          <Stop offset="0.55" stopColor={coat[1]} />
          <Stop offset="1" stopColor={coat[2]} />
        </LinearGradient>
        <RadialGradient id="glow">
          <Stop offset="0" stopColor={CAT_COLORS.light} stopOpacity={glow} />
          <Stop offset="0.5" stopColor={CAT_COLORS.light} stopOpacity={glow} />
          <Stop offset="1" stopColor={CAT_COLORS.light} stopOpacity={0} />
        </RadialGradient>
        {CAT_COLORS.moons.map((moon, tone) => {
          // Pale moons vanish on a light screen, so there the halo is the cat's orange.
          const color = dark ? moon : CAT_COLORS.base;
          const strength = dark ? 0.6 : 0.7;
          return (
            <RadialGradient id={`halo${tone}`} key={moon}>
              <Stop offset="0.5" stopColor={color} stopOpacity={strength} />
              <Stop offset="0.75" stopColor={color} stopOpacity={strength * 0.3} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          );
        })}
        <ClipPath id="head">
          <Path d={CAT_HEAD_PATH} />
        </ClipPath>
      </Defs>
      {active > 0 ? (
        <Circle cx={CAT_HEAD.x} cy={CAT_HEAD.y} fill="url(#glow)" r={GLOW.radius} />
      ) : null}
      {CAT_ORBITS.map((orbit, index) => (
        <Ellipse
          cx={CAT_ORBIT_CENTER.x}
          cy={CAT_ORBIT_CENTER.y}
          fill="none"
          key={orbit.radius}
          opacity={lineOpacity(index)}
          rx={orbit.radius}
          ry={orbit.radius * CAT_ORBIT_SQUASH}
          stroke="currentColor"
          strokeWidth={LINE.width}
          transform={`rotate(${orbit.tilt} ${CAT_ORBIT_CENTER.x} ${CAT_ORBIT_CENTER.y})`}
        />
      ))}
      {placed.map((entry) =>
        entry.body.running ? (
          <Circle
            cx={entry.x}
            cy={entry.y}
            fill={`url(#halo${catFleetMoonToneOf(entry.body.key, CAT_COLORS.moons.length)})`}
            key={entry.body.key}
            r={HALO_RADIUS}
          />
        ) : null,
      )}
      {far.map((entry) => (
        <OrbitingBody edged={!dark} entry={entry} key={entry.body.key} />
      ))}
      <G transform={HEAD_TRANSFORM}>
        <Path
          d={CAT_HEAD_PATH}
          fill={machine.offline ? props.faded : "url(#coat)"}
          fillOpacity={machine.offline ? 0.4 : 1}
        />
        <G clipPath="url(#head)" fill="none" stroke="currentColor">
          {CAT_ORBITS.map((orbit, index) => (
            <OrbitThroughCat
              busy={busyOrbits.has(index)}
              key={orbit.radius}
              opacity={lineOpacity(index)}
              orbit={orbit}
            />
          ))}
          {far.map((entry) => (
            <Circle
              cx={256 + (entry.x - CAT_HEAD.x) / HEAD_SCALE}
              cy={261 + (entry.y - CAT_HEAD.y) / HEAD_SCALE}
              key={entry.body.key}
              r={(entry.body.running ? MOON_RADIUS : HELD_RADIUS) / HEAD_SCALE}
              strokeDasharray={`0 ${1.6 / HEAD_SCALE}`}
              strokeLinecap="round"
              strokeWidth={0.9 / HEAD_SCALE}
            />
          ))}
        </G>
      </G>
      {stopped.map((body, index) => {
        const point = catStoppedPoint(body.key, index, stopped.length);
        return (
          <Circle
            cx={point.x}
            cy={point.y}
            fill="none"
            key={body.key}
            opacity={0.6}
            r={point.radius - 0.5}
            stroke="currentColor"
            strokeWidth={1}
          />
        );
      })}
      {near.map((entry) => (
        <OrbitingBody edged entry={entry} key={entry.body.key} />
      ))}
    </Svg>
  );
}

/**
 * One orbit where it crosses the cat, in the icon's units: dotted on the far half, which the
 * cat hides, and a plain line on the near half, which passes in front.
 */
function OrbitThroughCat(props: {
  readonly orbit: (typeof CAT_ORBITS)[number];
  readonly busy: boolean;
  readonly opacity: number;
}) {
  const center = { x: 256, y: 261 + 0.15 * 133 };
  const rx = props.orbit.radius / HEAD_SCALE;
  const ry = rx * CAT_ORBIT_SQUASH;
  const left = `${center.x - rx},${center.y}`;
  const right = `${center.x + rx},${center.y}`;
  return (
    <G transform={`rotate(${props.orbit.tilt} ${center.x} ${center.y})`}>
      <Path
        d={`M ${left} A ${rx} ${ry} 0 0 1 ${right}`}
        opacity={props.busy ? 0.6 : 0.3}
        strokeDasharray={`0 ${LINE.gap / HEAD_SCALE}`}
        strokeLinecap="round"
        strokeWidth={LINE.dot / HEAD_SCALE}
      />
      <Path
        d={`M ${right} A ${rx} ${ry} 0 0 1 ${left}`}
        opacity={props.opacity}
        strokeWidth={LINE.width / HEAD_SCALE}
      />
    </G>
  );
}

/**
 * A running thread's moon, or the ring of a stopped thread whose sub-agent still runs, with
 * those sub-agents round it.
 */
function OrbitingBody(props: {
  readonly entry: PlacedBody;
  /** Over the cat or on a light screen a moon needs a dark edge to stand out. */
  readonly edged: boolean;
}) {
  const { body, x, y } = props.entry;
  const unit = fleetHashUnit(body.key);
  const subagents = Math.min(body.subagents, SUBAGENT.max);
  return (
    <G>
      {body.running ? (
        <Circle
          cx={x}
          cy={y}
          fill={CAT_COLORS.moons[catFleetMoonToneOf(body.key, CAT_COLORS.moons.length)]}
          r={MOON_RADIUS}
          stroke={props.edged ? CAT_COLORS.shade : "none"}
          strokeOpacity={0.55}
          strokeWidth={0.8}
        />
      ) : (
        <Circle
          cx={x}
          cy={y}
          fill="none"
          opacity={0.6}
          r={HELD_RADIUS - 0.5}
          stroke="currentColor"
          strokeWidth={1}
        />
      )}
      {Array.from({ length: subagents }, (_, index) => {
        const angle = (index / subagents + unit) * 2 * Math.PI;
        return (
          <Circle
            cx={x + SUBAGENT.distance * Math.cos(angle)}
            cy={y + SUBAGENT.distance * Math.sin(angle)}
            fill="currentColor"
            key={index}
            r={SUBAGENT.radius}
          />
        );
      })}
    </G>
  );
}
