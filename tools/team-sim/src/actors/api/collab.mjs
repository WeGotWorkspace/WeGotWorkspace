import { ulid, uuid } from "../../client/ids.mjs";

/**
 * Chat, Tasks and Notes executors. Each gets (action, ctx) and returns
 * `{ ids, extra }` for the object it created, or `{ patch: { key, ... } }`
 * for a status change; the dispatcher writes the registry.
 */
export class Unsupported extends Error {
  constructor(message) {
    super(message);
    this.unsupported = true;
  }
}

export const need = (ctx, key) => {
  const o = ctx.registry.get(key);
  if (!o?.ids) throw new Error(`unknown object ${key} (not in the registry)`);
  return o;
};

async function postMessage(c, channelId, body, extra = {}) {
  const id = ulid();
  const msg = await c.post(`/api/v1/chat/channels/${encodeURIComponent(channelId)}/messages`, { id, body, ...extra });
  return { channelId, messageId: msg?.id ?? id };
}

export const collabExecutors = {
  async "chat.post"(a, ctx) {
    const ch = need(ctx, a.params.channel);
    return { ids: await postMessage(ctx.client(a.persona), ch.ids.channelId, a.params.text), extra: { channel: a.params.channel } };
  },

  async "chat.reply"(a, ctx) {
    const parent = need(ctx, a.params.parent);
    const ids = await postMessage(ctx.client(a.persona), parent.ids.channelId, a.params.text, { parentId: parent.ids.messageId });
    return { ids, extra: { channel: parent.channel ?? a.params.channel, parent: a.params.parent } };
  },

  async "chat.mention"(a, ctx) {
    const ch = need(ctx, a.params.channel);
    const who = ctx.world.persona(a.params.mention);
    const body = `@${who.displayName} ${a.params.text}`;
    const ids = await postMessage(ctx.client(a.persona), ch.ids.channelId, body, { mentions: [{ id: who.id, displayName: who.displayName }] });
    ctx.expectNotify({ to: a.params.mention, domain: "chat", action: "mentioned", from: a.persona, n: a.n });
    return { ids, extra: { channel: a.params.channel, mention: a.params.mention } };
  },

  async "chat.dm"(a, ctx) {
    const c = ctx.client(a.persona);
    const dm = await c.post("/api/v1/chat/dms", { principal: a.params.to });
    return { ids: await postMessage(c, dm.id, a.params.text), extra: { to: a.params.to } };
  },

  async "chat.leave"(a, ctx) {
    const ch = need(ctx, a.params.channel);
    const res = await ctx.client(a.persona).request("DELETE", `/api/v1/chat/channels/${encodeURIComponent(ch.ids.channelId)}`);
    if (res.ok) return { note: "left" };
    if (res.status >= 500) throw new Error(`leave channel → HTTP ${res.status}`);
    throw new Unsupported(`cannot leave a Team project channel without leaving the Team (HTTP ${res.status})`);
  },

  async "task.create"(a, ctx) {
    const list = need(ctx, a.params.list);
    const assignee = ctx.world.persona(a.params.assignee);
    const due = new Date(Date.parse(`${ctx.date}T16:00:00Z`) + a.params.dueInDays * 86400000).toISOString().slice(0, 19);
    const task = await ctx.client(a.persona).post("/api/v1/tasks/items", {
      taskListIds: { [list.ids.listId]: true },
      title: a.params.title,
      due,
      participants: participantFor(ctx, assignee),
    });
    return { ids: { taskId: task.id, listId: list.ids.listId }, extra: { status: "open", assignee: a.params.assignee, title: a.params.title } };
  },

  async "task.assign"(a, ctx) {
    const t = need(ctx, a.params.task);
    await patchTask(ctx.client(a.persona), t.ids.taskId, { participants: participantFor(ctx, ctx.world.persona(a.params.assignee)) });
    return { patch: { key: a.params.task, assignee: a.params.assignee } };
  },

  async "task.comment"() {
    throw new Unsupported("Tasks have no comments; the persona would use chat instead");
  },

  async "task.complete"(a, ctx) {
    const t = need(ctx, a.params.task);
    await patchTask(ctx.client(a.persona), t.ids.taskId, { workflowStatus: "completed" });
    return { patch: { key: a.params.task, status: "done" } };
  },

  async "task.archive"(a, ctx) {
    const t = need(ctx, a.params.task);
    await patchTask(ctx.client(a.persona), t.ids.taskId, { workflowStatus: "cancelled" });
    return { patch: { key: a.params.task, status: "archived" }, note: "Tasks have no archive; marked cancelled" , friction: "Tasks have no archive; closing a project leaves every done task in the list" };
  },

  async "note.create"(a, ctx) {
    const uid = uuid();
    const note = await ctx.client(a.persona).post("/api/v1/notes/items", { uid, notebookId: "notes-general", title: a.params.title, body: a.params.body });
    return { ids: { noteId: note?.id ?? uid }, extra: { title: a.params.title } };
  },

  async "note.edit"(a, ctx) {
    const n = need(ctx, a.params.note);
    const c = ctx.client(a.persona);
    const note = await c.get(`/api/v1/notes/items/${n.ids.noteId}`);
    await c.patch(`/api/v1/notes/items/${n.ids.noteId}`, { body: `${note.body ?? ""}\n${a.params.append}` }, { headers: { "if-match": note.etag } });
    return {};
  },
};

function participantFor(ctx, persona) {
  return { assignee: { "@type": "Participant", name: persona.displayName, email: ctx.world.email(persona.id), roles: { attendee: true }, participationStatus: "needs-action" } };
}

async function patchTask(c, id, body) {
  const task = await c.get(`/api/v1/tasks/items/${encodeURIComponent(id)}`);
  return c.patch(`/api/v1/tasks/items/${encodeURIComponent(id)}`, body, { headers: { "if-match": task.etag } });
}
