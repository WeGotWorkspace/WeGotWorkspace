import { corpus } from "../corpus/index.mjs";
import { addDays, zonedIso } from "./dates.mjs";

/** Kinds the browser layer can play. Anything else from a browser persona runs through the API. */
export const UI_KINDS = new Set([
  "chat.post",
  "note.create",
  "note.edit",
  "task.create",
  "doc.edit",
  "cal.event",
  "contact.create",
  "drive.upload",
  "meet.call",
  "doc.cowrite",
]);

/** Kinds the "desktop calendar app" persona plays over CalDAV/CardDAV. */
const DAV_KINDS = new Set(["cal.event", "cal.rsvp", "cal.reschedule", "contact.create", "contact.edit"]);

export const APP_OF = (kind) =>
  ({
    chat: "chat",
    task: "tasks",
    note: "notes",
    doc: "docs",
    cal: "calendar",
    contact: "contacts",
    meet: "meet",
    drive: "drive",
    gap: "none",
  })[kind.split(".")[0]];

/**
 * Collects actions for one night. Objects are named by logical keys; the
 * executor maps keys to server ids through the registry. Dependencies are
 * expressed on keys created tonight and resolved to action numbers in
 * `finish()`, after sorting by simulated minute.
 */
export function createBuilder({ world, date, rng, snapshot, ui }) {
  const actions = [];
  const created = new Map(); // key -> action (created tonight)
  const older = (snapshot?.objects ?? []).filter((o) => !["deleted", "archived"].includes(o.status));
  const consumed = new Set(); // keys deleted or archived tonight
  let driveBytes = snapshot?.driveBytes ?? 0;
  let seq = 0;

  const lang = (persona) => world.persona(persona).locale ?? "nl";
  const line = (pool, persona) => rng.pick(pool[lang(persona)] ?? pool.en);

  function layerFor(persona, kind) {
    const traits = world.persona(persona).traits ?? [];
    if (traits.includes("dav-only") && DAV_KINDS.has(kind)) return "dav";
    if (kind === "meet.call" || kind === "doc.cowrite") return "ui";
    if (ui.includes(persona) && UI_KINDS.has(kind)) return "ui";
    return "api";
  }

  function add(spec) {
    const deps = (spec.deps ?? []).filter((k) => created.has(k));
    const after = deps.reduce((m, k) => Math.max(m, created.get(k).minute + 1), 0);
    const action = {
      persona: spec.persona,
      layer: spec.layer ?? layerFor(spec.persona, spec.kind),
      app: APP_OF(spec.kind),
      kind: spec.kind,
      minute: Math.min(509, Math.max(spec.minute, after)),
      params: spec.params ?? {},
      creates: spec.creates,
      object: spec.creates ? { type: spec.type, scope: spec.scope, project: spec.project } : undefined,
      refs: spec.refs ?? [],
      depKeys: deps,
      flags: spec.flags,
      seq: seq++,
    };
    actions.push(action);
    if (spec.creates) created.set(spec.creates, { ...action, type: spec.type, scope: spec.scope, project: spec.project });
    for (const k of spec.consumes ?? []) consumed.add(k);
    return action;
  }

  /** An object of `type` the persona can read: tonight's (as dependency) or an older one. */
  function pickObject(type, persona, { project, ownedBy, preferTonight = 0.6, where } = {}) {
    const ok = (o) =>
      o.type === type &&
      !consumed.has(o.key) &&
      world.canRead(persona, o.scope) &&
      (!project || o.project === project) &&
      (!ownedBy || o.owner === ownedBy) &&
      (!where || where(o));
    const tonight = [...created.entries()]
      .map(([key, a]) => ({ key, type: a.type, scope: a.scope, project: a.project, owner: a.persona, minute: a.minute, ...a.params }))
      .filter(ok);
    const old = older.filter(ok);
    if (tonight.length && (rng.chance(preferTonight) || !old.length)) return { ...rng.pick(tonight), tonight: true };
    if (old.length) return { ...rng.pick(old), tonight: false };
    return null;
  }

  const key = (type) => `${type}:${date}:${seq}`;

  /** A start time `daysAhead` days out at a whole hour within the persona's day. */
  function slot(persona, daysAhead) {
    const hour = rng.int(9, 16);
    const day = addDays(date, daysAhead);
    return { start: zonedIso(day, `${String(hour).padStart(2, "0")}:00`, world.zoneOf(persona, day)), minutes: rng.pick([30, 45, 60]) };
  }

  function reserveDrive(bytes) {
    if (driveBytes + bytes > world.meta.driveCapBytes) return false;
    driveBytes += bytes;
    return true;
  }

  function finish() {
    const ordered = [...actions].sort((a, b) => a.minute - b.minute || a.seq - b.seq);
    const indexOf = new Map(ordered.map((a, i) => [a, i + 1]));
    const byKey = new Map(ordered.filter((a) => a.creates).map((a) => [a.creates, indexOf.get(a)]));
    return ordered.map((a) => {
      const { seq: _seq, depKeys, ...rest } = a;
      return { n: indexOf.get(a), ...rest, deps: depKeys.map((k) => byKey.get(k)).sort((x, y) => x - y) };
    });
  }

  return { add, pickObject, key, slot, line, lang, reserveDrive, layerFor, finish, corpus, actions, driveBytes: () => driveBytes };
}
