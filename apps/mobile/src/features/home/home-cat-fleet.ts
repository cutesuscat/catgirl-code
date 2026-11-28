import {
  CAT_FLEET_RESTING_SHARE,
  arrangeCatFleet,
  catFleetCoat,
  catFleetScatterOf,
  fleetHashUnit,
  type CatFleetMachine,
} from "@t3tools/client-runtime/state/cat-fleet";
import { MAX_SIDEBAR_CAT_FLEET_LIMIT } from "@t3tools/contracts/settings";

// The app icon's palette: the web client's --color-cat-* tokens.
export const CAT_COLORS = {
  light: "#fdb14f",
  base: "#ee8a2e",
  dark: "#dc6a18",
  cream: "#fbf1dc",
  honey: "#ffd45c",
  rust: "#c9462a",
  shade: "#281608",
  moons: ["#f5b4a2", "#fbf1dc", "#ffd9a8"],
} as const;

// One planet, in the web client's units, so a cat is drawn the same on every screen.
export const CAT_PLANET = { width: 66, height: 42 };
export const CAT_HEAD = { x: 33, y: 20.5, radius: 11.5 };
export const CAT_ORBIT_CENTER = { x: CAT_HEAD.x, y: CAT_HEAD.y + 0.15 * CAT_HEAD.radius };
export const CAT_ORBIT_SQUASH = 68.6 / 207;
// Seconds per turn: outer orbits turn more slowly, as on the desktop.
export const CAT_ORBITS = [
  { radius: 17.5, tilt: -26, period: 7.5 },
  { radius: 23.5, tilt: 9, period: 10.5 },
  { radius: 29.5, tilt: -9, period: 14 },
] as const;
/** A running sub-agent circles its thread's moon on this small orbit, squashed like the big one. */
export const CAT_SUBAGENT_ORBIT = { radius: 4.8, period: 3.2 };
// Stopped threads lie scattered just under the cat, as on the desktop.
const SCATTER = { size: 3.4, arc: 112, drift: 2.4, overlap: 0.5 };

/** A phone draws the planet this much larger than the desktop does. */
export const CAT_SCALE = 1.15;
const CELL_MIN_WIDTH = CAT_PLANET.width * CAT_SCALE;
/** The row's inset at each end, in points. */
export const HOME_CAT_FLEET_GUTTER = 12;
// A row that scrolls leaves this much of a cell showing at its edge, and may squeeze cells
// down to this share of their width so that it does.
const CELL_PEEK = 0.45;
const CELL_SQUEEZE = 0.92;

/** How many machines the row holds, as on the desktop's "Cat planets" limit. "All" is the top choice. */
export const HOME_CAT_FLEET_LIMITS = [6, 12, 24, MAX_SIDEBAR_CAT_FLEET_LIMIT] as const;
export const DEFAULT_HOME_CAT_FLEET_LIMIT = 12;

/** The stored choice, or the default when there is none or it is not a usable count. */
export function homeCatFleetLimitOf(stored: number | undefined): number {
  if (stored === undefined || !Number.isInteger(stored) || stored < 1) {
    return DEFAULT_HOME_CAT_FLEET_LIMIT;
  }
  return Math.min(stored, MAX_SIDEBAR_CAT_FLEET_LIMIT);
}

/**
 * The machines a phone's row draws from, busiest first as on the desktop. A single machine
 * with nothing on it gives no row: there is nothing to compare and nothing to see.
 */
export function rankHomeCatFleet(machines: readonly CatFleetMachine[]): readonly CatFleetMachine[] {
  const only = machines.length === 1 ? machines[0] : undefined;
  if (only?.offline || only?.bodies.length === 0) return [];
  return arrangeCatFleet(machines, machines.length).shown;
}

/**
 * The cells of a row `rowWidth` wide holding `total` cats. When they all fit, the cells share
 * the width between the gutters evenly, as many as fit. When they do not, the row scrolls,
 * and its cells are sized so the last one in view is cut about in half at the row's edge.
 */
export function homeCatFleetCells(
  rowWidth: number,
  total: number,
): { readonly width: number; readonly scrolls: boolean } {
  const inner = rowWidth - 2 * HOME_CAT_FLEET_GUTTER;
  const fit = Math.max(0, Math.floor(inner / CELL_MIN_WIDTH));
  // Not measured yet, or too narrow for one cat.
  if (fit === 0) return { width: 0, scrolls: false };
  if (total <= fit) return { width: inner / fit, scrolls: false };
  // The far gutter scrolls away with the cats, so the view runs to the row's edge.
  const visible = rowWidth - HOME_CAT_FLEET_GUTTER;
  const whole = Math.max(1, Math.floor(visible / (CELL_MIN_WIDTH * CELL_SQUEEZE) - CELL_PEEK));
  return { width: visible / (whole + CELL_PEEK), scrolls: true };
}

/** Whether the cell at `index` is in view, or within half a cell of it, with the row scrolled by `scrollX`. */
export function isHomeCatCellInView(
  index: number,
  cellWidth: number,
  scrollX: number,
  rowWidth: number,
): boolean {
  "worklet";
  const left = HOME_CAT_FLEET_GUTTER + index * cellWidth - scrollX;
  return left + 1.5 * cellWidth > 0 && left - 0.5 * cellWidth < rowWidth;
}

/**
 * The cats one row holds: the first `count` in rank, and always the machine the list is
 * narrowed to, which takes the last cell when it did not make the row on its own.
 */
export function pickHomeCatFleet(
  ranked: readonly CatFleetMachine[],
  count: number,
  selectedEnvironmentId: string | null,
): readonly CatFleetMachine[] {
  const shown = ranked.slice(0, Math.max(0, count));
  const selected = ranked.find((machine) => machine.environmentId === selectedEnvironmentId);
  if (shown.length === 0 || selected === undefined || shown.includes(selected)) return shown;
  return [...shown.slice(0, -1), selected];
}

/** `share` percent of `color` over `other`, channel by channel: CSS color-mix in srgb. */
export function mixHexColors(color: string, other: string, share: number): string {
  const channel = (hex: string, index: number) =>
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map((index) =>
    Math.round((channel(color, index) * share + channel(other, index) * (100 - share)) / 100),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** The three stops of a cat's coat, top to bottom, in the shade its machine's id picks. */
export function catCoatStops(environmentId: string, resting: boolean): readonly string[] {
  const { tint, ownShare } = catFleetCoat(environmentId);
  return [CAT_COLORS.light, CAT_COLORS.base, CAT_COLORS.dark].map((stop) => {
    const coat = mixHexColors(stop, CAT_COLORS[tint], ownShare);
    return resting ? mixHexColors(coat, CAT_COLORS.cream, CAT_FLEET_RESTING_SHARE) : coat;
  });
}

/**
 * Where a body sits on its orbit, a `turn` of 0 to 1 round from the orbit's right-hand end.
 * The lower half of an orbit passes in front of the cat and the upper half behind it.
 */
export function catOrbitPoint(
  orbit: { readonly radius: number; readonly tilt: number },
  turn: number,
): { readonly x: number; readonly y: number; readonly near: boolean } {
  "worklet";
  const angle = turn * 2 * Math.PI;
  const flatX = orbit.radius * Math.cos(angle);
  const flatY = orbit.radius * Math.sin(angle) * CAT_ORBIT_SQUASH;
  const tilt = (orbit.tilt * Math.PI) / 180;
  return {
    x: CAT_ORBIT_CENTER.x + flatX * Math.cos(tilt) - flatY * Math.sin(tilt),
    y: CAT_ORBIT_CENTER.y + flatX * Math.sin(tilt) + flatY * Math.cos(tilt),
    near: Math.sin(angle) >= 0,
  };
}

/** How fast a machine's moons turn: the desktop gives each machine 0.9 to 1.2 times the period. */
export function catOrbitPaceOf(environmentId: string): number {
  return 0.9 + fleetHashUnit(environmentId) * 0.3;
}

/**
 * How far round its orbit a body is `seconds` into the motion: it starts where its key puts
 * it, which is where the still picture draws it, and goes round once every `period` seconds.
 */
export function catOrbitTurn(start: number, seconds: number, period: number): number {
  "worklet";
  const turn = start + seconds / period;
  return turn - Math.floor(turn);
}

/** Where a sub-agent sits from its thread's moon, `turn` of the way round its little orbit. */
export function catSubagentOffset(
  tilt: number,
  turn: number,
): { readonly x: number; readonly y: number } {
  "worklet";
  const angle = turn * 2 * Math.PI;
  const flatX = CAT_SUBAGENT_ORBIT.radius * Math.cos(angle);
  const flatY = CAT_SUBAGENT_ORBIT.radius * Math.sin(angle) * CAT_ORBIT_SQUASH;
  const radians = (tilt * Math.PI) / 180;
  return {
    x: flatX * Math.cos(radians) - flatY * Math.sin(radians),
    y: flatX * Math.sin(radians) + flatY * Math.cos(radians),
  };
}

/**
 * The home list's scroll offset, for the row of cats at its top to stop moving once it is
 * scrolled out of sight. One per list; the list writes and the row reads.
 */
export interface HomeListScrollWatch {
  readonly note: (offset: number) => void;
  readonly offset: () => number;
  readonly subscribe: (onChange: () => void) => () => void;
}

export function createHomeListScrollWatch(): HomeListScrollWatch {
  let current = 0;
  const listeners = new Set<() => void>();
  return {
    note: (offset) => {
      if (offset === current) return;
      current = offset;
      for (const listener of listeners) listener();
    },
    offset: () => current,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

/** Where a stopped thread lies under the cat: the desktop's scatter, in the same place. */
export function catStoppedPoint(
  key: string,
  index: number,
  total: number,
): { readonly x: number; readonly y: number; readonly radius: number } {
  const { along, drift } = catFleetScatterOf(key, index, total);
  const angle = ((90 + along * SCATTER.arc) * Math.PI) / 180;
  const distance = CAT_HEAD.radius + SCATTER.size / 2 - SCATTER.overlap + drift * SCATTER.drift;
  return {
    x: CAT_HEAD.x + distance * Math.cos(angle),
    y: CAT_HEAD.y + distance * Math.sin(angle),
    radius: SCATTER.size / 2,
  };
}
