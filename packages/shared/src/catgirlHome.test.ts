// @effect-diagnostics nodeBuiltinImport:off - Moves real folders in temporary homes and runs sh.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { isSameHome, resolveCatgirlHome } from "./catgirlHome.ts";
import * as HostProcess from "./HostProcess.ts";
import { CATGIRL_HOME_SHELL_FUNCTION } from "./catgirlHomeScript.ts";

const homes: Array<string> = [];
afterEach(() => {
  for (const home of homes.splice(0)) NodeFS.rmSync(home, { recursive: true, force: true });
});

/** A person's home with `layout` in it: `t3` a folder with data, a link, or nothing. */
const makeHome = (layout: "folder" | "nothing" | { readonly link: string }) => {
  const home = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cg-home-")));
  homes.push(home);
  if (layout === "folder") {
    NodeFS.mkdirSync(NodePath.join(home, ".t3/userdata"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(home, ".t3/userdata/state.sqlite"), "threads");
    NodeFS.mkdirSync(NodePath.join(home, ".t3/worktrees/repo/branch"), { recursive: true });
  } else if (layout !== "nothing") {
    NodeFS.symlinkSync(layout.link, NodePath.join(home, ".t3"));
  }
  return home;
};

const kind = (file: string) => {
  try {
    const info = NodeFS.lstatSync(file);
    return info.isSymbolicLink()
      ? `link:${NodeFS.readlinkSync(file)}`
      : info.isDirectory()
        ? "folder"
        : "file";
  } catch {
    return "missing";
  }
};

const layoutOf = (home: string) => ({
  catcode: kind(NodePath.join(home, ".catcode")),
  t3: kind(NodePath.join(home, ".t3")),
});

const deadPid = () => NodeChildProcess.spawnSync("true").pid ?? 999_999;

/** The shell function in `home`; `sleep` returns at once, so a lock that stays taken costs no time. */
const shellHome = (home: string) => {
  const bin = NodePath.join(home, "test-bin");
  NodeFS.mkdirSync(bin, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const result = NodeChildProcess.spawnSync(
    "sh",
    ["-c", `${CATGIRL_HOME_SHELL_FUNCTION}\nset -eu\ncatgirl_home`],
    { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout.trim();
};

const movers = {
  node: (home: string) => resolveCatgirlHome(home),
  shell: shellHome,
};

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "moving ~/.t3 to ~/.catcode",
  () => {
    describe.each(Object.entries(movers))("%s", (name, move) => {
      it("renames a folder once and leaves a relative link where it was", () => {
        const home = makeHome("folder");
        const before = NodeFS.statSync(NodePath.join(home, ".t3/userdata/state.sqlite")).ino;
        expect(move(home)).toBe(NodePath.join(home, ".catcode"));
        expect(layoutOf(home)).toEqual({ catcode: "folder", t3: "link:.catcode" });
        // The same file through both paths: renamed, never copied.
        for (const path of [".t3/userdata/state.sqlite", ".catcode/userdata/state.sqlite"]) {
          expect(NodeFS.readFileSync(NodePath.join(home, path), "utf8")).toBe("threads");
          expect(NodeFS.statSync(NodePath.join(home, path)).ino).toBe(before);
        }
        expect(NodeFS.existsSync(NodePath.join(home, ".t3/worktrees/repo/branch"))).toBe(true);
        expect(isSameHome(NodePath.join(home, ".t3"), NodePath.join(home, ".catcode"))).toBe(true);
        expect(move(home)).toBe(NodePath.join(home, ".catcode"));
        expect(layoutOf(home)).toEqual({ catcode: "folder", t3: "link:.catcode" });
        expect(NodeFS.readdirSync(home).filter((file) => file.includes("lock"))).toEqual([]);
      });

      it("links the new home to a linked old home's target and leaves the old link", () => {
        const home = makeHome({ link: "shared/t3" });
        NodeFS.mkdirSync(NodePath.join(home, "shared/t3"), { recursive: true });
        expect(move(home)).toBe(NodePath.join(home, ".catcode"));
        expect(layoutOf(home)).toEqual({ catcode: "link:shared/t3", t3: "link:shared/t3" });
      });

      it("links to a shared target that does not exist yet", () => {
        const home = makeHome({ link: "/nonexistent/nfs/t3" });
        expect(move(home)).toBe(NodePath.join(home, ".catcode"));
        expect(layoutOf(home)).toEqual({
          catcode: "link:/nonexistent/nfs/t3",
          t3: "link:/nonexistent/nfs/t3",
        });
      });

      it("leaves a home that was moved before, or that has both", () => {
        const moved = makeHome({ link: ".catcode" });
        NodeFS.mkdirSync(NodePath.join(moved, ".catcode"));
        expect(move(moved)).toBe(NodePath.join(moved, ".catcode"));
        expect(layoutOf(moved)).toEqual({ catcode: "folder", t3: "link:.catcode" });

        const both = makeHome("folder");
        NodeFS.mkdirSync(NodePath.join(both, ".catcode"));
        expect(move(both)).toBe(NodePath.join(both, ".catcode"));
        expect(layoutOf(both)).toEqual({ catcode: "folder", t3: "folder" });
      });

      it("creates nothing in a home that has neither", () => {
        const home = makeHome("nothing");
        expect(move(home)).toBe(NodePath.join(home, ".catcode"));
        expect(layoutOf(home)).toEqual({ catcode: "missing", t3: "missing" });
        // A link to the new home whose folder was removed points nowhere to move.
        const dangling = makeHome({ link: ".catcode" });
        expect(move(dangling)).toBe(NodePath.join(dangling, ".catcode"));
        expect(layoutOf(dangling)).toEqual({ catcode: "missing", t3: "link:.catcode" });
      });

      it("keeps using the old home while another mover holds the lock", () => {
        const home = makeHome("folder");
        NodeFS.writeFileSync(NodePath.join(home, ".catcode.move-lock"), `${process.pid}\n`);
        const chosen =
          name === "node" ? resolveCatgirlHome(home, { lockWaitMs: 400 }) : shellHome(home);
        // Never an empty ~/.catcode beside an unmoved ~/.t3: that would hide the threads.
        expect(chosen).toBe(NodePath.join(home, ".t3"));
        expect(layoutOf(home)).toEqual({ catcode: "missing", t3: "folder" });
      });

      it("takes over a lock whose owner is gone", () => {
        const home = makeHome("folder");
        NodeFS.writeFileSync(NodePath.join(home, ".catcode.move-lock"), `${deadPid()}\n`);
        expect(move(home)).toBe(NodePath.join(home, ".catcode"));
        expect(layoutOf(home)).toEqual({ catcode: "folder", t3: "link:.catcode" });
      });
    });

    it("only chooses in another user's home", () => {
      const home = makeHome("folder");
      expect(resolveCatgirlHome(home, { move: false })).toBe(NodePath.join(home, ".t3"));
      expect(layoutOf(home)).toEqual({ catcode: "missing", t3: "folder" });
    });

    it("moves once when shell and Node movers start together", async () => {
      const module = NodeURL.fileURLToPath(new URL("./catgirlHome.ts", import.meta.url));
      const node = `import { resolveCatgirlHome } from ${JSON.stringify(module)};
process.stdout.write(resolveCatgirlHome(process.env.HOME));`;
      // A sh mover that finds the lock taken waits a second a time; here a twentieth, which is
      // still far longer than the lock is held.
      const bin = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cg-sleep-"));
      homes.push(bin);
      NodeFS.writeFileSync(NodePath.join(bin, "sleep"), "#!/bin/sh\nexec /bin/sleep 0.05\n", {
        mode: 0o755,
      });
      const run = (home: string, command: string, args: ReadonlyArray<string>) =>
        new Promise<string>((resolve, reject) => {
          const child = NodeChildProcess.spawn(command, args, {
            env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
          });
          let out = "";
          child.stdout.on("data", (chunk) => (out += chunk));
          child.on("error", reject);
          child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(out))));
        });
      for (let round = 0; round < 5; round++) {
        const home = makeHome("folder");
        const shell = () => run(home, "sh", ["-c", `${CATGIRL_HOME_SHELL_FUNCTION}\ncatgirl_home`]);
        const viaNode = () => run(home, process.execPath, ["--input-type=module", "-e", node]);
        const chosen = await Promise.all([shell(), shell(), shell(), viaNode(), viaNode()]);
        expect(new Set(chosen)).toEqual(new Set([NodePath.join(home, ".catcode")]));
        expect(layoutOf(home)).toEqual({ catcode: "folder", t3: "link:.catcode" });
        expect(NodeFS.readdirSync(NodePath.join(home, ".catcode")).sort()).toEqual([
          "userdata",
          "worktrees",
        ]);
        expect(NodeFS.readFileSync(NodePath.join(home, ".t3/userdata/state.sqlite"), "utf8")).toBe(
          "threads",
        );
      }
    });
  },
);
