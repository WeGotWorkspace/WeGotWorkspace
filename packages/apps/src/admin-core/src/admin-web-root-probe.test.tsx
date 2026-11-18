import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWebRootProbe, webRootProbeUrls } from "@/admin-core/src/admin-web-root-probe";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWebRootProbe", () => {
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

  it("reports only packages when only packages/.probe is reachable", async () => {
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

    const { result } = renderHook(() => useWebRootProbe());

    await waitFor(() => {
      expect(result.current).toEqual(["packages"]);
    });
  });

  it("reports every folder that serves the canary file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "wgw-content-probe\n",
      }),
    );

    const { result } = renderHook(() => useWebRootProbe());

    await waitFor(() => {
      expect(result.current).toEqual(["wgw-content", "packages", "wgw-plugins"]);
    });
  });

  it("reports nothing when the canary is denied", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWebRootProbe());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    expect(fetchMock).toHaveBeenCalledWith("/wgw-content/.probe", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith("/packages/.probe", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith("/wgw-plugins/.probe", expect.anything());
    expect(result.current).toEqual([]);
  });
});
