<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * CalendarEvent payload bounds: set → tooLarge; mixed calendar get isolates over-cap ids.
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

    public function test_oversized_calendar_event_set_is_too_large(): void
    {
        $payload = $this->sampleCalendarEventPayload();
        $payload['description'] = str_repeat('x', VObjectPayloadGuard::MAX_ICS_BYTES);

        $response = $this->jmap([
            ['CalendarEvent/set', [
                'accountId' => 'bob',
                'create' => ['k0' => $payload],
            ], 'c0'],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.created.k0'));
        $this->assertSame('tooLarge', $response->json('methodResponses.0.1.notCreated.k0.type'));
        $this->assertStringContainsString(
            (string) VObjectPayloadGuard::MAX_ICS_BYTES,
            (string) $response->json('methodResponses.0.1.notCreated.k0.description'),
        );
    }

    public function test_mixed_calendar_query_returns_over_cap_id_get_puts_it_in_not_found(): void
    {
        $normalId = $this->seedEventViaPdo('bob', 'normal.ics', $this->sampleIcs('Normal'));

        $chunks = [];
        for ($i = 0; $i < VObjectPayloadGuard::MAX_ICALENDAR_COMPONENTS + 1; $i++) {
            $chunks[] = "BEGIN:VEVENT\r\nUID:over-{$i}\r\nSUMMARY:E{$i}\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z\r\nEND:VEVENT";
        }
        $overCapIcs = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n".implode("\r\n", $chunks)."\r\nEND:VCALENDAR\r\n";
        $overCapId = $this->seedEventViaPdo('bob', 'over-cap.ics', $overCapIcs);

        $query = $this->jmap([
            ['CalendarEvent/query', ['accountId' => 'bob', 'filter' => ['inCalendars' => ['default']]], 'q0'],
        ])->assertOk();
        $ids = $query->json('methodResponses.0.1.ids');
        $this->assertIsArray($ids);
        $this->assertContains($normalId, $ids);
        $this->assertContains($overCapId, $ids);

        $get = $this->jmap([
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$normalId, $overCapId]], 'g0'],
        ])->assertOk();

        $this->assertSame('CalendarEvent/get', $get->json('methodResponses.0.0'));
        $list = $get->json('methodResponses.0.1.list');
        $notFound = $get->json('methodResponses.0.1.notFound');
        $this->assertIsArray($list);
        $this->assertIsArray($notFound);
        $this->assertCount(1, $list);
        $this->assertSame($normalId, $list[0]['id'] ?? null);
        $this->assertSame([$overCapId], $notFound);
    }
}
