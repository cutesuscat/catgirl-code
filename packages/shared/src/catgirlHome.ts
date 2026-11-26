// @effect-diagnostics nodeBuiltinImport:off - Runs before any Effect runtime, in the server and the desktop app.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as HostProcess from "./HostProcess.ts";
import {
  HOME_MOVE_LOCK_SUFFIX,
  HOME_MOVE_LOCK_WAIT_SECONDS,
  HOME_MOVE_UNOWNED_LOOKS,
} from "./catgirlHomeScript.ts";
import { CATGIRL_HOME_DIR, LEGACY_HOME_DIR } from "./catgirlRelease.ts";

// The rule of catgirlHomeScript.ts in Node, under the same lock file as the shell function.

const entry = (file: string) => {
  try {
    return NodeFS.lstatSync(file);
  } catch {
    return undefined;
  }
};

/** Whether `legacy` still holds the home: a folder, or a link elsewhere, with nothing at `home`. */
const unmoved = (home: string, legacy: string) => {
  const old = entry(legacy);
  if (entry(home) !== undefined || old === undefined) return false;
  if (!old.isSymbolicLink()) return old.isDirectory();
  try {
    return NodePath.resolve(NodePath.dirname(legacy), NodeFS.readlinkSync(legacy)) !== home;
  } catch {
    return false;
  }
};

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `move` holding the lock the shell function takes too; false when the lock stays taken. */
function withMoveLock(lock: string, waitMs: number, move: () => void): boolean {
  const PAUSE_MS = 200;
  let unowned = 0;
  for (let waited = 0; ; waited += PAUSE_MS) {
    try {
      NodeFS.writeFileSync(lock, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) return false;
    }
    let owner = "";
    try {
      owner = NodeFS.readFileSync(lock, "utf8").trim();
    } catch {}
    unowned = owner === "" ? unowned + 1 : 0;
    if (owner === "" ? unowned >= HOME_MOVE_UNOWNED_LOOKS : !isAlive(Number(owner))) {
      NodeFS.rmSync(lock, { force: true });
      continue;
    }
    if (waited >= waitMs) return false;
    pause(PAUSE_MS);
  }
  try {
    move();
  } finally {
    NodeFS.rmSync(lock, { force: true });
  }
  return true;
}

function moveOnce(homeDir: string, home: string, legacy: string): void {
  if (!unmoved(home, legacy)) return;
  // A junction is the link Windows lets anyone make; it needs an absolute target. Untested.
  const type = HostProcess.Platform.defaultValue() === "win32" ? "junction" : undefined;
  if (entry(legacy)?.isSymbolicLink()) {
    const target = NodeFS.readlinkSync(legacy);
    NodeFS.symlinkSync(type ? NodePath.resolve(homeDir, target) : target, home, type);
    return;
  }
  NodeFS.renameSync(legacy, home);
  NodeFS.symlinkSync(type ? home : CATGIRL_HOME_DIR, legacy, type);
}

/**
 * The default home in `homeDir`: `~/.catcode`, after moving an older `~/.t3` there. If the move
 * cannot happen (the lock stays taken, the rename fails), the old home is returned and used as it
 * is, so no empty `~/.catcode` ever hides it. `move: false` only chooses, for another user's home.
 */
export function resolveCatgirlHome(
  homeDir: string,
  options: { readonly move?: boolean; readonly lockWaitMs?: number } = {},
): string {
  const home = NodePath.join(homeDir, CATGIRL_HOME_DIR);
  const legacy = NodePath.join(homeDir, LEGACY_HOME_DIR);
  if (options.move !== false && unmoved(home, legacy)) {
    try {
      withMoveLock(
        `${home}${HOME_MOVE_LOCK_SUFFIX}`,
        options.lockWaitMs ?? HOME_MOVE_LOCK_WAIT_SECONDS * 1000,
        () => moveOnce(homeDir, home, legacy),
      );
    } catch {}
  }
  return unmoved(home, legacy) ? legacy : home;
}

/** Whether two homes are one folder, such as `~/.t3` and `~/.catcode` after the move. */
export function isSameHome(left: string, right: string): boolean {
  const real = (dir: string) => {
    try {
      return NodeFS.realpathSync(dir);
    } catch {
      return NodePath.resolve(dir);
    }
  };
  return real(left) === real(right);
}
