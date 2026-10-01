import { afterEach, describe, expect, it, vi } from "vitest";
import {
  playMeetKnockSound,
  primeMeetKnockSound,
  resetMeetKnockSoundForTests,
} from "@/meet-core/src/meet-chat-utils";

type FakeOscillator = {
  type: OscillatorType;
  frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

type FakeContext = {
  state: string;
  currentTime: number;
  destination: Record<string, never>;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  oscillators: FakeOscillator[];
  constructions: { count: number };
};

function installAudioContext(state: string): FakeContext {
  const oscillators: FakeOscillator[] = [];
  const constructions = { count: 0 };
  const ctx: FakeContext = {
    state,
    currentTime: 0,
    destination: {},
    constructions,
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    close: vi.fn(async () => {
      ctx.state = "closed";
    }),
    createGain: vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    })),
    createOscillator: vi.fn(() => {
      const osc: FakeOscillator = {
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }),
    oscillators,
  };

  class FakeAudioContext {
    constructor() {
      constructions.count += 1;
      return ctx;
    }
  }

  vi.stubGlobal("window", { AudioContext: FakeAudioContext });
  return ctx;
}

describe("playMeetKnockSound", () => {
  afterEach(() => {
    resetMeetKnockSoundForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("schedules the two-tone chime on an already running context", () => {
    const ctx = installAudioContext("running");

    playMeetKnockSound();

    expect(ctx.resume).not.toHaveBeenCalled();
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0]?.start).toHaveBeenCalledWith(0);
    expect(ctx.oscillators[0]?.frequency.setValueAtTime).toHaveBeenCalledWith(740, 0);
    expect(ctx.oscillators[1]?.start).toHaveBeenCalledWith(0.18);
    expect(ctx.oscillators[1]?.frequency.setValueAtTime).toHaveBeenCalledWith(988, 0.18);
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it("resumes a suspended context before scheduling the chime", async () => {
    const ctx = installAudioContext("suspended");

    playMeetKnockSound();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.createOscillator).not.toHaveBeenCalled();

    await ctx.resume.mock.results[0]?.value;
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0]?.start).toHaveBeenCalled();
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it("resumes an interrupted context before scheduling the chime", async () => {
    const ctx = installAudioContext("interrupted");

    playMeetKnockSound();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    await ctx.resume.mock.results[0]?.value;
    expect(ctx.oscillators).toHaveLength(2);
  });

  it("does not play when resume resolves after the knock has gone stale", async () => {
    const ctx = installAudioContext("suspended");
    let finish = (): void => {};
    ctx.resume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            ctx.state = "running";
            resolve();
          };
        }),
    );
    vi.spyOn(performance, "now").mockReturnValueOnce(1_000).mockReturnValue(3_000);

    playMeetKnockSound();
    finish();
    await Promise.resolve();

    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });

  it("does nothing when the browser has no audio context", () => {
    vi.stubGlobal("window", {});
    expect(() => playMeetKnockSound()).not.toThrow();
    expect(() => primeMeetKnockSound()).not.toThrow();
  });
});

describe("primeMeetKnockSound", () => {
  afterEach(() => {
    resetMeetKnockSoundForTests();
    vi.unstubAllGlobals();
  });

  it("resumes the shared context from a user gesture", () => {
    const ctx = installAudioContext("suspended");

    primeMeetKnockSound();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });

  it("resumes an interrupted context", () => {
    const ctx = installAudioContext("interrupted");

    primeMeetKnockSound();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("reuses one audio context for a later chime", () => {
    const ctx = installAudioContext("running");

    primeMeetKnockSound();
    playMeetKnockSound();

    expect(ctx.constructions.count).toBe(1);
    expect(ctx.oscillators).toHaveLength(2);
  });
});
