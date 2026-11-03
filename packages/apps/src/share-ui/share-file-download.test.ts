import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { wgwFetch, wgwEnsureFreshAccessToken } = vi.hoisted(() => ({
  wgwFetch: vi.fn(),
  wgwEnsureFreshAccessToken: vi.fn(async () => "guest-token" as string | null),
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch,
  wgwEnsureFreshAccessToken,
  wgwApiBaseUrl: () => "/api/v1",
  wgwReadJson: async (res: Response) => res.json(),
}));

import { stubAnchorClicks } from "@/lib/api/wgw/native-download.fixtures";
import { downloadSharedDriveFile } from "@/share-ui/share-file-download";
import { shareLabels } from "@/share-ui/share-labels";

const TICKET_URL = "https://drive.example.test/api/v1/jmap/download-ticket/guest/report.pdf";

function ticketResponse(status = 201): Response {
  const body = status === 201 ? { url: TICKET_URL, idleExpires: "", absoluteExpires: "" } : {};
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("downloadSharedDriveFile", () => {
  let stub: ReturnType<typeof stubAnchorClicks>;

  beforeEach(() => {
    vi.clearAllMocks();
    wgwEnsureFreshAccessToken.mockResolvedValue("guest-token");
    stub = stubAnchorClicks();
  });

  afterEach(() => {
    stub.restore();
    vi.restoreAllMocks();
  });

  it("hands a guest ticket URL to the browser and never reads the content into a Blob", async () => {
    wgwFetch.mockResolvedValue(ticketResponse());
    const blobSpy = vi.spyOn(Response.prototype, "blob");

    await downloadSharedDriveFile("/users/alice/Reports/report.pdf/");

    expect(wgwFetch).toHaveBeenCalledTimes(1);
    const [path, init] = wgwFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/files/download-tickets");
    expect(JSON.parse(String(init.body))).toEqual({ path: "/users/alice/Reports/report.pdf" });
    expect(blobSpy).not.toHaveBeenCalled();
    expect(stub.clicked).toEqual([{ href: TICKET_URL, download: "report.pdf" }]);
  });

  it("says the share session expired when there is no guest token", async () => {
    wgwEnsureFreshAccessToken.mockResolvedValue(null);

    await expect(downloadSharedDriveFile("/users/alice/report.pdf")).rejects.toThrow(
      "Share session expired. Open the link again.",
    );
    expect(wgwFetch).not.toHaveBeenCalled();
    expect(stub.clicked).toEqual([]);
  });

  it("says the share session expired when the ticket request is unauthorized", async () => {
    wgwFetch.mockResolvedValue(ticketResponse(401));

    await expect(downloadSharedDriveFile("/users/alice/report.pdf")).rejects.toThrow(
      "Share session expired. Open the link again.",
    );
    expect(stub.clicked).toEqual([]);
  });

  it("says the link is invalid when the file is not readable", async () => {
    wgwFetch.mockResolvedValue(ticketResponse(404));

    await expect(downloadSharedDriveFile("/users/alice/report.pdf")).rejects.toThrow(
      shareLabels.publicLinkOpenError,
    );
    expect(stub.clicked).toEqual([]);
  });

  it.each([429, 500, 503])(
    "asks to try again, not that the link is dead, when the ticket request answers %i",
    async (status) => {
      wgwFetch.mockResolvedValue(ticketResponse(status));

      await expect(downloadSharedDriveFile("/users/alice/report.pdf")).rejects.toThrow(
        shareLabels.publicLinkDownloadError,
      );
      expect(stub.clicked).toEqual([]);
    },
  );
});
