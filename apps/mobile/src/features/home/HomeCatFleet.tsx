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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
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
  CAT_SUBAGENT_ORBIT,
  HOME_CAT_FLEET_GUTTER,
  catCoatStops,
  catOrbitPaceOf,
  catOrbitPoint,
  catOrbitTurn,
  catStoppedPoint,
  catSubagentOffset,
  homeCatFleetCells,
  homeCatFleetLimitOf,
  isHomeCatCellInView,
  pickHomeCatFleet,
  rankHomeCatFleet,
  type HomeListScrollWatch,
} from "./home-cat-fleet";
import { useAtomValueWhileVisible } from "./home-route-visibility";

const HEAD_SCALE = CAT_HEAD.radius / 133;
const HEAD_TRANSFORM = `translate(${CAT_HEAD.x} ${CAT_HEAD.y}) scale(${HEAD_SCALE}) translate(-256 -261)`;
const MOON_RADIUS = 3;
const HELD_RADIUS = 2.1;
const SUBAGENT = { radius: 1.1, max: 3 };
// Orbit lines: thin where they pass round the cat, dotted where they pass behind it.
const LINE = { width: 0.7, dot: 1.1, gap: 2.5 };
// A cat with work running glows, fully once this many threads and sub-agents run on it.
const GLOW = { radius: 21, full: 5 };
const HALO_RADIUS = 7.5;
const EDGE = 0.8;
// The picture is drawn this much wider than its place in the row, so a glow at the end of an
// orbit fades out instead of being cut off.
const BLEED = 6;
const MAX_BODIES = 14;
const MAX_STOPPED = 16;
// Moons move at most this often (about 30 times a second): smooth at their slow pace, and half
// the redraws of a 60 Hz screen.
const STEP_SECONDS = 0.03;
// After a pause the first frame can report a long gap; the moons carry on instead of jumping.
const MAX_FRAME_GAP_MS = 100;
const FADE_WIDTH = 24;
// Where the moons that pass behind the cat show through it, in the planet's units: the head.
const THROUGH = {
  x: CAT_HEAD.x - CAT_HEAD.radius,
  y: CAT_HEAD.y - CAT_HEAD.radius,
  size: 2 * CAT_HEAD.radius,
};

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
  /** The list the row heads, so the moons stop once it is scrolled out of sight. */
  readonly listScroll?: HomeListScrollWatch;
}

/**
 * The busiest machines as cat planets, one row above the thread list that scrolls sideways
 * when they do not all fit. A running thread is a moon going round its cat and a stopped one
 * a dim ring under it. Tapping a cat lists that machine's threads only, and again every one.
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
  const screenColor = backgroundOf(useResolveClassNames("bg-screen"));
  const drawerColor = backgroundOf(useResolveClassNames("bg-drawer"));
  const [frame, setFrame] = useState({ y: 0, width: 0, height: 0 });
  const listShowsRow = useListShowsRow(props.listScroll, frame.y + frame.height);
  const foreground = useAppForeground();
  const reducedMotion = useReducedMotion();
  const scrollX = useSharedValue(0);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.set(event.contentOffset.x);
  });
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
  const shown = pickHomeCatFleet(machines, props.limit, props.selectedEnvironmentId);
  // Moons move only while one does, the list is in sight and the system allows motion.
  const moving =
    !reducedMotion &&
    foreground &&
    props.visible &&
    listShowsRow &&
    shown.some((machine) => !machine.offline && catFleetActivity(machine) > 0);
  const clock = useMotionClock(moving);
  const cells = homeCatFleetCells(frame.width, shown.length);
  const contentWidth = 2 * HOME_CAT_FLEET_GUTTER + shown.length * cells.width;
  const startFade = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, scrollX.get()) / FADE_WIDTH),
  }));
  const endFade = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, contentWidth - frame.width - scrollX.get()) / FADE_WIDTH),
  }));
  if (machines.length === 0) return null;
  const sidebar = props.pane === "sidebar";
  // On Android the list sits on the screen's surface in either pane.
  const fadeColor = sidebar && Platform.OS !== "android" ? drawerColor : screenColor;

  return (
    <View
      className="mb-1"
      onLayout={(event) => {
        const { y, width, height } = event.nativeEvent.layout;
        setFrame({ y, width, height });
      }}
      style={{ minHeight: CAT_PLANET.height * CAT_SCALE + 18 }}
    >
      <Animated.ScrollView
        // A row that shrinks, or stops scrolling, keeps its old offset unless brought back.
        onContentSizeChange={(width) => {
          const end = Math.max(0, width - frame.width);
          if (scrollX.get() > end) scrollRef.current?.scrollTo({ x: end, animated: false });
        }}
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: HOME_CAT_FLEET_GUTTER }}
        horizontal
        onScroll={onScroll}
        overScrollMode="never"
        scrollEnabled={cells.scrolls}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
      >
        {cells.width > 0
          ? shown.map((machine, index) => {
              const environment = props.environments.find(
                (candidate) => candidate.environmentId === machine.environmentId,
              );
              const selected = environment?.environmentId === props.selectedEnvironmentId;
              return (
                <Pressable
                  accessibilityHint={
                    selected
                      ? "Shows threads from every machine"
                      : "Shows only this machine's threads"
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
                    cell={{ index, width: cells.width, rowWidth: frame.width }}
                    clock={clock}
                    dark={themeAppearance === "dark"}
                    faded={faded}
                    ink={ink}
                    machine={machine}
                    scrollX={scrollX}
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
            })
          : null}
      </Animated.ScrollView>
      {cells.scrolls ? (
        <>
          <Animated.View
            className="absolute inset-y-0 left-0"
            pointerEvents="none"
            style={[{ width: FADE_WIDTH }, startFade]}
          >
            <EdgeFade color={fadeColor} side="start" />
          </Animated.View>
          <Animated.View
            className="absolute inset-y-0 right-0"
            pointerEvents="none"
            style={[{ width: FADE_WIDTH }, endFade]}
          >
            <EdgeFade color={fadeColor} side="end" />
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

/**
 * Seconds of motion so far, counted on the UI thread while `moving` and held while not. A
 * clock that never ran stays at 0, where every moon sits as in the still picture.
 */
function useMotionClock(moving: boolean): SharedValue<number> {
  const clock = useSharedValue(0);
  const elapsed = useSharedValue(0);
  const frameCallback = useFrameCallback((frame) => {
    "worklet";
    const gap = Math.min(frame.timeSincePreviousFrame ?? 0, MAX_FRAME_GAP_MS);
    const next = elapsed.get() + gap / 1000;
    elapsed.set(next);
    if (next - clock.get() >= STEP_SECONDS) clock.set(next);
  }, false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts and stops the UI thread's frame callback, which React does not own
  useEffect(() => {
    frameCallback.setActive(moving);
  }, [frameCallback, moving]);
  return clock;
}

function subscribeAppState(onChange: () => void): () => void {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

function useAppForeground(): boolean {
  return useSyncExternalStore(subscribeAppState, () => AppState.currentState === "active");
}

function subscribeNothing(): () => void {
  return () => {};
}

/** Whether the list is scrolled so that any of the row, which ends at `bottom`, is in sight. */
function useListShowsRow(watch: HomeListScrollWatch | undefined, bottom: number): boolean {
  return useSyncExternalStore(
    watch?.subscribe ?? subscribeNothing,
    () => bottom === 0 || (watch?.offset() ?? 0) < bottom,
  );
}

function colorOf(style: ReturnType<typeof useResolveClassNames>): string {
  return String(StyleSheet.flatten(style)?.color ?? "transparent");
}

function backgroundOf(style: ReturnType<typeof useResolveClassNames>): string {
  return String(StyleSheet.flatten(style)?.backgroundColor ?? "transparent");
}

function describeMachine(machine: CatFleetMachine): string {
  if (machine.offline) return "offline";
  const running = machine.bodies.filter((body) => body.running).length;
  const subagents = machine.bodies.reduce((total, body) => total + body.subagents, 0);
  const subagentNote =
    subagents === 0 ? "" : ` (+${subagents} ${subagents === 1 ? "sub-agent" : "sub-agents"})`;
  return `${running} running${subagentNote}, ${machine.bodies.length - running} stopped`;
}

/** The screen's colour, fading in towards the row's edge where more cats lie past it. */
function EdgeFade(props: { readonly color: string; readonly side: "start" | "end" }) {
  const solidAt = props.side === "start" ? 0 : 1;
  return (
    <Svg height="100%" width="100%">
      <Defs>
        <LinearGradient id="fade" x1="0" x2="1" y1="0" y2="0">
          <Stop offset={0} stopColor={props.color} stopOpacity={1 - solidAt} />
          <Stop offset={1} stopColor={props.color} stopOpacity={solidAt} />
        </LinearGradient>
      </Defs>
      <Rect fill="url(#fade)" height="100%" width="100%" />
    </Svg>
  );
}

type Layer = "back" | "through" | "front";

interface Motion {
  readonly clock: SharedValue<number>;
  readonly pace: number;
}

/**
 * The desktop's cat planet. The cat, its glow, its orbit lines and its stopped threads are
 * still pictures; each moon is a small view the UI thread moves round its orbit, in three
 * copies: behind the cat, as a dotted outline through it, and in front of it on the near half.
 */
function CatPlanet(props: {
  readonly machine: CatFleetMachine;
  /** The theme's text colour, for lines, rings and sub-agents. */
  readonly ink: string;
  /** The theme's muted text colour, for a cat that is offline. */
  readonly faded: string;
  readonly dark: boolean;
  readonly clock: SharedValue<number>;
  readonly scrollX: SharedValue<number>;
  readonly cell: { readonly index: number; readonly width: number; readonly rowWidth: number };
}) {
  const { machine, ink, dark, clock, scrollX } = props;
  const { index, width, rowWidth } = props.cell;
  // The cat's own clock follows the row's only while it is in view, so one scrolled away rests.
  const time = useSharedValue(0);
  useAnimatedReaction(
    () => (isHomeCatCellInView(index, width, scrollX.get(), rowWidth) ? clock.get() : -1),
    (now) => {
      if (now >= 0) time.set(now);
    },
  );
  const drawn = machine.offline ? [] : machine.bodies;
  const orbiting = drawn.filter(isCatFleetBodyInOrbit).slice(0, MAX_BODIES);
  const stopped = drawn.filter((body) => !isCatFleetBodyInOrbit(body)).slice(0, MAX_STOPPED);
  const active = catFleetActivity(machine);
  const busyOrbits = new Set(orbiting.map((body) => catFleetOrbitOf(body.key, CAT_ORBITS.length)));
  const motion: Motion = { clock: time, pace: catOrbitPaceOf(machine.environmentId) };
  const box = {
    width: (CAT_PLANET.width + 2 * BLEED) * CAT_SCALE,
    height: (CAT_PLANET.height + 2 * BLEED) * CAT_SCALE,
  };
  const viewBox = `${-BLEED} ${-BLEED} ${CAT_PLANET.width + 2 * BLEED} ${CAT_PLANET.height + 2 * BLEED}`;
  const bodies = (layer: Layer) =>
    orbiting.map((body) => (
      <MovingBody body={body} dark={dark} ink={ink} key={body.key} layer={layer} motion={motion} />
    ));

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ ...box, margin: -BLEED * CAT_SCALE }}
    >
      <Svg color={ink} {...box} style={StyleSheet.absoluteFill} viewBox={viewBox}>
        <PlanetSky active={active} busyOrbits={busyOrbits} dark={dark} />
      </Svg>
      {bodies("back")}
      <Svg color={ink} {...box} style={StyleSheet.absoluteFill} viewBox={viewBox}>
        <PlanetCat
          busyOrbits={busyOrbits}
          dark={dark}
          faded={props.faded}
          machine={machine}
          stopped={stopped}
        />
      </Svg>
      {orbiting.length > 0 ? (
        <View
          className="absolute overflow-hidden"
          style={{
            left: (THROUGH.x + BLEED) * CAT_SCALE,
            top: (THROUGH.y + BLEED) * CAT_SCALE,
            width: THROUGH.size * CAT_SCALE,
            height: THROUGH.size * CAT_SCALE,
            borderRadius: (THROUGH.size / 2) * CAT_SCALE,
          }}
        >
          {bodies("through")}
        </View>
      ) : null}
      {bodies("front")}
    </View>
  );
}

function lineOpacityOf(busy: boolean, dark: boolean): number {
  return busy ? (dark ? 0.34 : 0.45) : dark ? 0.16 : 0.2;
}

/** What lies behind the moons: the cat's glow and its orbit lines. */
function PlanetSky(props: {
  readonly active: number;
  readonly busyOrbits: ReadonlySet<number>;
  readonly dark: boolean;
}) {
  const glow = 0.3 + 0.5 * Math.min(1, props.active / GLOW.full);
  return (
    <>
      <Defs>
        <RadialGradient id="glow">
          <Stop offset="0" stopColor={CAT_COLORS.light} stopOpacity={glow} />
          <Stop offset="0.5" stopColor={CAT_COLORS.light} stopOpacity={glow} />
          <Stop offset="1" stopColor={CAT_COLORS.light} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {props.active > 0 ? (
        <Circle cx={CAT_HEAD.x} cy={CAT_HEAD.y} fill="url(#glow)" r={GLOW.radius} />
      ) : null}
      {CAT_ORBITS.map((orbit, index) => (
        <Ellipse
          cx={CAT_ORBIT_CENTER.x}
          cy={CAT_ORBIT_CENTER.y}
          fill="none"
          key={orbit.radius}
          opacity={lineOpacityOf(props.busyOrbits.has(index), props.dark)}
          rx={orbit.radius}
          ry={orbit.radius * CAT_ORBIT_SQUASH}
          stroke="currentColor"
          strokeWidth={LINE.width}
          transform={`rotate(${orbit.tilt} ${CAT_ORBIT_CENTER.x} ${CAT_ORBIT_CENTER.y})`}
        />
      ))}
    </>
  );
}

/** The cat, the orbit lines where they cross it, and its stopped threads lying under it. */
function PlanetCat(props: {
  readonly machine: CatFleetMachine;
  readonly busyOrbits: ReadonlySet<number>;
  readonly stopped: readonly CatFleetBody[];
  readonly faded: string;
  readonly dark: boolean;
}) {
  const { machine, stopped } = props;
  const coat = catCoatStops(machine.environmentId, catFleetActivity(machine) === 0);
  return (
    <>
      <Defs>
        <LinearGradient id="coat" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0" stopColor={coat[0]} />
          <Stop offset="0.55" stopColor={coat[1]} />
          <Stop offset="1" stopColor={coat[2]} />
        </LinearGradient>
        <ClipPath id="head">
          <Path d={CAT_HEAD_PATH} />
        </ClipPath>
      </Defs>
      <G transform={HEAD_TRANSFORM}>
        <Path
          d={CAT_HEAD_PATH}
          fill={machine.offline ? props.faded : "url(#coat)"}
          fillOpacity={machine.offline ? 0.4 : 1}
        />
        <G clipPath="url(#head)" fill="none" stroke="currentColor">
          {CAT_ORBITS.map((orbit, index) => (
            <OrbitThroughCat
              busy={props.busyOrbits.has(index)}
              key={orbit.radius}
              opacity={lineOpacityOf(props.busyOrbits.has(index), props.dark)}
              orbit={orbit}
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
    </>
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
 * One copy of a body in orbit. A running thread's moon goes round; a stopped thread held up by
 * a running sub-agent waits as a ring where it stopped. Its sub-agents circle it either way.
 */
function MovingBody(props: {
  readonly body: CatFleetBody;
  readonly layer: Layer;
  readonly motion: Motion;
  readonly ink: string;
  readonly dark: boolean;
}) {
  const { body, layer } = props;
  const { clock, pace } = props.motion;
  const running = body.running;
  const orbit = CAT_ORBITS[catFleetOrbitOf(body.key, CAT_ORBITS.length)]!;
  const start = fleetHashUnit(body.key);
  const tone = CAT_COLORS.moons[catFleetMoonToneOf(body.key, CAT_COLORS.moons.length)]!;
  const radius = running ? MOON_RADIUS : HELD_RADIUS;
  // The back copy carries the halo, so it is the widest.
  const reach = layer === "back" && running ? HALO_RADIUS : radius + EDGE;
  const originX = layer === "through" ? THROUGH.x : -BLEED;
  const originY = layer === "through" ? THROUGH.y : -BLEED;
  const subagents = layer === "through" ? 0 : Math.min(body.subagents, SUBAGENT.max);
  const placement = useAnimatedStyle(() => {
    const turn = running ? catOrbitTurn(start, clock.get(), orbit.period * pace) : start;
    const point = catOrbitPoint(orbit, turn);
    const shows = layer === "back" || (layer === "front") === point.near;
    return {
      opacity: shows ? 1 : 0,
      transform: [
        { translateX: (point.x - originX - reach) * CAT_SCALE },
        { translateY: (point.y - originY - reach) * CAT_SCALE },
      ],
    };
  });
  const size = 2 * reach * CAT_SCALE;

  return (
    <Animated.View
      className="absolute top-0 left-0"
      style={[{ width: size, height: size }, placement]}
    >
      <Svg
        color={props.ink}
        height={size}
        viewBox={`${-reach} ${-reach} ${2 * reach} ${2 * reach}`}
        width={size}
      >
        <BodyPicture body={body} dark={props.dark} layer={layer} tone={tone} />
      </Svg>
      {Array.from({ length: subagents }, (_, index) => (
        <MovingSubagent
          key={index}
          reach={reach}
          start={index / subagents + start}
          tilt={orbit.tilt}
          clock={clock}
          ink={props.ink}
        />
      ))}
    </Animated.View>
  );
}

function BodyPicture(props: {
  readonly body: CatFleetBody;
  readonly layer: Layer;
  readonly tone: string;
  readonly dark: boolean;
}) {
  const { body, layer, tone } = props;
  if (layer === "through") {
    return (
      <Circle
        fill="none"
        r={body.running ? MOON_RADIUS : HELD_RADIUS}
        stroke="currentColor"
        strokeDasharray="0 1.6"
        strokeLinecap="round"
        strokeWidth={0.9}
      />
    );
  }
  if (!body.running) {
    return (
      <Circle
        fill="none"
        opacity={0.6}
        r={HELD_RADIUS - 0.5}
        stroke="currentColor"
        strokeWidth={1}
      />
    );
  }
  // Pale moons vanish on a light screen, so there the halo is the cat's orange and the moon
  // has a dark edge. Over the cat a moon always has the edge.
  const halo = props.dark ? tone : CAT_COLORS.base;
  const strength = props.dark ? 0.6 : 0.7;
  const edged = layer === "front" || !props.dark;
  return (
    <>
      {layer === "back" ? (
        <>
          <Defs>
            <RadialGradient id="halo">
              <Stop offset="0.5" stopColor={halo} stopOpacity={strength} />
              <Stop offset="0.75" stopColor={halo} stopOpacity={strength * 0.3} />
              <Stop offset="1" stopColor={halo} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle fill="url(#halo)" r={HALO_RADIUS} />
        </>
      ) : null}
      <Circle
        fill={tone}
        r={MOON_RADIUS}
        stroke={edged ? CAT_COLORS.shade : "none"}
        strokeOpacity={0.55}
        strokeWidth={EDGE}
      />
    </>
  );
}

/** A running sub-agent going round its thread's moon, on a small orbit tilted like the moon's. */
function MovingSubagent(props: {
  readonly start: number;
  readonly tilt: number;
  readonly reach: number;
  readonly clock: SharedValue<number>;
  readonly ink: string;
}) {
  const { start, tilt, reach, clock } = props;
  const size = 2 * SUBAGENT.radius * CAT_SCALE;
  const placement = useAnimatedStyle(() => {
    const offset = catSubagentOffset(
      tilt,
      catOrbitTurn(start, clock.get(), CAT_SUBAGENT_ORBIT.period),
    );
    return {
      transform: [
        { translateX: (reach + offset.x - SUBAGENT.radius) * CAT_SCALE },
        { translateY: (reach + offset.y - SUBAGENT.radius) * CAT_SCALE },
      ],
    };
  });
  return (
    <Animated.View
      className="absolute top-0 left-0 rounded-full"
      style={[{ width: size, height: size, backgroundColor: props.ink }, placement]}
    />
  );
}
