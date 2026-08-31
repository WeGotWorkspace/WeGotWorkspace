import type { JmapClient } from "../core/JmapClient.js";
import { JmapSetItemError } from "../core/errors.js";
import { CORE_CAPABILITY, NOTES_CAPABILITY } from "../core/types.js";
import type {
  ChangesResponse,
  GetResponse,
  JmapId,
  JmapState,
  SetArgs,
  SetResponse,
} from "../core/types.js";
import type { JmapNote, JmapNotebook } from "./types.js";

const NOTEBOOK_TYPE = "Notebook";
const NOTE_TYPE = "Note";

export const NOTES_USING = [CORE_CAPABILITY, NOTES_CAPABILITY];

function assertSetSucceeded<T>(response: SetResponse<T>): void {
  const notCreated = Object.entries(response.notCreated ?? {});
  if (notCreated.length) throw new JmapSetItemError("create", notCreated[0][0], notCreated[0][1]);
  const notUpdated = Object.entries(response.notUpdated ?? {});
  if (notUpdated.length) throw new JmapSetItemError("update", notUpdated[0][0], notUpdated[0][1]);
  const notDestroyed = Object.entries(response.notDestroyed ?? {});
  if (notDestroyed.length)
    throw new JmapSetItemError("destroy", notDestroyed[0][0], notDestroyed[0][1]);
}

/**
 * Typed Notebook / Note methods over {@link JmapClient}.
 */
export class JmapNotesClient {
  readonly client: JmapClient;

  constructor(client: JmapClient) {
    this.client = client;
  }

  async getNotebooks(accountId: JmapId, ids?: JmapId[] | null): Promise<GetResponse<JmapNotebook>> {
    const response = await this.client.call<GetResponse<JmapNotebook>>(
      "Notebook/get",
      { accountId, ids: ids ?? null },
      NOTES_USING,
    );
    this.client.setState(accountId, NOTEBOOK_TYPE, response.state);
    return response;
  }

  async notebookChanges(accountId: JmapId, sinceState: JmapState, maxChanges?: number) {
    const response = await this.client.call<ChangesResponse>(
      "Notebook/changes",
      {
        accountId,
        sinceState,
        ...(maxChanges !== undefined ? { maxChanges } : {}),
      },
      NOTES_USING,
    );
    this.client.setState(accountId, NOTEBOOK_TYPE, response.newState);
    return response;
  }

  async getNotes(accountId: JmapId, ids?: JmapId[] | null): Promise<GetResponse<JmapNote>> {
    const response = await this.client.call<GetResponse<JmapNote>>(
      "Note/get",
      { accountId, ids: ids ?? null },
      NOTES_USING,
    );
    this.client.setState(accountId, NOTE_TYPE, response.state);
    return response;
  }

  async noteChanges(accountId: JmapId, sinceState: JmapState, maxChanges?: number) {
    const response = await this.client.call<ChangesResponse>(
      "Note/changes",
      {
        accountId,
        sinceState,
        ...(maxChanges !== undefined ? { maxChanges } : {}),
      },
      NOTES_USING,
    );
    this.client.setState(accountId, NOTE_TYPE, response.newState);
    return response;
  }

  async setNotebooks(
    args: Omit<SetArgs<JmapNotebook>, "accountId"> & {
      accountId: JmapId;
      onDestroyRemoveContents?: boolean;
    },
  ): Promise<SetResponse<JmapNotebook>> {
    const response = await this.client.call<SetResponse<JmapNotebook>>(
      "Notebook/set",
      args,
      NOTES_USING,
    );
    this.client.setState(args.accountId, NOTEBOOK_TYPE, response.newState);
    assertSetSucceeded(response);
    return response;
  }

  async setNotes(
    args: Omit<SetArgs<Omit<JmapNote, "id">>, "accountId"> & { accountId: JmapId },
  ): Promise<SetResponse<JmapNote>> {
    const response = await this.client.call<SetResponse<JmapNote>>("Note/set", args, NOTES_USING);
    this.client.setState(args.accountId, NOTE_TYPE, response.newState);
    assertSetSucceeded(response);
    return response;
  }
}
