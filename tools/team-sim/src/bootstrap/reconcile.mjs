import { personaPassword } from "../instance/config.mjs";

/** Outgoing mail to the project's own MailHog. Each value is needed; see spec "Outgoing mail". */
export const MAIL_SETTINGS = Object.freeze({
  mail_delivery_transport: "smtp",
  mail_delivery_smtp_host: "mailhog",
  mail_delivery_smtp_port: 1025,
  mail_delivery_smtp_security: "none",
  mail_delivery_smtp_username: "team-sim",
  mail_delivery_from: "studio@studiokade.example",
});

const groupId = (slug) => `principals/groups/${slug}`;

/**
 * Diff the world for `date` against the server's users, Teams, memberships,
 * mail settings and standing structure. Pure: `server` is
 *   { users: [{ username, isAdmin, groups: ["principals/groups/x"] }],
 *     groups: [{ id, name }], mail: { transport, smtpHost, ... }, infra: Set(keys) }
 * and the result is the list of writes that `applyPlan` performs.
 */
export function planReconcile({ world, date, server, infra }) {
  const writes = [];
  const users = new Map(server.users.map((u) => [u.username, u]));
  const groups = new Set(server.groups.map((g) => g.name ?? g.id.split("/").pop()));
  const personas = world.personasOn(date);

  for (const id of personas) {
    if (users.has(id)) continue;
    const p = world.persona(id);
    writes.push({ op: "user.create", username: id, body: { username: id, password: personaPassword(id), displayName: p.displayName, email: world.email(id), isAdmin: !!p.isAdmin } });
  }
  for (const id of personas) {
    const u = users.get(id);
    if (u && !!u.isAdmin !== !!world.persona(id).isAdmin) writes.push({ op: "user.admin", username: id, isAdmin: !!world.persona(id).isAdmin });
  }
  for (const team of world.teams) {
    if (!groups.has(team.id)) writes.push({ op: "team.create", slug: team.id, body: { slug: team.id, displayName: team.name } });
    for (const member of world.teamMembersOn(team.id, date)) {
      const has = users.get(member)?.groups?.includes(groupId(team.id));
      if (!has) writes.push({ op: "team.member", slug: team.id, username: member });
    }
  }
  const mail = server.mail ?? {};
  const mailOk = mail.transport === "smtp" && mail.smtpHost === "mailhog" && Number(mail.smtpPort) === 1025 && mail.smtpSecurity === "none" && mail.smtpUsername === MAIL_SETTINGS.mail_delivery_smtp_username && mail.from === MAIL_SETTINGS.mail_delivery_from;
  if (!mailOk) writes.push({ op: "mail.settings", values: MAIL_SETTINGS });
  for (const item of infra) if (!server.infra.has(item.key)) writes.push({ op: "infra.create", item });
  return writes;
}

/** Reads what planReconcile needs from the server (as the dev `admin` service account) and the registry. */
export async function readServer(admin, registry) {
  const state = await admin.get("/api/v1/admin/state");
  return {
    users: state.users,
    groups: state.groups,
    mail: state.mailDelivery?.config,
    infra: new Set(registry.all().filter((o) => ["channel", "tasklist", "folder"].includes(o.type) && o.status !== "deleted").map((o) => o.key)),
  };
}

/** Applies writes in order. `infraCreate(item)` creates one channel, task list or folder and returns its ids. */
export async function applyPlan({ admin, writes, registry, infraCreate, log = () => {} }) {
  for (const w of writes) {
    log(`reconcile: ${describe(w)}`);
    switch (w.op) {
      case "user.create":
        await admin.post("/api/v1/admin/users", w.body);
        break;
      case "user.admin":
        await admin.patch(`/api/v1/admin/users/${w.username}`, { isAdmin: w.isAdmin });
        break;
      case "team.create":
        await admin.post("/api/v1/admin/groups", w.body);
        break;
      case "team.member":
        await admin.put(`/api/v1/admin/groups/${w.slug}/members/${w.username}`, {});
        break;
      case "mail.settings":
        await admin.put("/api/v1/admin/settings", { values: w.values });
        break;
      case "infra.create": {
        const ids = await infraCreate(w.item);
        registry.put(w.item.key, { ...w.item, status: "active", ids, created: new Date().toISOString() });
        registry.save();
        break;
      }
      default:
        throw new Error(`unknown reconcile op ${w.op}`);
    }
  }
}

export function describe(w) {
  switch (w.op) {
    case "user.create":
      return `create user ${w.username}${w.body.isAdmin ? " (admin)" : ""}`;
    case "user.admin":
      return `set admin=${w.isAdmin} on ${w.username}`;
    case "team.create":
      return `create Team ${w.slug}`;
    case "team.member":
      return `add ${w.username} to Team ${w.slug}`;
    case "mail.settings":
      return "set outgoing mail to MailHog";
    case "infra.create":
      return `create ${w.item.type} ${w.item.key}`;
    default:
      return w.op;
  }
}
