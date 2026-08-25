<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Support\WgwSettings;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarsEventImportAccessTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_guest_cannot_import_events(): void
    {
        $this->postJson('/api/v1/calendars/events/import?calendarId=default', [])
            ->assertUnauthorized();
    }

    public function test_calendars_disabled_forbids_import(): void
    {
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, false);

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/import?calendarId=default', [])
            ->assertForbidden();
    }
}
