<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use App\Services\VObject\VObjectPayloadGuard;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * ICS payload bounds lifted from JmapRestPayloadBoundsTest onto CalendarEvent/get.
 */
final class JmapCalendarPayloadBoundsTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedDefaultCalendarFor('bob');
    }

    public function test_ics_with_too_many_vevents_is_invalid_arguments_on_get(): void
    {
        $chunks = [];
        for ($i = 0; $i < VObjectPayloadGuard::MAX_ICALENDAR_COMPONENTS + 1; $i++) {
            $chunks[] = "BEGIN:VEVENT\r\nUID:evt-{$i}\r\nSUMMARY:E{$i}\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z\r\nEND:VEVENT";
        }
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n".implode("\r\n", $chunks)."\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'many-events.ics', $ics);

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
            ],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'invalidArguments');
    }
}
