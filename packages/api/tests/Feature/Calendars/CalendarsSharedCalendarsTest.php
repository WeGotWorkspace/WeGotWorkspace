<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Membership group VEVENT calendars under principals/groups/{slug}.
 */
final class CalendarsSharedCalendarsTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $team = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Team');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);
    }

    public function test_list_includes_personal_and_group_calendars(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/calendars');

        $response->assertOk();
        $calendars = collect($response->json('list'));

        $personal = $calendars->firstWhere('id', 'default');
        $this->assertIsArray($personal);
        $this->assertSame('personal', $personal['scope']);
        $this->assertNull($personal['groupSlug']);

        $groupCalendar = $calendars->firstWhere('id', CalendarCollectionUris::groupCalendarApiId(self::TEAM));
        $this->assertIsArray($groupCalendar);
        $this->assertSame('group', $groupCalendar['scope']);
        $this->assertSame(self::TEAM, $groupCalendar['groupSlug']);
        $this->assertSame('Team', $groupCalendar['name']);
        $this->assertFalse($groupCalendar['myRights']['mayDelete']);
    }

    public function test_non_member_does_not_see_group_calendar(): void
    {
        $response = $this->withBearer($this->issueBearerTokenFor('carol'))
            ->getJson('/api/v1/calendars/calendars');

        $response->assertOk();
        $ids = collect($response->json('list'))->pluck('id')->all();
        $this->assertNotContains(CalendarCollectionUris::groupCalendarApiId(self::TEAM), $ids);
    }

    public function test_show_group_calendar(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/calendars/'.$calendarId)
            ->assertOk()
            ->assertJsonPath('id', $calendarId)
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', self::TEAM);
    }

    public function test_create_group_scoped_calendar(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/calendars', [
                'name' => 'Roadmap',
                'color' => '#22c55e',
                'groupSlug' => self::TEAM,
            ])
            ->assertCreated()
            ->assertJsonPath('name', 'Roadmap')
            ->assertJsonPath('color', '#22c55e')
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', self::TEAM)
            ->assertJsonPath('id', 'roadmap');

        $calendarId = (string) $response->json('id');
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/calendars/'.$calendarId)
            ->assertOk()
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', self::TEAM);
    }

    public function test_create_into_group_requires_membership(): void
    {
        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->postJson('/api/v1/calendars/calendars', [
                'name' => 'Secret',
                'groupSlug' => self::TEAM,
            ])
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }

    public function test_member_can_create_event_in_group_calendar(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events', array_merge(
                $this->sampleCalendarEventPayload($calendarId),
                ['title' => 'Team standup'],
            ))
            ->assertCreated()
            ->assertJsonPath('title', 'Team standup')
            ->assertJsonPath('calendarIds.'.$calendarId, true);
    }
}
