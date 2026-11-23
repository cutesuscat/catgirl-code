import type { CSSProperties } from "react";
import { memo, useId } from "react";

import { cn } from "../../lib/utils";
import { observeVisibleAnimation } from "../../lib/visibleAnimation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { fleetHashUnit, type CatFleetBody, type CatFleetMachine } from "./SidebarCatFleet.logic";

// One planet, in CSS pixels. The cat head is the app icon's, drawn in the icon's own units.
const PLANET = { width: 66, height: 38 };
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
const POINT = "absolute top-0 left-0 size-0";
const UNSQUASH = `scaleY(${1 / ORBIT_SQUASH})`;

/**
 * Every machine as a cat planet. A running thread is a moon in orbit, a stopped one is a ring
 * frozen where it stopped, and a running sub-agent circles the thread that started it.
 */
export const SidebarCatFleet = memo(function SidebarCatFleet({
  machines,
}: {
  machines: readonly CatFleetMachine[];
}) {
  if (machines.length === 0) return null;
  return (
    <div ref={observeVisibleAnimation} className="flex shrink-0 flex-wrap px-2 pb-1">
      {machines.map((machine) => (
        <CatPlanet key={machine.environmentId} machine={machine} />
      ))}
    </div>
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

function CatPlanet({ machine }: { machine: CatFleetMachine }) {
  const gradientId = useId();
  const bodies = machine.offline ? [] : machine.bodies.slice(0, MAX_BODIES);
  const speed = 0.9 + fleetHashUnit(machine.environmentId) * 0.3;
  const summary = describeMachine(machine);
  const fill = machine.offline ? "currentColor" : `url(#${gradientId})`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label={`${machine.label}: ${summary}`}
            className="flex flex-col items-center text-foreground"
            role="img"
            style={{ width: PLANET.width }}
          />
        }
      >
        <div className="relative" style={PLANET}>
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
      <TooltipPopup side="bottom">
        {machine.label} · {summary}
      </TooltipPopup>
    </Tooltip>
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
  const color = MOON_COLORS[Math.floor(unit * 997) % MOON_COLORS.length];
  const subagents = Math.min(body.subagents, SUBAGENT.max);
  // A stopped thread's arm is paused, not removed, so its ring stays where the moon stopped.
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
