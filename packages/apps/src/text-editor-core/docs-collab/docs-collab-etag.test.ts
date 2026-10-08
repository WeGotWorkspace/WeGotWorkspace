import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetSidecarEtag,
  rememberSidecarEtag,
  resetSidecarEtagsForTests,
  sidecarPrecondition,
} from "./docs-collab-etag";

const ROOM = "docs/together.md";
const OTHER_ROOM = "docs/other.md";
const SIDECAR_ETAG = '"sidecar-rev-1"';

describe("docs-collab-etag", () => {
  beforeEach(() => {
    resetSidecarEtagsForTests();
  });

  it("sends no precondition for a room it has never loaded", () => {
    expect(sidecarPrecondition(ROOM)).toBeNull();
  });

  it("sends If-Match once a sidecar ETag is known", () => {
    rememberSidecarEtag(ROOM, SIDECAR_ETAG);

    expect(sidecarPrecondition(ROOM)).toEqual({ name: "If-Match", value: SIDECAR_ETAG });
  });

  it("sends If-None-Match: * when the room is known to have no sidecar", () => {
    rememberSidecarEtag(ROOM, null);

    expect(sidecarPrecondition(ROOM)).toEqual({ name: "If-None-Match", value: "*" });
  });

  it("keeps rooms independent", () => {
    rememberSidecarEtag(ROOM, SIDECAR_ETAG);
    rememberSidecarEtag(OTHER_ROOM, null);

    expect(sidecarPrecondition(ROOM)).toEqual({ name: "If-Match", value: SIDECAR_ETAG });
    expect(sidecarPrecondition(OTHER_ROOM)).toEqual({ name: "If-None-Match", value: "*" });
  });

  it("returns to no precondition after the room is forgotten", () => {
    rememberSidecarEtag(ROOM, SIDECAR_ETAG);
    forgetSidecarEtag(ROOM);

    expect(sidecarPrecondition(ROOM)).toBeNull();
  });

  it("ignores a blank room", () => {
    rememberSidecarEtag("", SIDECAR_ETAG);

    expect(sidecarPrecondition("")).toBeNull();
  });
});
