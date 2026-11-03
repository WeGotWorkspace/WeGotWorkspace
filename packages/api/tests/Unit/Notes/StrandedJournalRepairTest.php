<?php

declare(strict_types=1);

namespace Tests\Unit\Notes;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\EventCalendarJournalStripper;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Notes a CalDAV client stored in a calendar that no longer accepts VJOURNAL
 * (an older update left the default calendar VEVENT-only) move to the
 * owner's notebook (#1779).
 */
final class StrandedJournalRepairTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    public function test_moves_stranded_notes_to_the_owner_notebook_once(): void
    {
        $this->seedWgwUser('stranded');
        $default = $this->eventOnlyCalendar('principals/stranded', 'default');
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendarObject($default, 'note.ics', $this->ics('VJOURNAL', 'stranded-note'));
        $caldav->createCalendarObject($default, 'event.ics', $this->ics('VEVENT', 'stranded-event'));

        $first = app(EventCalendarJournalStripper::class)->repairStranded();
        $second = app(EventCalendarJournalStripper::class)->repairStranded();

        $this->assertSame(1, $first['movedObjects']);
        $this->assertSame(0, $second['movedObjects'], 'A second run has nothing left to move.');
        $notebook = $this->calendarIdFor('principals/stranded', CalendarCollectionUris::NOTE_GENERAL);
        $this->assertSame($notebook, $this->calendarIdOfUid('stranded-note'));
        $this->assertSame($default[0], $this->calendarIdOfUid('stranded-event'));
        $this->assertSame(1, DB::connection('wgw')->table('calendarobjects')->where('uid', 'stranded-note')->count());
    }

    public function test_group_calendar_notes_move_to_the_group_notebook(): void
    {
        $this->seedWgwGroup('principals/groups/team', 'Team');
        $calendar = $this->eventOnlyCalendar('principals/groups/team', 'team-calendar');
        (new CalPDO(DB::connection('wgw')->getPdo()))
            ->createCalendarObject($calendar, 'note.ics', $this->ics('VJOURNAL', 'group-note'));

        app(EventCalendarJournalStripper::class)->repairStranded();

        $notebook = $this->calendarIdFor('principals/groups/team', CalendarCollectionUris::groupNotebookCalDavUri('team'));
        $this->assertSame($notebook, $this->calendarIdOfUid('group-note'));
    }

    public function test_uid_already_in_the_notebook_is_logged_and_left_in_place(): void
    {
        $this->seedWgwUser('collide');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/collide');
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $notebook = $this->idPair('principals/collide', CalendarCollectionUris::NOTE_GENERAL);
        $caldav->createCalendarObject($notebook, 'copy.ics', $this->ics('VJOURNAL', 'same-uid'));
        $default = $this->eventOnlyCalendar('principals/collide', 'old-default');
        $caldav->createCalendarObject($default, 'note.ics', $this->ics('VJOURNAL', 'same-uid'));
        $caldav->createCalendarObject($default, 'other.ics', $this->ics('VJOURNAL', 'other-note'));
        $warnings = [];
        Log::listen(function (MessageLogged $event) use (&$warnings): void {
            if ($event->level === 'warning') {
                $warnings[] = $event->message;
            }
        });

        $result = app(EventCalendarJournalStripper::class)->repairStranded();

        $this->assertSame(1, $result['movedObjects']);
        $this->assertSame(1, $result['collisions']);
        $this->assertSame($notebook[0], $this->calendarIdOfUid('other-note'));
        $this->assertSame(1, DB::connection('wgw')->table('calendarobjects')
            ->where('uid', 'same-uid')->where('calendarid', $default[0])->count());
        $this->assertCount(1, $warnings, 'The collision is logged for the admin.');
    }

    public function test_notebooks_and_calendars_without_notes_are_left_alone(): void
    {
        $this->seedWgwUser('clean');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/clean');
        $notebook = $this->idPair('principals/clean', CalendarCollectionUris::NOTE_GENERAL);
        (new CalPDO(DB::connection('wgw')->getPdo()))
            ->createCalendarObject($notebook, 'note.ics', $this->ics('VJOURNAL', 'kept-note'));

        $result = app(EventCalendarJournalStripper::class)->repairStranded();

        $this->assertSame(['scanned' => 0, 'repaired' => 0, 'movedObjects' => 0, 'collisions' => 0], $result);
        $this->assertSame($notebook[0], $this->calendarIdOfUid('kept-note'));
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function eventOnlyCalendar(string $principalUri, string $uri): array
    {
        $id = (new CalPDO(DB::connection('wgw')->getPdo()))->createCalendar($principalUri, $uri, [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ]);

        return [(int) $id[0], (int) $id[1]];
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function idPair(string $principalUri, string $uri): array
    {
        $row = DB::connection('wgw')->table('calendarinstances')
            ->where('principaluri', $principalUri)
            ->where('uri', $uri)
            ->first();
        $this->assertNotNull($row);

        return [(int) $row->calendarid, (int) $row->id];
    }

    private function calendarIdFor(string $principalUri, string $uri): int
    {
        return $this->idPair($principalUri, $uri)[0];
    }

    private function calendarIdOfUid(string $uid): int
    {
        return (int) DB::connection('wgw')->table('calendarobjects')->where('uid', $uid)->value('calendarid');
    }

    private function ics(string $component, string $uid): string
    {
        $times = $component === 'VEVENT' ? "DTSTART:20260710T090000Z\r\nDTEND:20260710T100000Z\r\n" : "DTSTART:20260710T090000Z\r\n";

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//wgw//test//EN\r\n"
            ."BEGIN:{$component}\r\nUID:{$uid}\r\nDTSTAMP:20260701T090000Z\r\n{$times}SUMMARY:{$uid}\r\n"
            ."END:{$component}\r\nEND:VCALENDAR\r\n";
    }
}
