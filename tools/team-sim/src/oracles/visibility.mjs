import { USING, jmap1 } from "../client/jmap.mjs";
import { oracleResult } from "./result.mjs";

/**
 * A persona never lists, opens or reaches an object or colleague their Teams
 * do not grant. Private class: failures render only in the report's Private
 * section. Dev accounts `admin` and `member` (Team `team`, dev seed) share no
 * Team with any persona. An admin persona may find and invite every user
 * (people lists), so for admins only DMs, shares, presence, free/busy and
 * object reads are checked against their real Teams.
 */
export async function visibilityOracle({ world, date, probes, objects, sampleSize = 8 }) {
  const failures = [];
  const fail = (persona, what, detail) => failures.push({ signature: `visibility:${what}`, persona, detail: `${persona}: ${detail}` });
  for (const persona of world.personasOn(date)) {
    const mine = new Set(world.teamsOf(persona));
    const mates = new Set(world.personasOn(date).filter((p) => p !== persona && world.sharesTeam(p, persona)));
    const admin = !!world.persona(persona).isAdmin;
    const outsiders = [...world.meta.devAccounts, ...world.personasOn(date).filter((p) => p !== persona && !mates.has(p))];
    const r = await probes.lists(persona);

    if (!admin) {
      for (const u of r.invitees) if (u !== persona && !mates.has(u)) fail(persona, "people-list", `invitee picker lists ${u}, who shares no Team`);
      for (const u of r.sharePrincipals) if (u.startsWith("groups/") ? !mine.has(u.slice(7)) : u !== persona && !mates.has(u)) fail(persona, "share-principals", `share picker offers ${u}`);
    } else {
      for (const u of r.inviteesShared) if (!mates.has(u)) fail(persona, "admin-shares-team-flag", `invitee ${u} is flagged as sharing a Team`);
    }
    for (const u of r.teamMembers) if (!mates.has(u)) fail(persona, "free-busy-list", `TeamMember/get lists ${u}`);
    for (const ch of r.channels) {
      if (ch.groupSlug && !mine.has(ch.groupSlug)) fail(persona, "channel-list", `channel list shows a channel of Team ${ch.groupSlug}`);
      if (ch.dmPeer && !mates.has(ch.dmPeer)) fail(persona, "dm-list", `has a DM with ${ch.dmPeer}, who shares no Team`);
    }
    for (const slug of r.groupFolders) if (!mine.has(slug)) fail(persona, "drive-roots", `Drive shows the folder of Team ${slug}`);
    for (const slug of r.groupTaskLists) if (!mine.has(slug)) fail(persona, "task-lists", `task list of Team ${slug} is listed`);
    for (const slug of r.groupNotebooks) if (!mine.has(slug)) fail(persona, "notebooks", `notebook of Team ${slug} is listed`);
    for (const slug of r.groupCalendars) if (!mine.has(slug)) fail(persona, "calendars", `calendar of Team ${slug} is listed`);
    for (const u of outsiders) {
      const status = await probes.dmStatus(persona, u);
      if (status >= 200 && status < 300) fail(persona, "dm-outsider", `could open a DM with ${u}, who shares no Team`);
    }
    for (const u of outsiders.slice(0, 3)) {
      const fb = await probes.freeBusy(persona, u);
      if (fb) fail(persona, "free-busy", `reads free/busy of ${u}`);
    }
    for (const team of world.teams.filter((t) => !mine.has(t.id))) {
      const status = await probes.folderStatus(persona, `/groups/${team.id}`);
      if (status >= 200 && status < 300) fail(persona, "drive-folder", `opens /groups/${team.id} (HTTP ${status})`);
    }
    const foreign = objects.filter((o) => o.ids && o.status !== "deleted" && o.scope && !o.scope.startsWith("own:") && !o.scope.startsWith("dm:") && world.teams.some((t) => t.id === o.scope) && !mine.has(o.scope));
    for (const o of foreign.slice(-sampleSize)) {
      const status = await probes.objectStatus(persona, o);
      if (status >= 200 && status < 300) fail(persona, `object-read:${o.type}`, `reads ${o.type} ${o.key} of Team ${o.scope} (HTTP ${status})`);
    }
  }
  return oracleResult("visibility", { failures, privateClass: true, notes: [`Checked ${world.personasOn(date).length} personas against their Teams, plus the dev accounts admin and member.`] });
}

/** Live probes over the API, as each persona. */
export function createVisibilityProbes({ client }) {
  const c = (p) => client(p, "oracle");
  return {
    async lists(p) {
      const [inv, princ, chans, lists, books] = await Promise.all([
        c(p).request("GET", "/api/v1/calendars/scheduling/invitees"),
        c(p).request("GET", "/api/v1/files/shares/principals?query="),
        c(p).request("GET", "/api/v1/chat/channels"),
        c(p).request("GET", "/api/v1/tasks/tasklists"),
        c(p).request("GET", "/api/v1/notes/notebooks"),
      ]);
      const top = await jmap1(c(p), USING.files, "FileNode/query", { accountId: p, filter: { isTopLevel: true } });
      const nodes = await jmap1(c(p), USING.files, "FileNode/get", { accountId: p, ids: top.ids, properties: ["name"] });
      const cals = await jmap1(c(p), USING.calendars, "Calendar/get", { accountId: p, ids: null, properties: ["id", "name"] });
      let teamMembers = [];
      try {
        const tm = await jmap1(c(p), USING.availability, "TeamMember/get", { accountId: p, ids: null });
        teamMembers = (tm.list ?? []).filter((m) => !m.isSelf).map((m) => m.id);
      } catch {
        teamMembers = [];
      }
      const invList = inv.json?.list ?? [];
      return {
        invitees: invList.map((u) => u.username),
        inviteesShared: invList.filter((u) => u.sharesTeam && u.username !== p).map((u) => u.username),
        sharePrincipals: (princ.json?.data ?? []).map((x) => x.principal),
        channels: chans.json?.list ?? [],
        groupTaskLists: (lists.json?.list ?? []).map((l) => l.groupSlug).filter(Boolean),
        groupNotebooks: (books.json?.list ?? []).map((b) => b.groupSlug ?? (b.id?.startsWith("group-") ? b.id.slice(6) : null)).filter(Boolean),
        groupFolders: (nodes.list ?? []).map((n) => n.name).filter((n) => n !== p),
        groupCalendars: (cals.list ?? []).map((x) => (x.id?.startsWith("group-") ? x.id.slice(6) : null)).filter(Boolean),
        teamMembers,
      };
    },
    async dmStatus(p, peer) {
      return (await c(p).request("POST", "/api/v1/chat/dms", { json: { principal: peer } })).status;
    },
    async freeBusy(p, peer) {
      const monday = new Date();
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      const start = `${monday.toISOString().slice(0, 10)}T00:00:00Z`;
      const end = new Date(Date.parse(start) + 7 * 86400000).toISOString().slice(0, 19) + "Z";
      try {
        const r = await jmap1(c(p), USING.availability, "TeamMember/getAvailability", { accountId: p, ids: [peer], utcStart: start, utcEnd: end });
        return (r.list ?? []).some((x) => x.id === peer);
      } catch {
        return false;
      }
    },
    async folderStatus(p, path) {
      return (await c(p).request("GET", `/api/v1/files/children?path=${encodeURIComponent(path)}`)).status;
    },
    async objectStatus(p, o) {
      const cp = c(p);
      switch (o.type) {
        case "task":
          return (await cp.request("GET", `/api/v1/tasks/items/${encodeURIComponent(o.ids.taskId)}`)).status;
        case "doc":
        case "file":
          return (await cp.request("GET", `/api/v1/files/content?path=${encodeURIComponent(o.ids.path)}`, { headers: { accept: "*/*", range: "bytes=0-0" } })).status;
        case "message":
          return (await cp.request("GET", `/api/v1/chat/channels/${encodeURIComponent(o.ids.channelId)}/messages?limit=1`)).status;
        case "comment":
          return (await cp.request("GET", `/api/v1/files/threads?path=${encodeURIComponent(o.ids.path)}`)).status;
        default:
          return 404;
      }
    },
  };
}
