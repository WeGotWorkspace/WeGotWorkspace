<?php

declare(strict_types=1);

namespace App\Services\Tasks\Conversion;

use App\Exceptions\ApiHttpException;
use App\Services\VObject\ICalendarDateList;
use App\Services\VObject\ICalendarDateTime;
use App\Services\VObject\ICalendarRecurrence;
use App\Services\VObject\ICalendarSeries;
use App\Services\VObject\VObjectPayloadGuard;
use Sabre\VObject\Component\VTodo;

final class IcsToJmapTaskConverter
{
    public function __construct(
        private readonly VObjectPayloadGuard $guard = new VObjectPayloadGuard,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function tasksFromIcs(string $ics): array
    {
        try {
            $vobject = $this->guard->readICalendar($ics, 'tasks');
        } catch (ApiHttpException $e) {
            throw $e;
        } catch (\Throwable) {
            return [];
        }

        /** @var list<VTodo> $components */
        $components = [];
        foreach ($vobject->getComponents('VTODO') as $component) {
            if ($component instanceof VTodo) {
                $components[] = $component;
            }
        }

        return $this->tasksFromComponents($components);
    }

    /**
     * @param  list<VTodo>  $components
     * @return list<array<string, mixed>>
     */
    private function tasksFromComponents(array $components): array
    {
        $tasks = [];
        foreach (ICalendarSeries::groupByUid($components) as $group) {
            $tasks[] = $this->convertGroupedComponents($group);
        }

        return $tasks;
    }

    /**
     * @param  list<VTodo>  $group
     * @return array<string, mixed>
     */
    private function convertGroupedComponents(array $group): array
    {
        if (count($group) === 1) {
            return $this->convertComponent($group[0]);
        }

        ['masters' => $masters, 'overrides' => $overrides] = ICalendarSeries::partitionMastersAndOverrides($group);
        $master = null;
        foreach ($masters as $candidate) {
            if ($master === null || isset($candidate->RRULE)) {
                $master = $candidate;
            }
        }

        if (! $master instanceof VTodo) {
            $master = $group[0];
        }

        $task = $this->convertComponent($master);
        if ($overrides !== []) {
            $recurrenceOverrides = [];
            foreach ($overrides as $override) {
                if (! $override instanceof VTodo) {
                    continue;
                }
                $recurrenceId = isset($override->{'RECURRENCE-ID'})
                    ? ICalendarDateTime::fromProperty($override->{'RECURRENCE-ID'})['value']
                    : null;
                if ($recurrenceId === null || $recurrenceId === '') {
                    continue;
                }
                $patch = TaskConversionSupport::recurrenceOverrideFromVtodo($override);
                if ($patch !== []) {
                    $recurrenceOverrides[$recurrenceId] = $patch;
                }
            }
            if ($recurrenceOverrides !== []) {
                $task['recurrenceOverrides'] = $recurrenceOverrides;
            }
        }

        return $task;
    }

    /**
     * @return array<string, mixed>
     */
    private function convertComponent(VTodo $todo): array
    {
        $uid = isset($todo->UID) ? trim((string) $todo->UID->getValue()) : '';
        $summary = isset($todo->SUMMARY) ? trim((string) $todo->SUMMARY->getValue()) : null;
        $description = isset($todo->DESCRIPTION) ? trim((string) $todo->DESCRIPTION->getValue()) : null;
        $status = isset($todo->STATUS) ? trim((string) $todo->STATUS->getValue()) : null;
        $class = isset($todo->CLASS) ? trim((string) $todo->CLASS->getValue()) : null;
        $priority = isset($todo->PRIORITY) ? (int) $todo->PRIORITY->getValue() : null;
        $progress = isset($todo->{'PERCENT-COMPLETE'}) ? (int) $todo->{'PERCENT-COMPLETE'}->getValue() : null;

        $categories = [];
        if (isset($todo->CATEGORIES)) {
            foreach ($todo->CATEGORIES as $category) {
                $categories = array_merge($categories, $category->getParts());
            }
        }

        $dateFields = [];
        TaskConversionSupport::applyDateTimesFromVtodo($todo, $dateFields);

        $task = [
            '@type' => 'Task',
            'uid' => $uid !== '' ? $uid : null,
            'title' => $summary !== '' ? $summary : null,
            'description' => $description !== '' ? $description : null,
            'start' => $dateFields['start'] ?? null,
            'due' => $dateFields['due'] ?? null,
            'completed' => $dateFields['completed'] ?? null,
        ];

        if (($dateFields['showWithoutTime'] ?? false) === true) {
            $task['showWithoutTime'] = true;
        }
        if (isset($dateFields['timeZone']) && is_string($dateFields['timeZone']) && $dateFields['timeZone'] !== '') {
            $task['timeZone'] = $dateFields['timeZone'];
        }

        $task += [
            'workflowStatus' => TaskConversionSupport::workflowFromStatus($status),
            'progress' => $progress,
            'priority' => self::normalizePriority($priority),
            'isDraft' => false,
            'sortOrder' => 0,
            'categories' => array_values(array_filter(array_map('trim', $categories), static fn (string $v): bool => $v !== '')),
            'privacy' => TaskConversionSupport::privacyFromClass($class),
            'created' => isset($todo->CREATED)
                ? ICalendarDateTime::fromProperty($todo->CREATED)['value']
                : null,
            'updated' => isset($todo->{'LAST-MODIFIED'})
                ? ICalendarDateTime::fromProperty($todo->{'LAST-MODIFIED'})['value']
                : null,
        ];

        $participants = TaskConversionSupport::participantsFromVtodo($todo);
        if ($participants !== []) {
            $task['participants'] = $participants;
        }

        $icsProps = TaskConversionSupport::icsPropsFromVtodo($todo);
        if ($icsProps !== []) {
            $task['icsProps'] = $icsProps;
        }

        $this->applyRecurrenceFromTodo($todo, $task);
        $this->applyAlertsFromTodo($todo, $task);

        return $task;
    }

    /**
     * @param  array<string, mixed>  $task
     */
    private function applyRecurrenceFromTodo(VTodo $todo, array &$task): void
    {
        if (isset($todo->RRULE)) {
            $rules = [];
            foreach ($todo->select('RRULE') as $property) {
                // Tasks keep the pre-RFC-8984 wire types (byMonth Int[], byDay iCal
                // strings) — shipped consumers; alignment is a documented follow-up.
                $rules[] = ICalendarRecurrence::ruleFromProperty($property, legacyWireTypes: true);
            }
            if ($rules !== []) {
                $task['recurrenceRules'] = $rules;
            }
        }

        if (isset($todo->EXDATE)) {
            $excluded = [];
            foreach ($todo->select('EXDATE') as $property) {
                foreach (ICalendarDateList::jmapValuesFromProperty($property) as $part) {
                    $excluded[] = $part;
                }
            }
            if ($excluded !== []) {
                $task['excludedRecurrenceDates'] = array_values(array_unique($excluded));
            }
        }
    }

    /**
     * @param  array<string, mixed>  $task
     */
    private function applyAlertsFromTodo(VTodo $todo, array &$task): void
    {
        $alerts = [];
        $index = 0;
        foreach ($todo->getComponents('VALARM') as $valarm) {
            $alert = TaskConversionSupport::alertFromValarm($valarm);
            if ($alert !== null) {
                $alerts['alert'.(++$index)] = $alert;
            }
        }

        if ($alerts !== []) {
            $task['alerts'] = $alerts;
        }
    }

    private static function normalizePriority(?int $priority): ?int
    {
        if ($priority === null || $priority <= 0) {
            return null;
        }

        return min(9, max(1, $priority));
    }
}
