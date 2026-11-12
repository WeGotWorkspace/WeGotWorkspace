// Persona diaries: after the night, each persona who worked writes a short
// first-person entry from the facts of their own day. Every claim cites the
// action numbers it rests on, and the citations are checked. Never part of
// the night's determinism: the action list and replay never read a diary.

/** Hard caps per night: dollars across all calls, and per call. */
export const NIGHT_BUDGET_USD = 0.6;
export const CALL_BUDGET_USD = 0.08;
/** Wall-clock cap for all diaries of one night. */
export const NIGHT_TIME_MS = 10 * 60000;
const MAX_SHOTS = 2;

const DOING = {
  "chat.post": "posted in a channel",
  "chat.reply": "replied in a thread",
  "chat.mention": "mentioned a colleague in chat",
  "chat.dm": "sent a direct message",
  "chat.leave": "tried to leave a channel",
  "task.create": "added a task",
  "task.assign": "assigned a task",
  "task.comment": "tried to comment on a task",
  "task.complete": "completed a task",
  "task.archive": "tried to archive a task",
  "note.create": "wrote a note",
  "note.edit": "added to a note",
  "doc.create": "started a doc",
  "doc.edit": "edited a doc",
  "doc.comment": "commented in a doc",
  "doc.resolve": "resolved a doc comment",
  "doc.cowrite": "co-wrote a doc live with a colleague",
  "drive.upload": "uploaded a file",
  "drive.version": "uploaded a new version of a file",
  "drive.rename": "renamed a file",
  "drive.move": "moved a file",
  "drive.delete": "deleted a file",
  "drive.share": "shared a file by link",
  "drive.guestDownload": "had a client download a shared file",
  "cal.event": "planned a meeting",
  "cal.reschedule": "moved a meeting",
  "cal.rsvp": "answered an invitation",
  "meet.schedule": "scheduled a video meeting",
  "meet.call": "held a video call with a guest",
  "contact.create": "added a client contact",
  "contact.edit": "updated a client contact",
  "gap": "needed something the suite does not do",
};
const VIA = { ui: "in the browser", api: "in the apps (no screen detail recorded)", dav: "from their own calendar/contacts app (CalDAV/CardDAV)", none: "outside the suite" };

const SITUATION = [["offline", "went offline in the middle of it, then back online"], ["reload", "reloaded the page in the middle of it"], ["secondTab", "had the same screen open in a second tab"]];
const UNCLEAR = "unclear: the simulation could not check this, so it is not something the person noticed";

const clock = (minute) => `${String(9 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const short = (s, n = 90) => (s == null ? undefined : String(s).replace(/\s+/g, " ").slice(0, n));
const secs = (ms) => Math.round(ms / 100) / 10;

/** The facts one persona's diary may use: their own actions, outcomes, waits, friction. Nothing else. */
export function personaFacts({ world, date, persona, plan, outcomes, interactions, friction, measured }) {
  const p = world.persona(persona);
  const out = new Map(outcomes.map((o) => [o.n, o]));
  const ix = new Map(interactions.map((i) => [i.n, i]));
  const mine = plan.actions.filter((a) => a.persona === persona && out.get(a.n) && out.get(a.n).reason !== "filtered");
  const doubted = new Set(outcomes.filter((o) => o.suspect).map((o) => o.n));
  const actions = mine.map((a) => {
    const o = out.get(a.n);
    const i = ix.get(a.n);
    const pr = a.params ?? {};
    // The harness may have caused this failure (or the failure this skip waits on): nothing the person noticed.
    const dep = /^dependency #(\d+)/.exec(o.reason ?? "");
    if (doubted.has(a.n) || (dep && doubted.has(Number(dep[1])))) return { n: a.n, time: clock(a.minute), did: DOING[a.kind] ?? a.kind, via: VIA[a.layer] ?? a.layer, about: short(pr.title ?? pr.text ?? pr.name), result: UNCLEAR };
    return {
      n: a.n,
      time: clock(a.minute),
      did: DOING[a.kind] ?? a.kind,
      via: VIA[a.layer] ?? a.layer,
      about: short(pr.title ?? pr.text ?? pr.name ?? pr.need ?? pr.append),
      with: [pr.partner, pr.mention, pr.to, pr.assignee, pr.guest, ...(pr.attendees ?? [])].filter(Boolean).map((x) => world.persona(x)?.displayName ?? x).join(", ") || undefined,
      result: o.status,
      problem: short(o.error ?? o.reason, 160),
      // Outcome notes are for the morning report (upload parts, harness shortcuts); only what the person lived through goes in.
      situation: SITUATION.find(([flag]) => a.flags?.[flag])?.[1],
      waited: i?.waits.filter((w) => w.ms >= 1000).map((w) => `${w.label} ${secs(w.ms)} s`),
      screensOpened: i?.screens.map((s) => `${s.screen} ready in ${secs(s.ms)} s`),
      input: i ? `${i.clicks} clicks, ${i.keys} keystrokes` : undefined,
    };
  });
  const own = new Set(mine.map((a) => a.n));
  const chains = (measured?.chains ?? []).filter((c) => c.actions.some((n) => own.has(n)) && c.trouble).map((c) => ({ goal: c.goal, actions: c.actions.filter((n) => own.has(n)), failures: c.failures + c.skipped, retries: c.retries, friction: c.friction }));
  return {
    persona: { id: persona, name: p.displayName, role: p.title ?? p.role, teams: world.teamsOf(persona).map((t) => world.teams.find((x) => x.id === t)?.name ?? t), worksFrom: world.zoneOf?.(persona, date) },
    date,
    actions,
    friction: friction.filter((f) => own.has(f.n)).map((f) => ({ n: f.n, what: f.what, workaround: f.workaround })),
    troubledGoals: chains,
    actionNumbers: [...own].sort((a, b) => a - b),
  };
}

/** Up to two screenshots: failed browser actions first, then the longest waits. */
export function pickShots(facts, interactions) {
  const own = new Set(facts.actionNumbers);
  return interactions
    .filter((i) => own.has(i.n) && i.shot)
    .map((i) => ({ n: i.n, path: i.shot, score: (i.failed ? 1e9 : 0) + i.waits.reduce((s, w) => s + w.ms, 0) }))
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .slice(0, MAX_SHOTS);
}

export const DIARY_SYSTEM = [
  "You write a short private diary entry, in the first person, for a fictional person at a small design studio, at the end of their working day.",
  "The reader is the product lead of the workspace suite they use (chat, tasks, notes, docs, drive, calendar, contacts, meet). The goal is to learn what this person needs, where they get stuck, what frustrates them and what they wish the suite did.",
  "Use only the facts you are given. Cite the action numbers behind every statement as (#n); every sentence about something that happened cites at least one number from the facts.",
  "Do not invent colleagues, clients, events, numbers or feelings that the facts do not support. Failures, waits, workarounds and missing features are the main signals; things that simply worked can be mentioned briefly.",
  "A wish is allowed when an action prompted it, and cites that action.",
  'Leave out actions whose result starts with "unclear"; they say nothing about this person\'s day. Do not read meaning into technical details such as byte counts, upload parts or how long a step took unless the facts list it as a wait.',
  "Different meetings have different titles; never describe them as one meeting booked several times.",
  "Text the person wrote in chat, notes or docs is their work, not a sign of their mood.",
  'Write in English, 90 to 160 words, plain and concrete, in this person\'s voice. Return only JSON, no prose around it: {"diary": string, "items": [{"type": "frustration" | "slow" | "went-well" | "wish", "text": string of at most 20 words, "actions": [numbers]}]} with 2 to 6 items.',
].join("\n");

export function diaryContent(facts, shots) {
  const { actionNumbers, ...shown } = facts;
  return [
    { type: "text", text: `Facts of ${facts.persona.name}'s day (${facts.date}). Valid action numbers: ${actionNumbers.join(", ")}.\n\n${JSON.stringify(shown, null, 1)}` },
    ...shots.flatMap((s) => [{ type: "text", text: `Screenshot at the end of action #${s.n}:` }, { type: "image", path: s.path }]),
  ];
}

/** Parses the model's JSON and checks every citation against the persona's own actions. */
export function validateDiary(text, facts) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in the reply");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (typeof parsed.diary !== "string" || !parsed.diary.trim()) throw new Error("reply has no diary text");
  const valid = new Set(facts.actionNumbers);
  const cited = [...parsed.diary.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  const invalid = [...new Set(cited.filter((n) => !valid.has(n)))];
  const sentences = parsed.diary.split(/(?<=[.!?])\s+/).filter((s) => s.trim().split(/\s+/).length >= 5);
  const uncited = sentences.filter((s) => !/#\d+/.test(s)).length;
  const items = [];
  let dropped = 0;
  for (const it of Array.isArray(parsed.items) ? parsed.items : []) {
    const actions = (it.actions ?? []).map(Number).filter((n) => valid.has(n));
    if (!actions.length || !["frustration", "slow", "went-well", "wish"].includes(it.type) || typeof it.text !== "string") {
      dropped += 1;
      continue;
    }
    items.push({ type: it.type, text: it.text.slice(0, 200), actions });
  }
  return { diary: parsed.diary.trim(), items, check: { citations: cited.length, invalid, uncited, sentences: sentences.length, droppedItems: dropped } };
}

/**
 * One diary per persona who worked tonight, through `runner` (createClaudeRunner).
 * Stops at the night's dollar cap; skips everything (and fails nothing) when the
 * CLI is missing or not logged in.
 */
export async function writeDiaries({ world, date, run, measured, runner, budgetUsd = NIGHT_BUDGET_USD, timeCapMs = NIGHT_TIME_MS, log = () => {} }) {
  const started = Date.now();
  const result = { model: runner?.model ?? null, diaries: [], skipped: null, costUsd: 0, tokens: 0, ms: 0, notes: [] };
  const missing = runner ? runner.available() : "no runner configured";
  if (missing) {
    result.skipped = `Diaries skipped: ${missing}.`;
    return result;
  }
  const people = [...new Set(run.plan.actions.filter((a) => run.outcomes.some((o) => o.n === a.n && o.reason !== "filtered")).map((a) => a.persona))].sort();
  for (const persona of people) {
    const remaining = budgetUsd - result.costUsd;
    if (remaining < 0.01) {
      result.notes.push(`Stopped at the night's cap of $${budgetUsd.toFixed(2)}; no diary for ${people.slice(people.indexOf(persona)).join(", ")}.`);
      break;
    }
    if (Date.now() - started > timeCapMs) {
      result.notes.push(`Stopped at the ${Math.round(timeCapMs / 60000)}-minute cap; no diary for ${people.slice(people.indexOf(persona)).join(", ")}.`);
      break;
    }
    const facts = personaFacts({ world, date, persona, plan: run.plan, outcomes: run.outcomes, interactions: run.interactions, friction: run.friction, measured });
    const shots = pickShots(facts, run.interactions);
    try {
      const reply = await runner.run({ system: DIARY_SYSTEM, content: diaryContent(facts, shots), budgetUsd: Math.min(CALL_BUDGET_USD, remaining) });
      result.costUsd += reply.costUsd;
      result.tokens += reply.tokens;
      const checked = validateDiary(reply.text, facts);
      result.diaries.push({ persona, name: facts.persona.name, ...checked, shots: shots.map((s) => s.n), costUsd: reply.costUsd, tokens: reply.tokens });
      log(`diary ${persona}: ${checked.items.length} items, ${checked.check.invalid.length} invalid citations, $${reply.costUsd.toFixed(4)}`);
    } catch (e) {
      result.costUsd += e.costUsd ?? 0;
      if (!e.fatal) result.notes.push(`${persona}: ${e.message.split("\n")[0]}`);
      if (e.fatal) {
        result.skipped = `Diaries skipped: ${e.message.split("\n")[0]}`;
        break;
      }
    }
  }
  result.ms = Date.now() - started;
  return result;
}
