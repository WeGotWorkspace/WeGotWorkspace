import { infraOn } from "../world/infra.mjs";
import { createBuilder } from "./builder.mjs";
import { assertIsoDate, isWeekend, weekday } from "./dates.mjs";
import { KINDS, PHASE_MENU } from "./kinds.mjs";
import { canonicalJson, createRng, seedFrom, sha256 } from "./prng.mjs";
import { rosterFor, uiPersonasFor } from "./roster.mjs";
import { assignDevices, googleActions } from "./google.mjs";

const ALL_APPS = ["chat", "docs", "notes", "tasks", "calendar", "contacts", "drive", "meet"];
/** A kind per app used to fill a missing app/layer pair. */
const FILL_KIND = { chat: "chat.post", docs: "doc.edit", notes: "note.create", tasks: "task.create", calendar: "cal.event", contacts: "contact.create", drive: "drive.upload", meet: "meet.schedule" };
const UI_FILL_KIND = { ...FILL_KIND, meet: "meet.call", docs: "doc.edit" };
const WORKDAY_MINUTES = 510;

/**
 * The night's action list: a pure function of (world, date, snapshot summary).
 * `snapshot` is `{ objects: [{ key, type, scope, project, owner, status, ... }], driveBytes }`
 * read from the registry inside the night's snapshot.
 */
export function planNight({ world, date, snapshot = { objects: [], driveBytes: 0 }, options = {} }) {
  assertIsoDate(date);
  const rng = createRng(seedFrom(`team-sim:${date}`));
  const { present, absent } = rosterFor(world, date, rng);
  const ui = uiPersonasFor(world, date, present, rng);
  const b = createBuilder({ world, date, rng: rng.fork("actions"), snapshot, ui });
  const ctx = { b, world, rng: rng.fork("kinds"), date };
  const projects = world.projectsOn(date);
  const light = isWeekend(date);

  if (!light) rhythm(ctx, present, projects);

  const range = world.rhythm.actionsPerPersona[light ? "weekend" : "weekday"];
  const perPersona = rng.fork("counts");
  for (const persona of present) {
    const count = perPersona.int(range[0], range[1]);
    // Intake work happens in the Business Team; others join a project from kick-off.
    const business = world.teamsOf(persona).includes("business");
    const mine = projects.filter((p) => (world.projectMembersOn(p, date).includes(persona) || p.pm === persona) && (p.phase !== "intake" || business));
    const sales = world.persona(persona).role === "sales";
    for (let i = 0; i < count; i += 1) {
      const minute = ctx.rng.int(20, WORKDAY_MINUTES - 1);
      drawAction(ctx, persona, mine, sales, projects, minute);
    }
    if (ctx.rng.chance(light ? 0.05 : 0.18)) KINDS.gap(ctx, persona, null, ctx.rng.int(0, WORKDAY_MINUTES - 1));
  }

  if (!light) {
    traitActions(ctx, present, ui, projects);
    fillCoverage(ctx, present, ui, projects);
  }
  // Since the move from Google: habits and leftovers from the export. Own stream, so the rest of the plan does not shift.
  googleActions({ b, world, date, rng: rng.fork("google"), present, ui, projects, light, all: options.habits === "all" });

  const actions = assignDevices(b.finish(), { world, rng: rng.fork("devices") });
  const hash = sha256(canonicalJson({ date, worldVersion: world.meta.version, actions, ...(options.habits ? { options } : {}) }));
  return {
    date,
    worldVersion: world.meta.version,
    weekday: weekday(date),
    light,
    present,
    absent,
    ui,
    infra: infraOn(world, date).map((i) => i.key),
    actions,
    hash,
    ...(options.habits ? { options } : {}),
  };
}

function drawAction(ctx, persona, mine, sales, projects, minute) {
  const { rng } = ctx;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let project = mine.length && rng.chance(0.75) ? rng.pick(mine) : null;
    if (!project && sales) project = projects.find((p) => p.phase === "intake") ?? null;
    const menu = project ? PHASE_MENU[project.phase] : PHASE_MENU.studio;
    const kind = rng.weighted(menu);
    const opts = kind === "drive.upload" && ctx.world.persona(persona).traits?.includes("big-uploads") && ["design", "production"].includes(project?.phase)
      ? { size: "print" } : kind === "cal.event" && project?.phase === "intake" ? { external: true } : {};
    if (kind === "drive.delete" && project?.phase === "close") opts.superseded = true;
    if (KINDS[kind](ctx, persona, project, minute, opts)) return;
  }
}

/** Studio rhythm: Monday studio meeting, daily stand-up per project, Friday deadlines. */
function rhythm(ctx, present, projects) {
  const { world, date, rng } = ctx;
  if (weekday(date) === world.rhythm.studioMeeting.weekday) {
    const host = present.find((p) => world.persona(p).role === "pm") ?? present[0];
    if (host) KINDS["meet.schedule"](ctx, host, null, 10);
  }
  for (const project of projects) {
    if (project.phase === "intake") continue;
    const pm = present.includes(project.pm) ? project.pm : null;
    if (pm) KINDS["chat.post"](ctx, pm, project, 15);
    if (pm && weekday(date) === world.rhythm.deadlineWeekday) KINDS["task.complete"](ctx, pm, project, rng.int(400, 500));
  }
}

/** Each persona's trait under test gets at least one action that exercises it. */
function traitActions(ctx, present, ui, projects) {
  const { world, date, rng, b } = ctx;
  const mineOf = (p) => projects.filter((x) => world.projectMembersOn(x, date).includes(p) && (x.phase !== "intake" || world.teamsOf(p).includes("business")));
  for (const persona of present) {
    const traits = world.persona(persona).traits ?? [];
    const project = mineOf(persona)[0] ?? null;
    if (traits.includes("big-uploads") && project) KINDS["drive.upload"](ctx, persona, project, rng.int(60, 400), { size: "print" });
    if (traits.includes("share-links") && project) {
      KINDS["drive.upload"](ctx, persona, project, rng.int(40, 200));
      KINDS["drive.share"](ctx, persona, project, rng.int(210, 300));
      KINDS["drive.guestDownload"](ctx, persona, project, rng.int(310, 400));
    }
    if (traits.includes("guest-intakes")) {
      const intake = projects.find((p) => p.phase === "intake") ?? project;
      if (intake) KINDS["cal.event"](ctx, persona, intake, rng.int(30, 200), { external: true, title: `Intake ${intake.name}` });
    }
    if (traits.includes("heavy-calendar")) for (const p of mineOf(persona)) KINDS["cal.event"](ctx, persona, p, rng.int(30, 480));
    if (traits.includes("dav-only")) {
      KINDS["cal.event"](ctx, persona, project, rng.int(30, 480));
      KINDS["contact.create"](ctx, persona, project, rng.int(30, 480));
    }
  }
  // Docs co-writing: two browser personas in the same doc at once.
  const writers = ui.filter((p) => world.sharesTeam(p, ui[0]));
  if (writers.length >= 2) {
    const doc = b.pickObject("doc", writers[0], { where: (o) => world.canRead(writers[1], o.scope) });
    if (doc) {
      const minute = rng.int(240, 300);
      b.add({ persona: writers[0], kind: "doc.cowrite", minute, deps: [doc.key], refs: [doc.key], params: { doc: doc.key, partner: writers[1], text: b.line(b.corpus.docs.paragraphs, writers[0]) } });
    }
  }
  // Browser behaviours: offline mid-edit, a reload mid-action, a second tab.
  const offline = ui.find((p) => world.persona(p).traits?.includes("offline"));
  const flagged = new Set();
  const flag = (persona, flags) => {
    const own = b.actions.filter((a) => a.persona === persona && a.layer === "ui" && !a.flags && ["note.edit", "note.create", "chat.post", "task.create"].includes(a.kind));
    if (own.length) { own[0].flags = flags; flagged.add(persona); }
  };
  if (offline) flag(offline, { offline: true });
  const rest = ui.filter((p) => !flagged.has(p));
  if (rest[0]) flag(rest[0], { reload: true });
  if (rest[1]) flag(rest[1], { secondTab: true });
}

/** Every app is used through both layers each night; the browser personas touch every app. */
function fillCoverage(ctx, present, ui, projects) {
  const { b, world, date, rng } = ctx;
  const projectOf = (p) =>
    projects.find((x) => world.projectMembersOn(x, date).includes(p) && x.phase !== "intake") ??
    (world.teamsOf(p).includes("business") ? projects.find((x) => world.projectMembersOn(x, date).includes(p)) : null) ??
    (world.persona(p).role === "sales" ? projects.find((x) => x.phase === "intake") : null) ??
    null;
  const has = (app, layer) => b.actions.some((a) => a.app === app && (layer === "api" ? a.layer === "api" || a.layer === "dav" : a.layer === "ui"));
  const apiPeople = present.filter((p) => !ui.includes(p));
  for (const app of ALL_APPS) {
    if (!has(app, "api") && apiPeople.length) {
      const persona = rng.pick(apiPeople);
      fill(ctx, persona, projectOf(persona), FILL_KIND[app], rng.int(30, 480));
    }
    if (!has(app, "ui") && ui.length) {
      const persona = ["contacts", "calendar", "tasks"].includes(app) ? ui.find((p) => world.appMode(p, app) === "web") ?? ui[0] : rng.pick(ui);
      const kind = UI_FILL_KIND[app];
      if (kind === "meet.call") {
        const project = projectOf(persona);
        b.add({ persona, kind, minute: rng.int(300, 420), params: { project: project?.id ?? null, guest: project ? world.client(project.client).contact : "Gast", guestEmail: project ? world.client(project.client).email : null } });
      } else {
        fill(ctx, persona, projectOf(persona), kind, rng.int(30, 480));
      }
    }
  }
}

function fill(ctx, persona, project, kind, minute) {
  const fallback = { "doc.edit": "doc.create", "task.create": "task.create" };
  return KINDS[kind](ctx, persona, project, minute) ?? (fallback[kind] && KINDS[fallback[kind]](ctx, persona, project, minute));
}
