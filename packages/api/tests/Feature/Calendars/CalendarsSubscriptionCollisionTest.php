<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\CalendarSubscription;
use App\Models\Principal;
use App\Services\Calendars\HostIpResolver;
use Illuminate\Support\Facades\Http;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\FakeHostIpResolver;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Calendar uris are only unique per owning principal. Subscribing the same feed (or two feeds
 * with the same name) as a personal calendar and on Teams must never touch another calendar.
 */
final class CalendarsSubscriptionCollisionTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const FEED_URL = 'https://feeds.example.test/villa.ics';

    private string $feedBody = '';

    protected function calendarFixtureUsersShareATeam(): bool
    {
        return false;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->app->instance(
            HostIpResolver::class,
            (new FakeHostIpResolver)->map('feeds.example.test', ['93.184.216.34']),
        );
        Http::preventStrayRequests();
        $this->feedBody = $this->sampleIcs('Villa day', 'villa@example.test');
        Http::fake([
            self::FEED_URL => fn () => Http::response($this->feedBody, 200, ['Content-Type' => 'text/calendar']),
        ]);
        foreach (['team-a', 'team-b'] as $slug) {
            $team = $this->seedWgwGroup('principals/groups/'.$slug, $slug);
            $this->appointTeamAdmin($slug, 'bob');
            $this->addPrincipalToGroup($team, $this->bob());
        }
    }

    public function test_personal_then_team_with_the_same_name_keeps_both(): void
    {
        $personal = $this->subscribe(null);
        $team = $this->subscribe('team-a');

        $this->assertBothSubscriptionsIntact([
            [$personal, 'principals/bob'],
            [$team, 'principals/groups/team-a'],
        ]);
    }

    public function test_team_then_personal_with_the_same_name_keeps_both(): void
    {
        $team = $this->subscribe('team-a');
        $personal = $this->subscribe(null);

        $this->assertBothSubscriptionsIntact([
            [$team, 'principals/groups/team-a'],
            [$personal, 'principals/bob'],
        ]);
    }

    public function test_team_a_then_team_b_with_the_same_name_keeps_both(): void
    {
        $a = $this->subscribe('team-a');
        $b = $this->subscribe('team-b');

        $this->assertBothSubscriptionsIntact([
            [$a, 'principals/groups/team-a'],
            [$b, 'principals/groups/team-b'],
        ]);
    }

    public function test_a_failed_team_subscription_removes_only_the_calendar_it_created(): void
    {
        $personal = $this->subscribe(null);

        $failSave = true;
        CalendarSubscription::creating(static function (CalendarSubscription $row) use (&$failSave): void {
            if ($failSave && $row->principal_uri === 'principals/groups/team-a') {
                throw new \RuntimeException('save failed');
            }
        });
        try {
            $this->withBearer($this->userBearerToken())->postJson('/api/v1/calendars/subscriptions', [
                'url' => self::FEED_URL,
                'name' => 'Villa',
                'groupSlug' => 'team-a',
            ])->assertStatus(500)
                ->assertJsonPath('error', 'The subscription could not be saved.');
        } finally {
            $failSave = false;
        }

        $this->assertBothSubscriptionsIntact([[$personal, 'principals/bob']]);
        $this->assertNull(
            CalendarInstance::query()->where('principaluri', 'principals/groups/team-a')->where('uri', $personal['calendarId'])->first(),
        );
    }

    public function test_deleting_the_team_subscription_leaves_the_personal_one(): void
    {
        $personal = $this->subscribe(null);
        $team = $this->subscribe('team-a');

        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/calendars/subscriptions/'.$team['id'])
            ->assertSuccessful();

        $this->assertBothSubscriptionsIntact([[$personal, 'principals/bob']]);
        $this->assertNull(
            CalendarInstance::query()->where('principaluri', 'principals/groups/team-a')->where('uri', $team['calendarId'])->first(),
        );
    }

    public function test_refreshing_the_team_subscription_does_not_touch_the_personal_calendar(): void
    {
        $personal = $this->subscribe(null);
        $team = $this->subscribe('team-a');
        $this->feedBody = $this->sampleIcs('Villa night', 'villa-night@example.test');

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/subscriptions/'.$team['id'].'/refresh')
            ->assertSuccessful();

        $personalInstance = CalendarInstance::query()->where('principaluri', 'principals/bob')->where('uri', $personal['calendarId'])->first();
        $teamInstance = CalendarInstance::query()->where('principaluri', 'principals/groups/team-a')->where('uri', $team['calendarId'])->first();
        $this->assertSame(['villa@example.test'], CalendarObject::query()->where('calendarid', $personalInstance->calendarid)->pluck('uid')->all());
        $this->assertSame(['villa-night@example.test'], CalendarObject::query()->where('calendarid', $teamInstance->calendarid)->pluck('uid')->all());
    }

    /** @return array<string, mixed> */
    private function subscribe(?string $groupSlug): array
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/calendars/subscriptions', [
            'url' => self::FEED_URL,
            'name' => 'Villa',
            ...($groupSlug !== null ? ['groupSlug' => $groupSlug] : []),
        ])->assertCreated()->json();
    }

    /** @param list<array{0: array<string, mixed>, 1: string}> $expected subscription response and owner principal */
    private function assertBothSubscriptionsIntact(array $expected): void
    {
        $this->assertSame(count($expected), CalendarSubscription::query()->count());
        foreach ($expected as [$subscription, $principalUri]) {
            $row = CalendarSubscription::query()->find($subscription['id']);
            $this->assertNotNull($row, 'subscription row survives');
            $this->assertSame($principalUri, $row->principal_uri);

            $instance = CalendarInstance::query()
                ->where('principaluri', $principalUri)
                ->where('uri', $subscription['calendarId'])
                ->first();
            $this->assertNotNull($instance, "calendar of {$principalUri} survives");
            $this->assertSame(
                1,
                CalendarObject::query()->where('calendarid', $instance->calendarid)->count(),
                "calendar of {$principalUri} keeps its event",
            );
        }
    }

    private function bob(): Principal
    {
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);

        return $bob;
    }
}
