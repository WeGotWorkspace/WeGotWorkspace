import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { createContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { MOCK_CALENDAR_CONTACT_CARDS } from "@/calendar-core/src/calendar-api-source";
import { CalendarInviteesCard } from "@/calendar-core/src/calendar-invitees-card";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import {
  loadCalendarContactCards,
  refreshCalendarContactCards,
  useCalendarContactInvitees,
} from "@/calendar-core/src/use-calendar-contact-invitees";
import { readContactsBootstrapFromCache } from "@/lib/offline/contacts-offline-store";
import { listCards } from "@/lib/api/wgw/contacts";
import { TooltipProvider } from "@/ui/tooltip";

vi.mock("@/lib/offline/contacts-offline-store", () => ({
  readContactsBootstrapFromCache: vi.fn(),
}));

vi.mock("@/lib/api/wgw/contacts", () => ({
  listCards: vi.fn(),
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

describe("loadCalendarContactCards", () => {
  beforeEach(() => {
    vi.mocked(readContactsBootstrapFromCache).mockReset();
    vi.mocked(listCards).mockReset();
  });

  it("returns cached cards on cache hit without calling listCards", async () => {
    const bootstrap = createContactsAppBootstrap({
      data: { addressBooks: [], cards: [cachedJane] },
    });
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(bootstrap);
    vi.mocked(listCards).mockResolvedValue([liveJane]);

    await expect(loadCalendarContactCards("alice")).resolves.toEqual([cachedJane]);
    expect(readContactsBootstrapFromCache).toHaveBeenCalledWith("alice");
    expect(listCards).not.toHaveBeenCalled();
  });

  it("fetches live cards when the cache is empty", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(null);
    vi.mocked(listCards).mockResolvedValue([liveJane]);

    await expect(loadCalendarContactCards("alice")).resolves.toEqual([liveJane]);
    expect(listCards).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the cache is empty and live listCards throws", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(null);
    vi.mocked(listCards).mockRejectedValue(new Error("offline"));

    await expect(loadCalendarContactCards("alice")).resolves.toEqual([]);
  });

  it("returns an empty list when username is missing", async () => {
    await expect(loadCalendarContactCards("")).resolves.toEqual([]);
    expect(readContactsBootstrapFromCache).not.toHaveBeenCalled();
    expect(listCards).not.toHaveBeenCalled();
  });
});

describe("refreshCalendarContactCards", () => {
  beforeEach(() => {
    vi.mocked(listCards).mockReset();
  });

  it("returns live cards", async () => {
    vi.mocked(listCards).mockResolvedValue([liveJane]);
    await expect(refreshCalendarContactCards()).resolves.toEqual([liveJane]);
  });

  it("returns null when live listCards throws", async () => {
    vi.mocked(listCards).mockRejectedValue(new Error("offline"));
    await expect(refreshCalendarContactCards()).resolves.toBeNull();
  });
});

describe("useCalendarContactInvitees", () => {
  beforeEach(() => {
    vi.mocked(readContactsBootstrapFromCache).mockReset();
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

  it("falls back to [] when live load throws", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(null);
    vi.mocked(listCards).mockRejectedValue(new Error("JMAP error"));

    const { result } = renderHook(() => useCalendarContactInvitees("alice"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.cards).toEqual([]);
  });

  it("replaces a stale cache with live listCards on refresh", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({
        data: { addressBooks: [], cards: [cachedJane] },
      }),
    );
    vi.mocked(listCards).mockResolvedValue([liveJane]);

    const { result } = renderHook(() => useCalendarContactInvitees("alice"));
    await waitFor(() => {
      expect(result.current.cards).toEqual([cachedJane]);
    });

    await act(async () => {
      result.current.refreshCards();
    });
    await waitFor(() => {
      expect(result.current.cards).toEqual([liveJane]);
    });
    expect(listCards).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good list when live refresh throws", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({
        data: { addressBooks: [], cards: [cachedJane] },
      }),
    );
    vi.mocked(listCards).mockRejectedValue(new Error("offline"));

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

  it("shows a live contact row after search when cache is stale", async () => {
    vi.mocked(readContactsBootstrapFromCache).mockResolvedValue(
      createContactsAppBootstrap({
        data: { addressBooks: [], cards: [cachedJane] },
      }),
    );
    vi.mocked(listCards).mockResolvedValue([liveJane]);

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
      expect(listCards).not.toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventAttendeesAdd), {
      target: { value: "Live" },
    });
    expect(screen.queryByRole("option", { name: /Live Jane/i })).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Live Jane.*Jane@Host · Work/i })).toBeTruthy();
    });
    expect(listCards).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventAttendeesAdd), {
      target: { value: "ali" },
    });
    expect(screen.getByRole("option", { name: /Alice.*Teammate/i })).toBeTruthy();
  });
});

describe("calendar contact load boundaries", () => {
  it("does not import ContactsApp hooks", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "use-calendar-contact-invitees.ts"), "utf8");
    expect(source).not.toMatch(/useContactsAPI|useContactsController|ContactsApp/);
    expect(source).toMatch(/readContactsBootstrapFromCache/);
    expect(source).toMatch(/listCards/);
  });

  it("ships a multi-email contact on the mock calendar source", () => {
    const multi = MOCK_CALENDAR_CONTACT_CARDS.find(
      (row) => Object.keys(row.emails ?? {}).length >= 2,
    );
    expect(multi).toBeTruthy();
    const addresses = Object.values(multi?.emails ?? {}).map((entry) => entry.address);
    expect(addresses).toContain("Jane@Host");
  });
});
