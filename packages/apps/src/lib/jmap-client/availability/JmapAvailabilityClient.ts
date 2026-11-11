import type { JmapClient } from "../core/JmapClient.js";
import { AVAILABILITY_CAPABILITY, CORE_CAPABILITY, type JmapId } from "../core/types.js";
import type {
  JmapTeamMemberGetAvailabilityArgs,
  JmapTeamMemberGetAvailabilityResponse,
  JmapTeamMemberGetResponse,
} from "./types.js";

export const AVAILABILITY_USING = [CORE_CAPABILITY, AVAILABILITY_CAPABILITY];

/**
 * `TeamMember/get` and `TeamMember/getAvailability` over {@link JmapClient}.
 * Read-only; ranges must be whole UTC weeks (see `availability-weeks.ts`).
 */
export class JmapAvailabilityClient {
  readonly client: JmapClient;

  constructor(client: JmapClient) {
    this.client = client;
  }

  /** The caller's account id for the availability capability. */
  accountId(): JmapId {
    return this.client.primaryAccountId(AVAILABILITY_CAPABILITY);
  }

  /** True when the connected server offers the capability. */
  isSupported(): boolean {
    return this.client.isConnected && AVAILABILITY_CAPABILITY in this.client.session.capabilities;
  }

  getTeamMembers(accountId: JmapId = this.accountId()): Promise<JmapTeamMemberGetResponse> {
    return this.client.call<JmapTeamMemberGetResponse>(
      "TeamMember/get",
      { accountId, ids: null },
      AVAILABILITY_USING,
    );
  }

  getAvailability(
    args: JmapTeamMemberGetAvailabilityArgs,
    accountId: JmapId = this.accountId(),
  ): Promise<JmapTeamMemberGetAvailabilityResponse> {
    return this.client.call<JmapTeamMemberGetAvailabilityResponse>(
      "TeamMember/getAvailability",
      {
        accountId,
        ids: args.ids,
        utcStart: args.utcStart,
        utcEnd: args.utcEnd,
        ...(args.excludeEventId ? { excludeEventId: args.excludeEventId } : {}),
      },
      AVAILABILITY_USING,
    );
  }
}
