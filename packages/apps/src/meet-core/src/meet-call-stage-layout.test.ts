import { describe, expect, it } from "vitest";
import {
  meetCallStageShowsChat,
  meetCallStageShowsStage,
} from "@/meet-core/src/meet-call-stage-layout";

describe("meetCallStage layout", () => {
  it("shows chat and stage side by side", () => {
    expect(meetCallStageShowsChat("side-by-side")).toBe(true);
    expect(meetCallStageShowsStage("side-by-side")).toBe(true);
  });

  it("hides chat when the stage is fullscreen", () => {
    expect(meetCallStageShowsChat("fullscreen")).toBe(false);
    expect(meetCallStageShowsStage("fullscreen")).toBe(true);
  });

  it("hides the stage when collapsed", () => {
    expect(meetCallStageShowsChat("collapsed")).toBe(true);
    expect(meetCallStageShowsStage("collapsed")).toBe(false);
  });
});
