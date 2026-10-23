#!/usr/bin/env node
/**
 * Migrate openapi paths to artifact-based routes (safe merge).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(__dirname, "../openapi/openapi.json");
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const paths = spec.paths;

const drop = [
  "/drive/changedir",
  "/meet/room", "/meet/join", "/meet/poll", "/meet/send", "/meet/leave", "/meet/chat", "/meet/rtc",
  "/collab/join", "/collab/poll", "/collab/send", "/collab/leave", "/collab/rtc",
  "/notes/items/{id}/archive", "/notes/items/{id}/restore",
  "/mail/move", "/mail/message", "/mail/message/attachment", "/mail/messages/attachments",
  "/mail/send", "/mail/draft",
  "/admin/updates/check", "/admin/updates/apply", "/admin/updates/cancel",
  "/admin/search/reindex", "/admin/search/state", "/admin/search/cancel",
  "/admin/plugins/install", "/plugins/{id}/activate", "/plugins/{id}/deactivate",
  "/search/unified", "/records/download", "/home/state",
  "/drive/user", "/drive/getdir", "/drive/searchfiles", "/drive/createnew",
  "/drive/renameitem", "/drive/deleteitems", "/drive/download", "/drive/upload", "/drive/stars",
  "/collab/document",
];

for (const p of drop) delete paths[p];

paths["/files/context"] = clone(paths["/drive/user"] ?? op("Files", "User file context"));
paths["/files/children"] = {
  get: {
    tags: ["Files"],
    summary: "List directory children",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Listing" } },
    "x-wgw-access": "user",
  },
};
paths["/files"] = {
  get: {
    tags: ["Files"],
    summary: "Search files",
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: "search", in: "query", required: true, schema: { type: "string" } },
      { name: "path", in: "query", schema: { type: "string" } },
      { name: "limit", in: "query", schema: { type: "integer" } },
      { name: "offset", in: "query", schema: { type: "integer" } },
    ],
    responses: { 200: { description: "Results" } },
    "x-wgw-access": "user",
  },
  patch: {
    tags: ["Files"],
    summary: "Rename file or directory",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Renamed" } },
    "x-wgw-access": "user",
  },
  delete: {
    tags: ["Files"],
    summary: "Delete files",
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: "Deleted" } },
    "x-wgw-access": "user",
  },
};
paths["/files/directories"] = {
  post: {
    tags: ["Files"],
    summary: "Create directory",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
    responses: { 201: { description: "Created" } },
    "x-wgw-access": "user",
  },
};
paths["/files/content"] = {
  get: {
    tags: ["Files"],
    summary: "Download file content",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Stream" } },
    "x-wgw-access": "user",
  },
  head: {
    tags: ["Files"],
    summary: "Upload probe",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", schema: { type: "string" } }],
    responses: { 200: { description: "Ready" } },
    "x-wgw-access": "user",
  },
  post: {
    tags: ["Files"],
    summary: "Upload file content",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", schema: { type: "string" } }],
    responses: { 200: { description: "Accepted" } },
    "x-wgw-access": "user",
  },
};
paths["/files/collaboration"] = {
  get: {
    tags: ["Files"],
    summary: "Load collaboration document",
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: "path", in: "query", required: true, schema: { type: "string" } },
      { name: "format", in: "query", schema: { type: "string", enum: ["markdown", "yjs"] } },
    ],
    responses: { 200: { description: "Document" } },
    "x-wgw-access": "user",
  },
  put: {
    tags: ["Files"],
    summary: "Save collaboration document",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Saved" } },
    "x-wgw-access": "user",
  },
};
paths["/files/star"] = {
  post: {
    tags: ["Files"],
    summary: "Star path",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Starred" } },
    "x-wgw-access": "user",
  },
  delete: {
    tags: ["Files"],
    summary: "Unstar path",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Unstarred" } },
    "x-wgw-access": "user",
  },
};
paths["/files/starred"] = {
  get: {
    tags: ["Files"],
    summary: "List starred paths",
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: "Paths" } },
    "x-wgw-access": "user",
  },
};
paths["/files/rooms"] = {
  post: {
    tags: ["Files"],
    summary: "Resolve file collab room",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Room" } },
    "x-wgw-access": "user",
  },
};

paths["/workspace/state"] = clone(paths["/home/state"] ?? op("Workspace", "Workspace bootstrap"));
paths["/search/results"] = clone(paths["/search/unified"] ?? op("Search", "Search results"));
paths["/search/results/{resultId}/content"] = {
  get: {
    tags: ["Search"],
    summary: "Download search result content",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "resultId", in: "path", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Content" } },
    "x-wgw-access": "user",
  },
};

paths["/mail/messages"].post = {
  tags: ["Mail"],
  summary: "Send message",
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: "Sent" } },
  "x-wgw-access": "user",
};
paths["/mail/messages/{messageId}"] = paths["/mail/messages/{messageId}"] ?? {
  get: op("Mail", "Get message").get,
  patch: op("Mail", "Patch message").get,
  delete: op("Mail", "Delete message").get,
};
paths["/mail/messages/{messageId}/attachments"] = {
  get: {
    tags: ["Mail"],
    summary: "List attachments",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Attachments" } },
    "x-wgw-access": "user",
  },
};
paths["/mail/messages/{messageId}/attachments/{attachmentId}"] = {
  get: {
    tags: ["Mail"],
    summary: "Download attachment",
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: "messageId", in: "path", required: true, schema: { type: "string" } },
      { name: "attachmentId", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: { 200: { description: "Attachment" } },
    "x-wgw-access": "user",
  },
};
paths["/mail/drafts"] = {
  post: {
    tags: ["Mail"],
    summary: "Save draft",
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: "Saved" } },
    "x-wgw-access": "user",
  },
};

if (paths["/notes/items/{id}"]) {
  paths["/notes/items/{id}"].patch = {
    tags: ["Notes"],
    summary: "Patch note (e.g. archive)",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Updated" } },
    "x-wgw-access": "user",
  };
}

paths["/meetings/rooms"] = {
  post: { tags: ["Meetings"], summary: "Create meeting room", responses: { 201: { description: "Created" } }, "x-wgw-access": "guest" },
};
paths["/meetings/rooms/{roomId}"] = {
  get: {
    tags: ["Meetings"],
    summary: "Meeting room status",
    parameters: [{ name: "roomId", in: "path", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Status" } },
    "x-wgw-access": "guest",
  },
};
const roomOp = (summary, access = "guest") => ({
  tags: ["Rooms"],
  summary,
  parameters: [{ name: "roomId", in: "path", required: true, schema: { type: "string" } }],
  responses: { 200: { description: "OK" } },
  "x-wgw-access": access,
});
paths["/rooms/{roomId}/participants"] = { post: roomOp("Join participant") };
paths["/rooms/{roomId}/events"] = { get: roomOp("Poll events"), post: roomOp("Send event") };
paths["/rooms/{roomId}/participants/{participantId}"] = {
  delete: {
    ...roomOp("Leave room"),
    parameters: [
      { name: "roomId", in: "path", required: true, schema: { type: "string" } },
      { name: "participantId", in: "path", required: true, schema: { type: "string" } },
    ],
  },
};
paths["/rooms/{roomId}/configuration"] = { get: roomOp("RTC configuration") };
paths["/rooms/{roomId}/messages"] = { post: roomOp("Chat message") };

paths["/admin/update-jobs"] = {
  post: { tags: ["Admin"], summary: "Start update job", security: [{ bearerAuth: [] }], responses: { 202: { description: "Accepted" } }, "x-wgw-access": "admin" },
};
paths["/admin/update-jobs/{jobId}"] = {
  delete: {
    tags: ["Admin"],
    summary: "Cancel update job",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "jobId", in: "path", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Cancelled" } },
    "x-wgw-access": "admin",
  },
};
paths["/admin/search/jobs"] = {
  post: { tags: ["Admin"], summary: "Start search reindex", security: [{ bearerAuth: [] }], responses: { 202: { description: "Accepted" } }, "x-wgw-access": "admin" },
};
paths["/admin/search/jobs/current"] = {
  get: { tags: ["Admin"], summary: "Search job state", security: [{ bearerAuth: [] }], responses: { 200: { description: "State" } }, "x-wgw-access": "admin" },
};
paths["/admin/search/jobs/{jobId}"] = {
  delete: {
    tags: ["Admin"],
    summary: "Cancel search job",
    security: [{ bearerAuth: [] }],
    parameters: [{ name: "jobId", in: "path", required: true, schema: { type: "string" } }],
    responses: { 200: { description: "Cancelled" } },
    "x-wgw-access": "admin",
  },
};
paths["/admin/backups/{name}"] = clone(paths["/admin/updates/backups/{name}"]);
delete paths["/admin/updates/backups/{name}"];

for (const p of drop) delete paths[p];

spec.info.description = "Artifact-based OpenAPI-first REST API.";
spec.paths = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`OpenAPI paths: ${Object.keys(spec.paths).length}`);

function clone(v) {
  return v ? structuredClone(v) : undefined;
}
function op(tag, summary) {
  return {
    get: {
      tags: [tag],
      summary,
      security: [{ bearerAuth: [] }],
      responses: { 200: { description: "OK" } },
      "x-wgw-access": "user",
    },
  };
}
