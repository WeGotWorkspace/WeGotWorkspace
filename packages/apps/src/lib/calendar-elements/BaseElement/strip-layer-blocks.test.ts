import { describe, expect, it } from "vitest";
import { stripLayerBlocks } from "./strip-layer-blocks.js";

describe("stripLayerBlocks", () => {
  it("leaves unlayered css untouched", () => {
    expect(stripLayerBlocks(".a{color:red}")).toBe(".a{color:red}");
  });

  it("drops a layer block and keeps the rules around it", () => {
    expect(stripLayerBlocks(".a{color:red}@layer base{.b{color:blue}}.c{color:green}")).toBe(
      ".a{color:red}.c{color:green}",
    );
  });

  it("drops nested braces inside a layer without ending early", () => {
    expect(stripLayerBlocks("@layer base{@media print{.b{color:blue}}}.c{color:green}")).toBe(
      ".c{color:green}",
    );
  });

  it("drops every layer block in the sheet", () => {
    expect(stripLayerBlocks("@layer a{.a{x:1}}.keep{y:2}@layer b{.b{z:3}}")).toBe(".keep{y:2}");
  });

  it("stops at an unterminated layer so a truncated sheet cannot leak rules", () => {
    expect(stripLayerBlocks(".a{color:red}@layer base")).toBe(".a{color:red}");
  });

  it("keeps a layer statement that only names layers", () => {
    expect(stripLayerBlocks("@layering{.a{x:1}}")).toBe("@layering{.a{x:1}}");
  });
});
