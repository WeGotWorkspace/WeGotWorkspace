import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminWebRootProbe, webRootProbeUrl } from "@/admin-core/src/admin-web-root-probe";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminWebRootProbe", () => {
  it("prefixes the canary with the app base path", () => {
    expect(webRootProbeUrl("/")).toBe("/wgw-content/.probe");
    expect(webRootProbeUrl("/wgw/")).toBe("/wgw/wgw-content/.probe");
  });

  it("warns when the canary file is served", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "wgw-content-probe\n",
      }),
    );

    render(<AdminWebRootProbe />);

    expect(await screen.findByText(/reachable from the web/i)).toBeTruthy();
  });

  it("stays quiet when the canary is denied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminWebRootProbe />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/wgw-content/.probe", expect.anything());
    });
    expect(screen.queryByText(/reachable from the web/i)).toBeNull();
  });
});
