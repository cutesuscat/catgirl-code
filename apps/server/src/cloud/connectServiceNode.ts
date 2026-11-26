// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalFetch:off - Runs before the CLI and its Effect runtime load.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadlinePromises from "node:readline/promises";

import { prepareConnectService } from "./connectServiceStartup.ts";

function readFile(path: string): string | null {
  try {
    return NodeFS.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Written beside the server's other state, atomically, readable only by its owner. */
function writeFile(path: string, contents: string | null): void {
  if (contents === null) return NodeFS.rmSync(path, { force: true });
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, `${contents}\n`, { mode: 0o600 });
  NodeFS.renameSync(temporary, path);
}

async function ask(question: string): Promise<boolean> {
  const readline = NodeReadlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await readline.question(question).catch(() => "");
  readline.close();
  return /^y(es)?$/iu.test(answer.trim());
}

/** False when the command was handled here and the CLI should not run. */
export async function prepareConnectServiceForCli(): Promise<boolean> {
  const result = await prepareConnectService({
    argv: process.argv,
    env: process.env,
    homeDirectory: NodeOS.homedir(),
    readFile,
    writeFile,
    fetch: (url, init) => globalThis.fetch(url, init),
    now: () => new Date(),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask,
    print: (line) => console.log(line),
    warn: (line) => console.error(line),
  });
  if (result._tag === "Exit") {
    process.exitCode = result.code;
    return false;
  }
  process.argv.splice(0, process.argv.length, ...result.argv);
  return true;
}
