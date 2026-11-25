/* oxlint-disable t3code/no-untranslated-copy -- Catgirl Code feature, English only: upstream's catalogs stay untouched */
import {
  CAT_FLEET_RESTING_SHARE,
  arrangeCatFleet,
  catFleetActivity,
  catFleetCoat,
  catFleetMoonToneOf,
  catFleetOrbitOf,
  catFleetScatterOf,
  fleetHashUnit,
  isCatFleetBodyInOrbit,
  type CatFleetBody,
  type CatFleetMachine,
} from "@t3tools/client-runtime/state/cat-fleet";
import type { CSSProperties } from "react";
import { memo, useId, useState } from "react";

import { cn } from "../../lib/utils";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Tooltip, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

// One planet, in CSS pixels. The cat head is the app icon's, drawn in the icon's own units.
const PLANET = { width: 66, height: 42 };
const HEAD = { x: 33, y: 20.5, radius: 11.5 };
const HEAD_SCALE = HEAD.radius / 133;
const HEAD_VIEW_BOX = `${256 - HEAD.x / HEAD_SCALE} ${261 - HEAD.y / HEAD_SCALE} ${PLANET.width / HEAD_SCALE} ${PLANET.height / HEAD_SCALE}`;
const EAR_LEFT = "M 126.04,232.73 L 154.09,103.79 Q 156,95 163.87,99.37 L 222.92,132.18 Z";
const EAR_RIGHT = "M 289.08,132.18 L 348.13,99.37 Q 356,95 357.91,103.79 L 385.96,232.73 Z";
// The cat's outline in CSS pixels, to clip what shows through it. Every part winds the same
// way: parts that wind against each other would cut holes where they overlap.
const HEAD_CLIP = `path("${[
  EAR_LEFT,
  EAR_RIGHT,
  "M 123,261 A 133 133 0 1 1 389,261 A 133 133 0 1 1 123,261 Z",
]
  .join(" ")
  .replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, x: string, y: string) => {
    const left = HEAD.x + (Number(x) - 256) * HEAD_SCALE;
    const top = HEAD.y + (Number(y) - 261) * HEAD_SCALE;
    return `${left.toFixed(2)},${top.toFixed(2)}`;
  })
  .replace(/A 133 133/g, `A ${HEAD.radius} ${HEAD.radius}`)}")`;
const ORBIT_CENTER = { x: HEAD.x, y: HEAD.y + 0.15 * HEAD.radius };
const ORBIT_SQUASH = 68.6 / 207;
// Outer orbits turn more slowly, as real ones do.
const ORBITS = [
  { radius: 17.5, tilt: -26, period: 7.5 },
  { radius: 23.5, tilt: 9, period: 10.5 },
  { radius: 29.5, tilt: -9, period: 14 },
];
const MOON_SIZE = 6;
const STOPPED_SIZE = 4.2;
const SUBAGENT = { size: 2.2, radius: 4.8, period: 3.2, max: 3 };
const MOON_COLORS = ["var(--color-cat-pink)", "var(--color-cat-cream)", "var(--color-cat-peach)"];
const COAT_STOPS = ["var(--color-cat-light)", "var(--color-cat)", "var(--color-cat-dark)"];
const COAT_TINTS = { honey: "var(--color-cat-honey)", rust: "var(--color-cat-rust)" };
// Orbit lines: thin where they pass round the cat, dotted where they pass behind it.
const LINE = { width: 0.7, dot: 1.1, gap: 2.5 };
const MAX_BODIES = 14;
// Stopped threads lie scattered just under the cat: across this arc of its outline, and from
// just overlapping it to this far off.
const SCATTER = { size: 3.4, arc: 112, drift: 2.4, overlap: 0.5 };
// A cat with work running glows, fully once this many threads and sub-agents run on it.
const GLOW = { radius: 21, full: 5 };
const MAX_STOPPED = 16;
const CARD_ROWS = 8;
const POINT = "absolute top-0 left-0 size-0";
const UNSQUASH = `scaleY(${1 / ORBIT_SQUASH})`;

/**
 * The busiest machines as cat planets. A running thread is a moon in orbit, a stopped one is a
 * dim ring lying just under the cat, and a running sub-agent circles the thread that started it.
 */
export const SidebarCatFleet = memo(function SidebarCatFleet({
  machines,
  limit,
  singleRow = false,
}: {
  machines: readonly CatFleetMachine[];
  /** How many cells the fleet may take. */
  limit: number;
  /** On a phone: only the busiest cats that fit one row, with no cell for the rest. */
  singleRow?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (machines.length === 0 || limit <= 0) return null;
  const { shown, hidden } = arrangeCatFleet(machines, limit);
  return (
    // The same timing as the thread rows, so a cat's card opens the way a thread's does.
    <TooltipProvider delay={150} closeDelay={0} timeout={400}>
      <div
        ref={observeVisibleAnimation}
        className={cn("flex shrink-0 flex-wrap px-2", singleRow ? "mb-1 overflow-hidden" : "pb-1")}
        // One cell is the planet, its top padding and one line of the name; later rows are cut off.
        style={singleRow ? { maxHeight: `calc(${PLANET.height + 2}px + 0.875rem)` } : undefined}
      >
        {(expanded && !singleRow ? [...shown, ...hidden] : shown).map((machine) => (
          <CatPlanet key={machine.environmentId} machine={machine} />
        ))}
        {hidden.length > 0 && !singleRow ? (
          <FleetOverflow
            expanded={expanded}
            machines={hidden}
            onToggle={() => setExpanded((value) => !value)}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
});

function describeMachine(machine: CatFleetMachine): string {
  if (machine.offline) return "offline";
  const running = machine.bodies.filter((body) => body.running).length;
  const subagents = machine.bodies.reduce((total, body) => total + body.subagents, 0);
  const subagentNote =
    subagents === 0 ? "" : ` (+${subagents} ${subagents === 1 ? "sub-agent" : "sub-agents"})`;
  return `${running} running${subagentNote}, ${machine.bodies.length - running} stopped`;
}

function moonColor(key: string): string {
  return MOON_COLORS[catFleetMoonToneOf(key, MOON_COLORS.length)]!;
}

// A stopped thread whose sub-agent still runs stays in the sky, so the sub-agent has
// something to circle.
const isInOrbit = isCatFleetBodyInOrbit;

function orbitIndexOf(body: CatFleetBody): number {
  return catFleetOrbitOf(body.key, ORBITS.length);
}

/** The three stops of a cat's coat, top to bottom. Its machine's id picks the shade. */
function coatStops(environmentId: string, resting: boolean): readonly string[] {
  const { tint, ownShare } = catFleetCoat(environmentId);
  return COAT_STOPS.map((stop) => {
    const coat = `color-mix(in srgb, ${stop} ${ownShare}%, ${COAT_TINTS[tint]})`;
    return resting
      ? `color-mix(in srgb, ${coat} ${CAT_FLEET_RESTING_SHARE}%, var(--color-cat-cream))`
      : coat;
  });
}

function CatPlanet({ machine }: { machine: CatFleetMachine }) {
  const gradientId = useId();
  const clipId = useId();
  const shown = machine.offline ? [] : machine.bodies;
  const bodies = shown.filter(isInOrbit).slice(0, MAX_BODIES);
  const stopped = shown.filter((body) => !isInOrbit(body)).slice(0, MAX_STOPPED);
  const active = catFleetActivity(machine);
  const glow = Math.min(1, active / GLOW.full);
  const speed = 0.9 + fleetHashUnit(machine.environmentId) * 0.3;
  const summary = describeMachine(machine);
  const fill = machine.offline ? "currentColor" : `url(#${gradientId})`;
  const coat = coatStops(machine.environmentId, active === 0);
  const busyOrbits = new Set(bodies.map(orbitIndexOf));

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label={`${machine.label}: ${summary}`}
            className="flex flex-col items-center rounded-md pt-0.5 text-foreground hover:bg-sidebar-row-hover"
            role="img"
            style={{ width: PLANET.width }}
          />
        }
      >
        <div className="relative" style={PLANET}>
          {glow > 0 ? (
            <span
              className="pointer-events-none absolute z-0 rounded-full"
              style={{
                left: HEAD.x - GLOW.radius,
                top: HEAD.y - GLOW.radius,
                width: 2 * GLOW.radius,
                height: 2 * GLOW.radius,
                background: `radial-gradient(closest-side, color-mix(in srgb, var(--color-cat-light) ${Math.round(30 + 50 * glow)}%, transparent) 50%, transparent)`,
              }}
            />
          ) : null}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible stroke-current"
            fill="none"
            viewBox={`0 0 ${PLANET.width} ${PLANET.height}`}
          >
            {ORBITS.map((orbit, index) => (
              <ellipse
                className={busyOrbits.has(index) ? "cat-orbit-line-busy" : "cat-orbit-line"}
                cx={ORBIT_CENTER.x}
                cy={ORBIT_CENTER.y}
                key={orbit.radius}
                rx={orbit.radius}
                ry={orbit.radius * ORBIT_SQUASH}
                strokeWidth={LINE.width}
                transform={`rotate(${orbit.tilt} ${ORBIT_CENTER.x} ${ORBIT_CENTER.y})`}
              />
            ))}
          </svg>
          <OrbitLayer side="back" bodies={bodies} speed={speed} />
          <svg
            aria-hidden="true"
            className={cn(
              "absolute inset-0 z-[1] size-full overflow-visible",
              machine.offline && "text-muted-foreground/40",
            )}
            viewBox={HEAD_VIEW_BOX}
          >
            <defs>
              <linearGradient
                gradientUnits="userSpaceOnUse"
                id={gradientId}
                x1="256"
                x2="256"
                y1="95"
                y2="394"
              >
                <stop offset="0" style={{ stopColor: coat[0] }} />
                <stop offset=".55" style={{ stopColor: coat[1] }} />
                <stop offset="1" style={{ stopColor: coat[2] }} />
              </linearGradient>
              <clipPath id={clipId}>
                <path d={EAR_LEFT} />
                <path d={EAR_RIGHT} />
                <circle cx="256" cy="261" r="133" />
              </clipPath>
            </defs>
            <path d={EAR_LEFT} fill={fill} />
            <path d={EAR_RIGHT} fill={fill} />
            <circle cx="256" cy="261" fill={fill} r="133" />
            <g className="stroke-foreground" clipPath={`url(#${clipId})`} fill="none">
              {ORBITS.map((orbit, index) => (
                <OrbitThroughCat busy={busyOrbits.has(index)} key={orbit.radius} orbit={orbit} />
              ))}
            </g>
          </svg>
          {bodies.length > 0 ? (
            <div
              className="pointer-events-none absolute inset-0 z-[1]"
              style={{ clipPath: HEAD_CLIP }}
            >
              <OrbitLayer side="through" bodies={bodies} speed={speed} />
            </div>
          ) : null}
          {stopped.map((body, index) => (
            <StoppedDot body={body} index={index} key={body.key} total={stopped.length} />
          ))}
          <OrbitLayer side="front" bodies={bodies} speed={speed} />
        </div>
        <span
          className={cn(
            "max-w-full truncate px-0.5 text-3xs",
            machine.offline ? "text-muted-foreground/50" : "text-muted-foreground",
          )}
        >
          {machine.label}
        </span>
      </TooltipTrigger>
      <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
        <ThreadHoverCard title={machine.label}>
          {machine.offline ? (
            <div>Offline</div>
          ) : shown.length === 0 ? (
            <div>Nothing running or waiting</div>
          ) : (
            shown.slice(0, CARD_ROWS).map((body) => <CardRow body={body} key={body.key} />)
          )}
          {shown.length > CARD_ROWS ? (
            <div className="pl-5">+{shown.length - CARD_ROWS} more</div>
          ) : null}
        </ThreadHoverCard>
      </ThreadHoverCardPopup>
    </Tooltip>
  );
}

/**
 * One orbit where it crosses the cat, in the icon's units: dotted on the far half, which the
 * cat hides, and a plain line on the near half, which passes in front.
 */
function OrbitThroughCat({ orbit, busy }: { orbit: (typeof ORBITS)[number]; busy: boolean }) {
  const center = { x: 256, y: 261 + 0.15 * 133 };
  const rx = orbit.radius / HEAD_SCALE;
  const ry = rx * ORBIT_SQUASH;
  const left = `${center.x - rx},${center.y}`;
  const right = `${center.x + rx},${center.y}`;
  return (
    <g transform={`rotate(${orbit.tilt} ${center.x} ${center.y})`}>
      <path
        className={busy ? "cat-orbit-far-busy" : "cat-orbit-far"}
        d={`M ${left} A ${rx} ${ry} 0 0 1 ${right}`}
        strokeDasharray={`0 ${LINE.gap / HEAD_SCALE}`}
        strokeLinecap="round"
        strokeWidth={LINE.dot / HEAD_SCALE}
      />
      <path
        className={busy ? "cat-orbit-line-busy" : "cat-orbit-line"}
        d={`M ${right} A ${rx} ${ry} 0 0 1 ${left}`}
        strokeWidth={LINE.width / HEAD_SCALE}
      />
    </g>
  );
}

/** The cell that stands for the machines that did not fit. Clicking it shows or hides them. */
function FleetOverflow({
  machines,
  expanded,
  onToggle,
}: {
  machines: readonly CatFleetMachine[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-expanded={expanded}
            aria-label={expanded ? "Show fewer machines" : `Show ${machines.length} more machines`}
            className="flex flex-col items-center rounded-md pt-0.5 text-muted-foreground hover:bg-sidebar-row-hover hover:text-foreground"
            onClick={onToggle}
            style={{ width: PLANET.width }}
            type="button"
          />
        }
      >
        <span className="relative block" style={PLANET}>
          <span
            className="absolute flex items-center justify-center rounded-full border border-dashed border-current/40 text-2xs tabular-nums"
            style={{
              left: HEAD.x - HEAD.radius,
              top: HEAD.y - HEAD.radius,
              width: 2 * HEAD.radius,
              height: 2 * HEAD.radius,
            }}
          >
            {expanded ? "−" : `+${machines.length}`}
          </span>
        </span>
        <span className="max-w-full truncate px-0.5 text-3xs">{expanded ? "fewer" : "more"}</span>
      </TooltipTrigger>
      {expanded ? null : (
        <ThreadHoverCardPopup side="right" align="start" sideOffset={4}>
          <ThreadHoverCard title={`${machines.length} more machines`}>
            {machines.slice(0, CARD_ROWS).map((machine) => (
              <div className="flex min-w-0 items-baseline gap-2" key={machine.environmentId}>
                <div className="min-w-0 truncate text-foreground/75">{machine.label}</div>
                <div className="shrink-0">{describeMachine(machine)}</div>
              </div>
            ))}
            {machines.length > CARD_ROWS ? <div>+{machines.length - CARD_ROWS} more</div> : null}
          </ThreadHoverCard>
        </ThreadHoverCardPopup>
      )}
    </Tooltip>
  );
}

/** One thread in a cat's card, marked the way it is drawn: a moon if running, a ring if not. */
function CardRow({ body }: { body: CatFleetBody }) {
  const color = moonColor(body.key);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex w-3 shrink-0 justify-center">
        {body.running ? (
          <span
            className="cat-moon rounded-full"
            style={{ width: 6, height: 6, "--cat-moon-color": color } as CSSProperties}
          />
        ) : (
          <span
            className="rounded-full border border-current opacity-60"
            style={{ width: 6, height: 6 }}
          />
        )}
      </span>
      <div className="min-w-0 truncate text-foreground/75">{body.title || "New thread"}</div>
      {body.subagents > 0 ? (
        <div className="shrink-0">
          · {body.subagents} {body.subagents === 1 ? "sub-agent" : "sub-agents"}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A stopped thread, lying just under the cat. Each dot gets its own share of the arc so they do
 * not stack, and its key places it within that share and sets how far off the cat it lies.
 */
function StoppedDot({ body, index, total }: { body: CatFleetBody; index: number; total: number }) {
  const { along, drift } = catFleetScatterOf(body.key, index, total);
  const angle = ((90 + along * SCATTER.arc) * Math.PI) / 180;
  const distance = HEAD.radius + SCATTER.size / 2 - SCATTER.overlap + drift * SCATTER.drift;
  return (
    <span
      className="pointer-events-none absolute z-[1] rounded-full border border-current opacity-60"
      style={{
        left: HEAD.x + distance * Math.cos(angle) - SCATTER.size / 2,
        top: HEAD.y + distance * Math.sin(angle) - SCATTER.size / 2,
        width: SCATTER.size,
        height: SCATTER.size,
      }}
    />
  );
}

/**
 * Each orbit is a flat circle squashed and tilted by one static transform; only rotations
 * animate, so the compositor moves the moons without repainting. The back copy is whole and
 * sits behind the cat. The front copy shows the near half over it, and the through copy shows
 * the far half as outlines, inside the cat only.
 */
function OrbitLayer({
  side,
  bodies,
  speed,
}: {
  side: "back" | "through" | "front";
  bodies: readonly CatFleetBody[];
  speed: number;
}) {
  return ORBITS.map((orbit, orbitIndex) => {
    const onOrbit = bodies.filter((body) => orbitIndexOf(body) === orbitIndex);
    if (onOrbit.length === 0) return null;
    const halfBox = orbit.radius + 8;
    return (
      <div
        className={cn(
          "pointer-events-none absolute",
          side === "back" && "z-0 origin-top",
          side === "through" && "origin-bottom overflow-hidden",
          side === "front" && "z-[2] origin-top overflow-hidden",
        )}
        key={orbit.radius}
        style={{
          left: ORBIT_CENTER.x - halfBox,
          top: side === "through" ? ORBIT_CENTER.y - halfBox : ORBIT_CENTER.y,
          width: 2 * halfBox,
          height: halfBox,
          transform: `rotate(${orbit.tilt}deg) scaleY(${ORBIT_SQUASH})`,
        }}
      >
        <div className={cn("absolute left-1/2 size-0", side === "through" ? "top-full" : "top-0")}>
          {onOrbit.map((body) => (
            <OrbitingBody
              body={body}
              key={body.key}
              period={orbit.period * speed}
              radius={orbit.radius}
              side={side}
            />
          ))}
        </div>
      </div>
    );
  });
}

function orbitStyle(period: number, phase: number, held = false): CSSProperties {
  return {
    "--cat-orbit-period": `${period}s`,
    "--cat-orbit-delay": `${-phase * period}s`,
    ...(held ? { animationPlayState: "paused" } : {}),
  } as CSSProperties;
}

function OrbitingBody({
  body,
  side,
  period,
  radius,
}: {
  body: CatFleetBody;
  side: "back" | "through" | "front";
  period: number;
  radius: number;
}) {
  const unit = fleetHashUnit(body.key);
  const subagents = side === "through" ? 0 : Math.min(body.subagents, SUBAGENT.max);
  // Only a stopped thread with a running sub-agent is drawn here. Its arm is paused, so it
  // waits as a ring where it stopped.
  const held = !body.running;
  const size = body.running ? MOON_SIZE : STOPPED_SIZE;
  const moon = { width: size, height: size, margin: -size / 2, transform: UNSQUASH };

  return (
    <span className={cn(POINT, "cat-orbit-arm")} style={orbitStyle(period, unit, held)}>
      <span className={POINT} style={{ transform: `translateX(${radius}px)` }}>
        <span className={cn(POINT, "cat-orbit-unspin")} style={orbitStyle(period, unit, held)}>
          {side === "through" ? (
            <span
              className="absolute rounded-full border border-dotted border-current"
              style={moon}
            />
          ) : body.running ? (
            <span
              // Over the cat a glow would vanish into the orange, so the near copy has an edge only.
              className={cn(
                "absolute rounded-full",
                side === "front" ? "cat-moon-near" : "cat-moon",
              )}
              style={{ ...moon, "--cat-moon-color": moonColor(body.key) } as CSSProperties}
            />
          ) : (
            <span className="absolute rounded-full border border-current opacity-60" style={moon} />
          )}
          {Array.from({ length: subagents }, (_, index) => {
            const phase = index / subagents + unit;
            return (
              <span
                className={cn(POINT, "cat-orbit-arm")}
                key={index}
                style={orbitStyle(SUBAGENT.period, phase)}
              >
                <span className={POINT} style={{ transform: `translateX(${SUBAGENT.radius}px)` }}>
                  <span
                    className={cn(POINT, "cat-orbit-unspin")}
                    style={orbitStyle(SUBAGENT.period, phase)}
                  >
                    <span
                      className="absolute rounded-full bg-current"
                      style={{
                        width: SUBAGENT.size,
                        height: SUBAGENT.size,
                        margin: -SUBAGENT.size / 2,
                        transform: UNSQUASH,
                      }}
                    />
                  </span>
                </span>
              </span>
            );
          })}
        </span>
      </span>
    </span>
  );
}
