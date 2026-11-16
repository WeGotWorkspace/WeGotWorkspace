import { describe, expect, it } from "vitest";
import { applyTaskAlertsPatch } from "@/lib/models/task-alerts";
import type { Task } from "@/lib/models/tasks-types";

const alert = (n: number) => ({ trigger: { offset: `-PT${n}M` } }) as never;

describe("applyTaskAlertsPatch", () => {
  it("keeps current when there is no patch and clears on null", () => {
    const current = { a: alert(5) } as Task["alerts"];
    expect(applyTaskAlertsPatch(current, undefined)).toBe(current);
    expect(applyTaskAlertsPatch(undefined, undefined)).toBeUndefined();
    expect(applyTaskAlertsPatch(current, null as never)).toBeUndefined();
  });

  it("merges per id and removes null entries", () => {
    const merged = applyTaskAlertsPatch(
      { a: alert(5), b: alert(10) } as Task["alerts"],
      {
        a: null,
        c: alert(15),
      } as never,
    );
    expect(Object.keys(merged ?? {})).toEqual(["b", "c"]);
    expect(
      applyTaskAlertsPatch({ a: alert(5) } as Task["alerts"], { a: null } as never),
    ).toBeUndefined();
  });
});
