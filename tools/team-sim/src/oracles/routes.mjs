import { readFileSync } from "node:fs";

/** OpenAPI path templates as matchers. Paths in the contract are relative to /api/v1. */
export function loadTemplates(openapiFile) {
  const spec = JSON.parse(readFileSync(openapiFile, "utf8"));
  const out = [];
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const method of Object.keys(ops)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      out.push(templateMatcher(method.toUpperCase(), path));
    }
  }
  // Literal segments first, so /admin/search/jobs/current wins over /admin/search/jobs/{jobId}.
  return out.sort((a, b) => b.literals - a.literals);
}

export function templateMatcher(method, template) {
  const parts = template.split("/").filter(Boolean);
  const re = new RegExp(`^/api/v1/${parts.map((p) => (p.startsWith("{") ? "[^/]+" : p.replace(/[.*+?^$()|[\]\\]/g, "\\$&"))).join("/")}/?$`);
  return { method, template, key: `${method} ${template}`, re, literals: parts.filter((p) => !p.startsWith("{")).length };
}

/** "GET /api/v1/notes/123" → "GET /notes/{id}" or null when no template matches. */
export function matchRoute(templates, method, path) {
  const hit = templates.find((t) => t.method === method && t.re.test(path));
  return hit ? hit.key : null;
}

/** Request kind for timing: the template when known, else the path with ids collapsed. */
export function requestKind(templates, method, path) {
  return matchRoute(templates, method, path) ?? `${method} ${davKind(path) ?? path.replace(/\/[0-9a-f-]{8,}|\/\d+/gi, "/:id")}`;
}

/** WebDAV, CalDAV and CardDAV paths carry names, not ids: collapse them to their collection kind. */
function davKind(path) {
  if (path.startsWith("/files/")) return `/files/…${/\.[a-z0-9]{1,5}$/i.test(path) ? "/:file" : "/:folder"}`;
  const m = /^\/(calendars|addressbooks)\/[^/]+\/[^/]+\/?(.*)$/.exec(path);
  if (m) return `/${m[1]}/:user/:collection${m[2] ? "/:object" : "/"}`;
  return null;
}
