import { assert, it } from "@effect/vitest";

import { deferralRecord, updateDeferral } from "./catgirlDeferUpdate.ts";

const idle = { unknownMigrations: 0, runningThreads: 0, replaceRequested: false };

it("lets an idle server be replaced", () => {
  assert.isNull(updateDeferral(idle));
});

it("keeps a server that has threads running, and says how many", () => {
  assert.deepStrictEqual(updateDeferral({ ...idle, runningThreads: 3 }), {
    reason: "busy",
    runningThreads: 3,
  });
});

it("keeps a server it could not ask, rather than guess that it is idle", () => {
  assert.deepStrictEqual(updateDeferral({ ...idle, runningThreads: undefined }), {
    reason: "unknown",
  });
});

it("replaces a busy server once someone asked for exactly that", () => {
  assert.isNull(updateDeferral({ ...idle, runningThreads: 3, replaceRequested: true }));
  assert.isNull(updateDeferral({ ...idle, runningThreads: undefined, replaceRequested: true }));
});

it("never takes over a database a newer build wrote, even when asked to", () => {
  for (const replaceRequested of [false, true]) {
    assert.deepStrictEqual(
      updateDeferral({ unknownMigrations: 2, runningThreads: 0, replaceRequested }),
      { reason: "newer-database", migrations: 2 },
    );
  }
});

it("records the reason as one line of JSON for the launch to hand to its client", () => {
  const record = deferralRecord({ reason: "busy", runningThreads: 3 }, "0.1.12");
  assert.notInclude(record, "\n");
  assert.deepInclude(JSON.parse(record), {
    reason: "busy",
    runningThreads: 3,
    serverVersion: "0.1.12",
  });
});
