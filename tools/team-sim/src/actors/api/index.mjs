import { calendarExecutors } from "./calendar.mjs";
import { collabExecutors } from "./collab.mjs";
import { davExecutors } from "./dav.mjs";
import { fileExecutors } from "./files.mjs";

export const apiExecutors = { ...collabExecutors, ...fileExecutors, ...calendarExecutors };
export { davExecutors };

/** Runs one action through the API or DAV layer. */
export async function executeApi(action, ctx) {
  const table = action.layer === "dav" ? { ...apiExecutors, ...davExecutors } : apiExecutors;
  const fn = table[action.kind];
  if (!fn) throw new Error(`no API executor for ${action.kind}`);
  const client = ctx.client(action.persona, action.layer === "dav" ? "dav" : "api");
  client.setAction(action.n);
  return fn(action, { ...ctx, dav: davExecutors });
}

/** Writes an executor's result into the registry. */
export function recordResult(registry, action, result, date) {
  if (!result) return;
  if (action.creates && result.ids) {
    registry.put(action.creates, {
      ...(action.object ?? {}),
      owner: action.persona,
      status: result.extra?.status ?? "active",
      ids: result.ids,
      ...(result.extra ?? {}),
      night: date,
      action: action.n,
    });
  }
  if (result.patch) {
    const { key, ...patch } = result.patch;
    if (registry.get(key)) registry.update(key, { ...patch, touched: date });
  }
  for (const key of action.refs ?? []) if (registry.get(key)) registry.update(key, { touched: date });
}
