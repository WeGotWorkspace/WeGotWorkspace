import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  NEW_TASK_PRIORITIES,
  NEW_TASK_STATUSES,
  TASKS_NEW_TASK_PREFS_SLICE,
  tasksNewTaskLabels,
  readTasksNewTaskPrefs,
  writeTasksNewTaskPrefs,
} from "@/lib/tasks-new-task-prefs";
import { useSettingsPrefsForm } from "@/settings-core/src/use-settings-prefs-form";
import { SettingsPrefsFormPane } from "@/settings-core/src/settings-prefs-form-pane";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormField } from "@/ui/form";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";

const settingsTasksNewTaskFormSchema = z.object({
  priority: z.string(),
  status: z.string(),
});

type SettingsTasksNewTaskFormValues = z.infer<typeof settingsTasksNewTaskFormSchema>;

const resolver = zodResolver(settingsTasksNewTaskFormSchema);

function readForm(): SettingsTasksNewTaskFormValues {
  const prefs = readTasksNewTaskPrefs();
  return { priority: String(prefs.priority), status: prefs.status };
}

function writeForm(values: SettingsTasksNewTaskFormValues): boolean {
  const current = readTasksNewTaskPrefs();
  const priority = NEW_TASK_PRIORITIES.find((value) => String(value) === values.priority);
  const status = NEW_TASK_STATUSES.find((value) => value === values.status);
  return writeTasksNewTaskPrefs({
    priority: priority ?? current.priority,
    status: status ?? current.status,
  });
}

/** What a new task starts with: its priority and its status. Device-local. */
export function SettingsTasksNewTaskPane() {
  const L = tasksNewTaskLabels;
  const { form } = useSettingsPrefsForm<SettingsTasksNewTaskFormValues>({
    resolver,
    read: readForm,
    write: writeForm,
    saved: TASKS_NEW_TASK_PREFS_SLICE,
    saveError: L.saveError,
  });
  return (
    <SettingsPrefsFormPane controller={{ form }} continued>
      <FormField
        control={form.control}
        name="priority"
        render={({ field }) => (
          <FieldLabelRow layout="inline" label={L.priority} description={L.priorityHint}>
            <Select value={field.value} onValueChange={field.onChange}>
              <CollectionGhostSelectTrigger aria-label={L.priority} label={<SelectValue />} />
              <SelectContent align="end">
                {NEW_TASK_PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={String(priority)}>
                    {L.priorities[priority]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLabelRow>
        )}
      />
      <FormField
        control={form.control}
        name="status"
        render={({ field }) => (
          <FieldLabelRow layout="inline" label={L.status} description={L.statusHint}>
            <Select value={field.value} onValueChange={field.onChange}>
              <CollectionGhostSelectTrigger aria-label={L.status} label={<SelectValue />} />
              <SelectContent align="end">
                {NEW_TASK_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {L.statuses[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLabelRow>
        )}
      />
    </SettingsPrefsFormPane>
  );
}
