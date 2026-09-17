import { JmapMethodError, JmapRequestError } from "./errors.js";
import {
  CALENDARS_CAPABILITY,
  CONTACTS_CAPABILITY,
  CORE_CAPABILITY,
  NOTES_CAPABILITY,
  type JmapId,
  type JmapInvocation,
  type JmapMethodErrorArgs,
  type JmapRequest,
  type JmapResponse,
  type JmapSession,
  type JmapState,
} from "./types.js";

export type JmapFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type JmapClientOptions = {
  /** URL of the JMAP Session resource (RFC 8620 section 2). */
  sessionUrl: string;
  /**
   * Fetch implementation. Supply one with auth baked in (e.g. adding an Authorization
   * header), or use {@link JmapClientOptions.headers} with the global fetch.
   */
  fetch?: JmapFetch;
  /** Extra headers sent with every request (e.g. `{ Authorization: "Bearer …" }`). */
  headers?: Record<string, string>;
  /** Called when the server reports a new session state (client should re-fetch session). */
  onSessionStateChange?: (sessionState: string) => void;
};

/**
 * Minimal JMAP core client (RFC 8620): session resource handling, batched method calls
 * against the single API endpoint, and per-account/type state bookkeeping.
 *
 * Transport only; calendar-specific methods live in {@link JmapCalendarsClient}.
 */
export class JmapClient {
  #options: JmapClientOptions;
  #fetch: JmapFetch;
  #session: JmapSession | null = null;
  #sessionState: string | null = null;
  /** Latest known datatype state, keyed by `${accountId}/${type}`. */
  #states = new Map<string, JmapState>();
  #callCounter = 0;

  constructor(options: JmapClientOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Fetches (or re-fetches) the session resource and validates calendar capability. */
  async connect(): Promise<JmapSession> {
    const response = await this.#fetch(this.#options.sessionUrl, {
      method: "GET",
      headers: { Accept: "application/json", ...this.#options.headers },
    });
    if (!response.ok) {
      throw new JmapRequestError(`Failed to fetch JMAP session (${response.status})`, {
        status: response.status,
      });
    }
    const session = (await response.json()) as JmapSession;
    if (!session.capabilities || !(CORE_CAPABILITY in session.capabilities)) {
      throw new JmapRequestError("Server is not a JMAP server (missing core capability)");
    }
    const hasCalendars = CALENDARS_CAPABILITY in session.capabilities;
    const hasContacts = CONTACTS_CAPABILITY in session.capabilities;
    const hasNotes = NOTES_CAPABILITY in session.capabilities;
    if (!hasCalendars && !hasContacts && !hasNotes) {
      throw new JmapRequestError(
        `Server does not advertise ${CALENDARS_CAPABILITY}, ${CONTACTS_CAPABILITY}, or ${NOTES_CAPABILITY}`,
      );
    }
    this.#session = session;
    this.#sessionState = session.state;
    return session;
  }

  get session(): JmapSession {
    if (!this.#session) throw new JmapRequestError("Not connected: call connect() first");
    return this.#session;
  }

  get isConnected(): boolean {
    return this.#session !== null;
  }

  /** The primary account id for the given capability (defaults to calendars). */
  primaryAccountId(capability: string = CALENDARS_CAPABILITY): JmapId {
    const accountId = this.session.primaryAccounts[capability];
    if (!accountId) {
      throw new JmapRequestError(`Session has no primary account for ${capability}`);
    }
    return accountId;
  }

  /** Latest known state string for a datatype in an account (from /get, /changes or /set). */
  getState(accountId: JmapId, type: string): JmapState | undefined {
    return this.#states.get(`${accountId}/${type}`);
  }

  setState(accountId: JmapId, type: string, state: JmapState): void {
    this.#states.set(`${accountId}/${type}`, state);
  }

  nextCallId(): string {
    this.#callCounter += 1;
    return `c${this.#callCounter}`;
  }

  /**
   * Sends a batch of method calls to the API endpoint. Method-level `error` responses are
   * NOT thrown here (a batch can mix successes and failures); use {@link JmapClient.call}
   * for single-call convenience or inspect the response per invocation.
   */
  async request(
    methodCalls: JmapInvocation[],
    using: string[] = [CORE_CAPABILITY, CALENDARS_CAPABILITY],
    init?: { signal?: AbortSignal },
  ): Promise<JmapResponse> {
    const body: JmapRequest = { using, methodCalls };
    const response = await this.#fetch(this.session.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...this.#options.headers,
      },
      body: JSON.stringify(body),
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    if (!response.ok) {
      let detail: unknown;
      let problemType: string | undefined;
      try {
        detail = await response.json();
        problemType = (detail as { type?: string }).type;
      } catch {
        // Non-JSON error body; status alone is enough context.
      }
      throw new JmapRequestError(`JMAP request failed (${response.status})`, {
        status: response.status,
        problemType,
        detail,
      });
    }
    const parsed = (await response.json()) as JmapResponse;
    if (this.#sessionState !== null && parsed.sessionState !== this.#sessionState) {
      this.#sessionState = parsed.sessionState;
      this.#options.onSessionStateChange?.(parsed.sessionState);
    }
    return parsed;
  }

  /** Sends a single method call and returns its response args; throws on method error. */
  async call<TResponse>(
    name: string,
    args: Record<string, unknown>,
    usingOrOptions?: string[] | { using?: string[]; signal?: AbortSignal },
  ): Promise<TResponse> {
    const using = Array.isArray(usingOrOptions)
      ? usingOrOptions
      : (usingOrOptions?.using ?? [CORE_CAPABILITY, CALENDARS_CAPABILITY]);
    const signal = Array.isArray(usingOrOptions) ? undefined : usingOrOptions?.signal;
    const callId = this.nextCallId();
    const response = await this.request(
      [[name, args, callId]],
      using,
      signal ? { signal } : undefined,
    );
    const invocation = response.methodResponses.find(([, , id]) => id === callId);
    if (!invocation) {
      throw new JmapRequestError(`No response for method call ${name} (${callId})`);
    }
    const [responseName, responseArgs] = invocation;
    if (responseName === "error") {
      throw new JmapMethodError(name, callId, responseArgs as JmapMethodErrorArgs);
    }
    return responseArgs as TResponse;
  }
}
