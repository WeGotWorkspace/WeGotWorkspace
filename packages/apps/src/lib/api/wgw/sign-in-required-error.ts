/**
 * There is no member session to send a request with (signed out, or the
 * refresh token was rejected): the user has to sign in again. Same message as
 * before; the class lets callers such as the upload queue tell it apart
 * without reading the text.
 */
export class WgwSignInRequiredError extends Error {
  constructor() {
    super("Missing auth session. Sign in to continue.");
    this.name = "WgwSignInRequiredError";
  }
}
