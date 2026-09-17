import { describe, expect, it } from "vitest";
import { JmapMailClient, MAIL_USING, SUBMISSION_USING } from "./JmapMailClient.js";
import {
  CORE_CAPABILITY,
  MAIL_CAPABILITY,
  SUBMISSION_CAPABILITY,
  type JmapInvocation,
} from "../core/types.js";
import { JmapClient } from "../core/JmapClient.js";

const ACCOUNT = "bob";
const SESSION_URL = "https://mock.example/jmap/session";
const API_URL = "https://mock.example/jmap/api";

function sessionJson() {
  return {
    capabilities: {
      [CORE_CAPABILITY]: {},
      [MAIL_CAPABILITY]: {},
      [SUBMISSION_CAPABILITY]: {},
    },
    accounts: {
      [ACCOUNT]: {
        name: ACCOUNT,
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: { [MAIL_CAPABILITY]: {}, [SUBMISSION_CAPABILITY]: {} },
      },
    },
    primaryAccounts: { [MAIL_CAPABILITY]: ACCOUNT, [SUBMISSION_CAPABILITY]: ACCOUNT },
    username: ACCOUNT,
    apiUrl: API_URL,
    downloadUrl: `${API_URL}/download/{accountId}/{blobId}/{name}?type={type}`,
    uploadUrl: `${API_URL}/upload/{accountId}`,
    eventSourceUrl: `${API_URL}/eventsource`,
    state: "s1",
  };
}

function methodResponse(name: string, args: Record<string, unknown>, id: string): JmapInvocation {
  return [name, args, id];
}

async function makeClient(handler: (calls: JmapInvocation[]) => JmapInvocation[]) {
  const recorded: Array<{ using: string[]; methodCalls: JmapInvocation[] }> = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    if (input === SESSION_URL) {
      return new Response(JSON.stringify(sessionJson()), { status: 200 });
    }
    const body = JSON.parse(String(init?.body)) as {
      using: string[];
      methodCalls: JmapInvocation[];
    };
    recorded.push(body);
    return new Response(
      JSON.stringify({ methodResponses: handler(body.methodCalls), sessionState: "s1" }),
      { status: 200 },
    );
  };
  const client = new JmapClient({ sessionUrl: SESSION_URL, fetch: fetchImpl });
  await client.connect();
  return { client, mail: new JmapMailClient(client), recorded };
}

describe("JmapMailClient contract batches", () => {
  it("query+get uses the #ids ResultReference", async () => {
    const { mail, recorded } = await makeClient((calls) => {
      const queryId = calls[0]?.[2] ?? "c1";
      return [
        methodResponse("Email/query", { accountId: ACCOUNT, ids: ["e1"] }, queryId),
        methodResponse(
          "Email/get",
          { accountId: ACCOUNT, state: "1:", list: [{ id: "e1" }], notFound: [] },
          calls[1]?.[2] ?? "c2",
        ),
      ];
    });

    const got = await mail.getEmailsByQuery(ACCOUNT, { inMailbox: "mb-inbox" }, { limit: 40 });
    expect(got.list[0]?.id).toBe("e1");
    expect(recorded[0]?.using).toEqual(MAIL_USING);
    expect(recorded[0]?.methodCalls[1]?.[1]).toEqual({
      accountId: ACCOUNT,
      "#ids": {
        resultOf: recorded[0]?.methodCalls[0]?.[2],
        name: "Email/query",
        path: "/ids",
      },
    });
  });

  it("Mailbox/get then Email/query+get stay on mail using", async () => {
    const { mail, recorded } = await makeClient((calls) =>
      calls.map(([name, , id]) => {
        if (name === "Mailbox/get") {
          return methodResponse(
            name,
            { accountId: ACCOUNT, state: "m0", list: [{ id: "mb1", name: "INBOX" }], notFound: [] },
            id,
          );
        }
        if (name === "Email/query") {
          return methodResponse(name, { accountId: ACCOUNT, ids: [] }, id);
        }
        return methodResponse(
          name,
          { accountId: ACCOUNT, state: "e0", list: [], notFound: [] },
          id,
        );
      }),
    );

    await mail.getMailboxes(ACCOUNT);
    await mail.getEmailsByQuery(ACCOUNT);
    expect(recorded.every((batch) => batch.using.join() === MAIL_USING.join())).toBe(true);
  });

  it("EmailSubmission/set requires identityId and uses submission using", async () => {
    const { mail, recorded } = await makeClient((calls) =>
      calls.map(([name, , id]) =>
        methodResponse(
          name,
          {
            accountId: ACCOUNT,
            created: { k0: { id: "sub-1", identityId: "primary", emailId: "e1" } },
            newState: "s1",
          },
          id,
        ),
      ),
    );

    await mail.setEmailSubmissions({
      accountId: ACCOUNT,
      create: { k0: { identityId: "primary", emailId: "e1" } },
    });
    expect(recorded[0]?.using).toEqual(SUBMISSION_USING);
    expect(recorded[0]?.methodCalls[0]?.[1]).toMatchObject({
      create: { k0: { identityId: "primary", emailId: "e1" } },
    });
  });
});
