import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../instance/config.mjs";

/**
 * Logical key → server ids, persisted in the data dir (`.team-sim/registry.json`)
 * so each snapshot carries the registry the planner reads. Objects:
 *   { key, type, scope, project, owner, status, ids: {...}, bytes?, size?, attendees?, channel?, created }
 */
export function openRegistry(dataDir) {
  const dir = stateDir(dataDir);
  const file = join(dir, "registry.json");
  const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { version: 1, objects: {}, users: {}, teams: {} };

  function save() {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`);
    renameSync(tmp, file);
  }

  return {
    state,
    save,
    get: (key) => state.objects[key] ?? null,
    put(key, value) {
      state.objects[key] = { ...(state.objects[key] ?? {}), key, ...value };
      return state.objects[key];
    },
    update(key, patch) {
      if (!state.objects[key]) throw new Error(`registry: unknown key ${key}`);
      Object.assign(state.objects[key], patch);
      return state.objects[key];
    },
    all: () => Object.values(state.objects),
  };
}

/** What the planner may read: object keys and their planning fields, no server ids. */
export function snapshotSummary(dataDir) {
  const file = join(stateDir(dataDir), "registry.json");
  if (!existsSync(file)) return { objects: [], driveBytes: 0 };
  const state = JSON.parse(readFileSync(file, "utf8"));
  const objects = Object.values(state.objects)
    .filter((o) => o.type !== "channel" && o.type !== "tasklist" && o.type !== "folder")
    .map(({ key, type, scope, project, owner, status, bytes, size, attendees, channel }) => ({ key, type, scope, project, owner, status, bytes, size, attendees, channel }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const driveBytes = objects.filter((o) => o.type === "file" && o.status !== "deleted").reduce((s, o) => s + (o.bytes ?? 0), 0);
  return { objects, driveBytes };
}
