/**
 * A WeGotWorkspace API request that failed with an HTTP status. Callers classify
 * the failure by `status`, never by the message text
 * (`.agents/skills/client-transport/SKILL.md`).
 */
export class WgwRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
