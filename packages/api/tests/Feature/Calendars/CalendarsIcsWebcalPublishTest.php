<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarFeedToken;
use App\Services\Calendars\CalendarFeedRateLimiter;
use App\Services\Calendars\HostIpResolver;
use Illuminate\Support\Facades\Http;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\FakeHostIpResolver;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarsIcsWebcalPublishTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedEventViaPdo('bob', 'pub-event.ics', $this->sampleIcs('Published Meeting', 'pub-event@example.test'));
    }

    public function test_owner_can_publish_get_and_download_hashed_feed(): void
    {
        $created = $this->asBob()->postJson('/api/v1/calendars/default/feed')
            ->assertCreated()
            ->json();

        $this->assertMatchesRegularExpression('#^https?://.+/api/v1/calendars/feeds/[a-z0-9]+$#', $created['httpsUrl']);
        $this->assertMatchesRegularExpression('#^webcal://.+/api/v1/calendars/feeds/[a-z0-9]+$#', $created['webcalUrl']);

        $raw = $this->tokenFromHttpsUrl($created['httpsUrl']);
        $row = CalendarFeedToken::query()->first();
        $this->assertNotNull($row);
        $this->assertSame(CalendarFeedToken::hashRaw($raw), (string) $row->token_hash);
        $this->assertNotSame($raw, (string) $row->getRawOriginal('token_cipher'));

        $this->asBob()->getJson('/api/v1/calendars/default/feed')
            ->assertOk()
            ->assertJsonPath('httpsUrl', $created['httpsUrl'])
            ->assertJsonPath('webcalUrl', $created['webcalUrl']);

        $this->asBob()->postJson('/api/v1/calendars/default/feed')
            ->assertOk()
            ->assertJsonPath('httpsUrl', $created['httpsUrl']);

        $ics = $this->get('/api/v1/calendars/feeds/'.$raw);
        $ics->assertOk();
        $this->assertStringContainsString('text/calendar', (string) $ics->headers->get('Content-Type'));
        $this->assertStringContainsString('BEGIN:VCALENDAR', $ics->getContent());
        $this->assertStringContainsString('UID:pub-event@example.test', $ics->getContent());
        $this->assertStringContainsString('SUMMARY:Published Meeting', $ics->getContent());

        $this->get('/api/v1/calendars/feeds/'.$raw.'.ics')
            ->assertOk()
            ->assertSee('BEGIN:VCALENDAR', false);
    }

    public function test_unknown_and_revoked_tokens_are_404(): void
    {
        $this->get('/api/v1/calendars/feeds/missingfeedtoken')->assertNotFound();

        $created = $this->asBob()->postJson('/api/v1/calendars/default/feed')->assertCreated()->json();
        $raw = $this->tokenFromHttpsUrl($created['httpsUrl']);

        $this->asBob()->deleteJson('/api/v1/calendars/default/feed')->assertNoContent();
        $this->get('/api/v1/calendars/feeds/'.$raw)->assertNotFound();
        $this->asBob()->getJson('/api/v1/calendars/default/feed')->assertNotFound();

        $republished = $this->asBob()->postJson('/api/v1/calendars/default/feed')->assertCreated()->json();
        $this->assertNotSame($created['httpsUrl'], $republished['httpsUrl']);
        $this->get('/api/v1/calendars/feeds/'.$raw)->assertNotFound();
        $this->get('/api/v1/calendars/feeds/'.$this->tokenFromHttpsUrl($republished['httpsUrl']))
            ->assertOk();
    }

    public function test_subscription_calendars_cannot_be_published(): void
    {
        $this->app->instance(HostIpResolver::class, (new FakeHostIpResolver)
            ->map('feeds.example.test', ['93.184.216.34']));
        Http::preventStrayRequests();
        Http::fake([
            'https://feeds.example.test/holidays.ics' => Http::response($this->sampleIcs(), 200),
        ]);

        $subscription = $this->asBob()->postJson('/api/v1/calendars/subscriptions', [
            'url' => 'https://feeds.example.test/holidays.ics',
        ])->assertCreated()->json();

        $this->asBob()->postJson('/api/v1/calendars/'.$subscription['calendarId'].'/feed')
            ->assertForbidden();
    }

    public function test_group_calendars_cannot_be_published(): void
    {
        $this->asBob()->postJson('/api/v1/calendars/group-team/feed')->assertForbidden();
    }

    public function test_other_users_cannot_manage_the_feed(): void
    {
        $this->asBob()->postJson('/api/v1/calendars/default/feed')->assertCreated();

        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->getJson('/api/v1/calendars/default/feed')
            ->assertNotFound();
        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->deleteJson('/api/v1/calendars/default/feed')
            ->assertNotFound();
    }

    public function test_public_feed_is_rate_limited(): void
    {
        $created = $this->asBob()->postJson('/api/v1/calendars/default/feed')->assertCreated()->json();
        $raw = $this->tokenFromHttpsUrl($created['httpsUrl']);

        $limiter = $this->app->make(CalendarFeedRateLimiter::class);
        for ($i = 0; $i < 60; $i++) {
            $this->assertTrue($limiter->allow('127.0.0.1', $raw));
        }

        $this->getJson('/api/v1/calendars/feeds/'.$raw)
            ->assertStatus(429)
            ->assertJsonPath('code', 'throttled');
    }

    public function test_unauthenticated_owner_feed_routes_are_401(): void
    {
        $this->getJson('/api/v1/calendars/default/feed')->assertUnauthorized();
        $this->postJson('/api/v1/calendars/default/feed')->assertUnauthorized();
        $this->deleteJson('/api/v1/calendars/default/feed')->assertUnauthorized();
    }

    private function asBob(): self
    {
        return $this->withBearer($this->userBearerToken());
    }

    private function tokenFromHttpsUrl(string $httpsUrl): string
    {
        $token = basename(parse_url($httpsUrl, PHP_URL_PATH) ?: '');
        $this->assertNotSame('', $token);

        return $token;
    }
}
