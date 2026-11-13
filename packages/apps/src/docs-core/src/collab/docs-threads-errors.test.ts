import { describe, expect, it } from "vitest";
import {
  docsThreadsRequestError,
  isDocsThreadsCannotCalculateChanges,
} from "./docs-threads-errors";

describe("docsThreadsRequestError", () => {
  it("keeps the status and the API error code", async () => {
    const res = new Response(
      JSON.stringify({
        error: "Sync state is invalid or expired.",
        code: "cannotCalculateChanges",
      }),
      { status: 400 },
    );
    const error = await docsThreadsRequestError(res, "GET /files/threads/changes");

    expect(error.status).toBe(400);
    expect(error.code).toBe("cannotCalculateChanges");
    expect(error.message).toBe("GET /files/threads/changes failed (400)");
    expect(isDocsThreadsCannotCalculateChanges(error)).toBe(true);
  });

  it("has no code when the body is not JSON", async () => {
    const error = await docsThreadsRequestError(
      new Response("<html>Bad gateway</html>", { status: 502 }),
      "GET /files/threads",
    );

    expect(error.status).toBe(502);
    expect(error.code).toBeUndefined();
    expect(isDocsThreadsCannotCalculateChanges(error)).toBe(false);
  });

  it("does not treat other errors as an expired state", () => {
    expect(isDocsThreadsCannotCalculateChanges(new Error("cannotCalculateChanges"))).toBe(false);
  });
});
