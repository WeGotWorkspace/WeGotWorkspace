<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Cross-user calendar ACL lifted from JmapRestCrossUserAclTest and
 * CalendarsAccessControlTest onto Calendar/* and CalendarEvent/* .
 */
final class JmapCalendarAclTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedDefaultCalendarFor('bob');
        $this->seedDefaultCalendarFor('carol');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_guest_cannot_access_calendar_methods(): void
    {
        $this->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ],
        ])->assertUnauthorized();

        $this->getJson('/api/v1/jmap/session')->assertUnauthorized();
    }

    public function test_user_cannot_read_other_users_calendar_event(): void
    {
        $eventId = $this->seedEventViaPdo('carol', 'carol-event.ics', $this->sampleIcs('Carol Event'));

        $args = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([], $args['list']);
        $this->assertSame([$eventId], $args['notFound']);
    }

    public function test_user_cannot_update_or_destroy_other_users_calendar_event(): void
    {
        $eventId = $this->seedEventViaPdo('carol', 'carol-event-update.ics', $this->sampleIcs('Carol Event Update'));

        $args = $this->jmapAs('bob', [
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'update' => [$eventId => ['title' => 'Hijacked']],
                'destroy' => [$eventId],
            ], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame('notFound', $args['notUpdated'][$eventId]['type']);
        $this->assertSame('notFound', $args['notDestroyed'][$eventId]['type']);
        $this->assertSame([], $args['updated']);
        $this->assertSame([], $args['destroyed']);
    }

    public function test_user_cannot_list_other_users_calendar_events(): void
    {
        $carolEventId = $this->seedEventViaPdo('carol', 'carol-list-event.ics', $this->sampleIcs('Carol List Event'));

        $args = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $ids = array_column($args['list'], 'id');
        $this->assertNotContains($carolEventId, $ids);
    }

    public function test_user_cannot_query_other_users_private_calendar(): void
    {
        $this->seedPrivateCalendarFor('carol', 'carol-private-cal');

        $this->jmapAs('bob', [
            ['CalendarEvent/query', [
                'accountId' => 'bob',
                'filter' => ['inCalendars' => ['carol-private-cal']],
            ], 'c0'],
        ])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'invalidArguments');
    }

    public function test_user_cannot_get_other_users_private_calendar(): void
    {
        $this->seedPrivateCalendarFor('carol', 'carol-private-cal');

        $args = $this->jmapAs('bob', [
            ['Calendar/get', ['accountId' => 'bob', 'ids' => ['carol-private-cal']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertSame([], $args['list']);
        $this->assertSame(['carol-private-cal'], $args['notFound']);
    }

    private function seedPrivateCalendarFor(string $username, string $calendarUri): void
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar('principals/'.$username, $calendarUri, [
            '{DAV:}displayname' => 'Private',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ]);
    }
}
