<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\SabreServerFactory;
use App\Dav\Server\WgwSchedulePlugin;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\Availability\AvailabilitySettings;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\AvailabilityTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1909: the CalDAV outbox VFREEBUSY report follows the Team availability
 * rules. Anything the caller may not read, a window over 54 covering weeks
 * or an incomplete result answers like an unknown address (3.7).
 */
final class AvailabilityCalDavFreeBusyTest extends WgwDatabaseTestCase
{
    use AvailabilityTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAvailabilityFixtures();
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['email' => null, 'displayname' => 'Groups'],
        );
        foreach (['alice', 'bob', 'carol'] as $username) {
            Principal::query()->where('uri', 'principals/'.$username)->update(['email' => $username.'@example.test']);
        }
    }

    protected function tearDown(): void
    {
        $this->tearDownAvailabilityFixtures();
        parent::tearDown();
    }

    public function test_switch_on_returns_time_only_periods_clipped_to_the_window(): void
    {
        $this->seedEventViaPdo('bob', 'a.ics', $this->eventIcs('a', ':20300107T080000Z', ':20300107T100000Z', ['SUMMARY:Secret']));
        $this->seedEventViaPdo('bob', 'b.ics', $this->eventIcs('b', ':20300107T150000Z', ':20300107T160000Z'));
        $this->seedEventViaPdo('groups/eng', 'c.ics', $this->eventIcs('c', ':20300107T153000Z', ':20300107T170000Z'), 'eng');
        $this->seedEventViaPdo('bob', 'outside.ics', $this->eventIcs('outside', ':20300108T100000Z', ':20300108T110000Z'));

        $reply = $this->freeBusy('carol', 'bob', '20300107T090000Z', '20300108T000000Z');

        $this->assertStringContainsString('2.0;Success', $reply);
        $this->assertStringNotContainsString('Secret', $reply);
        $this->assertSame(['20300107T090000Z/20300107T100000Z', '20300107T150000Z/20300107T170000Z'], $this->freeBusyLines($reply));
        $this->assertStringContainsString('DTSTART:20300107T090000Z', $reply);
        $this->assertStringContainsString('DTEND:20300108T000000Z', $reply);
    }

    public function test_switch_off_no_shared_team_and_unknown_answer_alike(): void
    {
        $this->seedEventViaPdo('carol', 'a.ics', $this->eventIcs('a', ':20300107T100000Z', ':20300107T110000Z'));

        $this->assertUnknown($this->freeBusy('bob', 'carol', '20300107T000000Z', '20300108T000000Z'));
        $this->assertUnknown($this->freeBusy('alice', 'bob', '20300107T000000Z', '20300108T000000Z'));
        $this->assertUnknown($this->freeBusy('carol', 'nobody', '20300107T000000Z', '20300108T000000Z'));

        app(AvailabilitySettings::class)->setEnabled('bob', false);
        $this->assertUnknown($this->freeBusy('carol', 'bob', '20300107T000000Z', '20300108T000000Z'));
    }

    public function test_a_window_over_54_covering_weeks_answers_unknown(): void
    {
        // An aligned 54-week window is fine; shifting it by a day covers 55.
        $this->assertStringContainsString('2.0;Success', $this->freeBusy('carol', 'bob', '20300107T000000Z', '20310120T000000Z'));
        $this->assertUnknown($this->freeBusy('carol', 'bob', '20300108T000000Z', '20310121T000000Z'));
    }

    public function test_an_incomplete_result_answers_unknown(): void
    {
        CalendarObject::query()->insert([
            'calendarid' => $this->defaultCalendarId('bob'),
            'uri' => 'broken.ics',
            'calendardata' => "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:broken\r\nDTSTART:20300107T100000Z\r\n",
            'lastmodified' => time(),
            'etag' => md5('broken'),
            'size' => 60,
            'componenttype' => 'VEVENT',
            'firstoccurence' => gmmktime(10, 0, 0, 1, 7, 2030),
            'lastoccurence' => gmmktime(11, 0, 0, 1, 7, 2030),
            'uid' => 'broken',
        ]);

        $this->assertUnknown($this->freeBusy('carol', 'bob', '20300107T000000Z', '20300108T000000Z'));
    }

    public function test_covering_weeks(): void
    {
        $monday = gmmktime(0, 0, 0, 1, 7, 2030);
        $this->assertSame([$monday], WgwSchedulePlugin::coveringWeeks($monday, $monday + 3600));
        $this->assertSame([$monday - 604800], WgwSchedulePlugin::coveringWeeks($monday - 60, $monday));
        $this->assertSame([$monday - 604800, $monday], WgwSchedulePlugin::coveringWeeks($monday - 60, $monday + 60));
        $this->assertSame([], WgwSchedulePlugin::coveringWeeks($monday, $monday));
    }

    private function assertUnknown(string $reply): void
    {
        $this->assertStringContainsString('3.7;Could not find principal', $reply);
        $this->assertStringNotContainsString('VFREEBUSY', $reply);
    }

    /**
     * @return list<string>
     */
    private function freeBusyLines(string $reply): array
    {
        preg_match_all('/^FREEBUSY[^:]*:(\S+)/m', str_replace("\r\n ", '', html_entity_decode($reply)), $matches);

        return $matches[1];
    }

    private function freeBusy(string $caller, string $target, string $start, string $end): string
    {
        $ics = implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//wgw//availability test//EN',
            'METHOD:REQUEST',
            'BEGIN:VFREEBUSY',
            'UID:fb-'.$target,
            'DTSTAMP:20300101T000000Z',
            'DTSTART:'.$start,
            'DTEND:'.$end,
            'ORGANIZER:mailto:'.$caller.'@example.test',
            'ATTENDEE:mailto:'.$target.'@example.test',
            'END:VFREEBUSY',
            'END:VCALENDAR',
            '',
        ]);

        $auth = 'Basic '.base64_encode($caller.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;
        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest('POST', '/calendars/'.$caller.'/outbox', [
            'Authorization' => $auth,
            'Content-Type' => 'text/calendar; charset=utf-8',
        ], $ics);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            $this->fail('Outbox POST failed: '.$e->getMessage()."\n".$e->getTraceAsString());
        }
        $this->assertSame(200, $response->getStatus(), (string) $response->getBodyAsString());

        return (string) $response->getBodyAsString();
    }

    private function defaultCalendarId(string $username): int
    {
        return (int) CalendarInstance::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('uri', 'default')
            ->value('calendarid');
    }
}
