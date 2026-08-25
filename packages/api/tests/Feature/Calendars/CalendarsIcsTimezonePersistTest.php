<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\AssertsIcsTimeZones;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #608: creating a timed IANA event must persist VTIMEZONE on the stored
 * object, and the published feed must expose it (or repair legacy objects).
 */
final class CalendarsIcsTimezonePersistTest extends WgwDatabaseTestCase
{
    use AssertsIcsTimeZones;
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_jmap_create_persists_vtimezone_and_round_trips_timezone(): void
    {
        $created = $this->jmap([
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'create' => ['ams' => [
                    'calendarIds' => ['default' => true],
                    'uid' => 'ams-persist-1',
                    'title' => 'Amsterdam catch-up',
                    'start' => '2026-06-15T10:00:00',
                    'end' => '2026-06-15T11:00:00',
                    'timeZone' => 'Europe/Amsterdam',
                ]],
            ], 'c'],
        ])->assertOk();

        $eventId = (string) $created->json('methodResponses.0.1.created.ams.id');
        $this->assertNotSame('', $eventId);

        $stored = CalendarObject::query()->where('calendardata', 'like', '%ams-persist-1%')->first();
        $this->assertNotNull($stored);
        $ics = is_string($stored->calendardata) ? $stored->calendardata : (string) $stored->calendardata;
        $this->assertStringContainsString('DTSTART;TZID=Europe/Amsterdam:20260615T100000', $ics);
        $this->assertEveryTzidHasVTimeZone($ics, 'stored calendar object');

        $fetched = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'g'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertSame('Europe/Amsterdam', $fetched['timeZone']);
        $this->assertSame('2026-06-15T10:00:00', $fetched['start']);
        $this->assertArrayHasKey('icsDefinition', $fetched['timeZones']['Europe/Amsterdam'] ?? []);
    }

    public function test_published_feed_includes_vtimezone_for_app_created_event(): void
    {
        $this->jmap([
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'create' => ['ams' => [
                    'calendarIds' => ['default' => true],
                    'uid' => 'ams-publish-1',
                    'title' => 'Amsterdam catch-up',
                    'start' => '2026-06-15T10:00:00',
                    'end' => '2026-06-15T11:00:00',
                    'timeZone' => 'Europe/Amsterdam',
                ]],
            ], 'c'],
        ])->assertOk();

        $created = $this->asBob()->postJson('/api/v1/calendars/default/feed')->assertCreated()->json();
        $raw = basename(parse_url((string) $created['httpsUrl'], PHP_URL_PATH) ?: '');
        $feed = $this->get('/api/v1/calendars/feeds/'.$raw)->assertOk()->getContent();

        $this->assertStringContainsString('UID:ams-publish-1', $feed);
        $this->assertStringContainsString('DTSTART;TZID=Europe/Amsterdam:20260615T100000', $feed);
        $this->assertEveryTzidHasVTimeZone($feed, 'published feed');
    }

    public function test_published_feed_repairs_legacy_stored_ics_missing_vtimezone(): void
    {
        $this->seedEventViaPdo(
            'bob',
            'legacy-publish.ics',
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:legacy-publish@example.test\r\nSUMMARY:Legacy Amsterdam\r\nDTSTART;TZID=Europe/Amsterdam:20260615T100000\r\nDTEND;TZID=Europe/Amsterdam:20260615T110000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        );

        $created = $this->asBob()->postJson('/api/v1/calendars/default/feed')->assertCreated()->json();
        $raw = basename(parse_url((string) $created['httpsUrl'], PHP_URL_PATH) ?: '');
        $feed = $this->get('/api/v1/calendars/feeds/'.$raw)->assertOk()->getContent();

        $this->assertStringContainsString('UID:legacy-publish@example.test', $feed);
        $this->assertEveryTzidHasVTimeZone($feed, 'repaired published feed');
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

    private function asBob(): self
    {
        return $this->withBearer($this->userBearerToken());
    }
}
