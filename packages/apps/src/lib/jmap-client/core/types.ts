/**
 * Core JMAP (RFC 8620) wire types. Only the subset needed by this client is modeled;
 * unknown properties are preserved via index signatures where round-tripping matters.
 */

/** JMAP Id (RFC 8620 section 1.2). */
export type JmapId = string;

/** Opaque per-datatype state string used by /get, /changes and /set. */
export type JmapState = string;

export const CORE_CAPABILITY = "urn:ietf:params:jmap:core";
export const CALENDARS_CAPABILITY = "urn:ietf:params:jmap:calendars";
export const FILENODE_CAPABILITY = "urn:ietf:params:jmap:filenode";

export type JmapAccount = {
  name: string;
  isPersonal: boolean;
  isReadOnly: boolean;
  accountCapabilities: Record<string, unknown>;
};

/** The Session resource (RFC 8620 section 2). */
export type JmapSession = {
  capabilities: Record<string, unknown>;
  accounts: Record<JmapId, JmapAccount>;
  primaryAccounts: Record<string, JmapId>;
  username: string;
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  eventSourceUrl: string;
  state: string;
  [key: string]: unknown;
};

/** A single method call or response: `[name, arguments, methodCallId]`. */
export type JmapInvocation = [name: string, args: Record<string, unknown>, methodCallId: string];

export type JmapRequest = {
  using: string[];
  methodCalls: JmapInvocation[];
  createdIds?: Record<JmapId, JmapId>;
};

export type JmapResponse = {
  methodResponses: JmapInvocation[];
  createdIds?: Record<JmapId, JmapId>;
  sessionState: string;
};

/** Method-level error args (RFC 8620 section 3.6.2), returned as an `error` invocation. */
export type JmapMethodErrorArgs = {
  type: string;
  description?: string;
  [key: string]: unknown;
};

/** SetError (RFC 8620 section 5.3). */
export type JmapSetError = {
  type: string;
  description?: string;
  properties?: string[];
  [key: string]: unknown;
};

/** Standard /get method (RFC 8620 section 5.1). */
export type GetArgs = {
  accountId: JmapId;
  ids?: JmapId[] | null;
  properties?: string[] | null;
};

export type GetResponse<T> = {
  accountId: JmapId;
  state: JmapState;
  list: T[];
  notFound: JmapId[];
};

/** Standard /changes method (RFC 8620 section 5.2). */
export type ChangesArgs = {
  accountId: JmapId;
  sinceState: JmapState;
  maxChanges?: number;
};

export type ChangesResponse = {
  accountId: JmapId;
  oldState: JmapState;
  newState: JmapState;
  hasMoreChanges: boolean;
  created: JmapId[];
  updated: JmapId[];
  destroyed: JmapId[];
};

/** Standard /set method (RFC 8620 section 5.3). */
export type SetArgs<T> = {
  accountId: JmapId;
  ifInState?: JmapState | null;
  create?: Record<JmapId, T> | null;
  update?: Record<JmapId, Record<string, unknown>> | null;
  destroy?: JmapId[] | null;
};

export type SetResponse<T> = {
  accountId: JmapId;
  oldState: JmapState | null;
  newState: JmapState;
  created?: Record<JmapId, Partial<T>> | null;
  updated?: Record<JmapId, Partial<T> | null> | null;
  destroyed?: JmapId[] | null;
  notCreated?: Record<JmapId, JmapSetError> | null;
  notUpdated?: Record<JmapId, JmapSetError> | null;
  notDestroyed?: Record<JmapId, JmapSetError> | null;
};

/** Standard /query method (RFC 8620 section 5.5). */
export type QueryArgs = {
  accountId: JmapId;
  filter?: Record<string, unknown> | null;
  sort?: Array<Record<string, unknown>> | null;
  position?: number;
  limit?: number;
  calculateTotal?: boolean;
};

export type QueryResponse = {
  accountId: JmapId;
  queryState: JmapState;
  canCalculateChanges: boolean;
  position: number;
  ids: JmapId[];
  total?: number;
  limit?: number;
};

/** Standard /queryChanges method (RFC 8620 section 5.6). */
export type QueryChangesArgs = {
  accountId: JmapId;
  filter?: Record<string, unknown> | null;
  sort?: Array<Record<string, unknown>> | null;
  sinceQueryState: JmapState;
  maxChanges?: number;
  upToId?: JmapId | null;
  calculateTotal?: boolean;
};

export type QueryChangesResponse = {
  accountId: JmapId;
  oldQueryState: JmapState;
  newQueryState: JmapState;
  total?: number;
  removed: JmapId[];
  added: Array<{ id: JmapId; index: number }>;
};
