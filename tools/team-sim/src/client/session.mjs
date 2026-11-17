import { ADMIN_PASSWORD, personaPassword } from "../instance/config.mjs";
import { createClient } from "./http.mjs";

/** The dev seed's two accounts share the dev password (WGW_DEV_PASSWORD). */
const DEV_ACCOUNTS = ["admin", "member"];

/**
 * Clients for every account of one run, created lazily and cached. API
 * actors, DAV actors and oracles each get their own client per persona (a
 * separate login), tagged with the layer in the request log.
 */
export function createSessions({ origin, requestLog, resetBudget }) {
  const cache = new Map();
  return function client(username, layer = "api") {
    const k = `${username}:${layer}`;
    if (!cache.has(k)) {
      cache.set(
        k,
        createClient({
          origin,
          username,
          password: DEV_ACCOUNTS.includes(username) ? ADMIN_PASSWORD : personaPassword(username),
          persona: username,
          layer,
          requestLog,
          onBudget: resetBudget,
        }),
      );
    }
    return cache.get(k);
  };
}
