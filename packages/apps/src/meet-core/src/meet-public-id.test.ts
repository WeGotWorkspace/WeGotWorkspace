import { describe, expect, it } from "vitest";
import {
  meetChannelIdsEqual,
  meetCollectionIdCandidates,
  meetCollectionIdFromPublic,
  meetPublicChannelId,
} from "@/meet-core/src/meet-public-id";

describe("meetPublicChannelId", () => {
  it("strips chat- and chat-grp- so the path can carry the type", () => {
    expect(meetPublicChannelId("chat-01h455vb4pa9nnrjpznsav8hva")).toBe(
      "01h455vb4pa9nnrjpznsav8hva",
    );
    expect(meetPublicChannelId("chat-general")).toBe("general");
    expect(meetPublicChannelId("chat-grp-0123456789abcdef0123456789abcdef01234567")).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(meetPublicChannelId("already-public")).toBe("already-public");
  });
});

describe("meetCollectionIdFromPublic", () => {
  it("restores chat- for slugs/ulids and chat-grp- for 40-hex group hashes", () => {
    expect(meetCollectionIdFromPublic("01h455vb4pa9nnrjpznsav8hva")).toBe(
      "chat-01h455vb4pa9nnrjpznsav8hva",
    );
    expect(meetCollectionIdFromPublic("general")).toBe("chat-general");
    expect(meetCollectionIdFromPublic("0123456789abcdef0123456789abcdef01234567")).toBe(
      "chat-grp-0123456789abcdef0123456789abcdef01234567",
    );
    expect(meetCollectionIdFromPublic("chat-general")).toBe("chat-general");
  });
});

describe("meetCollectionIdCandidates", () => {
  it("tries the collection id before a leftover public segment", () => {
    expect(meetCollectionIdCandidates("general")).toEqual(["chat-general", "general"]);
    expect(meetCollectionIdCandidates("chat-general")).toEqual(["chat-general"]);
  });
});

describe("meetChannelIdsEqual", () => {
  it("treats public and collection forms as the same channel", () => {
    expect(meetChannelIdsEqual("chat-general", "general")).toBe(true);
    expect(meetChannelIdsEqual("general", "chat-general")).toBe(true);
    expect(meetChannelIdsEqual("chat-secret", "general")).toBe(false);
  });
});
