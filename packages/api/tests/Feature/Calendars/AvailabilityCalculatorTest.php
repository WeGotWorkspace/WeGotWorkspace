<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\CalendarSubscription;
use App\Services\Calendars\Availability\AvailabilityCalculator;
use App\Services\Calendars\Availability\AvailabilitySettings;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\CollectionKind;
use Illuminate\Support\Str;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Tests\Support\AvailabilityTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1908: what counts as busy, from which calendars, and what a teammate may
 * see of it.
 */
final class AvailabilityCalculatorTest extends WgwDatabaseTestCase
{
    use AvailabilityTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAvailabilityFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownAvailabilityFixtures();
        parent::tearDown();
    }

    public function test_switch_off_gives_nothing(): void
    {
        $this->seedEventViaPdo('carol', 'a.ics', $this->eventIcs('a', ':20300107T100000Z', ':20300107T110000Z'));

        $this->assertNull(app(AvailabilityCalculator::class)->busyPeriods('carol', [self::week()]));
        app(AvailabilitySettings::class)->setEnabled('bob', false);
        $this->assertNull(app(AvailabilityCalculator::class)->busyPeriods('bob', [self::week()]));
    }

    public function test_rejects_weeks_that_do_not_start_on_monday_midnight_utc(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        app(AvailabilityCalculator::class)->busyPeriods('bob', [self::week() + 3600]);
    }

    public function test_rejects_more_than_54_weeks(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        app(AvailabilityCalculator::class)->busyPeriods('bob', array_map(self::week(...), range(0, 54)));
    }

    public function test_personal_and_team_calendars_count(): void
    {
        $this->seedEventViaPdo('bob', 'own.ics', $this->eventIcs('own', ':20300107T100000Z', ':20300107T110000Z'));
        $this->seedEventViaPdo('groups/eng', 'team.ics', $this->eventIcs('team', ':20300108T100000Z', ':20300108T110000Z'), 'eng');

        $result = $this->busy();

        $this->assertSame(['2030-01-07T10:00:00Z', '2030-01-08T10:00:00Z'], self::starts($result));
        $this->assertTrue($result->complete());
        $this->assertSame([self::week() => true], $result->completeByWeek);
    }

    public function test_subscriptions_shared_in_calendars_and_other_kinds_never_count(): void
    {
        $this->seedNamedCalendarFor('bob', 'holidays', 'Holidays');
        CalendarSubscription::query()->create([
            'id' => (string) Str::uuid(), 'username' => 'bob', 'calendar_uri' => 'holidays', 'url' => 'https://example.test/h.ics',
        ]);
        $this->seedEventViaPdo('bob', 'sub.ics', $this->eventIcs('sub', ':20300107T100000Z', ':20300107T110000Z'), 'holidays');

        $carolDefault = CalendarInstance::query()->where('principaluri', 'principals/carol')->where('uri', 'default')->firstOrFail();
        CalendarInstance::query()->create([
            'calendarid' => $carolDefault->calendarid, 'principaluri' => 'principals/bob', 'access' => SharingPlugin::ACCESS_READWRITE,
            'uri' => 'carol-shared', 'displayname' => 'Carol', 'share_invitestatus' => 2,
        ]);
        $this->seedEventViaPdo('carol', 'carol.ics', $this->eventIcs('carol', ':20300107T120000Z', ':20300107T130000Z'));

        app(WgwCalendarBackendFactory::class)->make()->createCollection(CollectionKind::TaskList, 'principals/bob', 'chores', [
            '{DAV:}displayname' => 'Chores',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VTODO']),
        ]);
        $this->seedEventViaPdo('bob', 'stray.ics', $this->eventIcs('stray', ':20300107T140000Z', ':20300107T150000Z'), 'chores');

        $this->assertSame([], $this->busy()->periods());
    }

    public function test_an_unchecked_calendar_never_counts_and_shows_on_the_next_call(): void
    {
        $this->seedEventViaPdo('groups/eng', 'team.ics', $this->eventIcs('team', ':20300108T100000Z', ':20300108T110000Z'), 'eng');
        $this->assertCount(1, $this->busy()->periods());

        $teamCalendarId = $this->calendarId('principals/groups/eng', 'eng');
        app(AvailabilitySettings::class)->setPref('bob', $teamCalendarId, false, null);

        $this->assertSame([], $this->busy()->periods());
    }

    public function test_show_as_free_never_counts_for_a_series_or_one_occurrence(): void
    {
        $this->seedEventViaPdo('bob', 'free.ics', $this->eventIcs('free', ':20300107T080000Z', ':20300107T090000Z', ['TRANSP:TRANSPARENT']));
        $this->seedEventViaPdo('bob', 'series.ics', $this->eventIcs(
            'series',
            ':20300107T100000Z',
            ':20300107T110000Z',
            ['RRULE:FREQ=DAILY;COUNT=3'],
            [['RECURRENCE-ID:20300108T100000Z', 'DTSTART:20300108T100000Z', 'DTEND:20300108T110000Z', 'TRANSP:TRANSPARENT']],
        ));
        $this->seedEventViaPdo('bob', 'free-series.ics', $this->eventIcs(
            'free-series',
            ':20300107T150000Z',
            ':20300107T160000Z',
            ['RRULE:FREQ=DAILY;COUNT=3', 'TRANSP:TRANSPARENT'],
            [['RECURRENCE-ID:20300108T150000Z', 'DTSTART:20300108T150000Z', 'DTEND:20300108T160000Z', 'TRANSP:OPAQUE']],
        ));

        $this->assertSame(
            ['2030-01-07T10:00:00Z', '2030-01-08T15:00:00Z', '2030-01-09T10:00:00Z'],
            self::starts($this->busy()),
        );
    }

    public function test_cancelled_never_counts_and_a_decline_frees_only_on_personal_calendars(): void
    {
        $declined = ['ORGANIZER:mailto:carol@example.test', 'ATTENDEE;PARTSTAT=DECLINED:mailto:bob'];
        $this->seedEventViaPdo('bob', 'cancelled.ics', $this->eventIcs('cancelled', ':20300107T080000Z', ':20300107T090000Z', ['STATUS:CANCELLED']));
        $this->seedEventViaPdo('bob', 'declined.ics', $this->eventIcs('declined', ':20300107T100000Z', ':20300107T110000Z', $declined));
        $this->seedEventViaPdo('groups/eng', 'team-declined.ics', $this->eventIcs('team-declined', ':20300107T120000Z', ':20300107T130000Z', $declined), 'eng');
        $this->seedEventViaPdo('groups/eng', 'team-cancelled.ics', $this->eventIcs('team-cancelled', ':20300107T140000Z', ':20300107T150000Z', ['STATUS:CANCELLED']), 'eng');

        $this->assertSame(['2030-01-07T12:00:00Z'], self::starts($this->busy()));
    }

    public function test_a_team_calendar_is_never_classified_as_personal(): void
    {
        $sources = app(CalendarCollectionAccess::class)->availabilitySourceInstances('bob');
        $teamIds = array_map(static fn (CalendarInstance $i): int => (int) $i->calendarid, $sources['team']);
        $personalIds = array_map(static fn (CalendarInstance $i): int => (int) $i->calendarid, $sources['personal']);

        $this->assertSame([$this->calendarId('principals/groups/eng', 'eng')], $teamIds);
        $this->assertSame([], array_intersect($teamIds, $personalIds));

        // `details` on a Team calendar is never applied.
        app(AvailabilitySettings::class)->setPref('bob', $teamIds[0], null, AvailabilitySettings::DETAIL_DETAILS);
        $this->seedEventViaPdo('groups/eng', 'team.ics', $this->eventIcs('team', ':20300108T100000Z', ':20300108T110000Z', ['SUMMARY:Standup', 'LOCATION:Room 1']), 'eng');
        $this->assertArrayNotHasKey('title', $this->busy()->periods()[0]);
    }

    public function test_overrides_moved_out_of_or_into_the_range(): void
    {
        $this->seedEventViaPdo('bob', 'weekly.ics', $this->eventIcs(
            'weekly',
            ':20300101T100000Z',
            ':20300101T110000Z',
            ['RRULE:FREQ=WEEKLY;COUNT=3'],
            [
                // The 8 January occurrence moves to the next week: out of range.
                ['RECURRENCE-ID:20300108T100000Z', 'DTSTART:20300115T090000Z', 'DTEND:20300115T100000Z'],
                // The 15 January occurrence moves into the range.
                ['RECURRENCE-ID:20300115T100000Z', 'DTSTART:20300109T090000Z', 'DTEND:20300109T100000Z'],
            ],
        ));

        $this->assertSame(['2030-01-09T09:00:00Z'], self::starts($this->busy()));
        $this->assertSame(['2030-01-15T09:00:00Z'], self::starts($this->busy(weeks: [self::week(1)])));
    }

    public function test_the_same_uid_in_a_personal_and_a_team_calendar_counts_once_time_only(): void
    {
        $lines = ['SUMMARY:Planning', 'LOCATION:Room 2'];
        $this->seedEventViaPdo('bob', 'copy.ics', $this->eventIcs('shared-uid', ':20300107T100000Z', ':20300107T110000Z', $lines));
        $this->seedEventViaPdo('groups/eng', 'orig.ics', $this->eventIcs('shared-uid', ':20300107T100000Z', ':20300107T110000Z', $lines), 'eng');
        app(AvailabilitySettings::class)->setPref('bob', $this->calendarId('principals/bob', 'default'), null, AvailabilitySettings::DETAIL_DETAILS);

        $this->assertSame(
            [['start' => '2030-01-07T10:00:00Z', 'timeZone' => null, 'duration' => 'PT1H', 'showWithoutTime' => false]],
            $this->busy()->periods(),
        );
    }

    public function test_exclude_uid_drops_that_event(): void
    {
        $this->seedEventViaPdo('bob', 'keep.ics', $this->eventIcs('keep', ':20300107T100000Z', ':20300107T110000Z'));
        $this->seedEventViaPdo('bob', 'drop.ics', $this->eventIcs('drop', ':20300107T120000Z', ':20300107T130000Z', ['RRULE:FREQ=DAILY;COUNT=3']));

        $this->assertSame(['2030-01-07T10:00:00Z'], self::starts($this->busy(excludeUid: 'drop')));
    }

    public function test_busy_and_details_fields(): void
    {
        $this->seedEventViaPdo('bob', 'meeting.ics', $this->eventIcs('meeting', ':20300107T100000Z', ':20300107T110000Z', [
            'SUMMARY:'.str_repeat('x', 250), 'LOCATION:Room 3', 'DESCRIPTION:secret notes', 'ATTENDEE:mailto:carol@example.test',
            'ORGANIZER:mailto:bob', 'CATEGORIES:Work', 'X-WGW-THING:1',
        ]));
        $this->seedEventViaPdo('bob', 'private.ics', $this->eventIcs('private', ':20300107T120000Z', ':20300107T130000Z', ['SUMMARY:Doctor', 'CLASS:PRIVATE']));
        $this->seedEventViaPdo('bob', 'call.ics', $this->eventIcs('call', ':20300107T140000Z', ':20300107T150000Z', ['SUMMARY:Call', 'LOCATION:Join at https://meet.example.test/abc']));

        $busy = $this->busy()->periods();
        foreach ($busy as $period) {
            $this->assertSame(['start', 'timeZone', 'duration', 'showWithoutTime'], array_keys($period));
        }

        app(AvailabilitySettings::class)->setPref('bob', $this->calendarId('principals/bob', 'default'), null, AvailabilitySettings::DETAIL_DETAILS);
        [$meeting, $private, $call] = $this->busy()->periods();

        $this->assertSame(['start', 'timeZone', 'duration', 'showWithoutTime', 'title', 'location'], array_keys($meeting));
        $this->assertSame(str_repeat('x', 200), $meeting['title']);
        $this->assertSame('Room 3', $meeting['location']);
        $this->assertArrayNotHasKey('title', $private);
        $this->assertSame(['start', 'timeZone', 'duration', 'showWithoutTime', 'title'], array_keys($call));
        $this->assertStringNotContainsString('meeting', (string) json_encode($busy));
    }

    public function test_two_personal_calendars_details_and_busy_and_the_stricter_copy_wins(): void
    {
        $this->seedNamedCalendarFor('bob', 'work', 'Work');
        app(AvailabilitySettings::class)->setPref('bob', $this->calendarId('principals/bob', 'work'), null, AvailabilitySettings::DETAIL_DETAILS);
        $this->seedEventViaPdo('bob', 'w.ics', $this->eventIcs('work-only', ':20300107T100000Z', ':20300107T110000Z', ['SUMMARY:Review']), 'work');
        $this->seedEventViaPdo('bob', 'd.ics', $this->eventIcs('default-only', ':20300107T120000Z', ':20300107T130000Z', ['SUMMARY:Lunch']));
        $this->seedEventViaPdo('bob', 'w2.ics', $this->eventIcs('both', ':20300107T140000Z', ':20300107T150000Z', ['SUMMARY:Both']), 'work');
        $this->seedEventViaPdo('bob', 'd2.ics', $this->eventIcs('both', ':20300107T140000Z', ':20300107T150000Z', ['SUMMARY:Both']));

        [$review, $lunch, $both] = $this->busy()->periods();
        $this->assertSame('Review', $review['title'] ?? null);
        $this->assertArrayNotHasKey('title', $lunch);
        $this->assertArrayNotHasKey('title', $both);
        $this->assertCount(3, $this->busy()->periods());
    }

    public function test_floating_and_all_day_events_keep_wall_clock_time(): void
    {
        $this->seedEventViaPdo('bob', 'floating.ics', $this->eventIcs('floating', ':20300107T090000', ':20300107T100000'));
        $this->seedEventViaPdo('bob', 'allday.ics', $this->eventIcs('allday', ';VALUE=DATE:20300108', ';VALUE=DATE:20300110'));
        $this->seedEventViaPdo('bob', 'zoned.ics', $this->eventIcs('zoned', ';TZID=Europe/Amsterdam:20300109T090000', ';TZID=Europe/Amsterdam:20300109T093000'));

        $this->assertSame([
            ['start' => '2030-01-07T09:00:00', 'timeZone' => null, 'duration' => 'PT1H', 'showWithoutTime' => false],
            ['start' => '2030-01-08', 'timeZone' => null, 'duration' => 'P2D', 'showWithoutTime' => true],
            ['start' => '2030-01-09T09:00:00', 'timeZone' => 'Europe/Amsterdam', 'duration' => 'PT30M', 'showWithoutTime' => false],
        ], $this->busy()->periods());
    }

    public function test_cut_list_skipped_recurrence_and_skipped_objects_are_incomplete(): void
    {
        foreach (range(10, 22) as $minute) {
            // 13 hourly series of 168 hours each: 2184 occurrences in the week.
            $this->seedEventViaPdo('bob', "many-{$minute}.ics", $this->eventIcs("many-{$minute}", ":20300107T00{$minute}00Z", ":20300107T00{$minute}30Z", ['RRULE:FREQ=HOURLY;COUNT=168']));
        }
        $cut = $this->busy();
        $this->assertCount(2000, $cut->periods());
        $this->assertFalse($cut->complete());
        $this->assertTrue($this->busy(weeks: [self::week(1)])->complete());

        $this->seedEventViaPdo('bob', 'hourly.ics', $this->eventIcs('hourly', ':20290101T000000Z', ':20290101T003000Z', ['RRULE:FREQ=HOURLY']));
        $this->assertFalse($this->busy(weeks: [self::week(2)])->complete());

        CalendarObject::query()->insert([
            'calendarid' => $this->calendarId('principals/bob', 'default'), 'uri' => 'broken.ics', 'componenttype' => 'VEVENT',
            'calendardata' => "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:2030012\r\n", 'etag' => 'x', 'size' => 40, 'lastmodified' => 1,
        ]);
        $this->seedEventViaPdo('bob', 'huge.ics', $this->eventIcs('huge', ':20300128T100000Z', ':20300128T110000Z', ['DESCRIPTION:'.str_repeat('y', 600_000)]));
        $skipped = $this->busy(weeks: [self::week(3), self::week(4)]);
        $this->assertFalse($skipped->complete());
        $this->assertSame([self::week(3) => false, self::week(4) => false], $skipped->completeByWeek);
        $this->assertSame([], $skipped->periods());
    }

    private function calendarId(string $principalUri, string $uri): int
    {
        return (int) CalendarInstance::query()->where('principaluri', $principalUri)->where('uri', $uri)->value('calendarid');
    }
}
