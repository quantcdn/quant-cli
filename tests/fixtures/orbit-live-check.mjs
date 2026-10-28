// Live checklist for an Orbit KV v2 site. Usage: ORBIT_KEY=... node orbit-live-check.mjs <origin>
const origin = process.argv[2].replace(/\/$/, "");
const key = process.env.ORBIT_KEY;
const results = [];
let cookie = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => crypto.randomUUID();
async function call(method, path, body, headers = {}) {
  const res = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie") || "";
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, setCookie };
}
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
async function until(fn, ms = 180000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last.done) return last; await sleep(5000); }
  return last;
}
const stamp = Date.now().toString(36);
const base = { description: "Live KV v2 check", owner: "Live Checker", status: "planned", priority: "medium", progress: 0, due: "" };

// Sign in
let r = await call("POST", "/api/session", { accessKey: key });
// Production (https) uses __Host-orbit; quant serve (http) gets orbit-local.
cookie = (r.setCookie.match(/((?:__Host-orbit|orbit-local)=[a-f0-9]{64})/) || [])[1] || "";
check("sign in", r.status === 200 && cookie, `status ${r.status}`);
r = await call("GET", "/api/session");
check("session has settingsVersion", r.status === 200 && "settingsVersion" in r.json, JSON.stringify(r.json?.user));
const settingsVersion = r.json?.settingsVersion ?? null;

// Indexes active? summary is a count on projectsByStatus
const t0 = Date.now();
const summary0 = await until(async () => { const s = await call("GET", "/api/projects/summary"); return { done: s.status === 200, s }; });
check("summary (count index) answers", summary0.s.status === 200, `${summary0.s.status} after ${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(summary0.s.json)}`);
const before = summary0.s.json?.counts || {};

// Create
const name = `Live check ${stamp}`;
const createId = rid();
r = await call("POST", "/api/projects", { ...base, name }, { "X-Request-Id": createId });
check("create (atomic + ifAbsent)", r.status === 201 && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(r.json?.project?.version || ""), `status ${r.status} version ${r.json?.project?.version}`);
const p = r.json?.project;
// Create retry with the same request id returns the stored project
r = await call("POST", "/api/projects", { ...base, name }, { "X-Request-Id": createId });
check("create retry with same X-Request-Id returns the stored project", (r.status === 201 || r.status === 200) && r.json?.project?.id === p?.id, `status ${r.status} ${r.json?.error || ""}`);
// Duplicate name (case and space variant)
r = await call("POST", "/api/projects", { ...base, name: `  ${name.toUpperCase()} ` }, { "X-Request-Id": rid() });
check("duplicate name refused (unique index)", r.status === 409 && /already exists/.test(r.json?.error || ""), `status ${r.status} ${r.json?.error}`);

// Update with version, then stale update
r = await call("PATCH", `/api/projects/${p.id}`, { ...base, name, status: "active", progress: 40, version: p.version }, { "X-Request-Id": rid() });
check("edit with current version", r.status === 200 && r.json?.project?.version !== p.version, `status ${r.status}`);
const v2 = r.json?.project?.version;
r = await call("PATCH", `/api/projects/${p.id}`, { ...base, name, status: "complete", version: p.version }, { "X-Request-Id": rid() });
check("stale edit refused (ifVersion)", r.status === 409 && /Someone else changed/.test(r.json?.error || "") && r.json?.currentVersion === v2, `status ${r.status} currentVersion ${r.json?.currentVersion === v2 ? "matches" : r.json?.currentVersion}`);
r = await call("PATCH", `/api/projects/${p.id}`, { ...base, name, status: "active" });
check("edit without version refused (400)", r.status === 400, `status ${r.status} ${r.json?.error}`);
r = await call("PATCH", `/api/projects/${p.id}`, { ...base, name: "bad\u0000name", status: "active", version: v2 });
check("control character refused (400)", r.status === 400, `status ${r.status} ${r.json?.error}`);

// Filters (index lists, eventual)
const byStatus = await until(async () => { const s = await call("GET", "/api/projects?status=active"); return { done: s.json?.projects?.some((x) => x.id === p.id), s }; }, 60000);
check("status filter finds the project (projectsByStatus)", byStatus.done, `status ${byStatus.s.status}`);
const byOwner = await until(async () => { const s = await call("GET", "/api/projects?owner=live%20checker"); return { done: s.json?.projects?.some((x) => x.id === p.id), s }; }, 60000);
check("owner filter finds the project (projectsByOwner)", byOwner.done, `status ${byOwner.s.status}`);
const both = await call("GET", "/api/projects?status=planned&owner=live%20checker");
check("status+owner filter excludes it (where)", both.status === 200 && !both.json.projects.some((x) => x.id === p.id), `status ${both.status}`);
r = await call("GET", "/api/projects");
check("unfiltered strong list includes it", r.status === 200 && r.json.projects.some((x) => x.id === p.id), `status ${r.status}`);

// Summary counts
r = await call("GET", "/api/projects/summary");
check("summary counts the project as active", r.status === 200 && r.json.counts.active === (before.active || 0) + 1, JSON.stringify(r.json?.counts));

// Activity
r = await call("GET", "/api/activity");
const mine = (r.json?.activity || []).filter((a) => a.project?.id === p.id);
check("activity has created and updated, newest first", r.status === 200 && mine.length >= 2 && mine[0].action === "updated" && mine.at(-1).action === "created", mine.map((a) => a.action).join(","));

// Settings conditional write
r = await call("GET", "/api/session");
const sv = r.json?.settingsVersion ?? null;
const settings = r.json?.settings || { name: "My workspace", description: "" };
r = await call("PATCH", "/api/settings", { name: settings.name, description: settings.description, version: sv });
check("settings save with version", r.status === 200 && r.json?.version, `status ${r.status}`);
r = await call("PATCH", "/api/settings", { name: settings.name, description: settings.description, version: sv });
check("stale settings save refused", sv !== null ? r.status === 409 : r.status === 409, `status ${r.status} ${r.json?.error}`);

// Delete: stale then current
r = await call("DELETE", `/api/projects/${p.id}?version=${p.version}`, null, { "X-Request-Id": rid() });
check("stale delete refused", r.status === 409, `status ${r.status}`);
r = await call("DELETE", `/api/projects/${p.id}?version=${v2}`, null, { "X-Request-Id": rid() });
check("delete with current version", r.status === 200, `status ${r.status}`);
r = await call("GET", "/api/projects/summary");
check("summary back to the start after delete", r.status === 200 && r.json.counts.active === (before.active || 0), JSON.stringify(r.json?.counts));

// Sign out, reuse, second sign-out
const old = cookie;
r = await call("DELETE", "/api/session");
check("sign out clears the cookie", r.status === 200 && /Max-Age=0/.test(r.setCookie), `status ${r.status}`);
r = await call("GET", "/api/session");
check("old cookie no longer works (strong read)", r.status === 401, `status ${r.status}`);
cookie = old;
r = await call("DELETE", "/api/session");
check("second sign-out still clears the cookie", r.status === 200 && /Max-Age=0/.test(r.setCookie), `status ${r.status}`);

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
