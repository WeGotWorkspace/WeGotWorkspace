/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContactCard } from "./contacts-types";
import { useContactPhotoSrc } from "./use-contact-photo-src";

const { downloadContactBlobMock } = vi.hoisted(() => ({
  downloadContactBlobMock: vi.fn(),
}));

vi.mock("@/lib/api/wgw/contacts", () => ({
  downloadContactBlob: downloadContactBlobMock,
}));

const janeCard = {
  id: "jane-doe",
  uid: "urn:uuid:jane",
  name: { full: "Jane Doe" },
} as ContactCard;

afterEach(() => {
  vi.restoreAllMocks();
  downloadContactBlobMock.mockReset();
});

describe("useContactPhotoSrc", () => {
  it("returns https photo URLs without fetching", () => {
    const card = {
      ...janeCard,
      media: {
        m1: {
          "@type": "Media" as const,
          kind: "photo" as const,
          uri: "https://example.com/photo.jpg",
        },
      },
    } as unknown as ContactCard;

    const { result } = renderHook(() => useContactPhotoSrc(card));

    expect(result.current).toBe("https://example.com/photo.jpg");
    expect(downloadContactBlobMock).not.toHaveBeenCalled();
  });

  it("fetches blob-backed photos with bearer auth and exposes an object URL", async () => {
    const blobId = "aabbccdd-1122-4aab-8aab-aabbccdd0001";
    const card = {
      ...janeCard,
      media: {
        m1: {
          "@type": "Media" as const,
          kind: "photo" as const,
          blobId,
          mediaType: "image/jpeg",
        },
      },
    } as unknown as ContactCard;

    const createObjectURL = vi.fn().mockReturnValue("blob:contact-photo");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    // Avoid `new Response(blob)` under jsdom — undici expects Blob#stream(), which
    // jsdom's Blob does not implement.
    downloadContactBlobMock.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["jpeg-bytes"], { type: "image/jpeg" }),
    } as Response);

    const { result, unmount } = renderHook(() => useContactPhotoSrc(card));

    await waitFor(() => {
      expect(result.current).toBe("blob:contact-photo");
    });

    expect(downloadContactBlobMock).toHaveBeenCalledWith(blobId);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:contact-photo");
  });
});
