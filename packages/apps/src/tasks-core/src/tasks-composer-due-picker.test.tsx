import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TasksComposerDuePicker,
  TasksDueAllDaySwitch,
} from "@/tasks-core/src/tasks-composer-due-picker";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import type { TaskDueFields } from "@/tasks-core/src/tasks-task-utils";
import { TooltipProvider } from "@/ui/tooltip";
import "@/tasks-core/src/tasks-field-controls.css";

/** The due trigger is named "Due date: <value>"; match on the field-name prefix. */
const dueTriggerName = new RegExp(`^${defaultTasksLabels.addTaskDue}:`);

type HarnessProps = {
  due: string | null;
  showWithoutTime?: boolean;
  onChange: (next: TaskDueFields) => void;
};

/** The due field and its All day switch over one value, as the detail pane wires them. */
function DueHarness({ due, showWithoutTime = true, onChange }: HarnessProps) {
  const [value, setValue] = useState({ due, showWithoutTime });
  const props: ComponentProps<typeof TasksComposerDuePicker> = {
    labels: defaultTasksLabels,
    due: value.due,
    showWithoutTime: value.showWithoutTime,
    onChange: (next) => {
      setValue({ due: next.due, showWithoutTime: next.showWithoutTime });
      onChange(next);
    },
  };
  return (
    <>
      <TasksComposerDuePicker {...props} />
      <TasksDueAllDaySwitch {...props} />
    </>
  );
}

function renderDue(overrides: Partial<HarnessProps> = {}) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <DueHarness due={null} onChange={onChange} {...overrides} />
    </TooltipProvider>,
  );
  return { onChange };
}

const timeField = () => screen.queryByLabelText<HTMLInputElement>(defaultTasksLabels.dueTimeLabel);
const allDaySwitch = () => screen.queryByRole("switch", { name: defaultTasksLabels.dueAllDay });

function selectDay(date: Date): void {
  const dataDay = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  const dayButton = document.querySelector(`button[data-day="${dataDay}"]`);
  expect(dayButton).toBeTruthy();
  fireEvent.click(dayButton!);
}

describe("TasksComposerDuePicker", () => {
  const now = new Date(2026, 6, 8, 12, 0, 0);

  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only the day until one is picked, then All day on and no time", () => {
    const { onChange } = renderDue();

    expect(timeField()).toBeNull();
    expect(allDaySwitch()).toBeNull();
    fireEvent.click(screen.getByLabelText(dueTriggerName));
    selectDay(now);

    expect(onChange).toHaveBeenCalledWith({
      due: "2026-07-08",
      showWithoutTime: true,
      timeZone: null,
    });
    expect(allDaySwitch()!.getAttribute("aria-checked")).toBe("true");
    expect(timeField()).toBeNull();
  });

  it("turning All day off gives the due a time, floating", () => {
    const { onChange } = renderDue({ due: "2026-07-08", showWithoutTime: true });

    fireEvent.click(allDaySwitch()!);

    expect(onChange).toHaveBeenCalledWith({
      due: "2026-07-08T09:00:00",
      showWithoutTime: false,
      timeZone: null,
    });
    expect(timeField()!.value).toBe("09:00");
    expect(timeField()!.closest(".collection-ghost-select")).toBeTruthy();
  });

  it("takes any time, and drops a zone the due had", () => {
    const { onChange } = renderDue({ due: "2026-07-08T09:00:00", showWithoutTime: false });

    fireEvent.change(timeField()!, { target: { value: "15:47" } });

    expect(onChange).toHaveBeenCalledWith({
      due: "2026-07-08T15:47:00",
      showWithoutTime: false,
      timeZone: null,
    });
  });

  it("keeps the time when clearing the field", () => {
    const { onChange } = renderDue({ due: "2026-07-08T09:00:00", showWithoutTime: false });

    fireEvent.change(timeField()!, { target: { value: "" } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the time when picking another day", () => {
    const { onChange } = renderDue({ due: "2026-07-08T15:45:00", showWithoutTime: false });

    fireEvent.click(screen.getByLabelText(dueTriggerName));
    selectDay(new Date(2026, 6, 10));

    expect(onChange).toHaveBeenCalledWith({
      due: "2026-07-10T15:45:00",
      showWithoutTime: false,
      timeZone: null,
    });
  });

  it("turning All day on returns to a date-only due without the time field", () => {
    const { onChange } = renderDue({ due: "2026-07-08T15:45:00", showWithoutTime: false });

    fireEvent.click(allDaySwitch()!);

    expect(onChange).toHaveBeenCalledWith({
      due: "2026-07-08",
      showWithoutTime: true,
      timeZone: null,
    });
    expect(timeField()).toBeNull();
  });
});
