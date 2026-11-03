import { describe, expect, it, vi } from "vitest";
import { StateChangeSubscription } from "./state-change-subscription";

const H1 = "1".repeat(32);
const H2 = "2".repeat(32);
const H3 = "3".repeat(32);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("StateChangeSubscription", () => {
  it("calls the listener once for types that arrive in the same tick", async () => {
    const listener = vi.fn(async () => true);
    const sub = new StateChangeSubscription(["Note", "Notebook"], listener, vi.fn());
    sub.offer("u", { Note: { state: "n1", hash: H1 } });
    sub.offer("u", { Notebook: { state: "b1", hash: H2 } });
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ Note: "n1", Notebook: "b1" }, "u");
  });

  it("ignores types it did not subscribe to", async () => {
    const listener = vi.fn(async () => true);
    const sub = new StateChangeSubscription(["Note"], listener, vi.fn());
    sub.offer("u", { Calendar: { state: "c", hash: H1 } });
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it("confirms the hash after a successful sync", async () => {
    const onConfirmed = vi.fn();
    const sub = new StateChangeSubscription(["Note"], async () => undefined, onConfirmed);
    sub.offer("u", { Note: { state: "n1", hash: H1 } });
    await flush();
    expect(sub.confirmed).toEqual({ Note: H1 });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("keeps the old hash when the sync fails or throws", async () => {
    let result: boolean | Error = true;
    const sub = new StateChangeSubscription(
      ["Note"],
      async () => {
        if (result instanceof Error) throw result;
        return result;
      },
      vi.fn(),
    );
    sub.offer("u", { Note: { state: "n1", hash: H1 } });
    await flush();
    result = false;
    sub.offer("u", { Note: { state: "n2", hash: H2 } });
    await flush();
    expect(sub.confirmed).toEqual({ Note: H1 });
    result = new Error("network");
    sub.offer("u", { Note: { state: "n3", hash: H3 } });
    await flush();
    expect(sub.confirmed).toEqual({ Note: H1 });
  });

  it("runs one sync at a time; a newer push only replaces the waiting one", async () => {
    const first = deferred<boolean>();
    const calls: string[] = [];
    const sub = new StateChangeSubscription(
      ["Note"],
      (states) => {
        calls.push(states.Note!);
        return calls.length === 1 ? first.promise : true;
      },
      vi.fn(),
    );
    sub.offer("u", { Note: { state: "n1", hash: H1 } });
    await flush();
    sub.offer("u", { Note: { state: "n2", hash: H2 } });
    sub.offer("u", { Note: { state: "n3", hash: H3 } });
    await flush();
    expect(calls).toEqual(["n1"]);

    first.resolve(true);
    await flush();
    expect(calls).toEqual(["n1", "n3"]);
    expect(sub.confirmed).toEqual({ Note: H3 });
  });

  it("an older sync that fails after a newer push never rolls back", async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const runs = [first, second];
    const sub = new StateChangeSubscription(["Note"], () => runs.shift()!.promise, vi.fn());
    sub.offer("u", { Note: { state: "n1", hash: H1 } });
    await flush();
    sub.offer("u", { Note: { state: "n2", hash: H2 } });

    first.resolve(false);
    await flush();
    second.resolve(true);
    await flush();
    expect(sub.confirmed).toEqual({ Note: H2 });
  });

  it("does not confirm a push that came without an event id", async () => {
    const sub = new StateChangeSubscription(["Note"], async () => true, vi.fn());
    sub.offer("u", { Note: { state: "n1", hash: null } });
    await flush();
    expect(sub.confirmed).toEqual({});
  });

  it("stops calling the listener after dispose", async () => {
    const listener = vi.fn(async () => true);
    const sub = new StateChangeSubscription(["Note"], listener, vi.fn());
    sub.offer("u", { Note: { state: "n1", hash: H1 } });
    sub.dispose();
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
