import { slugify } from "../../client/ids.mjs";
import { davUrl, projectFolder } from "./paths.mjs";

/**
 * Creates one piece of standing structure as its owner (the project's PM).
 * Team channels already exist: creating a Team provisions its default
 * channel, so the reconciler only looks it up.
 */
export function createInfra({ world, client, origin }) {
  return async function infraCreate(item) {
    const owner = client(item.owner);
    if (item.type === "channel" && item.key.startsWith("channel:team:")) {
      const { list } = await owner.get("/api/v1/chat/channels");
      const ch = list.find((c) => c.groupSlug === item.scope && c.isDefault) ?? list.find((c) => c.groupSlug === item.scope);
      if (!ch) throw new Error(`no default channel for Team ${item.scope} visible to ${item.owner}`);
      return { channelId: ch.id };
    }
    if (item.type === "channel") {
      const res = await owner.request("POST", "/api/v1/chat/channels", { json: { name: slugify(item.name), kind: "channel", groupSlug: item.scope } });
      if (res.ok) return { channelId: res.json.id };
      const { list } = await owner.get("/api/v1/chat/channels");
      const ch = list.find((c) => c.name === slugify(item.name) && c.groupSlug === item.scope);
      if (!ch) throw new Error(`create channel ${item.name}: HTTP ${res.status} ${res.text.slice(0, 200)}`);
      return { channelId: ch.id };
    }
    if (item.type === "tasklist") {
      const { list } = await owner.get("/api/v1/tasks/tasklists");
      const found = list.find((l) => l.name === item.name);
      if (found) return { listId: found.id };
      const created = await owner.post("/api/v1/tasks/tasklists", { name: item.name, groupSlug: item.scope });
      return { listId: created.id };
    }
    if (item.type === "folder" && item.key.startsWith("folder:team:")) return { path: `/groups/${item.scope}` };
    if (item.type === "folder") {
      const path = projectFolder(world, item.project);
      const res = await owner.raw("MKCOL", davUrl(origin, path) + "/", { auth: "basic" });
      if (![201, 405].includes(res.status)) throw new Error(`MKCOL ${path}: HTTP ${res.status} ${res.text.slice(0, 200)}`);
      return { path };
    }
    throw new Error(`unknown infra type ${item.type}`);
  };
}
