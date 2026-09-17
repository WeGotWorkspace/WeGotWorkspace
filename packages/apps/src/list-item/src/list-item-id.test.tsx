import { describe, expect, it } from "vitest";
import { LIST_ITEM_ID_ATTR, listItemIdFromTarget } from "@/list-item/src/list-item-id";

describe("listItemIdFromTarget", () => {
  it("reads the id from the row or a descendant", () => {
    const row = document.createElement("button");
    row.setAttribute(LIST_ITEM_ID_ATTR, "card-1");
    const child = document.createElement("span");
    row.append(child);
    expect(listItemIdFromTarget(child)).toBe("card-1");
    expect(listItemIdFromTarget(row)).toBe("card-1");
  });

  it("returns null outside a list row", () => {
    expect(listItemIdFromTarget(document.createElement("div"))).toBeNull();
    expect(listItemIdFromTarget(null)).toBeNull();
  });
});
