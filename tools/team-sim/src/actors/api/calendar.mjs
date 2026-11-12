import { roomCode, uuid } from "../../client/ids.mjs";
import { USING, jmap1, setOk } from "../../client/jmap.mjs";
import { need } from "./collab.mjs";

const localStart = (iso) => iso.replace(/\.\d{3}Z$|Z$/, "").slice(0, 19);
const shiftIso = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString();

function participants(ctx, organizer, attendees, external) {
  const p = { org: { "@type": "Participant", email: ctx.world.email(organizer), name: ctx.world.persona(organizer).displayName, roles: { owner: true, attendee: true }, participationStatus: "accepted" } };
  for (const id of attendees) {
    p[`a-${id}`] = { "@type": "Participant", email: ctx.world.email(id), name: ctx.world.persona(id).displayName, roles: { attendee: true }, expectReply: true, participationStatus: "needs-action" };
  }
  external.forEach((email, i) => {
    p[`x${i}`] = { "@type": "Participant", email, name: email.split("@")[0], roles: { attendee: true }, expectReply: true, participationStatus: "needs-action" };
  });
  return p;
}

async function createEvent(a, ctx, extra = {}) {
  const c = ctx.client(a.persona);
  const uid = uuid();
  const event = {
    "@type": "Event",
    uid,
    calendarIds: { default: true },
    title: a.params.title,
    start: localStart(a.params.start),
    timeZone: "Etc/UTC",
    duration: `PT${a.params.minutes}M`,
    participants: participants(ctx, a.persona, a.params.attendees, a.params.external ?? []),
    ...extra,
  };
  const res = setOk(await jmap1(c, USING.calendars, "CalendarEvent/set", { accountId: c.username, create: { e: event } }), "CalendarEvent create");
  for (const to of a.params.attendees) ctx.expectNotify({ to, domain: "calendar", action: "invite", from: a.persona, n: a.n, title: a.params.title });
  for (const to of a.params.external ?? []) ctx.expectMail({ to, n: a.n, title: a.params.title });
  return { eventId: res.created.e.id, uid, calendarId: "default" };
}

export const calendarExecutors = {
  async "cal.event"(a, ctx) {
    const ids = await createEvent(a, ctx);
    return { ids, extra: { attendees: a.params.attendees, external: a.params.external, title: a.params.title, start: a.params.start } };
  },

  async "meet.schedule"(a, ctx) {
    const c = ctx.client(a.persona);
    const code = roomCode();
    await c.post("/api/v1/meetings/rooms", { room: code, ownerPrincipal: `u:${a.persona}` });
    const meeting = await c.post("/api/v1/chat/channels", { name: a.params.title, kind: "meeting", guestRoomCode: code });
    const href = `${ctx.origin}/meet/meetings/${code}`;
    const ids = await createEvent(a, ctx, { links: { meet: { "@type": "Link", href, rel: "describedby" } } });
    const channel = ctx.registry.get(a.params.channel);
    if (channel?.ids) {
      await c.post(`/api/v1/chat/channels/${encodeURIComponent(channel.ids.channelId)}/messages`, { id: (await import("../../client/ids.mjs")).ulid(), body: `${a.params.title}: ${href}` });
    }
    return { ids: { ...ids, room: code, meetingChannelId: meeting.id }, extra: { attendees: a.params.attendees, external: a.params.external, title: a.params.title, start: a.params.start } };
  },

  async "cal.rsvp"(a, ctx) {
    const ev = need(ctx, a.params.event);
    const c = ctx.client(a.persona);
    const { list } = await c.get("/api/v1/calendars/scheduling/notifications");
    const hit = list.find((n) => n.uid === ev.ids.uid) ?? list.find((n) => n.title === ev.title);
    if (!hit) throw new Error(`no invitation for "${ev.title}" in ${a.persona}'s scheduling inbox (${list.length} items)`);
    await c.post(`/api/v1/calendars/scheduling/notifications/${encodeURIComponent(hit.id)}/respond`, { participationStatus: a.params.response, calendarId: "default" });
    return {};
  },

  async "cal.reschedule"(a, ctx) {
    const ev = need(ctx, a.params.event);
    const c = ctx.client(a.persona);
    if (ev.ids.href) return ctx.dav["cal.reschedule"](a, ctx);
    const start = shiftIso(ev.start, a.params.shiftMinutes);
    setOk(await jmap1(c, USING.calendars, "CalendarEvent/set", { accountId: c.username, update: { [ev.ids.eventId]: { start: localStart(start) } } }), "CalendarEvent reschedule");
    return { patch: { key: a.params.event, start } };
  },

  async "contact.create"(a, ctx) {
    const c = ctx.client(a.persona);
    const card = {
      "@type": "Card",
      version: "1.0",
      kind: "individual",
      addressBookIds: { default: true },
      name: { "@type": "Name", full: a.params.name },
      organizations: { o1: { "@type": "Organization", name: a.params.org } },
      emails: { e1: { "@type": "EmailAddress", address: a.params.email } },
      phones: { p1: { "@type": "Phone", number: a.params.phone } },
    };
    const res = setOk(await jmap1(c, USING.contacts, "ContactCard/set", { accountId: c.username, create: { c: card } }), "ContactCard create");
    return { ids: { cardId: res.created.c.id }, extra: { name: a.params.name, email: a.params.email } };
  },

  async "contact.edit"(a, ctx) {
    const card = need(ctx, a.params.contact);
    if (card.ids.href) return ctx.dav["contact.edit"](a, ctx);
    const c = ctx.client(a.persona);
    setOk(await jmap1(c, USING.contacts, "ContactCard/set", { accountId: c.username, update: { [card.ids.cardId]: { notes: { n1: { "@type": "Note", note: a.params.note } } } } }), "ContactCard update");
    return { patch: { key: a.params.contact, note: a.params.note } };
  },
};
