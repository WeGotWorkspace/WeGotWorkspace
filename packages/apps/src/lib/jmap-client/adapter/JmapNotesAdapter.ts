import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import { NOTES_CAPABILITY, type JmapId } from "../core/types.js";
import { JmapNotesClient } from "../notes/JmapNotesClient.js";
import type { JmapNote, JmapNotebook } from "../notes/types.js";

const NOTEBOOK_TYPE = "Notebook";
const NOTE_TYPE = "Note";

export type JmapNotesAdapterOptions = {
  client: JmapClient;
  accountId?: JmapId;
  onSyncError?: (error: unknown) => void;
  onRemoteNote?: (note: JmapNote) => void;
  onRemoteNoteDestroyed?: (noteId: JmapId) => void;
  onRemoteNotebook?: (notebook: JmapNotebook) => void;
  onRemoteNotebookDestroyed?: (notebookId: JmapId) => void;
};

/**
 * Inbound-only JMAP adapter: Notebook/Note `/changes` polling.
 * Mutations stay on REST `/notes/*`.
 */
export class JmapNotesAdapter {
  #notes: JmapNotesClient;
  #options: JmapNotesAdapterOptions;
  #accountId: JmapId | null = null;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #pollInFlight = false;

  constructor(options: JmapNotesAdapterOptions) {
    this.#options = options;
    this.#notes = new JmapNotesClient(options.client);
  }

  get accountId(): JmapId {
    if (this.#accountId) return this.#accountId;
    this.#accountId = this.#options.accountId ?? this.#options.client.primaryAccountId(NOTES_CAPABILITY);
    return this.#accountId;
  }

  async initialize(): Promise<void> {
    if (!this.#options.client.isConnected) await this.#options.client.connect();
    // Empty ids: record envelope state without re-listing every body.
    await this.#notes.getNotebooks(this.accountId, []);
    await this.#notes.getNotes(this.accountId, []);
  }

  async sync(): Promise<void> {
    const client = this.#options.client;
    try {
      const notebookState = client.getState(this.accountId, NOTEBOOK_TYPE);
      if (notebookState) {
        const changes = await this.#notes.notebookChanges(this.accountId, notebookState);
        const changedIds = [...changes.created, ...changes.updated];
        if (changedIds.length) {
          const fetched = await this.#notes.getNotebooks(this.accountId, changedIds);
          for (const notebook of fetched.list) {
            this.#options.onRemoteNotebook?.(notebook);
          }
        }
        for (const id of changes.destroyed) {
          this.#options.onRemoteNotebookDestroyed?.(id);
        }
      }

      const noteState = client.getState(this.accountId, NOTE_TYPE);
      if (noteState) {
        const changes = await this.#notes.noteChanges(this.accountId, noteState);
        const changedIds = [...changes.created, ...changes.updated];
        if (changedIds.length) {
          const fetched = await this.#notes.getNotes(this.accountId, changedIds);
          for (const note of fetched.list) {
            this.#options.onRemoteNote?.(note);
          }
        }
        for (const id of changes.destroyed) {
          this.#options.onRemoteNoteDestroyed?.(id);
        }
      }
    } catch (error) {
      if (error instanceof JmapMethodError && error.errorType === "cannotCalculateChanges") {
        await this.#refetchAll();
        return;
      }
      this.#options.onSyncError?.(error);
    }
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.#pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (this.#pollInFlight) return;
      this.#pollInFlight = true;
      void this.sync().finally(() => {
        this.#pollInFlight = false;
      });
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  async #refetchAll(): Promise<void> {
    const notebooks = await this.#notes.getNotebooks(this.accountId);
    for (const notebook of notebooks.list) {
      this.#options.onRemoteNotebook?.(notebook);
    }
    const notes = await this.#notes.getNotes(this.accountId);
    for (const note of notes.list) {
      this.#options.onRemoteNote?.(note);
    }
  }
}
