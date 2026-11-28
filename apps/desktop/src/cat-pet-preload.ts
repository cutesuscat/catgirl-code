// @effect-diagnostics globalTimers:off globalDate:off -- The pet page steps frames and hover delays with plain timers.
import { ipcRenderer } from "electron";
import type { CatPetSnapshot, CatPetThread } from "@t3tools/contracts";
import {
  CAT_PET_KIND_LABELS,
  CatPetPlayer,
  catPetHeadline,
  catPetOfflineLine,
  type CatPetAnimation,
} from "@t3tools/shared/catPetSprite";

import {
  CAT_PET_PAGE_CHANNEL,
  CAT_PET_RENDER_CHANNEL,
  type CatPetPageMessage,
  type CatPetRenderMessage,
} from "./catPet/catPetChannels.ts";

const send = (message: CatPetPageMessage) => ipcRenderer.send(CAT_PET_PAGE_CHANNEL, message);
const SHADOW = 8;
const HOVER_IN_MS = 300;
const HOVER_OUT_MS = 400;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

window.addEventListener("DOMContentLoaded", () => {
  const pet = document.getElementById("pet")!;
  const sheet = document.getElementById("sheet") as HTMLImageElement;
  const panel = document.getElementById("panel")!;
  const chev = document.getElementById("chev")!;
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  let current: CatPetRenderMessage | null = null;
  let art: NonNullable<CatPetRenderMessage["pet"]> | null = null;
  let playingKey = "";
  let scale = 1;
  let pointerOver = false;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let hovering = false;
  let reportedPanel = "";

  const player = new CatPetPlayer(
    {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (h) => clearTimeout(h as never),
    },
    (animation: CatPetAnimation, frame: number) => {
      if (art === null) return;
      const x = -Math.round(frame * art.spec.cell.width * scale);
      const y = -Math.round(animation.row * art.spec.cell.height * scale);
      sheet.style.transform = `translate(${x}px, ${y}px)`;
    },
  );

  const openThread = (thread: CatPetThread) =>
    send({ type: "open", environmentId: thread.environmentId, threadId: thread.threadId });

  const threadRow = (thread: CatPetThread) => {
    const row = element("li", `row k-${thread.kind}`);
    row.tabIndex = 0;
    row.append(
      element("span", "kind", CAT_PET_KIND_LABELS[thread.kind]),
      element("span", "title", thread.title === "" ? "Thread" : thread.title),
      element("span", "machine", thread.machine),
    );
    row.addEventListener("click", () => openThread(thread));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openThread(thread);
    });
    return row;
  };

  const buildPanel = (render: CatPetRenderMessage) => {
    const snapshot: CatPetSnapshot | null = render.snapshot;
    panel.replaceChildren();
    panel.append(
      element("h1", "", catPetHeadline(snapshot, { appClosed: render.appClosed, now: new Date() })),
    );
    const threads = snapshot?.threads ?? [];
    if (render.panel === "bubble") {
      const shown = threads.filter((thread) => thread.title !== "").slice(0, 3);
      if (shown.length > 0) {
        const rows = element("ul", "rows");
        rows.append(...shown.map(threadRow));
        panel.append(rows);
      }
    } else {
      const groups: Array<[string, readonly CatPetThread["kind"][]]> = [
        ["Needs you", ["approval", "input", "request"]],
        ["Stopped", ["limited", "failed"]],
        ["Working", ["working"]],
        ["Recently finished", ["done"]],
      ];
      for (const [label, kinds] of groups) {
        const inGroup = threads.filter((thread) => kinds.includes(thread.kind));
        if (inGroup.length === 0) continue;
        const rows = element("ul", "rows");
        rows.append(...inGroup.map(threadRow));
        panel.append(element("div", "section", label), rows);
      }
      if (threads.length === 0) panel.append(element("div", "sub", "Nothing needs you right now."));
    }
    const offline = catPetOfflineLine(snapshot);
    if (offline !== null) panel.append(element("div", "offline", offline));
    if (render.panel === "tray") {
      const actions = element("div", "actions");
      const newChat = element("button", "", "＋ New chat");
      newChat.addEventListener("click", () => send({ type: "new-thread" }));
      const open = element("button", "", "Open app");
      open.addEventListener("click", () => send({ type: "open" }));
      actions.append(newChat, open);
      panel.append(actions, element("div", "hint", "Arrow keys move her · Esc puts her back"));
    }
  };

  const reduced = (render: CatPetRenderMessage) =>
    render.motion === "reduced" ||
    (render.motion === "system" && reducedQuery.matches) ||
    (render.stillWhenIdle && render.state === "idle");

  const apply = (render: CatPetRenderMessage) => {
    current = render;
    if (render.pet !== null && render.pet !== art) {
      art = render.pet;
      sheet.src = art.sheetUrl;
      playingKey = "";
    }
    if (art === null) return;
    scale = render.petSize.width / art.spec.cell.width;
    pet.style.left = `${render.layout.pet.x}px`;
    pet.style.top = `${render.layout.pet.y}px`;
    pet.style.width = `${render.petSize.width}px`;
    pet.style.height = `${render.petSize.height}px`;
    sheet.style.width = `${Math.round(art.sheetWidth * scale)}px`;
    sheet.style.height = `${Math.round(art.sheetHeight * scale)}px`;
    sheet.classList.toggle("pixelated", art.spec.imageRendering === "pixelated");
    const animation = art.spec.animations[render.state];
    pet.classList.toggle("dim", animation.dim === true);
    pet.classList.toggle("held", render.state === "held");
    pet.classList.toggle(
      "unread",
      (render.snapshot?.unreadDone ?? 0) > 0 && render.state !== "done",
    );

    document.body.classList.toggle("bubble", render.panel === "bubble");
    document.body.classList.toggle("tray", render.panel === "tray");
    if (render.panel !== "none") {
      buildPanel(render);
      const box = {
        width: panel.offsetWidth + SHADOW * 2,
        height: panel.offsetHeight + SHADOW * 2,
      };
      const key = `${box.width}x${box.height}`;
      if (key !== reportedPanel) {
        reportedPanel = key;
        send({ type: "panel-size", ...box });
      }
      if (render.layout.panel !== null) {
        panel.style.left = `${render.layout.panel.x + SHADOW}px`;
        panel.style.top = `${render.layout.panel.y + SHADOW}px`;
      }
      if (render.panel === "tray" && !panel.contains(document.activeElement)) panel.focus();
    } else {
      reportedPanel = "";
    }

    const key = `${art.spec.id}|${render.state}|${reduced(render)}|${render.paused}`;
    if (key === playingKey) return;
    playingKey = key;
    if (render.paused) player.stop();
    else player.play(animation, { reduced: reduced(render) });
  };

  ipcRenderer.on(CAT_PET_RENDER_CHANNEL, (_event, render: CatPetRenderMessage) => apply(render));
  reducedQuery.addEventListener("change", () => {
    if (current !== null) {
      playingKey = "";
      apply(current);
    }
  });

  const setHover = (on: boolean) => {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(
      () => {
        hoverTimer = null;
        if (on === hovering) return;
        hovering = on;
        send({ type: "hover", on });
      },
      on ? HOVER_IN_MS : HOVER_OUT_MS,
    );
  };
  for (const target of [pet, panel]) {
    target.addEventListener("pointerenter", () => setHover(true));
    target.addEventListener("pointerleave", () => setHover(false));
  }

  // macOS and Windows forward moves over the transparent window; only the pet and its panel are solid.
  document.addEventListener("mousemove", (event) => {
    if (current?.clickThrough !== true) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const over = hit !== null && (pet.contains(hit) || panel.contains(hit));
    if (over === pointerOver) return;
    pointerOver = over;
    send({ type: "pointer", over });
  });

  pet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target === chev) return;
    pet.setPointerCapture(event.pointerId);
    send({ type: "press" });
  });
  pet.addEventListener("pointerup", (event) => {
    if (event.button !== 0 || event.target === chev) return;
    send({ type: "release" });
  });
  pet.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    send({ type: "menu" });
  });
  chev.addEventListener("pointerdown", (event) => event.stopPropagation());
  chev.addEventListener("click", () => send({ type: "tray", open: current?.panel !== "tray" }));

  panel.tabIndex = -1;
  document.addEventListener("keydown", (event) => {
    if (current?.panel !== "tray") return;
    const step = event.shiftKey ? 32 : 8;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      send({ type: "nudge", dx: move[0], dy: move[1] });
    } else if (event.key === "Escape") {
      event.preventDefault();
      send({ type: "reset-position" });
    }
  });
  window.addEventListener("blur", () => {
    if (current?.panel === "tray") send({ type: "tray", open: false });
  });

  send({ type: "ready" });
});
