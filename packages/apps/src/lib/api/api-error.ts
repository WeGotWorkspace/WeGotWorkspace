/**
 * An API request that failed with an HTTP status. Every error that leaves the
 * transport layer for an HTTP failure is one of these, so callers classify on
 * `status` and `code`, never on the message text
 * (`.agents/skills/client-transport/SKILL.md`).
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
