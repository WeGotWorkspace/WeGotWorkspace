import { expect, test } from "@playwright/test";

test.describe("REST API smoke", () => {
  test("GET /api/v1/health returns OpenAPI health payload", async ({ request }) => {
    const response = await request.get("/api/v1/health");

    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"] ?? "").toContain("application/json");

    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        status: "ok",
        apiVersion: "v1",
      }),
    );
    expect(typeof body.timestamp).toBe("string");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("response body is JSON only (no PHP deprecation HTML)", async ({ request }) => {
    const response = await request.get("/api/v1/health");
    const text = await response.text();

    expect(text.trimStart().startsWith("{")).toBeTruthy();
    expect(text).not.toContain("<b>Deprecated</b>");
    expect(text).not.toContain("PDO::MYSQL_ATTR_SSL_CA");
  });
});
