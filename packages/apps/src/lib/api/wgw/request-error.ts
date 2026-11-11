import { ApiError } from "@/lib/api/api-error";

/**
 * A WeGotWorkspace API request that failed with an HTTP status. Callers classify
 * the failure by `status`, never by the message text
 * (`.agents/skills/client-transport/SKILL.md`).
 */
export class WgwRequestError extends ApiError {}
