import type { JmapClient } from "../core/JmapClient.js";
import { CORE_CAPABILITY, NOTES_CAPABILITY } from "../core/types.js";
import type {
  ChangesResponse,
  GetResponse,
  JmapId,
  JmapState,
} from "../core/types.js";
import type { JmapNote, JmapNotebook } from "./types.js";

const NOTEBOOK_TYPE = "Notebook";
const NOTE_TYPE = "Note";

export const NOTES_USING = [CORE_CAPABILITY, NOTES_CAPABILITY];

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
}
