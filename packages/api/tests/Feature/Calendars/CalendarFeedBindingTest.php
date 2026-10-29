<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarFeedToken;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminGroupManagementService;
use App\Services\Admin\AdminUserProvisionerService;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A public feed belongs to one calendar: it serves exactly that calendar, ends
 * with it, and every principal who may publish the calendar sees the same feed.
 */
final class CalendarFeedBindingTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $team = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Team');
        foreach (['bob', 'carol', 'alice'] as $username) {
            $principal = Principal::forUsername($username);
            $this->assertNotNull($principal);
            $this->addPrincipalToGroup($team, $principal);
        }
    }

    public function test_every_group_member_sees_and_can_revoke_the_group_calendar_feed(): void
    {
        $this->createCalendar('carol', 'planning', self::TEAM, 'Team plan');
        $published = $this->as('bob')->postJson('/api/v1/calendars/planning/feed')->assertCreated()->json();

        $this->as('carol')->getJson('/api/v1/calendars/planning/feed')
            ->assertOk()
            ->assertJsonPath('httpsUrl', $published['httpsUrl']);
        $this->as('carol')->postJson('/api/v1/calendars/planning/feed', ['mode' => 'busy'])
            ->assertOk()
            ->assertJsonPath('httpsUrl', $published['httpsUrl'])
            ->assertJsonPath('mode', 'busy');
        $this->as('bob')->getJson('/api/v1/calendars/planning/feed')
            ->assertOk()
            ->assertJsonPath('mode', 'busy');
        $this->assertSame(1, CalendarFeedToken::query()->count());

        $this->as('carol')->deleteJson('/api/v1/calendars/planning/feed')->assertNoContent();

        $this->get('/api/v1/calendars/feeds/'.$this->token($published))->assertNotFound();
        $this->as('bob')->getJson('/api/v1/calendars/planning/feed')->assertNotFound();
    }

    public function test_a_new_group_calendar_with_the_same_id_does_not_reuse_a_deleted_calendars_feed(): void
    {
        $this->createCalendar('carol', 'planning', self::TEAM, 'Team plan');
        $published = $this->as('bob')->postJson('/api/v1/calendars/planning/feed')->assertCreated()->json();
        $this->get('/api/v1/calendars/feeds/'.$this->token($published))->assertOk()->assertSee('SUMMARY:Team plan', false);

        $this->destroyCalendar('alice', 'planning');
        $this->assertSame(0, CalendarFeedToken::query()->count());

        $this->createCalendar('carol', 'planning', self::TEAM, 'Later plan');
        $this->get('/api/v1/calendars/feeds/'.$this->token($published))->assertNotFound();
        $this->as('bob')->getJson('/api/v1/calendars/planning/feed')->assertNotFound();
    }

    public function test_the_publishers_personal_calendar_with_the_same_id_does_not_reuse_a_deleted_group_feed(): void
    {
        $this->createCalendar('carol', 'planning', self::TEAM, 'Team plan');
        $published = $this->as('bob')->postJson('/api/v1/calendars/planning/feed')->assertCreated()->json();
        $this->destroyCalendar('alice', 'planning');

        $this->createCalendar('bob', 'planning', null, 'Private plan');

        $this->get('/api/v1/calendars/feeds/'.$this->token($published))->assertNotFound();
    }

    public function test_a_feed_ends_when_its_calendar_is_removed_through_the_caldav_backend(): void
    {
        $this->createCalendar('bob', 'work', null, 'Work item');
        $published = $this->as('bob')->postJson('/api/v1/calendars/work/feed')->assertCreated()->json();

        $instance = CalendarInstance::query()->where('principaluri', 'principals/bob')->where('uri', 'work')->firstOrFail();
        app(WgwCalendarBackendFactory::class)->make()->deleteCalendar([(int) $instance->calendarid, (int) $instance->id]);

        $this->assertSame(0, CalendarFeedToken::query()->count());
        $this->createCalendar('bob', 'work', null, 'New work item');
        $this->get('/api/v1/calendars/feeds/'.$this->token($published))->assertNotFound();
    }

    public function test_deleting_a_user_ends_their_feeds_and_a_reused_username_starts_unpublished(): void
    {
        $this->seedEventViaPdo('carol', 'carol-event.ics', $this->sampleIcs('Carol plan'));
        $published = $this->as('carol')->postJson('/api/v1/calendars/default/feed')->assertCreated()->json();

        app(AdminUserProvisionerService::class)->delete('carol');
        $this->assertSame(0, CalendarFeedToken::query()->count());

        $this->seedWgwUser('carol', displayName: 'New Carol');
        $this->seedDefaultCalendarFor('carol');
        $this->seedEventViaPdo('carol', 'new-carol.ics', $this->sampleIcs('New Carol plan'));

        $this->get('/api/v1/calendars/feeds/'.$this->token($published))->assertNotFound();
        $this->as('carol')->getJson('/api/v1/calendars/default/feed')->assertNotFound();
    }

    public function test_deleting_a_group_ends_its_calendar_feeds(): void
    {
        $this->createCalendar('carol', 'planning', self::TEAM, 'Team plan');
        $published = $this->as('bob')->postJson('/api/v1/calendars/planning/feed')->assertCreated()->json();

        app(AdminGroupManagementService::class)->delete(self::TEAM);

        $this->assertSame(0, CalendarFeedToken::query()->count());
        $this->createCalendar('bob', 'planning', null, 'Private plan');
        $this->get('/api/v1/calendars/feeds/'.$this->token($published))->assertNotFound();
    }

    public function test_a_feed_stays_with_its_calendar_when_the_calendar_leaves_the_group(): void
    {
        $this->createCalendar('carol', 'planning', self::TEAM, 'Team plan');
        $published = $this->as('bob')->postJson('/api/v1/calendars/planning/feed')->assertCreated()->json();

        $updated = $this->jmapAs('alice', [
            ['Calendar/set', ['accountId' => 'alice', 'update' => ['planning' => ['groupSlug' => null]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.updated');
        $this->assertIsArray($updated);
        $this->assertArrayHasKey('planning', $updated);

        $this->get('/api/v1/calendars/feeds/'.$this->token($published))->assertOk()->assertSee('SUMMARY:Team plan', false);
        $this->as('alice')->getJson('/api/v1/calendars/planning/feed')
            ->assertOk()
            ->assertJsonPath('httpsUrl', $published['httpsUrl']);
        $this->as('bob')->getJson('/api/v1/calendars/planning/feed')->assertNotFound();
    }

    private function createCalendar(string $username, string $id, ?string $groupSlug, string $eventTitle): void
    {
        $calendar = ['name' => ucfirst($id), 'id' => $id];
        if ($groupSlug !== null) {
            $calendar['groupSlug'] = $groupSlug;
        }
        $created = $this->jmapAs($username, [
            ['Calendar/set', ['accountId' => $username, 'create' => ['c' => $calendar]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c.id');
        $this->assertSame($id, $created);

        $event = $this->sampleCalendarEventPayload($id);
        $event['title'] = $eventTitle;
        $createdEvent = $this->jmapAs($username, [
            ['CalendarEvent/set', ['accountId' => $username, 'create' => ['e' => $event]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.e');
        $this->assertIsArray($createdEvent);
    }

    private function destroyCalendar(string $username, string $id): void
    {
        $this->jmapAs($username, [
            ['Calendar/set', ['accountId' => $username, 'destroy' => [$id], 'onDestroyRemoveEvents' => true], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed', [$id]);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->as($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function as(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }

    /**
     * @param  array<string, mixed>  $feed
     */
    private function token(array $feed): string
    {
        return basename((string) parse_url((string) $feed['httpsUrl'], PHP_URL_PATH));
    }
}
