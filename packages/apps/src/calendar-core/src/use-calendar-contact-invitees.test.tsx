import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactCard } from "@/lib/models/contacts-types";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { CalendarInviteesCard } from "@/calendar-core/src/calendar-invitees-card";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  refreshCalendarContactCards,
  useCalendarContactInvitees,
} from "@/calendar-core/src/use-calendar-contact-invitees";
import {
  readContactsBootstrapFromCache,
  readContactsColdDownload,
} from "@/lib/offline/contacts/contacts-offline-store";
import {
  ensureContactsDownloaded,
  refreshCachedContacts,
} from "@/lib/offline/contacts/contacts-hybrid-operations";
import { listCards } from "@/lib/api/wgw/contacts";
import { TooltipProvider } from "@/ui/tooltip";
import { useContactsLiveInbound } from "@/lib/offline/contacts/use-contacts-live-inbound";

vi.mock("@/lib/offline/contacts/contacts-offline-store", () => ({
  readContactsBootstrapFromCache: vi.fn(),
  readContactsColdDownload: vi.fn(),
}));

vi.mock("@/lib/offline/contacts/contacts-hybrid-operations", () => ({
  ensureContactsDownloaded: vi.fn(),
  refreshCachedContacts: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwLiveApiEnabled: () => true,
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: true }),
}));

// Calendar must never download the address book itself: every test proves it is not called.
vi.mock("@/lib/api/wgw/contacts", () => ({
  listCards: vi.fn(),
}));

vi.mock("@/lib/offline/contacts/use-contacts-live-inbound", () => ({
  useContactsLiveInbound: vi.fn(),
}));

const cachedJane = {
  "@type": "Card",
  version: "1.0",
  id: "cached-jane",
  uid: "urn:uuid:cached-jane",
  addressBookIds: { default: true },
  name: { "@type": "Name", isOrdered: false, full: "Cached Jane" },
  emails: {
    e1: { "@type": "EmailAddress", address: "cached@host" },
  },
} as unknown as ContactCard;

const liveJane = {
  "@type": "Card",
  version: "1.0",
  id: "live-jane",
  uid: "urn:uuid:live-jane",
  addressBookIds: { default: true },
  name: { "@type": "Name", isOrdered: false, full: "Live Jane" },
  emails: {
    work: { "@type": "EmailAddress", address: "Jane@Host", contexts: { work: true } },
    home: { "@type": "EmailAddress", address: "jane.home@host", contexts: { home: true } },
  },
} as unknown as ContactCard;

describe("refreshCalendarContactCards", () => {
  beforeEach(() => {
    vi.mocked(readContactsBootstrapFromCache).mockReset();
    vi.mocked(readContactsColdDownload).mockReset().mockResolvedValue(null);
    vi.mocked(ensureContactsDownloaded).mockReset().mockResolvedValue(undefined);
    vi.mocked(listCards).mockReset();
  });

  it("reads the cache when there is one", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({ data: { addressBooks: [], cards: [cachedJane] } }),
    );
    await expect(refreshCalendarContactCards("alice")).resolves.toEqual([cachedJane]);
    expect(ensureContactsDownloaded).not.toHaveBeenCalled();
    expect(listCards).not.toHaveBeenCalled();
  });

  it("a search without any cache starts the shared Contacts download, never listCards", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValueOnce(null);
    // The shared download fills the cache once for every app.
    vi.mocked(ensureContactsDownloaded).mockImplementation(async () => {
      vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
        createContactsAppBootstrap({ data: { addressBooks: [], cards: [liveJane] } }),
      );
    });

    await expect(refreshCalendarContactCards("alice")).resolves.toEqual([liveJane]);
    expect(ensureContactsDownloaded).toHaveBeenCalledTimes(1);
    expect(listCards).not.toHaveBeenCalled();
  });

  it("an unfinished first download is joined, not restarted or doubled", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({ data: { addressBooks: [], cards: [cachedJane] } }),
    );
    vi.mocked(readContactsColdDownload).mockResolvedValue({ remainingCardIds: ["x"] } as never);

    await expect(refreshCalendarContactCards("alice")).resolves.toEqual([cachedJane]);
    expect(ensureContactsDownloaded).toHaveBeenCalledTimes(1);
    expect(listCards).not.toHaveBeenCalled();
  });

  it("returns null when the shared download fails", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(null);
    vi.mocked(ensureContactsDownloaded).mockRejectedValue(new Error("offline"));
    await expect(refreshCalendarContactCards("alice")).resolves.toBeNull();
    expect(listCards).not.toHaveBeenCalled();
  });
});

describe("useCalendarContactInvitees", () => {
  beforeEach(() => {
    vi.mocked(readContactsBootstrapFromCache).mockReset();
    vi.mocked(readContactsColdDownload).mockReset().mockResolvedValue(null);
    vi.mocked(refreshCachedContacts).mockReset().mockResolvedValue(undefined);
    vi.mocked(useContactsLiveInbound).mockClear();
    vi.mocked(ensureContactsDownloaded).mockReset().mockResolvedValue(undefined);
    vi.mocked(listCards).mockReset();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("exposes cached cards after load", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({
        data: { addressBooks: [], cards: [cachedJane] },
      }),
    );

    const { result } = renderHook(() => useCalendarContactInvitees("alice"));
    await waitFor(() => {
      expect(result.current.cards).toEqual([cachedJane]);
    });
  });

  it("does not enable the sync while the first download is unfinished", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({ data: { addressBooks: [], cards: [cachedJane] } }),
    );
    vi.mocked(readContactsColdDownload).mockResolvedValue({
      remainingCardIds: ["x"],
    } as never);

    const { result } = renderHook(() => useCalendarContactInvitees("alice"));
    await waitFor(() => {
      expect(result.current.cards).toEqual([cachedJane]);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(refreshCachedContacts).not.toHaveBeenCalled();
    for (const [args] of vi.mocked(useContactsLiveInbound).mock.calls) {
      expect(args.enabled).toBe(false);
    }
  });

  it("catches a complete cache up once from its tokens, without listCards", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({ data: { addressBooks: [], cards: [cachedJane] } }),
    );

    const { result } = renderHook(() => useCalendarContactInvitees("alice"));
    await waitFor(() => {
      expect(refreshCachedContacts).toHaveBeenCalledTimes(1);
    });
    expect(refreshCachedContacts).toHaveBeenCalledWith("alice");
    await waitFor(() => {
      expect(vi.mocked(useContactsLiveInbound)).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    });
    expect(result.current.cards).toEqual([cachedJane]);
    expect(refreshCachedContacts).toHaveBeenCalledTimes(1);
    expect(listCards).not.toHaveBeenCalled();
  });

  it("opens with no cache without downloading anything", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(null);

    const { result } = renderHook(() => useCalendarContactInvitees("alice"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.cards).toEqual([]);
    expect(ensureContactsDownloaded).not.toHaveBeenCalled();
    expect(listCards).not.toHaveBeenCalled();
  });

  it("a search with no cache fills it through the shared download and starts the live sync", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(null);
    vi.mocked(ensureContactsDownloaded).mockImplementation(async () => {
      vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
        createContactsAppBootstrap({ data: { addressBooks: [], cards: [liveJane] } }),
      );
    });
    const { result } = renderHook(() => useCalendarContactInvitees("alice"));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.refreshCards();
    });

    await waitFor(() => {
      expect(result.current.cards).toEqual([liveJane]);
    });
    await waitFor(() => {
      expect(vi.mocked(useContactsLiveInbound)).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    });
    expect(ensureContactsDownloaded).toHaveBeenCalledTimes(1);
    expect(listCards).not.toHaveBeenCalled();
  });

  it("refresh re-reads the cache the live sync keeps current, without a download", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({
        data: { addressBooks: [], cards: [cachedJane] },
      }),
    );

    const { result } = renderHook(() => useCalendarContactInvitees("alice"));
    await waitFor(() => {
      expect(result.current.cards).toEqual([cachedJane]);
    });
    // The live inbound sync runs once a cache exists.
    await waitFor(() => {
      expect(vi.mocked(useContactsLiveInbound)).toHaveBeenLastCalledWith(
        expect.objectContaining({ username: "alice" }),
      );
    });

    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({ data: { addressBooks: [], cards: [liveJane] } }),
    );
    await act(async () => {
      result.current.refreshCards();
    });
    await waitFor(() => {
      expect(result.current.cards).toEqual([liveJane]);
    });
    expect(listCards).not.toHaveBeenCalled();
  });

  it("keeps the last good list when a refresh without cache fails", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValueOnce(
      createContactsAppBootstrap({
        data: { addressBooks: [], cards: [cachedJane] },
      }),
    );
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(null);
    vi.mocked(ensureContactsDownloaded).mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useCalendarContactInvitees("alice"));
    await waitFor(() => {
      expect(result.current.cards).toEqual([cachedJane]);
    });

    await act(async () => {
      result.current.refreshCards();
      await Promise.resolve();
    });
    expect(result.current.cards).toEqual([cachedJane]);
  });

  it("shows a contact the live sync added after search, from the cache", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({
        data: { addressBooks: [], cards: [cachedJane] },
      }),
    );

    function Harness() {
      const { cards, refreshCards } = useCalendarContactInvitees("alice");
      return (
        <TooltipProvider delayDuration={0}>
          <CalendarInviteesCard
            attendees={[]}
            invitees={[{ username: "alice", email: "alice@example.test", name: "Alice" }]}
            contactCards={cards}
            labels={defaultCalendarLabels}
            canSubmitEmail
            onChange={() => undefined}
            onRefreshContactCards={refreshCards}
          />
        </TooltipProvider>
      );
    }

    render(<Harness />);
    await waitFor(() => {
      expect(readContactsBootstrapFromCache).toHaveBeenCalled();
    });
    // Contacts (another tab) pulled a new card into the shared cache.
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({ data: { addressBooks: [], cards: [cachedJane, liveJane] } }),
    );

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventAttendeesAdd), {
      target: { value: "Live" },
    });
    expect(screen.queryByRole("option", { name: /Live Jane/i })).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Live Jane.*Jane@Host · Work/i })).toBeTruthy();
    });
    expect(listCards).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventAttendeesAdd), {
      target: { value: "ali" },
    });
    expect(screen.getByRole("option", { name: /Alice.*Teammate/i })).toBeTruthy();
  });
});
