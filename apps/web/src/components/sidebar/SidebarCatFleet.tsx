import type { CSSProperties } from "react";
import { memo, useId } from "react";

import { cn } from "../../lib/utils";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { ThreadHoverCard, ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Tooltip, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { fleetHashUnit, type CatFleetBody, type CatFleetMachine } from "./SidebarCatFleet.logic";

// One planet, in CSS pixels. The cat head is the app icon's, drawn in the icon's own units.
const PLANET = { width: 66, height: 42 };
const HEAD = { x: 33, y: 20.5, radius: 11.5 };
const HEAD_SCALE = HEAD.radius / 133;
const HEAD_VIEW_BOX = `${256 - HEAD.x / HEAD_SCALE} ${261 - HEAD.y / HEAD_SCALE} ${PLANET.width / HEAD_SCALE} ${PLANET.height / HEAD_SCALE}`;
const ORBIT_CENTER = { x: HEAD.x, y: HEAD.y + 0.15 * HEAD.radius };
const ORBIT_SQUASH = 68.6 / 207;
// Outer orbits turn more slowly, as real ones do.
const ORBITS = [
  { radius: 17.5, tilt: -26, period: 7.5 },
  { radius: 23.5, tilt: 9, period: 10.5 },
  { radius: 29.5, tilt: -9, period: 14 },
];
const MOON_SIZE = 5;
const STOPPED_SIZE = 4.2;
const SUBAGENT = { size: 2.2, radius: 4.8, period: 3.2, max: 3 };
const MOON_COLORS = ["var(--color-cat-pink)", "var(--color-cat-cream)", "var(--color-cat-peach)"];
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
 * Every machine as a cat planet. A running thread is a moon in orbit, a stopped one is a dim
 * ring lying just under the cat, and a running sub-agent circles the thread that started it.
 */
export const SidebarCatFleet = memo(function SidebarCatFleet({
  machines,
}: {
  machines: readonly CatFleetMachine[];
}) {
  if (machines.length === 0) return null;
  return (
    // The same timing as the thread rows, so a cat's card opens the way a thread's does.
    <TooltipProvider delay={150} closeDelay={0} timeout={400}>
      <div ref={observeVisibleAnimation} className="flex shrink-0 flex-wrap px-2 pb-1">
        {machines.map((machine) => (
          <CatPlanet key={machine.environmentId} machine={machine} />
        ))}
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
  return MOON_COLORS[Math.floor(fleetHashUnit(key) * 997) % MOON_COLORS.length]!;
}

// A stopped thread whose sub-agent still runs stays in the sky, so the sub-agent has
// something to circle.
function isInOrbit(body: CatFleetBody): boolean {
  return body.running || body.subagents > 0;
}

function CatPlanet({ machine }: { machine: CatFleetMachine }) {
  const gradientId = useId();
  const shown = machine.offline ? [] : machine.bodies;
  const bodies = shown.filter(isInOrbit).slice(0, MAX_BODIES);
  const stopped = shown.filter((body) => !isInOrbit(body)).slice(0, MAX_STOPPED);
  const active = shown.reduce((total, body) => total + (body.running ? 1 : 0) + body.subagents, 0);
  const glow = Math.min(1, active / GLOW.full);
  const speed = 0.9 + fleetHashUnit(machine.environmentId) * 0.3;
  const summary = describeMachine(machine);
  const fill = machine.offline ? "currentColor" : `url(#${gradientId})`;

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
                <stop offset="0" stopColor="var(--color-cat-light)" />
                <stop offset=".55" stopColor="var(--color-cat)" />
                <stop offset="1" stopColor="var(--color-cat-dark)" />
              </linearGradient>
            </defs>
            <path
              d="M 126.04,232.73 L 154.09,103.79 Q 156,95 163.87,99.37 L 222.92,132.18 Z"
              fill={fill}
            />
            <path
              d="M 385.96,232.73 L 357.91,103.79 Q 356,95 348.13,99.37 L 289.08,132.18 Z"
              fill={fill}
            />
            <circle cx="256" cy="261" fill={fill} r="133" />
          </svg>
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

/** One thread in a cat's card, marked the way it is drawn: a moon if running, a ring if not. */
function CardRow({ body }: { body: CatFleetBody }) {
  const color = moonColor(body.key);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex w-3 shrink-0 justify-center">
        {body.running ? (
          <span
            className="rounded-full"
            style={{
              width: 6,
              height: 6,
              background: color,
              boxShadow: `0 0 4px 1px color-mix(in srgb, ${color} 60%, transparent)`,
            }}
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
  const share = SCATTER.arc / total;
  const along = (index + 0.5 - total / 2 + (fleetHashUnit(body.key) - 0.5) * 0.9) * share;
  const angle = ((90 + along) * Math.PI) / 180;
  const distance =
    HEAD.radius +
    SCATTER.size / 2 -
    SCATTER.overlap +
    fleetHashUnit(`${body.key}:drift`) * SCATTER.drift;
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
 * sits behind the cat. The front copy shows the near half over it.
 */
function OrbitLayer({
  side,
  bodies,
  speed,
}: {
  side: "back" | "front";
  bodies: readonly CatFleetBody[];
  speed: number;
}) {
  const front = side === "front";
  return ORBITS.map((orbit, orbitIndex) => {
    const halfBox = orbit.radius + 8;
    return (
      <div
        className={cn(
          "pointer-events-none absolute origin-top",
          front ? "z-[2] overflow-hidden" : "z-0",
        )}
        key={orbit.radius}
        style={{
          left: ORBIT_CENTER.x - halfBox,
          top: ORBIT_CENTER.y,
          width: 2 * halfBox,
          height: halfBox,
          transform: `rotate(${orbit.tilt}deg) scaleY(${ORBIT_SQUASH})`,
        }}
      >
        <div className="absolute top-0 left-1/2 size-0">
          <span
            className="absolute rounded-full border border-current opacity-10"
            style={{ width: 2 * orbit.radius, height: 2 * orbit.radius, margin: -orbit.radius }}
          />
          {bodies
            .filter(
              (body) => Math.floor(fleetHashUnit(body.key) * 7919) % ORBITS.length === orbitIndex,
            )
            .map((body) => (
              <OrbitingBody
                body={body}
                front={front}
                key={body.key}
                period={orbit.period * speed}
                radius={orbit.radius}
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
  front,
  period,
  radius,
}: {
  body: CatFleetBody;
  front: boolean;
  period: number;
  radius: number;
}) {
  const unit = fleetHashUnit(body.key);
  const color = moonColor(body.key);
  const subagents = Math.min(body.subagents, SUBAGENT.max);
  // Only a stopped thread with a running sub-agent is drawn here. Its arm is paused, so it
  // waits as a ring where it stopped.
  const held = !body.running;

  return (
    <span className={cn(POINT, "cat-orbit-arm")} style={orbitStyle(period, unit, held)}>
      <span className={POINT} style={{ transform: `translateX(${radius}px)` }}>
        <span className={cn(POINT, "cat-orbit-unspin")} style={orbitStyle(period, unit, held)}>
          {body.running ? (
            <span
              className="absolute rounded-full"
              style={{
                width: MOON_SIZE,
                height: MOON_SIZE,
                margin: -MOON_SIZE / 2,
                background: color,
                // Over the cat a glow would vanish into the orange, so the near copy gets an edge.
                boxShadow: front
                  ? "0 0 0 0.8px var(--color-cat-shade)"
                  : `0 0 ${MOON_SIZE * 0.7}px ${MOON_SIZE * 0.12}px color-mix(in srgb, ${color} 60%, transparent)`,
                transform: UNSQUASH,
              }}
            />
          ) : (
            <span
              className="absolute rounded-full border border-current opacity-60"
              style={{
                width: STOPPED_SIZE,
                height: STOPPED_SIZE,
                margin: -STOPPED_SIZE / 2,
                transform: UNSQUASH,
              }}
            />
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
