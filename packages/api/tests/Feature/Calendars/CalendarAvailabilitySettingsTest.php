<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarAvailabilityPref;
use App\Services\Calendars\Availability\AvailabilitySettings;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Tests\Support\AvailabilityTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1909: `GET|PUT /api/v1/calendars/availability`. Defaults, round trip,
 * 400 for wrong types, 422 for foreign calendars and details on a Team
 * calendar (nothing written), choices kept while off.
 */
final class CalendarAvailabilitySettingsTest extends WgwDatabaseTestCase
{
    use AvailabilityTestFixtures;

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAvailabilityFixtures();
        $this->token = $this->issueBearerTokenFor('carol');
    }

    protected function tearDown(): void
    {
        $this->tearDownAvailabilityFixtures();
        parent::tearDown();
    }

    public function test_defaults_list_own_and_team_calendars_included_and_busy(): void
    {
        $this->seedNamedCalendarFor('carol', 'work', 'Work');

        $settings = $this->withBearer($this->token)->getJson('/api/v1/calendars/availability')->assertOk()->json();
        $this->assertIsArray($settings);
        foreach ($settings['calendars'] as $calendar) {
            $this->assertTrue($calendar['color'] === null || is_string($calendar['color']));
        }
        $settings['calendars'] = array_map(static fn (array $calendar): array => array_diff_key($calendar, ['color' => 1]), $settings['calendars']);

        $this->assertSame([
            'enabled' => false,
            'teams' => [['slug' => 'eng', 'name' => 'Engineering']],
            'calendars' => [
                $this->row('default', 'personal'),
                $this->row('work', 'personal', name: 'Work'),
                $this->row('group-eng', 'team', name: 'Engineering'),
            ],
        ], $settings);
    }

    public function test_round_trip_and_choices_are_kept_while_off(): void
    {
        $this->putSettings([
            'enabled' => true,
            'calendars' => [
                ['calendarId' => 'default', 'detail' => 'details'],
                ['calendarId' => 'group-eng', 'include' => false],
            ],
        ])->assertOk()->assertJsonPath('enabled', true);

        $this->putSettings(['enabled' => false])->assertOk();
        $this->putSettings(['enabled' => true])->assertOk();

        $settings = $this->withBearer($this->token)->getJson('/api/v1/calendars/availability')->assertOk();
        $this->assertTrue($settings->json('enabled'));
        $byId = array_column($settings->json('calendars'), null, 'calendarId');
        $this->assertSame(['include' => true, 'detail' => 'details'], array_intersect_key($byId['default'], ['include' => 1, 'detail' => 1]));
        $this->assertSame(['include' => false, 'detail' => 'busy'], array_intersect_key($byId['group-eng'], ['include' => 1, 'detail' => 1]));
    }

    public function test_details_on_a_team_calendar_is_422_and_nothing_is_written(): void
    {
        $this->putSettings([
            'enabled' => true,
            'calendars' => [
                ['calendarId' => 'default', 'include' => false],
                ['calendarId' => 'group-eng', 'detail' => 'details'],
            ],
        ])->assertStatus(422);

        $this->assertNothingWritten();
    }

    public function test_a_calendar_that_is_not_the_callers_source_is_422(): void
    {
        $this->seedNamedCalendarFor('bob', 'secret', 'Secret');
        foreach (['secret', 'nope', 'group-ops'] as $foreign) {
            $this->putSettings(['enabled' => true, 'calendars' => [['calendarId' => $foreign, 'include' => false]]])->assertStatus(422);
        }

        $this->assertNothingWritten();
    }

    public function test_wrong_types_are_400(): void
    {
        $bodies = [
            ['enabled' => 'yes'],
            ['calendars' => 'default'],
            ['calendars' => [['include' => false]]],
            ['calendars' => [['calendarId' => 'default', 'include' => 'no']]],
            ['calendars' => [['calendarId' => 'default', 'detail' => 'everything']]],
            ['calendars' => [['calendarId' => 'default', 'color' => '#fff']]],
            ['other' => true],
            ['calendars' => array_fill(0, 201, ['calendarId' => 'default'])],
        ];
        foreach ($bodies as $body) {
            $this->putSettings($body)->assertStatus(400);
        }

        $this->assertNothingWritten();
    }

    public function test_settings_route_is_declared_next_to_subscriptions_above_the_feed_routes(): void
    {
        $uris = array_values(array_unique(array_map(
            static fn ($route): string => $route->uri(),
            Route::getRoutes()->getRoutes(),
        )));
        $subscriptions = array_search('api/v1/calendars/subscriptions/{id}/refresh', $uris, true);
        $availability = array_search('api/v1/calendars/availability', $uris, true);
        $feed = array_search('api/v1/calendars/{calendarId}/feed', $uris, true);

        $this->assertIsInt($availability);
        $this->assertSame($subscriptions + 1, $availability);
        $this->assertLessThan($feed, $availability);
    }

    /**
     * @param  array<mixed>  $body
     */
    private function putSettings(array $body): TestResponse
    {
        return $this->withBearer($this->token)->putJson('/api/v1/calendars/availability', $body);
    }

    private function assertNothingWritten(): void
    {
        $this->assertFalse(app(AvailabilitySettings::class)->isEnabled('carol'));
        $this->assertSame(0, CalendarAvailabilityPref::query()->where('principal_uri', 'principals/carol')->count());
    }

    /**
     * @return array<string, mixed>
     */
    private function row(string $calendarId, string $source, string $name = 'Calendar'): array
    {
        return [
            'calendarId' => $calendarId,
            'name' => $name,
            'source' => $source,
            'include' => true,
            'detail' => 'busy',
        ];
    }
}
