/**
 * Network pre-check.
 *
 * A throwaway peer connection gathers server-reflexive candidates against two
 * different STUN hosts and classifies the path. The result tells the relay
 * logic whether to ask for TURN at join instead of waiting for a connection
 * that was never going to succeed.
 *
 * Deliberately free of Meet and collab imports: both meshes send the class on
 * their join body, so this module takes its STUN list as an argument and keeps
 * one session-wide cache for whoever asks first.
 *
 * Only the class ever leaves the browser. Addresses are read to compare mapped
 * ports and are never stored, logged, or sent.
 */

export type NetClass = "open" | "symmetric" | "udp-blocked" | "unknown";

export const NET_PROBE_TIMEOUT_MS = 1_500;

export interface NetProbeOptions {
  /** Two STUN urls on different hosts. Fewer cannot reveal a symmetric NAT. */
  stunUrls: readonly string[];
  timeoutMs?: number;
  /** Injected in tests; defaults to the global constructor. */
  createConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

export interface Reflexive {
  host: string;
  port: number;
}

/**
 * `candidate:` lines are space separated and positional:
 * `foundation component transport priority address port typ <type> ...`
 */
function parseCandidate(candidate: string): { address: string; port: number; type: string } | null {
  const parts = candidate.replace(/^candidate:/, "").split(" ");
  if (parts.length < 8) return null;
  const typIndex = parts.indexOf("typ");
  if (typIndex === -1 || typIndex + 1 >= parts.length) return null;
  const port = Number(parts[5]);
  if (!Number.isFinite(port)) return null;
  return { address: parts[4] ?? "", port, type: parts[typIndex + 1] ?? "" };
}

function isIpv4(address: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
}

/**
 * A candidate whose address is an mDNS name or a private range tells us
 * nothing about the public path.
 */
function isPublicIpv6(address: string): boolean {
  if (!address.includes(":")) return false;
  const lower = address.toLowerCase();
  if (lower.startsWith("fe80") || lower.startsWith("::1")) return false;
  // Unique-local addresses (fc00::/7) are not reachable from the internet.
  return !/^f[cd]/.test(lower);
}

function stunHost(url: string): string {
  return url.replace(/^stuns?:/, "").split(":")[0] ?? url;
}

/**
 * Classify from what was gathered.
 *
 * Two hosts agreeing on the mapped port means the NAT reuses one binding for
 * any destination, so a direct connection can work. Different ports mean a
 * per-destination binding, which no amount of signalling can pair up.
 */
export function classifyCandidates(
  reflexive: readonly Reflexive[],
  publicIpv6Seen: boolean,
  hostCount: number,
): NetClass {
  if (reflexive.length === 0) {
    // A public IPv6 host candidate is directly reachable, so UDP is not
    // actually blocked even though no STUN answer came back.
    if (publicIpv6Seen) return "open";
    return "udp-blocked";
  }

  const hosts = new Set(reflexive.map((entry) => entry.host));
  if (hosts.size < 2 || hostCount < 2) return "unknown";

  const ports = new Set(reflexive.map((entry) => entry.port));
  return ports.size === 1 ? "open" : "symmetric";
}

/**
 * Run the probe once. Resolves `unknown` rather than rejecting: a pre-check
 * that fails must not stop a call from being attempted.
 */
export async function probeNetClass(options: NetProbeOptions): Promise<NetClass> {
  const { stunUrls, timeoutMs = NET_PROBE_TIMEOUT_MS } = options;
  const create =
    options.createConnection ?? ((config: RTCConfiguration) => new RTCPeerConnection(config));

  const hosts = [...new Set(stunUrls.map(stunHost))];
  if (hosts.length < 2) return "unknown";

  let pc: RTCPeerConnection | null = null;
  try {
    pc = create({ iceServers: stunUrls.map((urls) => ({ urls })) });
  } catch {
    return "unknown";
  }

  const reflexive: Reflexive[] = [];
  let publicIpv6Seen = false;

  try {
    return await new Promise<NetClass>((resolve) => {
      let settled = false;
      const finish = (result: NetClass) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        // A timeout with nothing gathered is still evidence: no server
        // reflexive candidate at all is what udp-blocked looks like.
        finish(classifyCandidates(reflexive, publicIpv6Seen, hosts.length));
      }, timeoutMs);

      const connection = pc as RTCPeerConnection;

      connection.onicecandidate = (event) => {
        if (!event.candidate) {
          // Gathering finished before the deadline.
          finish(classifyCandidates(reflexive, publicIpv6Seen, hosts.length));
          return;
        }
        const parsed = parseCandidate(event.candidate.candidate);
        if (!parsed) return;

        if (parsed.type === "srflx" && isIpv4(parsed.address)) {
          const host = stunHost(event.candidate.url ?? "");
          reflexive.push({ host: host || `#${reflexive.length}`, port: parsed.port });
          if (reflexive.length >= hosts.length) {
            finish(classifyCandidates(reflexive, publicIpv6Seen, hosts.length));
          }
          return;
        }

        if (parsed.type === "host" && isPublicIpv6(parsed.address)) {
          publicIpv6Seen = true;
        }
      };

      connection.createDataChannel("probe");
      connection
        .createOffer()
        .then((offer) => connection.setLocalDescription(offer))
        .catch(() => finish("unknown"));
    });
  } finally {
    try {
      pc?.close();
    } catch {
      // A connection that never opened does not need closing.
    }
  }
}

let cached: NetClass | null = null;
let inFlight: Promise<NetClass> | null = null;

/**
 * Session-wide cached class. Meet and collab both call this, so the probe runs
 * once per network rather than once per join.
 */
export async function getNetClass(options: NetProbeOptions): Promise<NetClass> {
  if (cached !== null) return cached;
  inFlight ??= probeNetClass(options).then((result) => {
    cached = result;
    inFlight = null;
    return result;
  });
  return inFlight;
}

/** The last classification, without triggering a probe. */
export function peekNetClass(): NetClass | null {
  return cached;
}

/**
 * Drop the cache so the next caller re-probes. Called when the network
 * changed under us: `online`, and `navigator.connection` `change`.
 */
export function resetNetClass(): void {
  cached = null;
  inFlight = null;
}
