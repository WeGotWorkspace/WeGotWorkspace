/**
 * An API request that failed with an HTTP status, so callers classify on
 * `status` and `code`, never on the message text. New HTTP failures use it; a
 * few older classes still extend `Error` with their own `status` (listed in
 * `.agents/skills/client-transport/SKILL.md`).
 *
 * `code` is the server's machine code from the `{ error, code? }` body when the
 * client parsed it (`.agents/skills/api/rest-design.md#errors`).
 *
 * The base sets no `name`: subclasses keep the name they had, so `String(error)`
 * and every message a user can see stay the same.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * The server answered, but the client cannot use the answer: a body that is
 * not JSON, a response without a field the contract promises (an id, a
 * `blobId`, a new state, a token), or a record that cannot be read back right
 * after it was written. There is no HTTP status to classify on, so it carries
 * none: the offline outbox keeps treating it as transient, as it did when this
 * was a bare `Error`.
 *
 * Like `ApiError`, it sets no `name`, so `String(error)` and the message stay
 * the same as before.
 */
export class UnexpectedApiResponseError extends Error {}
