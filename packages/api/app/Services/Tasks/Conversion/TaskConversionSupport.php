<?php

declare(strict_types=1);

namespace App\Services\Tasks\Conversion;

use App\Services\VObject\ICalendarAlarmTrigger;
use App\Services\VObject\ICalendarDateTime;
use Sabre\VObject\Component;
use Sabre\VObject\Component\VTodo;
use Sabre\VObject\Property;

/**
 * VTODO → JMAP Task field mapping helpers.
 */
final class TaskConversionSupport
{
    /** @var array<string, string> */
    private const STATUS_TO_WORKFLOW = [
        'NEEDS-ACTION' => 'needs-action',
        'IN-PROCESS' => 'in-process',
        'COMPLETED' => 'completed',
        'CANCELLED' => 'cancelled',
    ];

    /** @var array<string, string> */
    private const WORKFLOW_TO_STATUS = [
        'needs-action' => 'NEEDS-ACTION',
        'in-process' => 'IN-PROCESS',
        'completed' => 'COMPLETED',
        'cancelled' => 'CANCELLED',
        'pending' => 'NEEDS-ACTION',
        'failed' => 'CANCELLED',
    ];

    /** @var array<string, string> */
    private const CLASS_TO_PRIVACY = [
        'PUBLIC' => 'public',
        'PRIVATE' => 'private',
        'CONFIDENTIAL' => 'secret',
    ];

    /** @var array<string, string> */
    private const PRIVACY_TO_CLASS = [
        'public' => 'PUBLIC',
        'private' => 'PRIVATE',
        'secret' => 'CONFIDENTIAL',
    ];

    /** @var list<string> */
    private const NULLABLE_FIELDS = [
        'description',
        'start',
        'due',
        'completed',
        'workflowStatus',
        'progress',
        'priority',
        'privacy',
        'showWithoutTime',
        'timeZone',
        'recurrenceRules',
        'excludedRecurrenceDates',
        'recurrenceOverrides',
        'alerts',
        'participants',
        'icsProps',
    ];

    /** @var list<string> */
    private const KNOWN_VTODO_PROPERTIES = [
        'UID', 'SUMMARY', 'DESCRIPTION', 'DTSTART', 'DUE', 'COMPLETED', 'STATUS',
        'PERCENT-COMPLETE', 'PRIORITY', 'CATEGORIES', 'CLASS', 'CREATED', 'LAST-MODIFIED',
        'RRULE', 'EXDATE', 'RECURRENCE-ID', 'ORGANIZER', 'ATTENDEE', 'DTSTAMP', 'SEQUENCE',
    ];

    public static function workflowFromStatus(?string $status): ?string
    {
        if ($status === null || trim($status) === '') {
            return null;
        }

        return self::STATUS_TO_WORKFLOW[strtoupper(trim($status))] ?? 'needs-action';
    }

    public static function statusFromWorkflow(?string $workflowStatus): ?string
    {
        if ($workflowStatus === null || trim($workflowStatus) === '') {
            return null;
        }

        return self::WORKFLOW_TO_STATUS[strtolower(trim($workflowStatus))] ?? 'NEEDS-ACTION';
    }

    public static function privacyFromClass(?string $class): ?string
    {
        if ($class === null || trim($class) === '') {
            return null;
        }

        return self::CLASS_TO_PRIVACY[strtoupper(trim($class))] ?? 'public';
    }

    public static function classFromPrivacy(?string $privacy): ?string
    {
        if ($privacy === null || trim($privacy) === '') {
            return null;
        }

        return self::PRIVACY_TO_CLASS[strtolower(trim($privacy))] ?? 'PUBLIC';
    }

    /**
     * @param  array<string, mixed>  $existing
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public static function mergeTaskPatch(array $existing, array $patch): array
    {
        $merged = $existing;
        foreach ($patch as $key => $value) {
            if ($value === null && in_array($key, self::NULLABLE_FIELDS, true)) {
                $merged[$key] = null;

                continue;
            }
            if (in_array($key, ['recurrenceOverrides', 'alerts', 'participants'], true)
                && is_array($value)
                && isset($merged[$key])
                && is_array($merged[$key])) {
                $merged[$key] = array_replace($merged[$key], $value);

                continue;
            }
            if ($key === 'icsProps' && is_array($value) && isset($merged[$key]) && is_array($merged[$key])) {
                $merged[$key] = array_replace($merged[$key], $value);

                continue;
            }
            $merged[$key] = $value;
        }

        return $merged;
    }

    /**
     * @return array<string, mixed>
     */
    public static function normalizeTaskMapKeys(array $task): array
    {
        if (! isset($task['@type']) || ! is_string($task['@type'])) {
            $task['@type'] = 'Task';
        }

        foreach (['alerts', 'participants'] as $mapKey) {
            if (! isset($task[$mapKey]) || ! is_array($task[$mapKey])) {
                continue;
            }
            $normalized = [];
            foreach ($task[$mapKey] as $id => $entry) {
                if (! is_array($entry)) {
                    continue;
                }
                if (! isset($entry['@type'])) {
                    $entry['@type'] = match ($mapKey) {
                        'participants' => 'Participant',
                        default => 'Alert',
                    };
                }
                $normalized[(string) $id] = $entry;
            }
            if ($normalized !== []) {
                $task[$mapKey] = $normalized;
            } else {
                unset($task[$mapKey]);
            }
        }

        return $task;
    }

    /**
     * @param  array<string, mixed>  $task
     */
    public static function applyDateTimesFromVtodo(VTodo $todo, array &$task): void
    {
        $showWithoutTime = false;
        $timeZone = null;

        if (isset($todo->DTSTART)) {
            $start = ICalendarDateTime::fromProperty($todo->DTSTART);
            $task['start'] = $start['value'];
            $showWithoutTime = $start['showWithoutTime'];
            $timeZone = $start['timeZone'];
        }

        if (isset($todo->DUE)) {
            $due = ICalendarDateTime::fromProperty($todo->DUE);
            $task['due'] = $due['value'];
            $showWithoutTime = $showWithoutTime || $due['showWithoutTime'];
            $timeZone ??= $due['timeZone'];
        }

        if ($showWithoutTime) {
            $task['showWithoutTime'] = true;
        }

        if ($timeZone !== null && $timeZone !== '') {
            $task['timeZone'] = $timeZone;
        }

        if (isset($todo->COMPLETED)) {
            $task['completed'] = self::formatCompletedUtc((string) $todo->COMPLETED->getValue());
        }
    }

    /**
     * @param  array<string, mixed>  $task
     */
    public static function writeDateTimesToVtodo(VTodo $todo, array $task): void
    {
        $showWithoutTime = (bool) ($task['showWithoutTime'] ?? false);
        $timeZone = isset($task['timeZone']) && is_string($task['timeZone']) ? $task['timeZone'] : null;

        if (isset($task['start']) && is_string($task['start']) && trim($task['start']) !== '') {
            ICalendarDateTime::writeProperty(
                $todo,
                'DTSTART',
                $task['start'],
                $showWithoutTime,
                $timeZone,
            );
        }

        if (isset($task['due']) && is_string($task['due']) && trim($task['due']) !== '') {
            ICalendarDateTime::writeProperty(
                $todo,
                'DUE',
                $task['due'],
                $showWithoutTime,
                $timeZone,
            );
        }

        if (isset($task['completed']) && is_string($task['completed']) && trim($task['completed']) !== '') {
            $todo->add('COMPLETED', self::completedToIcs($task['completed']));
        }
    }

    /**
     * @return array<string, mixed>
     */
    public static function participantsFromVtodo(VTodo $todo): array
    {
        $participants = [];
        $index = 0;

        if (isset($todo->ORGANIZER)) {
            $participants['org'] = [
                '@type' => 'Participant',
                'name' => self::participantNameFromProperty($todo->ORGANIZER),
                'email' => self::emailFromCalAddress((string) $todo->ORGANIZER->getValue()),
                'roles' => ['owner'],
            ];
        }

        if (isset($todo->ATTENDEE)) {
            foreach ($todo->ATTENDEE as $attendee) {
                $id = 'att'.(++$index);
                $partstat = isset($attendee['PARTSTAT']) ? strtolower((string) $attendee['PARTSTAT']) : null;
                $entry = [
                    '@type' => 'Participant',
                    'name' => self::participantNameFromProperty($attendee),
                    'email' => self::emailFromCalAddress((string) $attendee->getValue()),
                    'roles' => ['attendee'],
                ];
                if ($partstat !== null && $partstat !== '') {
                    $entry['participationStatus'] = $partstat;
                }
                $participants[$id] = $entry;
            }
        }

        return $participants;
    }

    /**
     * @param  array<string, mixed>  $task
     */
    public static function writeParticipantsToVtodo(VTodo $todo, array $task): void
    {
        $participants = $task['participants'] ?? null;
        if (! is_array($participants)) {
            return;
        }

        foreach ($participants as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $email = $entry['email'] ?? null;
            if (! is_string($email) || trim($email) === '') {
                continue;
            }
            $roles = $entry['roles'] ?? [];
            $params = ['CN' => $entry['name'] ?? $email];
            $address = str_starts_with($email, 'mailto:') ? $email : 'mailto:'.$email;

            if (is_array($roles) && in_array('owner', $roles, true)) {
                $todo->add('ORGANIZER', $address, $params);

                continue;
            }

            if (isset($entry['participationStatus']) && is_string($entry['participationStatus'])) {
                $params['PARTSTAT'] = strtoupper($entry['participationStatus']);
            }
            $todo->add('ATTENDEE', $address, $params);
        }
    }

    /**
     * @return array<string, string>
     */
    public static function icsPropsFromVtodo(VTodo $todo): array
    {
        $props = [];
        foreach ($todo->children() as $child) {
            if (! $child instanceof Property) {
                continue;
            }
            $name = strtoupper($child->name);
            if (in_array($name, self::KNOWN_VTODO_PROPERTIES, true)) {
                continue;
            }
            $props[$name] = trim((string) $child->getValue());
        }

        return $props;
    }

    /**
     * @param  array<string, mixed>  $task
     */
    public static function writeIcsPropsToVtodo(VTodo $todo, array $task): void
    {
        $props = $task['icsProps'] ?? null;
        if (! is_array($props)) {
            return;
        }

        foreach ($props as $name => $value) {
            if (! is_string($name) || ! is_string($value) || trim($value) === '') {
                continue;
            }
            $todo->add(strtoupper($name), $value);
        }
    }

    public static function formatCompletedUtc(?string $value): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        $normalized = ICalendarDateTime::toJmap(trim($value));
        if (str_ends_with($normalized, 'Z')) {
            return $normalized;
        }

        $dt = new \DateTimeImmutable($normalized);

        return $dt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }

    public static function completedToIcs(string $value): string
    {
        $utc = self::formatCompletedUtc($value);

        return ICalendarDateTime::toIcs($utc ?? $value);
    }

    /**
     * @return array<string, mixed>
     */
    public static function recurrenceOverrideFromVtodo(VTodo $todo): array
    {
        $override = [];

        if (isset($todo->SUMMARY)) {
            $title = trim((string) $todo->SUMMARY->getValue());
            if ($title !== '') {
                $override['title'] = $title;
            }
        }
        if (isset($todo->DESCRIPTION)) {
            $description = trim((string) $todo->DESCRIPTION->getValue());
            if ($description !== '') {
                $override['description'] = $description;
            }
        }
        if (isset($todo->DTSTART)) {
            $start = ICalendarDateTime::fromProperty($todo->DTSTART);
            $override['start'] = $start['value'];
            if ($start['showWithoutTime']) {
                $override['showWithoutTime'] = true;
            }
            if ($start['timeZone'] !== null && $start['timeZone'] !== '') {
                $override['timeZone'] = $start['timeZone'];
            }
        }
        if (isset($todo->DUE)) {
            $due = ICalendarDateTime::fromProperty($todo->DUE);
            $override['due'] = $due['value'];
            if ($due['showWithoutTime']) {
                $override['showWithoutTime'] = true;
            }
            if ($due['timeZone'] !== null && $due['timeZone'] !== '') {
                $override['timeZone'] = $due['timeZone'];
            }
        }
        if (isset($todo->COMPLETED)) {
            $override['completed'] = self::formatCompletedUtc((string) $todo->COMPLETED->getValue());
        }

        $status = isset($todo->STATUS) ? strtoupper(trim((string) $todo->STATUS->getValue())) : null;
        if ($status === 'CANCELLED') {
            $override['excluded'] = true;
        } elseif ($status !== null && $status !== '') {
            $override['workflowStatus'] = self::workflowFromStatus($status);
        }

        if (isset($todo->{'PERCENT-COMPLETE'})) {
            $override['progress'] = (int) $todo->{'PERCENT-COMPLETE'}->getValue();
        }

        return $override;
    }

    /**
     * @param  array<string, mixed>  $task
     * @return list<string>
     */
    public static function excludedDatesFromRecurrenceOverrides(array $task): array
    {
        $overrides = $task['recurrenceOverrides'] ?? null;
        if (! is_array($overrides)) {
            return [];
        }

        $excluded = is_array($task['excludedRecurrenceDates'] ?? null)
            ? $task['excludedRecurrenceDates']
            : [];

        foreach ($overrides as $recurrenceId => $patch) {
            if (! is_string($recurrenceId) || ! is_array($patch)) {
                continue;
            }
            if (($patch['excluded'] ?? false) === true) {
                $excluded[] = $recurrenceId;
            }
        }

        return array_values(array_unique($excluded));
    }

    /**
     * @param  array<string, mixed>  $task
     * @return array<string, mixed>
     */
    public static function writableRecurrenceOverrides(array $task): array
    {
        $overrides = $task['recurrenceOverrides'] ?? null;
        if (! is_array($overrides)) {
            return [];
        }

        $writable = [];
        foreach ($overrides as $recurrenceId => $patch) {
            if (! is_string($recurrenceId) || ! is_array($patch)) {
                continue;
            }
            if (($patch['excluded'] ?? false) === true) {
                continue;
            }
            $writable[$recurrenceId] = $patch;
        }

        return $writable;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function alertFromValarm(Component $valarm): ?array
    {
        $parsed = ICalendarAlarmTrigger::fromValarm($valarm);
        if ($parsed === null) {
            return null;
        }

        $trigger = $parsed['kind'] === 'absolute'
            ? [
                '@type' => 'AbsoluteTrigger',
                'when' => $parsed['when'],
            ]
            : [
                '@type' => 'OffsetTrigger',
                'offset' => $parsed['offset'],
                'relativeTo' => $parsed['relatedTo'],
            ];

        $alert = [
            '@type' => 'Alert',
            'trigger' => $trigger,
        ];

        if (isset($valarm->ACTION)) {
            $action = strtolower(trim((string) $valarm->ACTION->getValue()));
            if (in_array($action, ['display', 'email'], true)) {
                $alert['action'] = $action;
            }
        }

        if (isset($valarm->ACKNOWLEDGED)) {
            $alert['acknowledged'] = ICalendarDateTime::fromProperty($valarm->ACKNOWLEDGED)['value'];
        }

        return $alert;
    }

    /**
     * @param  array<string, mixed>  $alerts
     */
    public static function writeValarmComponents(Component $parent, array $alerts): void
    {
        foreach ($alerts as $entry) {
            if (! is_array($entry)) {
                continue;
            }

            $trigger = $entry['trigger'] ?? null;
            if (! is_array($trigger)) {
                continue;
            }

            $parts = ICalendarAlarmTrigger::toIcsParts($trigger);
            if ($parts === null) {
                continue;
            }

            $valarm = $parent->add('VALARM');
            $action = isset($entry['action']) && is_string($entry['action'])
                ? strtoupper($entry['action'])
                : 'DISPLAY';
            $valarm->add('ACTION', $action);
            $valarm->add('TRIGGER', $parts['value'], $parts['params']);

            if (isset($entry['acknowledged']) && is_string($entry['acknowledged']) && trim($entry['acknowledged']) !== '') {
                $valarm->add('ACKNOWLEDGED', ICalendarDateTime::toIcs($entry['acknowledged']));
            }
        }
    }

    private static function participantNameFromProperty(Property $property): ?string
    {
        if (isset($property['CN'])) {
            $name = trim((string) $property['CN']);
            if ($name !== '') {
                return $name;
            }
        }

        return null;
    }

    private static function emailFromCalAddress(string $value): ?string
    {
        $value = trim($value);
        if (str_starts_with(strtolower($value), 'mailto:')) {
            return substr($value, 7);
        }

        return $value !== '' ? $value : null;
    }
}
