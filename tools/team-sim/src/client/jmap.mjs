/** JMAP over a persona's client. Throws on a method-level error so the action fails with it. */
export const USING = {
  calendars: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"],
  contacts: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"],
  files: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:filenode", "https://wegotworkspace.org/jmap/filenode-version-check"],
  assembly: ["urn:ietf:params:jmap:core", "https://wegotworkspace.org/jmap/blob-assembly"],
  availability: ["urn:ietf:params:jmap:core", "urn:wgw:jmap:availability", "urn:ietf:params:jmap:calendars"],
  notes: ["urn:ietf:params:jmap:core", "urn:wgw:jmap:notes"],
  chat: ["urn:ietf:params:jmap:core", "urn:wgw:jmap:chat"],
};

export async function jmap(client, using, calls) {
  const res = await client.post("/api/v1/jmap", { using, methodCalls: calls.map((c, i) => [c[0], c[1], c[2] ?? `c${i}`]) });
  for (const [name, args] of res.methodResponses ?? []) {
    if (name === "error") {
      const e = new Error(`JMAP error ${args.type}: ${args.description ?? ""}`);
      e.jmap = args;
      throw e;
    }
  }
  return res.methodResponses;
}

/** One call, returning its result object. */
export async function jmap1(client, using, name, args) {
  const [[, result]] = await jmap(client, using, [[name, args]]);
  return result;
}

/** Throws when a /set call reports notCreated / notUpdated / notDestroyed. */
export function setOk(result, what) {
  for (const k of ["notCreated", "notUpdated", "notDestroyed"]) {
    const bad = result?.[k] && Object.values(result[k])[0];
    if (bad) {
      const e = new Error(`${what}: ${k} ${bad.type}${bad.description ? ` (${bad.description})` : ""}${bad.properties ? ` [${bad.properties}]` : ""}`);
      e.setError = bad;
      throw e;
    }
  }
  return result;
}
