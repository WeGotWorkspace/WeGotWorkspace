import assert from "node:assert/strict";
import test from "node:test";

import { hasSummary, isDeliveryIssue, summaryLabelAction } from "./issue-summary.mjs";

const filled = [
  "## Summary",
  "",
  "**What:** Guests cannot upload into a shared folder.",
  "**Who notices:** Guests with an upload link.",
  "**If we wait:** Guests see an upload option that never works.",
  "",
  "## Details",
  "Technical text.",
].join("\n");

// What the Epic, Task and Chore templates prefill: markers with nothing after them.
const templatePrefill =
  "### Summary\n\n**What:**\n**Who notices:**\n**If we wait:**\n\n### Parent goal\n\nx";

test("a filled Summary counts", () => {
  assert.equal(hasSummary(filled), true);
});

test("the empty template prefill does not count", () => {
  assert.equal(hasSummary(templatePrefill), false);
});

test("a marker followed by the next marker on the next line does not count", () => {
  assert.equal(
    hasSummary(
      "**What:**\n**Who notices:** Admins on small hosts.\n**If we wait:** Uploads keep failing.",
    ),
    false,
  );
});

test("a one-word line does not count", () => {
  assert.equal(
    hasSummary(
      "**What:** TBD\n**Who notices:** Admins on small hosts.\n**If we wait:** Uploads keep failing.",
    ),
    false,
  );
});

test("a missing line does not count", () => {
  assert.equal(
    hasSummary("**What:** Uploads fail on small hosts.\n**Who notices:** Admins on small hosts."),
    false,
  );
});

test("plain markers, list items and quotes count", () => {
  assert.equal(
    hasSummary(
      "- What: Uploads fail on small hosts.\n- Who notices: Admins on small hosts.\n- If we wait: Uploads keep failing.",
    ),
    true,
  );
  assert.equal(
    hasSummary(
      "> **What:** Uploads fail.\n>\n> **Who notices:** Small hosts.\n>\n> **If we wait:** They keep failing.",
    ),
    true,
  );
});

test("an empty or missing body does not count", () => {
  assert.equal(hasSummary(""), false);
  assert.equal(hasSummary(null), false);
});

test("Epics, Tasks, Chores and Bugs are delivery issues", () => {
  assert.equal(isDeliveryIssue({ labels: ["type:epic"] }), true);
  assert.equal(isDeliveryIssue({ labels: ["type:task", "area:docs"] }), true);
  assert.equal(isDeliveryIssue({ labels: ["type:chore"] }), true);
  assert.equal(isDeliveryIssue({ labels: ["type:bug"] }), true);
  assert.equal(isDeliveryIssue({ labels: ["needs-triage"], typeName: "Bug" }), true);
});

test("other issues are not delivery issues", () => {
  assert.equal(isDeliveryIssue({ labels: ["security", "dast"] }), false);
  assert.equal(isDeliveryIssue({ labels: [], typeName: null }), false);
});

test("a delivery issue without a Summary gets the label", () => {
  assert.equal(summaryLabelAction({ labels: ["type:task"], body: templatePrefill }), "add");
  assert.equal(
    summaryLabelAction({
      labels: ["needs-triage"],
      typeName: "Bug",
      body: "### What is going wrong?\n\nIt breaks.",
    }),
    "add",
  );
});

test("the label is not added twice", () => {
  assert.equal(summaryLabelAction({ labels: ["type:task", "needs-summary"], body: "" }), null);
});

test("the label goes away once the Summary is filled in", () => {
  assert.equal(
    summaryLabelAction({ labels: ["type:task", "needs-summary"], body: filled }),
    "remove",
  );
});

test("a complete delivery issue is left alone", () => {
  assert.equal(summaryLabelAction({ labels: ["type:epic"], body: filled }), null);
});

test("other issues and closed issues are left alone", () => {
  assert.equal(summaryLabelAction({ labels: ["dast"], body: "" }), null);
  assert.equal(summaryLabelAction({ state: "closed", labels: ["type:task"], body: "" }), null);
});
