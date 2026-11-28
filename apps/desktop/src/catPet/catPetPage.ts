/** The pet window's page: markup and styles only. Its logic lives in the sandboxed cat-pet preload. */
export const CAT_PET_WINDOW_TITLE = "Catgirl Code Pet";

export function catPetPageHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${CAT_PET_WINDOW_TITLE}</title><style>
:root { color-scheme: light dark; --base: #fffaf3; --text: #3a2418; --muted: #8a6a58; --line: #ead8c6;
  --row: #f6eadc; --accent: #e9822b; --dot: #e9822b; --warn: #c9821b; --bad: #c8413b; --ok: #3d9a5d; }
@media (prefers-color-scheme: dark) { :root { --base: #2a211c; --text: #f6eee7; --muted: #bba393;
  --line: #4a3a31; --row: #3a2e27; --accent: #f3a259; --dot: #f3a259; } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
body { color: var(--text); font: 12px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, sans-serif;
  user-select: none; -webkit-user-select: none; }
#pet { position: absolute; cursor: pointer; touch-action: none; }
#pet.held { cursor: grabbing; }
#sprite { position: absolute; inset: 0; overflow: hidden; }
#sheet { position: absolute; left: 0; top: 0; max-width: none; pointer-events: none; will-change: transform; }
#sheet.pixelated { image-rendering: pixelated; }
#pet.dim #sheet { opacity: 0.72; filter: saturate(0.7); }
#z { position: absolute; right: 18%; top: 8%; font: 700 15px/1 ui-rounded, sans-serif; color: var(--muted);
  display: none; }
#pet.dim #z { display: block; }
#dot { position: absolute; right: 14%; top: 10%; width: 10px; height: 10px; border-radius: 50%;
  background: var(--dot); box-shadow: 0 0 0 2px var(--base); display: none; }
#pet.unread #dot { display: block; }
#chev { position: absolute; right: 2px; bottom: 2px; width: 22px; height: 22px; border: 1px solid var(--line);
  border-radius: 50%; background: var(--base); color: var(--text); font: 700 12px/1 sans-serif; padding: 0;
  cursor: pointer; opacity: 0; transition: opacity 120ms; }
#pet:hover #chev, #chev:focus-visible, body.tray #chev { opacity: 1; }
#panel { position: absolute; width: 280px; padding: 10px 10px 8px; border: 1px solid var(--line); border-radius: 14px;
  background: var(--base); box-shadow: 0 6px 22px rgba(40, 20, 10, 0.18); display: none; }
body.bubble #panel, body.tray #panel { display: block; }
#panel h1 { margin: 0 0 6px; font-size: 12px; font-weight: 650; }
#panel .sub { color: var(--muted); }
.rows { margin: 4px 0 0; padding: 0; list-style: none; }
.row { display: flex; gap: 6px; align-items: baseline; padding: 4px 6px; border-radius: 8px; cursor: pointer; }
.row:hover, .row:focus-visible { background: var(--row); outline: none; }
.row .kind { flex: none; font-weight: 600; }
.row .title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.row .machine { flex: none; color: var(--muted); max-width: 90px; overflow: hidden; white-space: nowrap;
  text-overflow: ellipsis; }
.k-approval .kind, .k-input .kind, .k-request .kind { color: var(--accent); }
.k-limited .kind { color: var(--warn); }
.k-failed .kind { color: var(--bad); }
.k-done .kind { color: var(--ok); }
.k-working .kind { color: var(--muted); }
.section { margin-top: 6px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.offline { margin-top: 6px; color: var(--muted); }
.actions { display: flex; gap: 6px; margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
.actions button { flex: 1; font: inherit; color: inherit; background: var(--row); border: 0; border-radius: 8px;
  padding: 5px 8px; cursor: pointer; }
.actions button:focus-visible { outline: 2px solid var(--accent); }
.hint { margin-top: 6px; color: var(--muted); font-size: 11px; }
</style></head><body aria-hidden="true">
<div id="panel"></div>
<div id="pet"><div id="sprite"><img id="sheet" alt="" draggable="false"></div><span id="z">z</span>
<span id="dot"></span><button id="chev" tabindex="-1" aria-label="Activity">▾</button></div>
</body></html>`;
}
