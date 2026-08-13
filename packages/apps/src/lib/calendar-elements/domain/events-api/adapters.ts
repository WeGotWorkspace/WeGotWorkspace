import type {
  EventCreateRequestDetail,
  EventDeleteRequestDetail,
  EventUpdateRequestDetail,
} from "../../types/CalendarEventRequests.js";
import type {
  CreateInput,
  EventOperation,
  EventOperationRequest,
  EventTarget,
  MoveInput,
  RemoveInput,
  ResizeEndInput,
  ResizeStartInput,
  UpdateInput,
} from "@/lib/calendar-engine";

export function toEventTarget(input: {
  eventId?: string;
  accountId?: string;
  calendarId?: string;
  recurrenceId?: string;
}): EventTarget {
  if (!input.eventId) {
    return { key: "" };
  }
  return {
    eventId: input.eventId,
    accountId: input.accountId,
    calendarId: input.calendarId,
    recurrenceId: input.recurrenceId,
  };
}

export function fromCreateRequest(detail: EventCreateRequestDetail): CreateInput {
  return {
    event: {
      accountId: detail.envelope.accountId,
      calendarId: detail.envelope.calendarId,
      pendingOp: "created",
      data: {
        ...detail.content,
      },
    },
  };
}

export function fromUpdateRequest(detail: EventUpdateRequestDetail): UpdateInput {
  return {
    target: toEventTarget(detail.envelope),
    scope: detail.envelope.isRecurring && !detail.envelope.isException ? "series" : "single",
    patch: {
      start: detail.content.start,
      end: detail.content.end,
      allDay: detail.content.allDay,
      summary: detail.content.summary,
      color: detail.content.color,
      location: detail.content.location,
      calendarId: detail.envelope.calendarId,
      accountId: detail.envelope.accountId,
    },
  };
}

export function fromDeleteRequest(detail: EventDeleteRequestDetail): RemoveInput {
  return {
    target: toEventTarget(detail.envelope),
    scope: detail.envelope.isRecurring ? "series" : "single",
  };
}

export function deriveOperation(request: EventOperationRequest): EventOperation {
  if (request.kind === "create") return { type: "create", input: request.input };
  if (request.kind === "update") return { type: "update", input: request.input };
  if (request.kind === "move") return { type: "move", input: request.input };
  if (request.kind === "resizeStart") return { type: "resize-start", input: request.input };
  if (request.kind === "resizeEnd") return { type: "resize-end", input: request.input };
  if (request.kind === "remove") return { type: "remove", input: request.input };
  if (request.kind === "addExclusion") return { type: "add-exclusion", input: request.input };
  if (request.kind === "removeExclusion") return { type: "remove-exclusion", input: request.input };
  if (request.kind === "addException") return { type: "add-exception", input: request.input };
  return { type: "remove-exception", input: request.input };
}

export function moveFromUpdateRequest(
  detail: EventUpdateRequestDetail,
  delta: MoveInput["delta"],
): MoveInput {
  return {
    target: toEventTarget(detail.envelope),
    scope: detail.envelope.isRecurring && !detail.envelope.isException ? "series" : "single",
    delta,
  };
}

export function resizeStartFromUpdateRequest(
  detail: EventUpdateRequestDetail,
): ResizeStartInput | null {
  if (!detail.content.start) return null;
  return {
    target: toEventTarget(detail.envelope),
    scope: detail.envelope.isRecurring && !detail.envelope.isException ? "series" : "single",
    toStart: detail.content.start,
  };
}

export function resizeEndFromUpdateRequest(
  detail: EventUpdateRequestDetail,
): ResizeEndInput | null {
  if (!detail.content.end) return null;
  return {
    target: toEventTarget(detail.envelope),
    scope: detail.envelope.isRecurring && !detail.envelope.isException ? "series" : "single",
    toEnd: detail.content.end,
  };
}
