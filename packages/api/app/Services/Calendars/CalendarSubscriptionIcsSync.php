<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\Conversion\CalendarConversionSupport;
use App\Services\Calendars\Conversion\RecurrenceOverrideSupport;
use App\Services\VObject\ICalendarUid;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;

/**
 * Persist a remote ICS feed into Sabre calendarobjects, keyed by VEVENT UID.
 */
final class CalendarSubscriptionIcsSync
{
    public function __construct(private readonly VObjectPayloadGuard $payloadGuard) {}

    public function sync(CalendarInstance $instance, string $ics): void
    {
        $incoming = $this->documentsByUid($ics);
        if ($incoming === []) {
            throw new ApiHttpException(400, 'The calendar feed contains no events.', 'bad_request');
        }

        $calendarId = (int) $instance->calendarid;
        $backendId = [(int) $instance->calendarid, (int) $instance->id];
        $existing = CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('componenttype', 'VEVENT')
            ->get()
            ->keyBy(fn (CalendarObject $object): string => (string) $object->uid);

        $caldav = $this->calBackend();

        foreach ($incoming as $uid => $document) {
            $uri = $this->objectUriForUid($uid);
            $current = $existing->get($uid);
            if ($current !== null) {
                $caldav->updateCalendarObject($backendId, (string) $current->uri, $document);
                $existing->forget($uid);

                continue;
            }

            $caldav->createCalendarObject($backendId, $uri, $document);
        }

        foreach ($existing as $stale) {
            $caldav->deleteCalendarObject($backendId, (string) $stale->uri);
        }
    }

    public function calendarDisplayName(string $ics): ?string
    {
        $calendar = $this->payloadGuard->readICalendarFeed($ics);
        foreach (['X-WR-CALNAME', 'NAME'] as $property) {
            if (! isset($calendar->{$property})) {
                continue;
            }
            $value = trim((string) $calendar->{$property}->getValue());
            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    /**
     * @return array<string, string> UID => VCALENDAR document
     */
    public function documentsByUid(string $ics): array
    {
        $calendar = $this->payloadGuard->readICalendarFeed($ics);
        $series = RecurrenceOverrideSupport::groupRecurrenceSeries(
            CalendarConversionSupport::veventsFromCalendar($calendar),
        );
        if ($series === []) {
            throw new ApiHttpException(400, 'The calendar feed contains no events.', 'bad_request');
        }

        $documents = [];
        foreach ($series as $group) {
            $uid = $this->uidOf($group['master']);
            $vevents = [$group['master'], ...$group['overrides']];
            $documents[$uid] = $this->serializeSeries($calendar, $vevents);
        }

        return $documents;
    }

    /**
     * @param  list<VEvent>  $vevents
     */
    private function serializeSeries(VCalendar $source, array $vevents): string
    {
        $out = new VCalendar;
        $out->PRODID = '-//WeGotWorkspace//Calendar//EN';
        foreach ($source->select('VTIMEZONE') as $timezone) {
            $out->add(clone $timezone);
        }
        foreach ($vevents as $vevent) {
            $out->add(clone $vevent);
        }

        return $out->serialize();
    }

    private function uidOf(VEvent $vevent): string
    {
        if (isset($vevent->UID)) {
            $uid = trim((string) $vevent->UID->getValue());
            if ($uid !== '') {
                return $uid;
            }
        }

        return ICalendarUid::fromSeed((string) $vevent->serialize());
    }

    private function objectUriForUid(string $uid): string
    {
        $hash = substr(hash('sha256', $uid), 0, 32);

        return 'sub-'.$hash.'.ics';
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
