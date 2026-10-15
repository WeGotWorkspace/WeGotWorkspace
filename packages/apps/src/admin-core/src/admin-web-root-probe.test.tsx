import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminWebRootProbe, webRootProbeUrls } from "@/admin-core/src/admin-web-root-probe";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminWebRootProbe", () => {
  it("prefixes the canary with the app base path", () => {
    expect(webRootProbeUrls("/")).toEqual([
      "/wgw-content/.probe",
      "/packages/.probe",
      "/wgw-plugins/.probe",
    ]);
    expect(webRootProbeUrls("/wgw/")).toEqual([
      "/wgw/wgw-content/.probe",
      "/wgw/packages/.probe",
      "/wgw/wgw-plugins/.probe",
    ]);
  });

  it("warns when only packages/.probe is reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/packages/.probe")) {
          return {
            ok: true,
            text: async () => "wgw-content-probe\n",
          };
        }

        return {
          ok: false,
          text: async () => "",
        };
      }),
    );

    render(<AdminWebRootProbe />);

    expect(await screen.findByText(/packages is reachable from the web/i)).toBeTruthy();
    expect(screen.queryByText(/wgw-content is reachable/i)).toBeNull();
    expect(screen.queryByText(/wgw-plugins is reachable/i)).toBeNull();
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
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    expect(fetchMock).toHaveBeenCalledWith("/wgw-content/.probe", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith("/packages/.probe", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith("/wgw-plugins/.probe", expect.anything());
    expect(screen.queryByText(/reachable from the web/i)).toBeNull();
  });
});
