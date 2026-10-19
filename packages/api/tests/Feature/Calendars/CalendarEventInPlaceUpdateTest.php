<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A WGW edit patches the stored iCalendar instead of rebuilding it (#1392).
 * Input is a real Apple Calendar capture (macOS 26.6.2).
 */
final class CalendarEventInPlaceUpdateTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const FIXTURE = __DIR__.'/../../fixtures/Interop/RealClients/apple-calendar-macos26-event.before.ics';

    private const EVENT_ID = 'apple-event';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $ics = file_get_contents(self::FIXTURE);
        $this->assertIsString($ics);
        $this->seedEventViaPdo('bob', self::EVENT_ID.'.ics', $ics);
    }

    public function test_title_edit_keeps_everything_else_apple_wrote(): void
    {
        $this->updateEvent(['title' => 'Renamed in WGW']);

        $stored = $this->storedIcs();
        $this->assertStringContainsString("SUMMARY:Renamed in WGW\r\n", $stored);
        // Calendar-level properties (RT-9)
        $this->assertStringContainsString("CALSCALE:GREGORIAN\r\n", $stored);
        $this->assertStringContainsString("PRODID:-//Apple Inc.//macOS 26.6.2//EN\r\n", $stored);
        // The agenda link stays a link (RT-1)
        $this->assertStringContainsString("URL;VALUE=URI:https://example.com/agenda\r\n", $stored);
        $this->assertStringNotContainsString('CONFERENCE', $stored);
        // The alarm keeps its identity (RT-5)
        $this->assertStringContainsString("UID:3B9E02C3-CC51-4404-9BAC-81422A02D7B0\r\n", $stored);
        $this->assertStringContainsString("X-WR-ALARMUID:3B9E02C3-CC51-4404-9BAC-81422A02D7B0\r\n", $stored);
        // Vendor properties and the stored VTIMEZONE
        $this->assertStringContainsString("X-APPLE-CREATOR-IDENTITY:com.apple.calendar\r\n", $stored);
        $this->assertStringContainsString("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\n", $stored);
    }

    public function test_changed_alert_keeps_its_uid(): void
    {
        $this->updateEvent(['alerts' => ['alert1' => [
            '@type' => 'Alert',
            'action' => 'display',
            'trigger' => ['@type' => 'RelativeAlert', 'offset' => '-PT30M'],
        ]]]);

        $stored = $this->storedIcs();
        $this->assertStringContainsString("TRIGGER:-PT30M\r\n", $stored);
        $this->assertStringNotContainsString('TRIGGER:-PT15M', $stored);
        $this->assertSame(1, substr_count($stored, 'BEGIN:VALARM'));
        $this->assertStringContainsString("UID:3B9E02C3-CC51-4404-9BAC-81422A02D7B0\r\n", $stored);
    }

    public function test_title_edit_reads_back_through_jmap(): void
    {
        $this->updateEvent(['title' => 'Renamed in WGW']);

        $event = $this->jmap([['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [self::EVENT_ID]], 'g']])
            ->json('methodResponses.0.1.list.0');
        $this->assertSame('Renamed in WGW', $event['title'] ?? null);
        $this->assertSame('https://example.com/agenda', $event['links']['link1']['href'] ?? null);
    }

    public function test_pointer_patch_removes_the_alert_and_keeps_the_rest(): void
    {
        $this->updateEvent(['alerts/alert1' => null]);

        $stored = $this->storedIcs();
        $this->assertStringNotContainsString('BEGIN:VALARM', $stored);
        $this->assertStringContainsString("URL;VALUE=URI:https://example.com/agenda\r\n", $stored);
    }

    public function test_pointer_into_missing_object_is_reported_as_invalid_patch(): void
    {
        $response = $this->jmap([['CalendarEvent/set', ['accountId' => 'bob', 'update' => [self::EVENT_ID => ['participants/nobody/name' => 'X']]], 's']]);

        $this->assertSame('invalidPatch', $response->json('methodResponses.0.1.notUpdated.'.self::EVENT_ID.'.type'));
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function updateEvent(array $patch): void
    {
        $response = $this->jmap([['CalendarEvent/set', ['accountId' => 'bob', 'update' => [self::EVENT_ID => $patch]], 's']]);
        $this->assertArrayHasKey(self::EVENT_ID, (array) $response->json('methodResponses.0.1.updated'), (string) $response->getContent());
    }

    private function storedIcs(): string
    {
        $object = CalendarObject::query()->where('uri', self::EVENT_ID.'.ics')->firstOrFail();

        return (string) $object->calendardata;
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ])->assertOk();
    }
}
