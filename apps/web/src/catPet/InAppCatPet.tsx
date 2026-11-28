import type { CatPetStatus, CatPetThread } from "@t3tools/contracts";
import {
  CAT_PET_DONE_LOOPS,
  CAT_PET_KIND_LABELS,
  CAT_PET_SLEEP_AFTER_MS,
  catPetDisplayWidth,
  catPetHeadline,
  catPetLoopDuration,
  catPetOfflineLine,
  isCatPetBusy,
  resolveCatPetState,
} from "@t3tools/shared/catPetSprite";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isElectron } from "../env";
import { useClientSettings } from "../hooks/useSettings";
import { CatPetSprite } from "./CatPetSprite";
import { getCatPetSnapshot, subscribeCatPetSnapshot } from "./catPetStore";
import { useCatPetChoices } from "./useCatPets";

const POSITION_KEY = "catgirl:in-app-pet-position";

function readPosition(): { right: number; bottom: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null") as unknown;
    if (typeof raw === "object" && raw !== null && "right" in raw && "bottom" in raw) {
      const { right, bottom } = raw as { right: unknown; bottom: unknown };
      if (typeof right === "number" && typeof bottom === "number") return { right, bottom };
    }
  } catch {}
  return { right: 24, bottom: 24 };
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

/**
 * The pet inside the app window, where a floating one can't work: the browser build, Wayland,
 * or when she picks it. Same art and moods; drag it within the window.
 */
export function InAppCatPet() {
  const settings = useClientSettings((s) => s.catPet);
  const snapshot = useSyncExternalStore(subscribeCatPetSnapshot, getCatPetSnapshot);
  const systemReduced = useReducedMotion();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CatPetStatus | null>(null);
  const [hover, setHover] = useState(false);
  const [held, setHeld] = useState(false);
  const [position, setPosition] = useState(readPosition);
  const [celebrating, setCelebrating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const drag = useRef<{
    x: number;
    y: number;
    right: number;
    bottom: number;
    moved: boolean;
  } | null>(null);
  const lastSeq = useRef<number | null>(null);
  const pets = useCatPetChoices(isElectron && settings.customPets);
  const pet = pets?.find((choice) => choice.id === settings.petId) ?? pets?.[0] ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Asks the desktop app whether the floating pet works here (not on Wayland).
  useEffect(() => {
    const bridge = window.catgirlPet;
    if (bridge === undefined || !settings.enabled) return;
    let cancelled = false;
    void bridge
      .getStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A finished run plays done a few times; the timer that ends it is an outside clock.
  useEffect(() => {
    const seq = snapshot?.celebrateSeq ?? null;
    if (seq === null) return;
    const previous = lastSeq.current;
    lastSeq.current = seq;
    if (previous === null || seq <= previous || pet === null) return;
    const ms = catPetLoopDuration(pet.spec.animations.done) * CAT_PET_DONE_LOOPS;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), ms);
    return () => window.clearTimeout(timer);
  }, [snapshot?.celebrateSeq, pet]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Wakes once when ten idle minutes are up, to show her asleep.
  useEffect(() => {
    const idleSince = snapshot?.mood === "idle" ? snapshot.idleSince : null;
    if (idleSince === null) return;
    const wait = idleSince + CAT_PET_SLEEP_AFTER_MS - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), wait + 50);
    return () => window.clearTimeout(timer);
  }, [snapshot?.mood, snapshot?.idleSince]);

  const inApp =
    settings.enabled &&
    (!isElectron || settings.placement === "in-app" || status?.placement === "in-app");
  if (!inApp || pet === null) return null;

  const state = resolveCatPetState({
    mood: snapshot?.mood ?? "idle",
    held,
    celebrating,
    appClosed: false,
    idleSince: snapshot?.idleSince ?? null,
    now,
  });
  if (settings.showWhen === "busy" && !isCatPetBusy(state)) return null;
  const reduced = settings.motion === "reduced" || (settings.motion === "system" && systemReduced);
  const width = catPetDisplayWidth(settings.size, pet.spec.imageRendering);
  const threads = snapshot?.threads ?? [];
  const open = (thread: CatPetThread) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: thread.environmentId, threadId: thread.threadId },
    });

  return (
    <div
      className="pointer-events-none fixed z-40 flex flex-col items-end gap-1.5"
      style={{ right: position.right, bottom: position.bottom }}
      aria-hidden
    >
      {hover && !held ? (
        <div className="pointer-events-auto w-72 rounded-xl border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
          <p className="mb-1 font-semibold">
            {catPetHeadline(snapshot, { appClosed: false, now: new Date(now) })}
          </p>
          {settings.showTitles
            ? threads.slice(0, 3).map((thread) => (
                <button
                  key={`${thread.environmentId}:${thread.threadId}`}
                  type="button"
                  tabIndex={-1}
                  onClick={() => open(thread)}
                  className="flex w-full gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-accent"
                >
                  <span className="font-semibold">{CAT_PET_KIND_LABELS[thread.kind]}</span>
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                  <span className="text-muted-foreground">{thread.machine}</span>
                </button>
              ))
            : null}
          {catPetOfflineLine(snapshot) !== null ? (
            <p className="mt-1 text-muted-foreground">{catPetOfflineLine(snapshot)}</p>
          ) : null}
        </div>
      ) : null}
      <div
        className="pointer-events-auto relative cursor-pointer touch-none transition-opacity duration-200"
        // Faded while nothing draws her attention; full when hovered, held or asking for you.
        style={
          hover || held || snapshot?.mood === "needs-you"
            ? undefined
            : { opacity: settings.opacity / 100 }
        }
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, ...position, moved: false };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start === null) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (!start.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          start.moved = true;
          setHeld(true);
          setPosition({
            right: Math.max(0, Math.min(window.innerWidth - width, start.right - dx)),
            bottom: Math.max(0, Math.min(window.innerHeight - width, start.bottom - dy)),
          });
        }}
        onPointerUp={() => {
          const start = drag.current;
          drag.current = null;
          setHeld(false);
          if (start?.moved === true) {
            try {
              localStorage.setItem(POSITION_KEY, JSON.stringify(position));
            } catch {}
            return;
          }
          const urgent = threads.find((thread) => thread.kind !== "working");
          if (urgent !== undefined) open(urgent);
        }}
      >
        <CatPetSprite
          spec={pet.spec}
          sheetUrl={pet.sheetUrl}
          state={state}
          width={width}
          reduced={reduced}
        />
        {(snapshot?.unreadDone ?? 0) > 0 && state !== "done" ? (
          <span className="absolute top-[10%] right-[14%] size-2.5 rounded-full bg-primary ring-2 ring-background" />
        ) : null}
      </div>
    </div>
  );
}
