// The studio moved from Google Workspace together, on purpose. Two kinds of
// action come from that background, both drawn from their own seeded stream:
// habits (people trying to work the Google way) and imports of what they still
// had in their Google export. Devices: which browser actions run on a phone
// and which native app writes a DAV action.
import { NATIVE_KINDS } from "./builder.mjs";
import { channelFor, folderFor, scopeFor } from "./kinds.mjs";

export const IMPORT_TYPES = ["docx", "xlsx", "ics", "vcf", "folder"];
/** Browser flows that also run on a phone (checked on WebKit iPhone and Chromium Android). */
export const PHONE_KINDS = new Set(["chat.post", "note.create", "note.edit", "task.create"]);
const PHONE_SHARE = 1 / 3;
const NATIVE_PHONE_SHARE = 0.4;

export function googleActions({ b, world, date, rng, present, ui, projects, light, all = false }) {
  if (light && !all) return;
  const projectOf = (p) => projects.find((x) => x.phase !== "intake" && world.projectMembersOn(x, date).includes(p)) ?? null;
  const minute = () => rng.int(30, 480);

  // Habits: at most one per persona, four to six in all (every habit once with --habits all).
  const candidates = [];
  for (const persona of present) {
    for (const id of world.persona(persona).habits ?? []) {
      const h = world.habit(id);
      // Calendar habits of a persona who keeps a native calendar app happen in that app.
      const native = h.app === "calendar" && world.appMode(persona, "calendar") === "native";
      const layer = native ? "dav" : h.layers.includes("ui") && ui.includes(persona) ? "ui" : h.layers.includes("api") ? "api" : null;
      if (layer) candidates.push({ persona, habit: h, layer });
    }
  }
  // A habit that finds nothing to work on (no doc, no file yet) passes to the next candidate.
  const done = new Set();
  const order = rng.shuffle(candidates);
  if (all) {
    for (const h of world.habits) {
      const options = order.filter((x) => x.habit.id === h.id).sort((x, y) => (y.layer === "ui") - (x.layer === "ui") || done.has(x.persona) - done.has(y.persona));
      for (const c of options) if (habitAction({ b, world, date, rng, ...c, project: projectOf(c.persona), minute: minute() })) { done.add(c.persona); break; }
    }
  } else {
    const want = rng.int(4, 6);
    for (const c of order) {
      if (done.size >= want) break;
      if (!done.has(c.persona) && habitAction({ b, world, date, rng, ...c, project: projectOf(c.persona), minute: minute() })) done.add(c.persona);
    }
  }

  // Leftovers from the Google export: two to four on weekdays (every type once with --habits all).
  const types = all ? IMPORT_TYPES : Array.from({ length: rng.int(2, 4) }, () => rng.pick(IMPORT_TYPES));
  const people = rng.shuffle([...present]);
  const browserPeople = people.filter((p) => ui.includes(p));
  types.forEach((type, i) => {
    // A .docx becomes a doc only in the browser, so a browser persona brings it in when one is working tonight.
    const persona = type === "docx" && browserPeople.length ? browserPeople[i % browserPeople.length] : people[i % people.length];
    const project = projectOf(persona);
    const app = { docx: "docs", xlsx: "drive", ics: "calendar", vcf: "contacts", folder: "drive" }[type];
    const native = (type === "ics" || type === "vcf") && world.appMode(persona, app) === "native";
    const layer = native ? "dav" : (type === "folder" || type === "docx") && ui.includes(persona) ? "ui" : "api";
    b.add({ persona, kind: "migrate.import", app, layer, minute: minute(), type: type === "docx" ? "doc" : type === "ics" || type === "vcf" ? undefined : "file",
      scope: scopeFor(project), project: project?.id, creates: ["docx", "xlsx", "folder"].includes(type) ? b.key(type === "docx" ? "doc" : "file") : undefined,
      params: { type, folder: project ? folderFor(project) : "folder:team:studio" } });
  });
}

function habitAction({ b, world, date, rng, persona, habit, layer, project, minute }) {
  const base = { persona, kind: "habit", app: habit.app, layer, minute };
  const mates = (project ? world.projectMembersOn(project, date) : world.teamMembersOn("studio", date)).filter((m) => m !== persona);
  const params = { habit: habit.id };
  switch (habit.id) {
    case "mention-assign":
    case "suggest-edit": {
      const doc = b.pickObject("doc", persona, { project: project?.id });
      if (!doc) return null;
      const readers = mates.filter((m) => world.canRead(m, doc.scope));
      if (!readers.length) return null;
      if (habit.id === "mention-assign") return b.add({ ...base, deps: [doc.key], refs: [doc.key], params: { ...params, doc: doc.key, mention: rng.pick(readers), text: b.line(b.corpus.docs.comments, persona) } });
      // The doc's author accepts (a colleague when it is the persona's own doc); a new paragraph on half the days, a sentence on the rest.
      const author = doc.owner && doc.owner !== persona && readers.includes(doc.owner) ? doc.owner : rng.pick(readers);
      return b.add({ ...base, deps: [doc.key], refs: [doc.key], params: { ...params, doc: doc.key, author, paragraph: rng.chance(0.5), text: b.line(b.corpus.docs.comments, persona) } });
    }
    case "team-share":
      // In Google, a file in My Drive is shared with a group in one go; here: a file in the persona's own Drive, shared with the project's Team.
      if (!project) return null;
      return b.add({ ...base, params: { ...params, team: project.team, name: `${rng.pick(b.corpus.files.exports)}_${rng.int(1, 99)}.pdf` } });
    case "expiring-link": {
      const file = b.pickObject("file", persona, { project: project?.id });
      if (!file) return null;
      const client = project ? world.client(project.client) : null;
      return b.add({ ...base, deps: [file.key], refs: [file.key], params: { ...params, file: file.key, team: file.scope, channel: channelFor(project), to: client?.email, expiresInDays: 7 } });
    }
    case "find-a-time":
    case "meet-in-invite": {
      const attendees = rng.shuffle(mates).slice(0, rng.int(1, 3)).sort();
      if (!attendees.length) return null;
      const { start, minutes } = b.slot(persona, rng.int(1, 6));
      const name = project ? project.name : "Studio";
      return b.add({ ...base, type: "event", scope: scopeFor(project), project: project?.id, creates: b.key("event"),
        params: { ...params, title: `${name} — ${habit.id === "meet-in-invite" ? "video call" : "afstemming"} (${start.slice(5, 10)})`, start, minutes, attendees, channel: channelFor(project) } });
    }
    case "folder-drop":
    case "sheet-open":
      if (!project) return null;
      return b.add({ ...base, type: "file", scope: scopeFor(project), project: project.id, creates: b.key("file"), params: { ...params, folder: folderFor(project) } });
    default:
      return null;
  }
}

/** Phone or desk per browser action, and which native app writes a DAV action. Seeded, in action order. */
export function assignDevices(actions, { world, rng }) {
  return actions.map((a) => {
    if (a.layer === "ui") {
      const d = world.persona(a.persona).devices ?? {};
      const phone = PHONE_KINDS.has(a.kind) && rng.chance(PHONE_SHARE);
      return { ...a, device: phone ? "phone" : "desk", browser: phone ? (d.phone === "android" ? "android" : "iphone") : d.browser ?? "chrome" };
    }
    if (a.layer === "dav") {
      const android = world.persona(a.persona).devices?.phone === "android";
      // An Android persona's native app on the desk is Apple's (the desk is a Mac); on the phone it is DAVx5.
      const device = rng.chance(NATIVE_PHONE_SHARE) ? "phone" : "desk";
      return { ...a, device, client: device === "phone" && android ? "davx5" : "apple" };
    }
    return a;
  });
}

export { NATIVE_KINDS };
