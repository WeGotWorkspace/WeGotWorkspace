import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * JSONL request log shared by API actors, DAV actors, browser actors and
 * oracles. One line per request: who, which layer, method, path, status, ms,
 * and the plan action number when the request belongs to an action.
 */
export function createRequestLog(file) {
  if (file) mkdirSync(dirname(file), { recursive: true });
  const entries = [];
  return {
    entries,
    add(entry) {
      const line = { t: new Date().toISOString(), ...entry };
      entries.push(line);
      if (file) appendFileSync(file, `${JSON.stringify(line)}\n`);
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A persona's API session. Logs in the way the web app does
 * (`POST /api/v1/auth/token`, bearer JWT), re-logs in on 401 once, and backs
 * off on 429 (calling `onBudget` so the night can reset the account budget
 * the way the live tier does).
 */
export function createClient({ origin, username, password, persona = username, layer = "api", requestLog, onBudget, fetchImpl = fetch }) {
  let token = null;
  let action = null;

  async function raw(method, path, { json, body, headers = {}, auth = "bearer", tag, timeoutMs = 120000, countBytes = false, retry } = {}) {
    const url = path.startsWith("http") ? path : `${origin}${path}`;
    const h = { accept: "application/json", ...headers };
    if (json !== undefined) h["content-type"] = "application/json";
    if (auth === "bearer" && token) h.authorization = `Bearer ${token}`;
    if (auth === "basic") h.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    const started = performance.now();
    let res;
    let error = null;
    try {
      res = await fetchImpl(url, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    } catch (e) {
      error = e;
    }
    const ms = Math.round(performance.now() - started);
    const status = res?.status ?? 0;
    let bytes = null;
    let text = "";
    if (res && countBytes && res.ok) {
      bytes = 0;
      for await (const chunk of res.body) bytes += chunk.length;
    } else if (res) {
      text = await res.text().catch(() => "");
    }
    let data = null;
    if (text && /json/.test(res?.headers.get("content-type") ?? "")) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    requestLog?.add({ persona, layer, method, path: new URL(url).pathname, status, ms, action, tag, retry, error: error?.message, body: status >= 500 ? text.slice(0, 400) : undefined });
    return { status, ok: status >= 200 && status < 300, json: data, text, bytes, ms, headers: res?.headers, error };
  }

  async function login() {
    const res = await raw("POST", "/api/v1/auth/token", { json: { username, password }, auth: "none", tag: "login" });
    if (!res.ok) throw new Error(`login ${username} failed: HTTP ${res.status} ${res.text.slice(0, 200)}`);
    token = res.json?.token ?? res.json?.access_token ?? res.json?.accessToken;
    if (!token) throw new Error(`login ${username}: no token in response`);
    return token;
  }

  async function request(method, path, opts = {}) {
    if (!token && opts.auth !== "basic" && opts.auth !== "none") await login();
    let res = await raw(method, path, opts);
    if (res.status === 401 && opts.auth !== "basic" && opts.auth !== "none") {
      await login();
      res = await raw(method, path, { ...opts, retry: "401" });
    }
    for (let attempt = 0; res.status === 429 && attempt < 4; attempt += 1) {
      await onBudget?.(username);
      await sleep(1000 * (attempt + 1));
      res = await raw(method, path, { ...opts, retry: "429" });
    }
    return res;
  }

  /** Like request, but throws on a non-2xx so an action fails with the server's answer. */
  async function must(method, path, opts = {}) {
    const res = await request(method, path, opts);
    if (!res.ok) {
      const err = new Error(`${method} ${path} → HTTP ${res.status}: ${res.text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json ?? res.text;
  }

  return {
    username,
    persona,
    login,
    request,
    must,
    raw,
    get: (p, o) => must("GET", p, o),
    post: (p, json, o) => must("POST", p, { ...o, json }),
    put: (p, json, o) => must("PUT", p, { ...o, json }),
    patch: (p, json, o) => must("PATCH", p, { ...o, json }),
    del: (p, o) => must("DELETE", p, o),
    setAction: (n) => {
      action = n;
    },
    token: () => token,
  };
}
