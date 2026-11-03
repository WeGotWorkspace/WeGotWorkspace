/**
 * JMAP Push transport contract (docs/architecture/jmap-push.md, #1659).
 *
 * Only the event-source transport calls `deliver`, so every state still comes
 * from the server under the user's own rights. Any other transport (the mesh
 * `check-now`, #1662) can only `wake`: a transport that fails or lies costs
 * at most one extra request.
 */

/** RFC 8620 §7.1: per account, per type, the state `Foo/get` would return now. */
export type StateChange = {
  "@type": "StateChange";
  changed: Record<string, Record<string, string>>;
};

export interface PushSink {
  /** A StateChange from the server, with the event id that followed it. */
  deliver(change: StateChange, eventId: string): void;
  /** "Something may have changed, ask the server now." Any transport may call it. */
  wake(reason: string): void;
}

export interface PushTransport {
  /** Starts the transport; returns a stop function. */
  start(sink: PushSink): () => void;
}

export function isStateChange(value: unknown): value is StateChange {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { "@type"?: unknown; changed?: unknown };
  if (candidate["@type"] !== "StateChange") return false;
  if (typeof candidate.changed !== "object" || candidate.changed === null) return false;
  return Object.values(candidate.changed).every(
    (states) =>
      typeof states === "object" &&
      states !== null &&
      Object.values(states).every((state) => typeof state === "string"),
  );
}
