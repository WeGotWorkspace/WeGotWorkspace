// The other client in Contacts e2e: the same user, straight to the JMAP API.
const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
export const CONTACTS_E2E_USER = process.env.WGW_E2E_USERNAME ?? "admin";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";
const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:contacts"];

export type JmapInvocation = [string, Record<string, unknown>, string];

let accessToken: string | null = null;

async function token(): Promise<string> {
  if (accessToken) return accessToken;
  const res = await fetch(`${API}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: CONTACTS_E2E_USER, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login ${CONTACTS_E2E_USER} failed: ${res.status}`);
  accessToken = ((await res.json()) as { access_token: string }).access_token;
  return accessToken;
}

export async function contactsJmap(methodCalls: JmapInvocation[]): Promise<JmapInvocation[]> {
  const res = await fetch(`${API}/api/v1/jmap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify({ using: USING, methodCalls }),
  });
  if (!res.ok) throw new Error(`JMAP failed: ${res.status}`);
  return ((await res.json()) as { methodResponses: JmapInvocation[] }).methodResponses;
}

/** Creates cards in the default address book; returns their ids in `create` order. */
export async function createContactCards(cards: Record<string, unknown>[]): Promise<string[]> {
  const create: Record<string, unknown> = {};
  cards.forEach((card, index) => {
    create[`c${index}`] = card;
  });
  const [[, result]] = await contactsJmap([
    ["ContactCard/set", { accountId: CONTACTS_E2E_USER, create }, "s0"],
  ]);
  const created = (result.created ?? {}) as Record<string, { id: string }>;
  const ids = cards.map((_, index) => created[`c${index}`]?.id);
  if (ids.some((id) => !id)) {
    throw new Error(
      `Seeded ${Object.keys(created).length} cards: ${JSON.stringify(result.notCreated)}`,
    );
  }
  return ids as string[];
}

export async function destroyContactCards(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await contactsJmap([
    ["ContactCard/set", { accountId: CONTACTS_E2E_USER, destroy: ids }, "d0"],
  ]).catch(() => undefined);
}
