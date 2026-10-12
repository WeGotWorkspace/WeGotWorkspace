import type { NetClass } from "@/lib/rtc/net-probe";

/**
 * Worse networks ask for the relay. A tie asks the initiator, except when both
 * sides are `open`: a direct pair that can connect must not request at all.
 */
const RANK: Record<NetClass, number> = {
  open: 0,
  unknown: 1,
  symmetric: 2,
  "udp-blocked": 3,
};

export function shouldRequestRelay(
  local: NetClass,
  remote: NetClass | undefined,
  initiator: boolean,
): boolean {
  const other: NetClass = remote ?? "unknown";
  if (local === "open" && other === "open") return false;
  if (RANK[local] > RANK[other]) return true;
  if (RANK[local] < RANK[other]) return false;
  return initiator;
}

/** Own path cannot do direct, so the join asks before any offer goes out. */
export function needsRelayPrecheck(net: NetClass | undefined): boolean {
  return net === "symmetric" || net === "udp-blocked";
}
