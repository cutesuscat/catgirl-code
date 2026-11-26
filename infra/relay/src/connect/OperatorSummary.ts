import type { SummaryRow } from "./CollectStore.ts";
import { RETENTION_DAYS } from "./CollectStore.ts";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const KIND_LABELS: Readonly<Record<SummaryRow["kind"], string>> = {
  analytics: "Usage",
  logs: "Crash report or log",
  traces: "Trace",
  metrics: "Metric",
};

/** The operator's page: counts per day, kind, event and app version. Nothing per install. */
export function renderSummaryPage(input: {
  readonly serviceName: string;
  readonly relayUrl: string;
  readonly fingerprint: string;
  readonly generatedAt: string;
  readonly rows: ReadonlyArray<SummaryRow>;
}): string {
  const days = new Map<string, Array<SummaryRow>>();
  for (const row of input.rows) {
    const list = days.get(row.day) ?? [];
    list.push(row);
    days.set(row.day, list);
  }
  const total = input.rows.reduce((sum, row) => sum + row.events, 0);
  const sections = [...days.entries()]
    .map(([day, rows]) => {
      const dayTotal = rows.reduce((sum, row) => sum + row.events, 0);
      const body = rows
        .map(
          (row) =>
            `<tr><td>${escapeHtml(KIND_LABELS[row.kind])}</td><td><code>${escapeHtml(row.event)}</code></td>` +
            `<td>${row.appVersion === "" ? "<span class=muted>unknown</span>" : escapeHtml(row.appVersion)}</td>` +
            `<td class=num>${row.events}</td><td class=num>${row.installs}</td></tr>`,
        )
        .join("");
      return (
        `<section><h2>${escapeHtml(day)} <span class=muted>${dayTotal} ${dayTotal === 1 ? "record" : "records"}</span></h2>` +
        `<table><thead><tr><th>Kind</th><th>Event</th><th>App version</th><th class=num>Records</th><th class=num>Installs</th></tr></thead>` +
        `<tbody>${body}</tbody></table></section>`
      );
    })
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(input.serviceName)}: collected data</title>
<style>
:root{color-scheme:light dark;--bg:#fbf8f4;--fg:#2b2622;--muted:#7a6f66;--line:#e6ddd4;--accent:#c4612f}
@media (prefers-color-scheme:dark){:root{--bg:#1d1916;--fg:#f1e9e1;--muted:#a3968b;--line:#3a322c;--accent:#f08a52}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}
.muted{color:var(--muted);font-weight:400}code{font:13px ui-monospace,monospace}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}.num{text-align:right}
.facts{display:flex;flex-wrap:wrap;gap:8px 24px;margin:12px 0 0;color:var(--muted)}.facts b{color:var(--fg);font-weight:600}
.empty{margin-top:32px;padding:24px;border:1px dashed var(--line);border-radius:8px;color:var(--muted)}
.wrap{overflow-x:auto}
</style></head><body><main>
<h1>${escapeHtml(input.serviceName)}</h1>
<div class=muted>Usage data and crash reports sent by people who turned them on. Only for the operator.</div>
<div class=facts><span>Instance <b>${escapeHtml(input.relayUrl)}</b></span><span>Key <b>${escapeHtml(input.fingerprint)}</b></span>
<span>Kept <b>${RETENTION_DAYS} days</b></span><span>Records <b>${total}</b></span><span>As of <b>${escapeHtml(input.generatedAt)}</b></span></div>
<div class=wrap>${sections === "" ? "<div class=empty>Nothing has been collected in the last 30 days.</div>" : sections}</div>
</main></body></html>`;
}
