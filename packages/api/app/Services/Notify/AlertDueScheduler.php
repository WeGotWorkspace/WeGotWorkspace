<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Events\EventDispatch;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Notify\AlertDueNotify;
use App\Services\VObject\ICalendarAlarmTrigger;
use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Facades\Schema;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Component\VTodo;
use Sabre\VObject\Reader;
use Sabre\VObject\Recur\EventIterator;
use Sabre\VObject\Recur\NoInstancesException;

final class AlertDueScheduler
{
    public function __construct(private readonly EventDispatch $events) {}

    public function scan(?DateTimeImmutable $now = null): int
    {
        if (! Schema::connection('wgw')->hasTable('calendarobjects')) {
            return 0;
        }

        $now = $now ?? new DateTimeImmutable('now', new DateTimeZone('UTC'));
        $windowStart = $now->sub(new DateInterval('PT90S'));
        $windowEnd = $now->add(new DateInterval('PT30S'));
        $fired = 0;

        $objects = CalendarObject::query()
            ->whereIn('componenttype', ['VEVENT', 'VTODO'])
            ->where('calendardata', 'like', '%BEGIN:VALARM%')
            ->limit(500)
            ->get();

        foreach ($objects as $object) {
            $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
            if ($raw === '') {
                continue;
            }
            try {
                $parsed = Reader::read($raw);
            } catch (\Throwable) {
                continue;
            }
            if (! $parsed instanceof VCalendar) {
                continue;
            }
            $owners = $this->ownerUsernames((int) $object->calendarid);
            if ($owners === []) {
                continue;
            }
            $domain = ((string) $object->componenttype) === 'VTODO' ? 'tasks' : 'calendar';
            $navigate = $domain === 'tasks' ? '/tasks' : '/calendar';
            $uid = (string) $object->uid;
            $summary = $this->summary($parsed);

            foreach ($parsed->select('VEVENT') as $vevent) {
                if (! $vevent instanceof VEvent) {
                    continue;
                }
                $fired += $this->fireAlarmsForComponent(
                    $vevent,
                    $owners,
                    $domain,
                    $uid,
                    $navigate,
                    $summary,
                    $windowStart,
                    $windowEnd,
                    $now,
                );
            }
            foreach ($parsed->select('VTODO') as $vtodo) {
                if (! $vtodo instanceof VTodo) {
                    continue;
                }
                $fired += $this->fireAlarmsForComponent(
                    $vtodo,
                    $owners,
                    $domain,
                    $uid,
                    $navigate,
                    $summary,
                    $windowStart,
                    $windowEnd,
                    $now,
                );
            }
        }

        return $fired;
    }

    /**
     * @param  list<string>  $owners
     */
    private function fireAlarmsForComponent(
        VEvent|VTodo $component,
        array $owners,
        string $domain,
        string $uid,
        string $navigate,
        string $summary,
        DateTimeImmutable $windowStart,
        DateTimeImmutable $windowEnd,
        DateTimeImmutable $now,
    ): int {
        $alarms = $component->select('VALARM');
        if ($alarms === []) {
            return 0;
        }
        $occurrences = $this->occurrences($component, $now);
        $fired = 0;
        $alarmIndex = 0;
        foreach ($alarms as $valarm) {
            $alarmIndex++;
            $action = isset($valarm->ACTION) ? strtoupper(trim((string) $valarm->ACTION->getValue())) : 'DISPLAY';
            if ($action !== 'DISPLAY' && $action !== 'AUDIO') {
                continue;
            }
            $parsed = ICalendarAlarmTrigger::fromValarm($valarm);
            if ($parsed === null) {
                continue;
            }
            foreach ($occurrences as $occurrenceStart) {
                $triggerAt = $this->triggerAt($parsed, $component, $occurrenceStart);
                if ($triggerAt === null) {
                    continue;
                }
                if ($triggerAt < $windowStart || $triggerAt > $windowEnd) {
                    continue;
                }
                $occurrenceKey = $occurrenceStart->setTimezone(new DateTimeZone('UTC'))->format('Ymd\THis\Z');
                $dedupe = $domain.'.alert_due:'.$uid.':'.$occurrenceKey.':'.$alarmIndex;
                $copy = AlertDueNotify::eventData(
                    $domain,
                    $summary,
                    $occurrenceStart,
                    $this->endDate($component, $occurrenceStart),
                    $navigate,
                    $dedupe,
                );
                $this->events->fireMutation(
                    actor: 'system',
                    domain: $domain,
                    action: 'alert_due',
                    target: $uid,
                    data: [
                        'recipients' => $owners,
                        ...$copy,
                        'dedupe_key' => $dedupe,
                        'trigger' => $parsed,
                    ],
                    eventId: $dedupe,
                );
                $fired++;
            }
        }

        return $fired;
    }

    /**
     * @param  array{kind: string, offset?: string, relatedTo?: string, when?: string}  $parsed
     */
    private function triggerAt(array $parsed, VEvent|VTodo $component, DateTimeImmutable $occurrenceStart): ?DateTimeImmutable
    {
        if ($parsed['kind'] === 'absolute') {
            $when = $parsed['when'] ?? '';
            if (! is_string($when) || $when === '') {
                return null;
            }
            try {
                return (new DateTimeImmutable($when))->setTimezone(new DateTimeZone('UTC'));
            } catch (\Throwable) {
                return null;
            }
        }
        $offset = $parsed['offset'] ?? '';
        if (! is_string($offset) || $offset === '') {
            return null;
        }
        $anchor = $occurrenceStart;
        if (($parsed['relatedTo'] ?? 'start') === 'end') {
            $end = $this->endDate($component, $occurrenceStart);
            if ($end !== null) {
                $anchor = $end;
            }
        }

        return $this->applyIcalDuration($anchor, $offset);
    }

    /**
     * @return list<DateTimeImmutable>
     */
    private function occurrences(VEvent|VTodo $component, DateTimeImmutable $now): array
    {
        if (! isset($component->RRULE) && ! isset($component->RDATE)) {
            $start = $this->startDate($component);

            return $start !== null ? [$start] : [];
        }
        try {
            $iterator = new EventIterator($component, null, $now->getTimezone());
            $iterator->fastForward($now->sub(new DateInterval('P1D')));
            $out = [];
            $guard = 0;
            while ($iterator->valid() && $guard < 32) {
                $out[] = DateTimeImmutable::createFromInterface($iterator->getDtStart())->setTimezone(new DateTimeZone('UTC'));
                $iterator->next();
                $guard++;
                $last = $out[array_key_last($out)];
                if ($last > $now->add(new DateInterval('P2D'))) {
                    break;
                }
            }

            return $out !== [] ? $out : array_filter([$this->startDate($component)]);
        } catch (NoInstancesException|\Throwable) {
            $start = $this->startDate($component);

            return $start !== null ? [$start] : [];
        }
    }

    private function startDate(VEvent|VTodo $component): ?DateTimeImmutable
    {
        $prop = $component->DTSTART ?? $component->DUE ?? null;
        if ($prop === null) {
            return null;
        }
        try {
            return DateTimeImmutable::createFromInterface($prop->getDateTime())->setTimezone(new DateTimeZone('UTC'));
        } catch (\Throwable) {
            return null;
        }
    }

    private function endDate(VEvent|VTodo $component, DateTimeImmutable $start): ?DateTimeImmutable
    {
        $prop = $component->DTEND ?? $component->DUE ?? $component->DURATION ?? null;
        if ($prop === null) {
            return $start;
        }
        try {
            if ($component->DURATION ?? null) {
                return $start->add($component->DURATION->getDateInterval());
            }

            return DateTimeImmutable::createFromInterface($prop->getDateTime())->setTimezone(new DateTimeZone('UTC'));
        } catch (\Throwable) {
            return $start;
        }
    }

    private function applyIcalDuration(DateTimeImmutable $anchor, string $offset): ?DateTimeImmutable
    {
        $negative = str_starts_with($offset, '-');
        $spec = ltrim($offset, '+-');
        if ($spec === '' || ! str_starts_with($spec, 'P')) {
            return null;
        }
        try {
            $interval = new DateInterval($spec);
        } catch (\Throwable) {
            return null;
        }

        return $negative ? $anchor->sub($interval) : $anchor->add($interval);
    }

    /**
     * @return list<string>
     */
    private function ownerUsernames(int $calendarId): array
    {
        $instances = CalendarInstance::query()
            ->where('calendarid', $calendarId)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->get(['principaluri']);
        $out = [];
        foreach ($instances as $instance) {
            $uri = (string) $instance->principaluri;
            if (str_starts_with($uri, 'principals/groups/')) {
                continue;
            }
            if (str_starts_with($uri, 'principals/')) {
                $out[] = substr($uri, strlen('principals/'));
            }
        }

        return array_values(array_unique($out));
    }

    private function summary(VCalendar $calendar): string
    {
        foreach (['VEVENT', 'VTODO'] as $name) {
            foreach ($calendar->select($name) as $comp) {
                if (isset($comp->SUMMARY)) {
                    return trim((string) $comp->SUMMARY->getValue());
                }
            }
        }

        return '';
    }
}
