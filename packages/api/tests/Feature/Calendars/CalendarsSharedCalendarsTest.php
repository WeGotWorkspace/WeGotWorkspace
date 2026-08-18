<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Jmap\JmapCapabilities;
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
        $this->assertSame(CalendarColorPalette::forUri(self::TEAM), $groupCalendar['color']);
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

    public function test_patch_group_calendar_updates_name_and_color(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/calendars/calendars/'.$calendarId, [
                'name' => 'Team planning',
                'color' => '#ec4899',
            ])
            ->assertOk()
            ->assertJsonPath('id', $calendarId)
            ->assertJsonPath('name', 'Team planning')
            ->assertJsonPath('color', '#ec4899')
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', self::TEAM)
            ->assertJsonPath('myRights.mayWrite', true)
            ->assertJsonPath('myRights.mayDelete', false);

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/calendars/'.$calendarId)
            ->assertOk()
            ->assertJsonPath('name', 'Team planning')
            ->assertJsonPath('color', '#ec4899');
    }

    public function test_jmap_calendar_set_updates_group_calendar_name_and_color(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['Calendar/set', ['accountId' => 'bob', 'update' => [$calendarId => ['name' => 'Squad', 'color' => '#22c55e']]], 'c0'],
                ['Calendar/get', ['accountId' => 'bob', 'ids' => [$calendarId]], 'c1'],
            ],
        ])->assertOk();

        $this->assertNull($response->json('methodResponses.0.1.notUpdated.'.$calendarId));
        $this->assertNull($response->json('methodResponses.0.1.updated.'.$calendarId));
        $this->assertSame('Squad', $response->json('methodResponses.1.1.list.0.name'));
        $this->assertSame('#22c55e', $response->json('methodResponses.1.1.list.0.color'));
        $this->assertSame($calendarId, $response->json('methodResponses.1.1.list.0.id'));
    }

    public function test_non_member_cannot_patch_group_calendar(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->patchJson('/api/v1/calendars/calendars/'.$calendarId, [
                'name' => 'Hijacked',
            ])
            ->assertNotFound();
    }

    public function test_delete_provisioned_group_calendar_is_forbidden(): void
    {
        $calendarId = CalendarCollectionUris::groupCalendarApiId(self::TEAM);

        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/calendars/calendars/'.$calendarId)
            ->assertForbidden();
    }

    public function test_patch_extra_group_calendar_updates_name_and_color(): void
    {
        $calendarId = $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/calendars', [
                'name' => 'Roadmap',
                'groupSlug' => self::TEAM,
            ])
            ->assertCreated()
            ->json('id');

        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/calendars/calendars/'.$calendarId, [
                'name' => 'Roadmap 2026',
                'color' => '#0ea5e9',
            ])
            ->assertOk()
            ->assertJsonPath('id', $calendarId)
            ->assertJsonPath('name', 'Roadmap 2026')
            ->assertJsonPath('color', '#0ea5e9')
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', self::TEAM);
    }
}
