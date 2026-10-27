// Quant function body: event and kvStore are provided by the runtime.
// No Node imports, server process, or build-time credentials.
// The orbit store is format 2 (KV v2): every write that depends on what is
// stored is conditional, and a project change and its activity entry commit
// in one transaction. The indexes are declared in quant/meta.json.
const request = event.request;
// Keep the original request path; take the public host and protocol from event.url.
const url = new URL(request.url);
if (event.url) {
  const publicUrl = new URL(event.url);
  url.protocol = publicUrl.protocol;
  url.host = publicUrl.host;
}
const path = url.pathname.replace(/\/$/, "");
const route = `${request.method} ${path}`;
const store = `${event.quantOrg}-${event.quantProject}-orbit`;
const secure = url.protocol === "https:";
const cookieName = secure ? "__Host-orbit" : "orbit-local";
const sessionSeconds = 8 * 60 * 60;
const activitySeconds = 90 * 24 * 60 * 60;
const pageSize = 50;
const STATUSES = ["planned", "active", "complete", "archived"];
const PRIORITIES = ["low", "medium", "high"];
// A KV version: 26 Crockford base32 characters (the ULID alphabet).
const VERSION = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;
const COPY = {
  conflict: "Someone else changed this project. Reload it to see their change.",
  settingsConflict:
    "Someone else changed these settings. Reload them to see their change.",
  duplicate: "A project with this name already exists.",
  // A create can conflict only with an earlier attempt of the same request.
  created: "This project was already created. Reload to see it.",
  notReady: "The workspace is still being set up. Try again in a minute.",
  // The store is format 1, or the indexes in quant/meta.json are not declared.
  dataModel: "The workspace data model is not set up. See README › Data model.",
  unavailable: "The workspace could not be reached. Please try again.",
  version: "A current version is required. Reload and try again.",
};
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Surrogate-Control": "no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
// Only errors made here are shown to the client (expose). A KVError has its
// own status and message; neither ever reaches the client.
const fail = (status, message, body = {}) => {
  throw Object.assign(new Error(message), { status, body, expose: true });
};
const hash = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const set = async (key, value, options) => {
  if ((await kvStore.set(store, key, value, options)) === false)
    throw new Error("KV write rejected");
};
// A conditional set returns { version }; anything else is not a success.
const setIf = async (key, value, condition) => {
  const result = await kvStore.set(store, key, value, condition);
  if (typeof result?.version !== "string") throw new Error("KV write rejected");
  return result.version;
};
// On format 2, deleting a missing key returns false. A session that is
// already gone is signed out; any other false is a failed delete.
const removeSession = async (key) => {
  if ((await kvStore.delete(store, key)) !== false) return;
  if (await kvStore.getEntry(store, key)) throw new Error("KV delete rejected");
};
const cookie = (value, age = sessionSeconds) =>
  `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;

// ---- Request bodies and fields.
async function readBytes(reader) {
  let length = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) {
      await reader.cancel();
      fail(413, "Request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function readBody() {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    fail(415, "Send application/json.");
  // Bound the stream too: Content-Length is optional and untrusted.
  const reader = request.body?.getReader();
  if (!reader) fail(400, "A JSON object is required.");
  const bytes = await readBytes(reader);
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail(400, "Invalid JSON.");
  }
  if (!isObject(body)) fail(400, "A JSON object is required.");
  return body;
}
// C0 control characters and DEL, except tab, newline and carriage return.
// The KV backend refuses U+0000 in an indexed field.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const plain = (value, label) => {
  if (CONTROL.test(value)) fail(400, `${label} must not contain control characters.`);
  return value;
};
const text = (value, label, max, optional = false) => {
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    (!optional && !value.trim())
  )
    fail(
      400,
      `${label} must be ${optional ? "at most" : "between 1 and"} ${max} characters.`,
    );
  return plain(value.trim(), label);
};
const choice = (value, allowed, message) => {
  if (!allowed.includes(value)) fail(400, message);
  return value;
};
const progressOf = (value) => {
  if (!Number.isInteger(value) || value < 0 || value > 100)
    fail(400, "Progress must be 0–100.");
  return value;
};
const validDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const dueOf = (value) => {
  if (typeof value !== "string" || (value !== "" && !validDate(value)))
    fail(400, "Choose a valid due date.");
  return value;
};
// A write that depends on what is stored needs the version that was read.
const versionOf = (value) => {
  if (typeof value !== "string" || !VERSION.test(value)) fail(400, COPY.version);
  return value;
};
function projectInput(body) {
  const fields = {
    name: text(body.name, "Project name", 100),
    description: text(body.description, "Description", 500, true),
    owner: text(body.owner, "Owner", 60),
    status: choice(body.status, STATUSES, "Choose a valid status."),
    priority: choice(body.priority, PRIORITIES, "Choose a valid priority."),
    progress: progressOf(body.progress),
    due: dueOf(body.due),
  };
  if (fields.status === "complete") fields.progress = 100;
  return fields;
}
const cursorParam = () => {
  const cursor = url.searchParams.get("cursor");
  if (cursor && cursor.length > 8192) fail(400, "Invalid cursor.");
  return cursor ? { cursor } : {};
};

// ---- Sessions.
const validPrincipal = (p) =>
  p &&
  /^[a-z0-9][a-z0-9-]{0,47}$/.test(p.workspace) &&
  ["owner", "viewer"].includes(p.role) &&
  typeof p.name === "string" &&
  p.active === true;
const validSession = (s) =>
  !!s &&
  Number.isFinite(s.expires) &&
  s.expires > Date.now() &&
  /^auth:[a-f0-9]{64}$/.test(s.authKey);
const cookieToken = () =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
async function sessionHashOf(token) {
  return token && /^[a-f0-9]{64}$/.test(token) ? hash(token) : null;
}
// The request key: the SHA-256 hex of the session hash and the client's
// request ID. A create derives its project id from it, so a retry of the
// same create finds the first attempt, and one session never finds
// another's.
async function requestKeyOf(sessionHash) {
  const requestId = request.headers.get("x-request-id") ?? "";
  return REQUEST_ID.test(requestId)
    ? hash(`${sessionHash}:${requestId}`)
    : null;
}
async function signIn() {
  const body = await readBody();
  if (
    typeof body.accessKey !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.accessKey)
  )
    fail(401, "The access key is not valid.");
  const authKey = `auth:${await hash(body.accessKey)}`;
  const principal = await kvStore.get(store, authKey);
  if (!validPrincipal(principal)) fail(401, "The access key is not valid.");
  const token = random();
  await set(
    `session:${await hash(token)}`,
    { authKey, expires: Date.now() + sessionSeconds * 1000 },
    { ttl: sessionSeconds },
  );
  return json({ ok: true }, 200, { "Set-Cookie": cookie(token) });
}
async function signOut(sessionHash) {
  if (sessionHash) await removeSession(`session:${sessionHash}`);
  return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
}
async function authenticate(sessionHash) {
  const session = sessionHash
    ? await kvStore.get(store, `session:${sessionHash}`)
    : null;
  if (!validSession(session)) fail(401, "Sign in to continue.");
  // Re-read access on every request: deleting/disabling an auth key revokes its sessions.
  const principal = await kvStore.get(store, session.authKey);
  if (!validPrincipal(principal)) fail(401, "Your access has expired.");
  return {
    principal,
    prefix: `workspace:${principal.workspace}:`,
    requestKey: await requestKeyOf(sessionHash),
  };
}
async function sessionInfo({ principal, prefix }) {
  const entry = await kvStore.getEntry(store, `${prefix}settings`);
  const settings = isObject(entry?.value)
    ? entry.value
    : { name: "My workspace", description: "" };
  return json({
    user: {
      name: principal.name,
      role: principal.role,
      workspace: principal.workspace,
    },
    settings,
    settingsVersion: entry ? entry.version : null,
  });
}
// The first write of the settings has version null (ifAbsent).
const settingsCondition = (version) =>
  version === null ? { ifAbsent: true } : { ifVersion: versionOf(version) };
async function updateSettings({ prefix }) {
  const body = await readBody();
  const settings = {
    name: text(body.name, "Workspace name", 60),
    description: text(body.description, "Description", 240, true),
  };
  const condition = settingsCondition(body.version);
  const version = await setIf(`${prefix}settings`, settings, condition);
  return json({ settings, version });
}

// ---- Pages.
function checkedPage(page) {
  if (
    !page ||
    !Array.isArray(page.items) ||
    typeof page.hasMore !== "boolean" ||
    (page.hasMore && !page.cursor)
  )
    throw new Error("KV cursor API required");
  return page;
}
// An item of the collection <prefix><name>, whose value.id is its key id.
function itemOf(item, collection) {
  if (
    typeof item?.key !== "string" ||
    !item.key.startsWith(`${collection}:`) ||
    !isObject(item.value) ||
    item.value.id !== item.key.slice(collection.length + 1) ||
    typeof item.version !== "string"
  )
    throw new Error("Invalid record");
  return item;
}
async function listPage(collection, options) {
  const page = checkedPage(
    await kvStore.list(store, {
      ...options,
      includeValues: true,
      limit: pageSize,
      ...cursorParam(),
    }),
  );
  return { ...page, items: page.items.map((i) => itemOf(i, collection)) };
}

// ---- Projects.
const projectKey = (prefix, id) => `${prefix}project:${id}`;
const withVersion = (entry) => ({ ...entry.value, version: entry.version });
const ownerParam = () => {
  const owner = (url.searchParams.get("owner") ?? "").trim().toLowerCase();
  if (owner.length > 60) fail(400, "Owner must be at most 60 characters.");
  return plain(owner, "Owner");
};
// A filtered list uses an index, newest first by updatedAt. The default list
// is a strong collection list: it is in key order (project ids are random),
// not time order, and it also holds projects that the indexes do not.
function projectQuery({ principal, prefix }) {
  const status = url.searchParams.get("status") ?? "";
  const ownerKey = ownerParam();
  if (status && !STATUSES.includes(status)) fail(400, "Choose a valid status.");
  const workspace = principal.workspace;
  if (status)
    return {
      index: "projectsByStatus",
      equals: { workspace, status },
      reverse: true,
      ...(ownerKey ? { where: { ownerKey } } : {}),
    };
  if (ownerKey)
    return {
      index: "projectsByOwner",
      equals: { workspace, ownerKey },
      reverse: true,
    };
  return { collection: `${prefix}project` };
}
async function listProjects(ctx) {
  const page = await listPage(`${ctx.prefix}project`, projectQuery(ctx));
  return json({
    projects: page.items.map(withVersion),
    cursor: page.cursor,
    hasMore: page.hasMore,
  });
}
async function projectSummary({ principal }) {
  const workspace = principal.workspace;
  const values = await Promise.all(
    STATUSES.map((status) =>
      kvStore.count(store, {
        index: "projectsByStatus",
        equals: { workspace, status },
      }),
    ),
  );
  if (!values.every((n) => Number.isSafeInteger(n) && n >= 0))
    throw new Error("KV count rejected");
  return json({
    counts: Object.fromEntries(STATUSES.map((s, i) => [s, values[i]])),
    total: values.reduce((sum, n) => sum + n, 0),
  });
}
function buildProject({ principal }, id, fields, existing, ms) {
  const now = new Date(ms).toISOString();
  return {
    id,
    ...fields,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: principal.name,
    workspace: principal.workspace,
    nameKey: fields.name.toLowerCase(),
    ownerKey: fields.owner.toLowerCase(),
  };
}
// With a request ID, a create's project id comes from the request key, so a
// retry of the same create has the same key.
async function projectIdFor(ctx) {
  const source = ctx.requestKey
    ? await hash(`project:${ctx.requestKey}`)
    : random();
  return source.slice(0, 32);
}
// One activity entry for each project change, in the same transaction.
function activityEntry(ctx, action, project, ms) {
  const id = `${String(ms).padStart(13, "0")}-${random().slice(0, 8)}`;
  const { name, status, progress, priority } = project;
  return [
    `${ctx.prefix}activity:${id}`,
    {
      id,
      at: new Date(ms).toISOString(),
      actor: ctx.principal.name,
      action,
      project: { id: project.id, name, status, progress, priority },
    },
    { ttl: activitySeconds },
  ];
}
// No idempotency key: each attempt has new timestamps, so the backend would
// see different operations. A create is protected by its id and ifAbsent; a
// PATCH or DELETE is never sent again.
async function commit(tx, ackKey) {
  const result = await tx.commit();
  if (!isObject(result?.versions) || typeof result.versions[ackKey] !== "string")
    throw new Error("KV transaction rejected");
  return result.versions[ackKey];
}
async function readProject(key) {
  const entry = await kvStore.getEntry(store, key);
  if (!entry || !isObject(entry.value)) fail(404, "Project not found.");
  return entry;
}
async function createProject(ctx) {
  const fields = projectInput(await readBody());
  const id = await projectIdFor(ctx);
  const key = projectKey(ctx.prefix, id);
  // A retry whose first attempt committed finds its project already stored
  // (getEntry is strong). A retry that races its first attempt meets ifAbsent.
  const earlier = ctx.requestKey ? await kvStore.getEntry(store, key) : null;
  if (isObject(earlier?.value))
    return json({ project: withVersion(earlier) }, 201);
  const ms = Date.now();
  const project = buildProject(ctx, id, fields, null, ms);
  const activity = activityEntry(ctx, "created", project, ms);
  const tx = kvStore
    .atomic(store)
    .set(key, project, { ifAbsent: true })
    .set(...activity);
  const version = await commit(tx, key);
  return json({ project: { ...project, version } }, 201);
}
async function updateProject(ctx, id) {
  const key = projectKey(ctx.prefix, id);
  const existing = await readProject(key);
  const body = await readBody();
  const version = versionOf(body.version);
  const fields = projectInput(body);
  const ms = Date.now();
  const project = buildProject(ctx, id, fields, existing.value, ms);
  const activity = activityEntry(ctx, "updated", project, ms);
  const tx = kvStore
    .atomic(store)
    .set(key, project, { ifVersion: version })
    .set(...activity);
  const saved = await commit(tx, key);
  return json({ project: { ...project, version: saved } });
}
async function deleteProject(ctx, id) {
  const key = projectKey(ctx.prefix, id);
  const existing = await readProject(key);
  const version = versionOf(url.searchParams.get("version"));
  const ms = Date.now();
  const project = { ...existing.value, id };
  const activity = activityEntry(ctx, "deleted", project, ms);
  const tx = kvStore
    .atomic(store)
    .delete(key, { ifVersion: version })
    .set(...activity);
  await commit(tx, activity[0]);
  return json({ ok: true });
}

// ---- Activity: a reverse collection list (ids start with the time).
async function listActivity({ prefix }) {
  const collection = `${prefix}activity`;
  const page = await listPage(collection, { collection, reverse: true });
  return json({
    activity: page.items.map((item) => item.value),
    cursor: page.cursor,
    hasMore: page.hasMore,
  });
}

// ---- Routing.
const routes = new Map([
  ["GET /api/session", sessionInfo],
  ["PATCH /api/settings", updateSettings],
  ["GET /api/projects", listProjects],
  ["GET /api/projects/summary", projectSummary],
  ["POST /api/projects", createProject],
  ["GET /api/activity", listActivity],
]);
function projectRoute(ctx) {
  const match = path.match(/^\/api\/projects\/([a-f0-9]{32})$/);
  if (!match) return json({ error: "Route not found." }, 404);
  if (request.method === "PATCH") return updateProject(ctx, match[1]);
  if (request.method === "DELETE") return deleteProject(ctx, match[1]);
  return json({ error: "Method not allowed." }, 405, {
    Allow: "PATCH, DELETE",
  });
}
async function handle() {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method))
    return json({ error: "Method not allowed." }, 405, {
      Allow: "GET, POST, PATCH, DELETE",
    });
  if (request.method !== "GET" && request.headers.get("origin") !== url.origin)
    fail(403, "A same-origin request is required.");
  if (route === "POST /api/session") return signIn();
  const sessionHash = await sessionHashOf(cookieToken());
  if (route === "DELETE /api/session") return signOut(sessionHash);
  const ctx = await authenticate(sessionHash);
  if (request.method !== "GET" && ctx.principal.role !== "owner")
    fail(403, "Owner access is required.");
  const handler = routes.get(route);
  return handler ? handler(ctx) : projectRoute(ctx);
}
// The KV errors that a person can act on. Every other error is a 503 with
// the generic message; the KV message is never shown.
function conflictCopy() {
  if (route === "POST /api/projects") return COPY.created;
  return path === "/api/settings" ? COPY.settingsConflict : COPY.conflict;
}
// A format 1 store, or an index read whose index is not declared (the
// backend's message is "No index named <name>").
const missingDataModel = (error) =>
  error.code === "REQUIRES_FORMAT_2" ||
  (error.code === "VALIDATION" &&
    /^No index named /.test(String(error.message)));
function kvErrorResponse(error) {
  if (error.code === "CONFLICT")
    return json(
      {
        error: conflictCopy(),
        ...(VERSION.test(error.currentVersion ?? "")
          ? { currentVersion: error.currentVersion }
          : {}),
      },
      409,
    );
  if (error.code === "UNIQUE_VIOLATION")
    return json({ error: COPY.duplicate }, 409);
  if (error.code === "INDEX_NOT_READY")
    return json({ error: COPY.notReady }, 503);
  if (missingDataModel(error)) return json({ error: COPY.dataModel }, 503);
  return null;
}
function errorResponse(error) {
  if (error?.expose === true)
    return json({ error: error.message, ...error.body }, error.status);
  const mapped = error?.name === "KVError" ? kvErrorResponse(error) : null;
  if (mapped) return mapped;
  console.error("Orbit API request failed:", error?.message);
  return json({ error: COPY.unavailable }, 503);
}
// The body runs as an async function: its result is this promise's value.
return handle().catch(errorResponse);
