import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchInstallerBootstrap } from "@/lib/api/wgw/installer";

describe("fetchInstallerBootstrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces the installer lock message from a 423 body", async () => {
    const message =
      "The installer closed 30 minutes after it was first opened. Delete /var/www/wgw-content/.install-window on the server to reopen it.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: message, code: "installer_locked" }), {
          status: 423,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(fetchInstallerBootstrap()).rejects.toThrow(message);
  });
});
