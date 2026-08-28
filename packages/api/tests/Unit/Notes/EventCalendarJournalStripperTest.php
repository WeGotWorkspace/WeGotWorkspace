<?php

declare(strict_types=1);

namespace Tests\Unit\Notes;

use App\Models\Calendar;
use App\Models\CalendarObject;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarRepository;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\EventCalendarJournalStripper;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class EventCalendarJournalStripperTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    public function test_scope_vjournal_only_excludes_event_and_task_collections(): void
    {
        $this->seedWgwUser('scope-user', password: 'longpassword');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/scope-user');

        $notebookIds = Calendar::query()->vjournalOnly()->pluck('id')->all();
        $eventIds = Calendar::query()->supportsVevent()->pluck('id')->all();
        $taskIds = Calendar::query()->vtodoOnly()->pluck('id')->all();

        $this->assertNotEmpty($notebookIds);
        $this->assertEmpty(array_intersect($notebookIds, $eventIds));
        $this->assertEmpty(array_intersect($notebookIds, $taskIds));

        foreach (Calendar::query()->vjournalOnly()->get() as $calendar) {
            $this->assertTrue($calendar->isVjournalOnly());
            $this->assertFalse($calendar->supportsVevent());
            $this->assertFalse($calendar->supportsVtodo());
        }
    }

    public function test_provisioned_event_calendars_have_no_vjournal_and_notebooks_are_vjournal_only(): void
    {
        $this->seedWgwUser('iso-user', password: 'longpassword');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/iso-user');

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $byUri = [];
        foreach ($caldav->getCalendarsForUser('principals/iso-user') as $calendar) {
            $byUri[(string) ($calendar['uri'] ?? '')] = $calendar;
        }

        foreach ([
            CalendarCollectionUris::EVENT_DEFAULT,
            CalendarCollectionUris::EVENT_HOME,
            CalendarCollectionUris::EVENT_WORK,
        ] as $uri) {
            $this->assertSame(['VEVENT'], $this->componentSetFor($byUri[$uri]));
        }
        $this->assertSame(['VJOURNAL'], $this->componentSetFor($byUri[CalendarCollectionUris::NOTE_GENERAL]));
    }

    public function test_calendar_list_does_not_include_notebooks(): void
    {
        $this->seedWgwUser('list-user', password: 'longpassword');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/list-user');

        $ids = app(CalendarRepository::class)
            ->accessibleVeventInstances('list-user')
            ->pluck('uri')
            ->all();

        $this->assertNotContains(CalendarCollectionUris::NOTE_GENERAL, $ids);
        $this->assertContains(CalendarCollectionUris::EVENT_DEFAULT, $ids);
    }

    public function test_stripper_removes_vjournal_from_legacy_event_calendars_and_moves_objects(): void
    {
        $this->seedWgwUser('legacy-journal');
        $principalUri = 'principals/legacy-journal';
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar($principalUri, 'default', [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VJOURNAL']),
        ]);

        $backendId = $this->resolveCalendarIdPair('legacy-journal', 'default');
        $caldav->createCalendarObject($backendId, 'old-journal.ics', $this->sampleJournalIcs('Legacy note'));

        $result = app(EventCalendarJournalStripper::class)->stripAll();

        $this->assertGreaterThanOrEqual(1, $result['stripped']);
        $this->assertSame(1, $result['movedObjects']);

        $default = Calendar::query()
            ->whereHas('instances', fn ($query) => $query->where('principaluri', $principalUri)->where('uri', 'default'))
            ->first();
        $this->assertNotNull($default);
        $this->assertSame('VEVENT', (string) $default->components);
        $this->assertFalse($default->supportsVjournal());

        $this->assertSame(0, CalendarObject::query()->where('calendarid', $default->id)->where('componenttype', 'VJOURNAL')->count());

        $notebook = Calendar::query()
            ->whereHas('instances', fn ($query) => $query->where('principaluri', $principalUri)->where('uri', CalendarCollectionUris::NOTE_GENERAL))
            ->first();
        $this->assertNotNull($notebook);
        $this->assertTrue($notebook->isVjournalOnly());
        $this->assertSame(1, CalendarObject::query()->where('calendarid', $notebook->id)->where('componenttype', 'VJOURNAL')->count());
    }

    /**
     * @param  array<string, mixed>  $calendar
     * @return list<string>
     */
    private function componentSetFor(array $calendar): array
    {
        $property = $calendar['{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set'] ?? null;
        $this->assertInstanceOf(SupportedCalendarComponentSet::class, $property);

        return $property->getValue();
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function resolveCalendarIdPair(string $username, string $uri): array
    {
        $row = DB::connection('wgw')->table('calendarinstances')
            ->where('principaluri', 'principals/'.$username)
            ->where('uri', $uri)
            ->first();
        $this->assertNotNull($row);

        return [(int) $row->calendarid, (int) $row->id];
    }

    private function sampleJournalIcs(string $summary): string
    {
        $uid = 'journal-'.bin2hex(random_bytes(8));

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Notes//EN\r\nBEGIN:VJOURNAL\r\nUID:{$uid}\r\nDTSTAMP:20260828T120000Z\r\nSUMMARY:{$summary}\r\nDESCRIPTION:Body\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n";
    }
}
