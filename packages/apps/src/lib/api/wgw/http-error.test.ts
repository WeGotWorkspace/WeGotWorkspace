import { describe, expect, it } from "vitest";
import {
  wgwErrorMessageFromBody,
  wgwLooksLikeHtml,
  wgwReadJson,
  wgwReadJsonFailureMessage,
} from "./http";

describe("wgwErrorMessageFromBody", () => {
  it("prefers JSON error and message fields", () => {
    expect(wgwErrorMessageFromBody(JSON.stringify({ error: "markdown_too_large" }), 413)).toBe(
      "markdown_too_large",
    );
    expect(wgwErrorMessageFromBody(JSON.stringify({ message: "Server exploded" }), 500)).toBe(
      "Server exploded",
    );
  });

  it("falls back to status text instead of dumping non-JSON bodies", () => {
    const html = "<!DOCTYPE html><html><head><title>Server Error</title></head></html>";
    expect(wgwErrorMessageFromBody(html, 500, "Internal Server Error")).toBe(
      "Internal Server Error",
    );
  });

  it("uses HTTP status when body and status text are empty", () => {
    expect(wgwErrorMessageFromBody("", 502)).toBe("HTTP 502");
  });

  it("falls back to JSON code when error and message are missing", () => {
    expect(wgwErrorMessageFromBody(JSON.stringify({ code: "post_too_large" }), 413)).toBe(
      "post_too_large",
    );
  });

  it("does not dump a long URL when the 200 body is HTML", () => {
    const html =
      "<br />\n<b>Warning</b>:  PHP Request Startup: POST Content-Length of 9437184 bytes exceeds the limit of 8388608 bytes in <b>Unknown</b> on line <b>0</b><br />";
    expect(wgwLooksLikeHtml(html)).toBe(true);
    expect(wgwReadJsonFailureMessage(html, 200)).toBe("Server returned HTML instead of a result");
    expect(wgwReadJsonFailureMessage(html, 200)).not.toMatch(/http:\/\//);
  });

  it("prefers post_too_large JSON even when PHP prepended an HTML warning", () => {
    const body =
      "<br />\n<b>Warning</b>:  PHP Request Startup: POST Content-Length of 9437184 bytes exceeds the limit of 8388608 bytes in <b>Unknown</b> on line <b>0</b><br />\n" +
      JSON.stringify({
        error: "Upload too large. Current server post_max_size is 8M.",
        code: "post_too_large",
      });
    expect(wgwErrorMessageFromBody(body, 200, "OK")).toBe(
      "Upload too large. Current server post_max_size is 8M.",
    );
    expect(wgwReadJsonFailureMessage(body, 200)).toBe(
      "Upload too large. Current server post_max_size is 8M.",
    );
  });

  it("wgwReadJson treats empty 200 as an empty object", async () => {
    const res = new Response("", { status: 200 });
    await expect(wgwReadJson(res)).resolves.toEqual({});
  });

  it("reads JSON after a PHP warning prefix", () => {
    const body =
      "POST Content-Length of 11000659 bytes exceeds the limit of 8388608 bytes\n" +
      JSON.stringify({
        error: "Upload too large. Current server post_max_size is 8M.",
        code: "post_too_large",
      });
    expect(wgwErrorMessageFromBody(body, 413)).toBe(
      "Upload too large. Current server post_max_size is 8M.",
    );
  });
});
