/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MeetDirectMessageRows,
  MeetSidebarRows,
} from "@/meet-core/src/meet-workspace-sidebar-rows";
import type { MeetDirectMessagePerson } from "@/meet-core/src/meet-direct-messages";
import type { MeetChannel } from "@/meet-core/src/meet-types";

const people: MeetDirectMessagePerson[] = [
  { id: "ada", displayName: "Ada Lovelace", channelId: "dm:ada" },
  { id: "grace", displayName: "Grace Hopper", channelId: "dm:grace" },
];

describe("MeetDirectMessageRows", () => {
  it("prefixes each person with a presence dot and no avatar", () => {
    const { container } = render(
      <ul>
        <MeetDirectMessageRows
          people={people}
          selectedId={null}
          authorPresence={{ ada: "online", grace: "away" }}
          onSelect={vi.fn()}
          channelHasLiveCall={() => false}
          channelCallAudioOnly={() => false}
        />
      </ul>,
    );

    expect(container.querySelector(".user-avatar")).toBeNull();
    const rows = container.querySelectorAll(".meet-direct-message-row");
    expect(rows).toHaveLength(2);
    expect(
      rows[0]?.querySelector(".collection-sidebar-row__leading [data-presence='online']"),
    ).toBeTruthy();
    expect(
      rows[1]?.querySelector(".collection-sidebar-row__leading [data-presence='away']"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ada Lovelace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grace Hopper" })).toBeTruthy();
  });

  it("uses an offline presence dot when presence is missing", () => {
    const { container } = render(
      <ul>
        <MeetDirectMessageRows
          people={[people[0]!]}
          selectedId={null}
          onSelect={vi.fn()}
          channelHasLiveCall={() => false}
          channelCallAudioOnly={() => false}
        />
      </ul>,
    );

    expect(
      container.querySelector(".collection-sidebar-row__leading [data-presence='offline']"),
    ).toBeTruthy();
    expect(container.querySelector(".user-avatar")).toBeNull();
  });
});

const channels: MeetChannel[] = [
  { id: "channel-design", name: "Design", kind: "channel", scope: "personal" },
  { id: "meeting-standup", name: "Standup", kind: "meeting", scope: "personal" },
];

describe("MeetSidebarRows", () => {
  it("prefixes channels with a hash icon and keeps the name text", () => {
    const { container } = render(
      <ul>
        <MeetSidebarRows
          channels={channels}
          selectedId={null}
          onSelect={vi.fn()}
          channelHasLiveCall={() => false}
          channelCallAudioOnly={() => false}
        />
      </ul>,
    );

    const design = screen.getByRole("button", { name: "design" });
    expect(design.textContent).not.toContain("#");
    expect(design.closest(".collection-sidebar-row")?.querySelector(".lucide-hash")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Standup" })
        .closest(".collection-sidebar-row")
        ?.querySelector(".lucide-calendar-days"),
    ).toBeTruthy();
    expect(container.querySelector(".user-avatar")).toBeNull();
  });
});
