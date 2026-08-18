import type { JmapMethodErrorArgs, JmapSetError } from "./types.js";

/** Transport or request-level failure (HTTP error, RFC 7807 problem details, invalid JSON). */
export class JmapRequestError extends Error {
  readonly status: number | undefined;
  readonly problemType: string | undefined;
  readonly detail: unknown;

  constructor(
    message: string,
    options: { status?: number; problemType?: string; detail?: unknown } = {},
  ) {
    super(message);
    this.name = "JmapRequestError";
    this.status = options.status;
    this.problemType = options.problemType;
    this.detail = options.detail;
  }
}

/** A method call in the batch returned an `error` invocation (RFC 8620 section 3.6.2). */
export class JmapMethodError extends Error {
  readonly methodName: string;
  readonly methodCallId: string;
  readonly errorType: string;
  readonly args: JmapMethodErrorArgs;

  constructor(methodName: string, methodCallId: string, args: JmapMethodErrorArgs) {
    super(
      `JMAP method ${methodName} failed: ${args.type}${args.description ? ` (${args.description})` : ""}`,
    );
    this.name = "JmapMethodError";
    this.methodName = methodName;
    this.methodCallId = methodCallId;
    this.errorType = args.type;
    this.args = args;
  }
}

/** One or more records in a /set call were rejected (notCreated/notUpdated/notDestroyed). */
export class JmapSetItemError extends Error {
  readonly phase: "create" | "update" | "destroy";
  readonly itemId: string;
  readonly setError: JmapSetError;

  constructor(phase: "create" | "update" | "destroy", itemId: string, setError: JmapSetError) {
    super(`JMAP set ${phase} failed for ${itemId}: ${setError.type}`);
    this.name = "JmapSetItemError";
    this.phase = phase;
    this.itemId = itemId;
    this.setError = setError;
  }
}
