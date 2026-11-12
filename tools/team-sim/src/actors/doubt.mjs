// A failure the harness itself may have caused (a race in its own bookkeeping,
// not something a person would notice). The outcome is recorded as failed
// with `suspect: "harness"`; the report tags it, friction does not count it as
// the persona's trouble, and diaries leave it out.
export class HarnessDoubt extends Error {
  constructor(message) {
    super(message);
    this.suspect = "harness";
  }
}
