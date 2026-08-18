<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use App\Services\Calendars\CalendarEventMapper;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * CalDAV ↔ JMAP round-trip interoperability for the calendars domain.
 */
final class CalendarsCalDavInteropTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_jmap_create_persists_readable_ics_in_caldav_storage(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $payload = [
            'uid' => $uid,
            'calendarIds' => ['default' => true],
            'title' => 'Interop Event',
            'start' => '2026-07-01T09:00:00Z',
            'end' => '2026-07-01T10:00:00Z',
        ];

        $eventId = (string) $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => $payload]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.d.id');
        $this->assertNotSame('', $eventId);

        $stored = $this->findBobEvent($eventId);
        $this->assertNotNull($stored);

        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('SUMMARY:Interop Event', $ics);
        $this->assertStringContainsString('UID:'.$uid, $ics);
        $this->assertSame(
            $stored->uri,
            str_ends_with($eventId, '.ics') ? $eventId : $eventId.'.ics',
        );
    }

    public function test_jmap_create_with_alerts_persists_valarm_in_caldav_blob(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $eventId = (string) $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => [
                'uid' => $uid,
                'calendarIds' => ['default' => true],
                'title' => 'Reminder Event',
                'start' => '2026-07-01T09:00:00Z',
                'end' => '2026-07-01T10:00:00Z',
                'alerts' => [
                    'reminder' => [
                        '@type' => 'Alert',
                        'action' => 'display',
                        'trigger' => [
                            '@type' => 'RelativeAlert',
                            'offset' => '-PT15M',
                        ],
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.d.id');

        $event = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('-PT15M', $event['alerts']['alert1']['trigger']['offset']);
        $stored = $this->findBobEvent($eventId);
        $this->assertNotNull($stored);

        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('BEGIN:VALARM', $ics);
        $this->assertStringContainsString('TRIGGER:-PT15M', $ics);
        $this->assertStringContainsString('ACTION:DISPLAY', $ics);
    }

    public function test_caldav_valarm_readable_via_jmap(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:CalDAV Reminder\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT30M\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $eventId = $this->seedEventViaPdo('bob', 'caldav-reminder.ics', $ics);

        $event = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertSame($uid, $event['uid']);
        $this->assertSame('display', $event['alerts']['alert1']['action']);
        $this->assertSame('-PT30M', $event['alerts']['alert1']['trigger']['offset']);
    }

    public function test_jmap_create_updates_caldav_search_index(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $eventId = (string) $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['d' => [
                'uid' => $uid,
                'calendarIds' => ['default' => true],
                'title' => 'Searchable Event',
                'start' => '2026-07-01T09:00:00Z',
                'end' => '2026-07-01T10:00:00Z',
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.d.id');

        $stored = $this->findBobEvent($eventId);
        $this->assertNotNull($stored);

        $sourceKey = $this->calDavSearchSourceKey('bob', 'default', (string) $stored->uri);
        $row = DB::connection('wgw')->table('search_documents')
            ->where('source_type', 'caldav')
            ->where('source_key', $sourceKey)
            ->first();

        $this->assertNotNull($row, 'JMAP create should index the CalDAV event.');
        $this->assertSame('calendar', $row->category);
        $this->assertSame('bob', $row->owner_username);
        $this->assertStringContainsString('Searchable Event', (string) $row->title);

        $search = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/search/results?'.http_build_query([
                'q' => 'Searchable',
                'sources' => ['caldav'],
                'limit' => 10,
            ]));

        $search->assertOk();
        $sourceTypes = array_map(
            static fn (array $hit): string => (string) ($hit['sourceType'] ?? ''),
            $search->json('data.results') ?? [],
        );
        $this->assertContains('caldav', $sourceTypes);
    }

    public function test_caldav_seeded_event_readable_via_jmap(): void
    {
        $uid = 'urn:uuid:'.Str::uuid()->toString();
        $eventId = $this->seedEventViaPdo('bob', 'caldav-seeded.ics', $this->sampleIcs('CalDAV Seeded', $uid));

        $event = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertSame($uid, $event['uid']);
        $this->assertSame('CalDAV Seeded', $event['title']);
    }

    public function test_jmap_update_rewrites_stored_ics(): void
    {
        $eventId = $this->seedEventViaPdo('bob', 'update-me.ics', $this->sampleIcs('Before Update'));

        $this->jmap([
            ['CalendarEvent/set', ['accountId' => 'bob', 'update' => [$eventId => [
                'title' => 'After Update',
                'start' => '2026-08-01T09:00:00Z',
                'end' => '2026-08-01T10:00:00Z',
            ]]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.notUpdated.'.$eventId, null);

        $stored = $this->findBobEvent($eventId);
        $this->assertNotNull($stored);
        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('SUMMARY:After Update', $ics);
        $this->assertStringNotContainsString('Before Update', $ics);
    }

    private function findBobEvent(string $eventId): ?CalendarObject
    {
        $uri = str_ends_with($eventId, '.ics') ? $eventId : CalendarEventMapper::eventUriFromId($eventId);

        return CalendarObject::query()
            ->where('uri', $uri)
            ->whereHas('calendar.instances', function ($query): void {
                $query->where('principaluri', 'principals/bob');
            })
            ->first();
    }

    private function calDavSearchSourceKey(string $username, string $calendarUri, string $eventUri): string
    {
        return $username.'|'.$calendarUri.'|'.$eventUri;
    }
}
