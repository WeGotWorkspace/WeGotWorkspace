/**
 * One builder per action kind. Each takes (ctx, persona, project, minute)
 * and adds zero or one action through ctx.b. A builder returns null when a
 * prerequisite is missing (no task to comment on yet), and the planner then
 * draws another kind.
 */

/** Large print uploads per night; keeps one night's Drive growth near 2 GB at most. */
const MAX_PRINT_UPLOADS = 2;

/** Before kick-off a project lives with sales: the Business Team's channel and folder. */
const intake = (project) => project?.phase === "intake";
export const channelFor = (project) => (!project ? "channel:team:studio" : intake(project) ? "channel:team:business" : `channel:project:${project.id}`);
export const folderFor = (project) => (intake(project) ? "folder:team:business" : `folder:project:${project.id}`);
export const scopeFor = (project) => (!project ? "studio" : intake(project) ? "business" : project.team);

const MEET_TOPICS = ["check-in", "review call", "planning call", "catch-up", "walkthrough"];
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
const HOUR = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
/** Meeting titles are unique within a night, so nobody reads three meetings as one booked three times. */
function uniqueTitle(b, base, start) {
  const taken = new Set(b.actions.map((a) => a.params?.title).filter(Boolean));
  if (!taken.has(base)) return base;
  const day = `${base} (${DAY.format(new Date(start))})`;
  return taken.has(day) ? `${base} (${DAY.format(new Date(start))} ${HOUR.format(new Date(start))})` : day;
}

export const KINDS = {
  "chat.post": ({ b }, persona, project, minute) =>
    b.add({ persona, kind: "chat.post", minute, type: "message", scope: scopeFor(project), project: project?.id,
      creates: b.key("message"), params: { channel: channelFor(project), text: b.line(b.corpus.chat, persona) } }),

  "chat.reply": ({ b }, persona, project, minute) => {
    const parent = b.pickObject("message", persona, { project: project?.id, preferTonight: 0.9 });
    if (!parent) return null;
    return b.add({ persona, kind: "chat.reply", minute, type: "message", scope: parent.scope, project: parent.project,
      creates: b.key("message"), deps: [parent.key], refs: [parent.key],
      params: { channel: parent.channel ?? channelFor(project), parent: parent.key, text: b.line(b.corpus.chat.replies, persona) } });
  },

  "chat.mention": ({ b, world, rng, date }, persona, project, minute) => {
    const pool = world.teamMembersOn(scopeFor(project), date).filter((p) => p !== persona && (!project || intake(project) || world.projectMembersOn(project, date).includes(p)));
    if (!pool.length) return null;
    const who = rng.pick(pool);
    return b.add({ persona, kind: "chat.mention", minute, type: "message", scope: scopeFor(project), project: project?.id,
      creates: b.key("message"), params: { channel: channelFor(project), mention: who, text: b.line(b.corpus.chat, persona) } });
  },

  "chat.dm": ({ b, world, rng, date }, persona, _project, minute) => {
    const pool = world.personasOn(date).filter((p) => p !== persona && world.sharesTeam(p, persona));
    if (!pool.length) return null;
    const to = rng.pick(pool);
    return b.add({ persona, kind: "chat.dm", minute, type: "dm", scope: `dm:${[persona, to].sort().join("+")}`,
      creates: b.key("dm"), params: { to, text: b.line(b.corpus.chat, persona) } });
  },

  "task.create": ({ b, world, rng, date }, persona, project, minute) => {
    if (!project) return null;
    const assignee = rng.pick(world.projectMembersOn(project, date));
    return b.add({ persona, kind: "task.create", minute, type: "task", scope: project.team, project: project.id,
      creates: b.key("task"), params: { list: `tasklist:project:${project.id}`, title: b.line(b.corpus.tasks, persona), assignee, dueInDays: rng.int(1, 14) } });
  },

  "task.assign": ({ b, world, rng, date }, persona, project, minute) => {
    const task = b.pickObject("task", persona, { project: project?.id });
    if (!task || !project) return null;
    const assignee = rng.pick(world.projectMembersOn(project, date));
    return b.add({ persona, kind: "task.assign", minute, deps: [task.key], refs: [task.key], params: { task: task.key, assignee } });
  },

  "task.comment": ({ b }, persona, project, minute) => {
    const task = b.pickObject("task", persona, { project: project?.id });
    if (!task) return null;
    return b.add({ persona, kind: "task.comment", minute, deps: [task.key], refs: [task.key],
      params: { task: task.key, text: b.line(b.corpus.tasks.comments, persona) } });
  },

  "task.complete": ({ b }, persona, project, minute) => {
    const task = b.pickObject("task", persona, { project: project?.id, preferTonight: 0.2, where: (o) => o.status !== "done" });
    if (!task) return null;
    return b.add({ persona, kind: "task.complete", minute, deps: [task.key], refs: [task.key], params: { task: task.key } });
  },

  "task.archive": ({ b }, persona, project, minute) => {
    const task = b.pickObject("task", persona, { project: project?.id, preferTonight: 0 });
    if (!task) return null;
    return b.add({ persona, kind: "task.archive", minute, deps: [task.key], refs: [task.key], consumes: [task.key], params: { task: task.key } });
  },

  "note.create": ({ b, rng }, persona, project, minute) =>
    b.add({ persona, kind: "note.create", minute, type: "note", scope: `own:${persona}`, project: project?.id, creates: b.key("note"),
      params: { title: `${b.line(b.corpus.notes.titles, persona)}${project ? ` — ${project.name}` : ""}`,
        body: [b.line(b.corpus.notes.lines, persona), b.line(b.corpus.notes.lines, persona)].join("\n"), pinned: rng.chance(0.1) } }),

  "note.edit": ({ b }, persona, _project, minute) => {
    const note = b.pickObject("note", persona, { ownedBy: persona, preferTonight: 0.4 });
    if (!note) return null;
    return b.add({ persona, kind: "note.edit", minute, deps: [note.key], refs: [note.key], params: { note: note.key, append: b.line(b.corpus.notes.lines, persona) } });
  },

  "doc.create": ({ b }, persona, project, minute) => {
    if (!project) return null;
    const title = `${b.line(b.corpus.docs.titles, persona)} ${project.name}`;
    return b.add({ persona, kind: "doc.create", minute, type: "doc", scope: scopeFor(project), project: project.id, creates: b.key("doc"),
      params: { folder: folderFor(project), title, body: b.line(b.corpus.docs.paragraphs, persona) } });
  },

  "doc.edit": ({ b }, persona, project, minute) => {
    const doc = b.pickObject("doc", persona, { project: project?.id });
    if (!doc) return null;
    return b.add({ persona, kind: "doc.edit", minute, deps: [doc.key], refs: [doc.key], params: { doc: doc.key, append: b.line(b.corpus.docs.paragraphs, persona) } });
  },

  "doc.comment": ({ b }, persona, project, minute) => {
    const doc = b.pickObject("doc", persona, { project: project?.id });
    if (!doc) return null;
    return b.add({ persona, kind: "doc.comment", minute, type: "comment", scope: doc.scope, project: doc.project, creates: b.key("comment"),
      deps: [doc.key], refs: [doc.key], params: { doc: doc.key, text: b.line(b.corpus.docs.comments, persona) } });
  },

  "doc.resolve": ({ b }, persona, project, minute) => {
    const comment = b.pickObject("comment", persona, { project: project?.id, where: (o) => o.status !== "resolved" });
    if (!comment) return null;
    return b.add({ persona, kind: "doc.resolve", minute, deps: [comment.key], refs: [comment.key], consumes: [comment.key], params: { comment: comment.key } });
  },

  "cal.event": ({ b, world, rng, date }, persona, project, minute, { external = false, title } = {}) => {
    const members = project ? world.projectMembersOn(project, date) : world.teamMembersOn("studio", date);
    const attendees = rng.shuffle(members.filter((m) => m !== persona)).slice(0, rng.int(1, 4)).sort();
    const client = project ? world.client(project.client) : null;
    const { start, minutes } = b.slot(persona, rng.int(1, 10));
    return b.add({ persona, kind: "cal.event", minute, type: "event", scope: scopeFor(project), project: project?.id, creates: b.key("event"),
      params: { title: uniqueTitle(b, title ?? `${project ? project.name : "Studio"} — ${rng.pick(["overleg", "review", "sync", "workshop"])}`, start),
        start, minutes, attendees, external: external && client ? [client.email] : [] } });
  },

  "cal.rsvp": ({ b, rng }, persona, _project, minute) => {
    const ev = b.pickObject("event", persona, { where: (o) => (o.attendees ?? []).includes(persona) });
    if (!ev) return null;
    return b.add({ persona, kind: "cal.rsvp", minute, deps: [ev.key], refs: [ev.key],
      params: { event: ev.key, response: rng.weighted([["accepted", 6], ["tentative", 2], ["declined", 1]]) } });
  },

  "cal.reschedule": ({ b, rng }, persona, _project, minute) => {
    const ev = b.pickObject("event", persona, { ownedBy: persona });
    if (!ev) return null;
    return b.add({ persona, kind: "cal.reschedule", minute, deps: [ev.key], refs: [ev.key], params: { event: ev.key, shiftMinutes: rng.pick([-60, 30, 60, 1440]) } });
  },

  "contact.create": ({ b, world, rng }, persona, project, minute) => {
    const client = project ? world.client(project.client) : rng.pick(world.clients.filter((c) => !c.confidential));
    return b.add({ persona, kind: "contact.create", minute, type: "contact", scope: `own:${persona}`, creates: b.key("contact"),
      params: { name: client.contact, org: client.org, email: client.email, phone: client.phone } });
  },

  "contact.edit": ({ b, rng }, persona, _project, minute) => {
    const contact = b.pickObject("contact", persona, { ownedBy: persona, preferTonight: 0.3 });
    if (!contact) return null;
    return b.add({ persona, kind: "contact.edit", minute, deps: [contact.key], refs: [contact.key],
      params: { contact: contact.key, note: rng.pick(["Voorkeur: bellen na 14:00", "Prefers email", "Nieuwe titel: hoofd marketing", "Assistent: Jet"]) } });
  },

  "meet.schedule": (ctx, persona, project, minute) => {
    const { b, world, rng, date } = ctx;
    const external = project && ["intake", "strategy"].includes(project.phase) && world.persona(persona).role !== "designer";
    const members = project ? world.projectMembersOn(project, date) : world.teamMembersOn("studio", date);
    const attendees = rng.shuffle(members.filter((m) => m !== persona)).slice(0, rng.int(1, 4)).sort();
    const { start, minutes } = b.slot(persona, rng.int(1, 7));
    return b.add({ persona, kind: "meet.schedule", minute, type: "event", scope: scopeFor(project), project: project?.id, creates: b.key("event"),
      params: { title: uniqueTitle(b, `${project ? project.name : "Studio"} — ${MEET_TOPICS[b.actions.filter((x) => x.kind === "meet.schedule" && x.params.channel === channelFor(project)).length % MEET_TOPICS.length]}`, start), start, minutes, attendees, meet: true,
        channel: channelFor(project), external: external ? [world.client(project.client).email] : [] } });
  },

  "drive.upload": ({ b, world, rng }, persona, project, minute, { size = "export" } = {}) => {
    if (!project) return null;
    if (size === "print" && b.actions.filter((a) => a.params.size === "print").length >= MAX_PRINT_UPLOADS) return null;
    const range = size === "print" ? world.rhythm.printFileBytes : world.rhythm.exportFileBytes;
    const bytes = rng.int(range.min, range.max);
    if (!b.reserveDrive(bytes)) return null;
    const base = rng.pick(size === "print" ? b.corpus.files.print : b.corpus.files.exports);
    const ext = size === "print" ? ".pdf" : rng.pick(b.corpus.files.extensions.exports);
    return b.add({ persona, kind: "drive.upload", minute, type: "file", scope: scopeFor(project), project: project.id, creates: b.key("file"),
      params: { folder: folderFor(project), name: `${base}_${rng.int(1, 99)}${ext}`, bytes, size } });
  },

  "drive.version": ({ b, rng }, persona, project, minute) => {
    const file = b.pickObject("file", persona, { project: project?.id, where: (o) => o.size !== "print" });
    if (!file) return null;
    const bytes = rng.int(200000, 4000000);
    if (!b.reserveDrive(bytes)) return null;
    return b.add({ persona, kind: "drive.version", minute, deps: [file.key], refs: [file.key], params: { file: file.key, bytes } });
  },

  "drive.rename": ({ b, rng }, persona, project, minute) => {
    const file = b.pickObject("file", persona, { project: project?.id });
    if (!file) return null;
    return b.add({ persona, kind: "drive.rename", minute, deps: [file.key], refs: [file.key], params: { file: file.key, suffix: rng.pick(["_v2", "_def", "_klant", "_final"]) } });
  },

  "drive.move": ({ b }, persona, project, minute) => {
    const file = b.pickObject("file", persona, { project: project?.id });
    if (!file || !file.project) return null;
    return b.add({ persona, kind: "drive.move", minute, deps: [file.key], refs: [file.key], params: { file: file.key, subfolder: "Archief" } });
  },

  "drive.delete": ({ b }, persona, project, minute, { superseded = false } = {}) => {
    const file = b.pickObject("file", persona, { project: project?.id, preferTonight: 0, where: (o) => !superseded || o.size === "print" });
    if (!file) return null;
    return b.add({ persona, kind: "drive.delete", minute, deps: [file.key], refs: [file.key], consumes: [file.key], params: { file: file.key, bytes: file.bytes ?? 0 } });
  },

  "drive.share": ({ b, world }, persona, project, minute) => {
    if (!project) return null;
    const file = b.pickObject("file", persona, { project: project.id });
    if (!file) return null;
    return b.add({ persona, kind: "drive.share", minute, type: "share", scope: file.scope, project: project.id, creates: b.key("share"),
      deps: [file.key], refs: [file.key], params: { file: file.key, client: world.client(project.client).email } });
  },

  "drive.guestDownload": ({ b }, persona, project, minute) => {
    const share = b.pickObject("share", persona, { project: project?.id, preferTonight: 0.8 });
    if (!share) return null;
    return b.add({ persona, kind: "drive.guestDownload", minute, deps: [share.key], refs: [share.key], params: { share: share.key } });
  },

  "chat.leave": ({ b }, persona, project, minute) => {
    if (!project) return null;
    return b.add({ persona, kind: "chat.leave", minute, refs: [`channel:project:${project.id}`], params: { channel: `channel:project:${project.id}` } });
  },

  gap: ({ b, world, rng }, persona, _project, minute) => {
    const pool = b.corpus.gaps[world.persona(persona).role];
    if (!pool) return null;
    return b.add({ persona, kind: "gap", minute, layer: "none", params: rng.pick(pool) });
  },
};

/** Weighted kinds per project phase; studio-level work when the persona has no active project. */
export const PHASE_MENU = {
  intake: [["contact.create", 2], ["cal.event", 2], ["meet.schedule", 2], ["doc.create", 2], ["chat.post", 2], ["note.create", 1]],
  kickoff: [["task.create", 4], ["chat.post", 2], ["cal.event", 2], ["task.assign", 1], ["doc.create", 1], ["chat.mention", 1]],
  strategy: [["note.create", 2], ["note.edit", 2], ["doc.edit", 3], ["doc.comment", 2], ["chat.post", 2], ["meet.schedule", 1], ["task.comment", 1], ["chat.reply", 2]],
  design: [["drive.upload", 3], ["drive.version", 2], ["doc.comment", 2], ["chat.reply", 2], ["chat.post", 1], ["task.complete", 1], ["drive.rename", 1], ["doc.resolve", 1]],
  production: [["drive.upload", 3], ["drive.share", 3], ["drive.guestDownload", 2], ["task.complete", 2], ["chat.post", 1], ["drive.move", 1]],
  close: [["task.archive", 3], ["drive.delete", 2], ["chat.post", 1], ["note.edit", 1], ["chat.leave", 1]],
  studio: [["chat.post", 3], ["chat.dm", 3], ["chat.reply", 2], ["cal.rsvp", 2], ["note.create", 1], ["note.edit", 1], ["contact.edit", 1], ["task.comment", 1], ["doc.resolve", 1], ["cal.reschedule", 1]],
};
