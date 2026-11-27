<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarAvailabilityLink;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Models\User;
use App\Services\Calendars\Availability\AvailabilitySettings;
use Illuminate\Support\Facades\RateLimiter;
use Sabre\VObject\Reader;
use Tests\Support\AvailabilityTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #2405: the owner's public availability link and the feed behind it. The
 * owner is carol, who never switches Team sharing on: the link is independent.
 */
final class AvailabilityPublicLinkTest extends WgwDatabaseTestCase
{
    use AvailabilityTestFixtures;

    private const LINK = '/api/v1/calendars/availability/public-link';

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAvailabilityFixtures();
        $this->token = $this->issueBearerTokenFor('carol');
        RateLimiter::clear('availability-feed-ip:127.0.0.1');
        RateLimiter::clear('availability-feed-miss:127.0.0.1');
    }

    protected function tearDown(): void
    {
        $this->tearDownAvailabilityFixtures();
        parent::tearDown();
    }

    public function test_the_link_is_off_until_turned_on(): void
    {
        $this->assertSame(['enabled' => false], $this->withBearer($this->token)->getJson(self::LINK)->assertOk()->json());
        $this->assertSame(0, CalendarAvailabilityLink::query()->count());
    }

    public function test_turning_on_twice_returns_the_same_link(): void
    {
        $first = $this->withBearer($this->token)->postJson(self::LINK)->assertCreated()->json();
        $second = $this->withBearer($this->token)->postJson(self::LINK)->assertOk()->json();
        $shown = $this->withBearer($this->token)->getJson(self::LINK)->assertOk()->json();

        $this->assertSame($first, $second);
        $this->assertSame($first, $shown);
        $this->assertTrue($first['enabled']);
        $this->assertMatchesRegularExpression('#^https?://.+/api/v1/calendars/availability/feeds/[a-z0-9]{48}$#', $first['httpsUrl']);
        $this->assertMatchesRegularExpression('#^webcal://.+/api/v1/calendars/availability/feeds/[a-z0-9]{48}$#', $first['webcalUrl']);
    }

    public function test_the_token_is_stored_hashed_and_encrypted(): void
    {
        $url = $this->withBearer($this->token)->postJson(self::LINK)->json('httpsUrl');
        $raw = basename($url);
        $row = CalendarAvailabilityLink::query()->firstOrFail();

        $this->assertSame(hash('sha256', $raw), $row->token_hash);
        $stored = (string) CalendarAvailabilityLink::query()->toBase()->value('token_cipher');
        $this->assertStringNotContainsString($raw, $stored);
        $this->assertSame($raw, $row->token_cipher);
    }

    public function test_the_link_needs_a_signed_in_user(): void
    {
        $this->getJson(self::LINK)->assertUnauthorized();
        $this->postJson(self::LINK)->assertUnauthorized();
        $this->putJson(self::LINK)->assertUnauthorized();
        $this->deleteJson(self::LINK)->assertUnauthorized();
    }

    public function test_people_have_their_own_link(): void
    {
        $this->withBearer($this->token)->postJson(self::LINK)->assertCreated();
        $bob = $this->issueBearerTokenFor('bob');

        $this->assertSame(['enabled' => false], $this->withBearer($bob)->getJson(self::LINK)->json());
    }

    public function test_the_feed_shows_merged_busy_blocks_for_the_next_weeks(): void
    {
        $day = self::monday() + 86400;
        $this->seedBusy('carol', 'a', $day + 36000, $day + 39600);
        $this->seedBusy('carol', 'b', $day + 38000, $day + 43200);
        $this->seedBusy('carol', 'c', $day + 43200, $day + 46800);
        $this->seedBusy('carol', 'd', $day + 4 * 86400 + 32400, $day + 4 * 86400 + 36000);
        $feed = $this->feed($this->publicUrl());

        $this->assertSame([
            [gmdate('Ymd\THis\Z', $day + 36000), gmdate('Ymd\THis\Z', $day + 46800)],
            [gmdate('Ymd\THis\Z', $day + 4 * 86400 + 32400), gmdate('Ymd\THis\Z', $day + 4 * 86400 + 36000)],
        ], $feed);
    }

    public function test_free_cancelled_and_do_not_add_never_show(): void
    {
        $day = self::monday() + 86400;
        $this->seedBusy('carol', 'busy', $day + 36000, $day + 39600);
        $this->seedBusy('carol', 'free', $day + 50000, $day + 53000, ['TRANSP:TRANSPARENT']);
        $this->seedBusy('carol', 'cancelled', $day + 60000, $day + 63000, ['STATUS:CANCELLED']);
        $this->seedNamedCalendarFor('carol', 'work', 'Work');
        $this->seedBusy('carol', 'excluded', $day + 70000, $day + 73000, [], 'work');
        app(AvailabilitySettings::class)->setPref('carol', $this->calendarIdOf('work'), false, null);

        $this->assertSame(
            [[gmdate('Ymd\THis\Z', $day + 36000), gmdate('Ymd\THis\Z', $day + 39600)]],
            $this->feed($this->publicUrl()),
        );
    }

    public function test_the_feed_works_with_the_team_switch_off_and_follows_it_never(): void
    {
        $day = self::monday() + 86400;
        $this->seedBusy('carol', 'a', $day + 36000, $day + 39600);
        $url = $this->publicUrl();
        $this->assertFalse(app(AvailabilitySettings::class)->isEnabled('carol'));

        $this->assertCount(1, $this->feed($url));
        app(AvailabilitySettings::class)->setEnabled('carol', true);
        app(AvailabilitySettings::class)->setEnabled('carol', false);
        $this->assertCount(1, $this->feed($url));
    }

    public function test_titles_and_locations_stay_hidden_even_with_details_chosen(): void
    {
        $day = self::monday() + 86400;
        $this->seedBusy('carol', 'a', $day + 36000, $day + 39600, ['SUMMARY:Board meeting', 'LOCATION:Room 4']);
        app(AvailabilitySettings::class)->setPref('carol', $this->calendarIdOf('default'), true, AvailabilitySettings::DETAIL_DETAILS);

        $body = $this->get($this->publicUrl())->assertOk()->getContent();

        $this->assertStringNotContainsString('Board', (string) $body);
        $this->assertStringNotContainsString('Room 4', (string) $body);
    }

    public function test_regenerate_ends_old_url(): void
    {
        $old = $this->publicUrl();
        $new = $this->withBearer($this->token)->putJson(self::LINK)->assertOk()->json('httpsUrl');

        $this->assertNotSame($old, $new);
        $this->get($old)->assertNotFound();
        $this->get($new)->assertOk();
        $this->assertSame($new, $this->withBearer($this->token)->getJson(self::LINK)->json('httpsUrl'));
        $this->assertSame(1, CalendarAvailabilityLink::query()->count());
    }

    public function test_regenerate_while_off_is_a_conflict(): void
    {
        $this->withBearer($this->token)->putJson(self::LINK)->assertStatus(409);
        $this->assertSame(0, CalendarAvailabilityLink::query()->count());
    }

    public function test_turning_off_ends_the_url_and_is_idempotent(): void
    {
        $url = $this->publicUrl();
        $this->withBearer($this->token)->deleteJson(self::LINK)->assertNoContent();
        $this->withBearer($this->token)->deleteJson(self::LINK)->assertNoContent();

        $this->get($url)->assertNotFound();
        $this->assertSame(['enabled' => false], $this->withBearer($this->token)->getJson(self::LINK)->json());
        $again = $this->withBearer($this->token)->postJson(self::LINK)->assertCreated()->json('httpsUrl');
        $this->assertNotSame($url, $again);
        $this->get($url)->assertNotFound();
    }

    public function test_every_refusal_looks_the_same(): void
    {
        $revoked = $this->publicUrl();
        $this->withBearer($this->token)->deleteJson(self::LINK)->assertNoContent();
        $disabledUrl = $this->withBearer($this->issueBearerTokenFor('bob'))->postJson(self::LINK)->json('httpsUrl');
        User::query()->where('username', 'bob')->update(['enabled' => false]);

        $bodies = [];
        foreach ([$revoked, $disabledUrl, str_replace(basename($revoked), str_repeat('a', 48), $revoked), $revoked.'x.ics'] as $url) {
            $response = $this->get($url)->assertNotFound();
            $bodies[] = $response->getContent();
        }
        $this->assertCount(1, array_unique($bodies));
    }

    public function test_the_dot_ics_suffix_is_accepted(): void
    {
        $this->get($this->publicUrl().'.ics')->assertOk();
    }

    public function test_etag_answers_not_modified_and_the_response_is_not_cached(): void
    {
        $day = self::monday() + 86400;
        $this->seedBusy('carol', 'a', $day + 36000, $day + 39600);
        $url = $this->publicUrl();

        $first = $this->get($url)->assertOk();
        $etag = (string) $first->headers->get('ETag');
        $this->assertNotSame('', $etag);
        $this->assertStringContainsString('no-cache', (string) $first->headers->get('Cache-Control'));
        $this->assertSame('noindex', $first->headers->get('X-Robots-Tag'));
        $this->assertStringStartsWith('text/calendar', (string) $first->headers->get('Content-Type'));
        $this->assertStringContainsString('availability.ics', (string) $first->headers->get('Content-Disposition'));
        $this->withHeaders(['If-None-Match' => $etag])->get($url)->assertStatus(304);

        $this->seedBusy('carol', 'b', $day + 50000, $day + 53000);
        $this->withHeaders(['If-None-Match' => $etag])->get($url)->assertOk();
    }

    public function test_the_calendar_name_is_the_owners_display_name_and_availability(): void
    {
        Principal::forUsername('carol')->update(['displayname' => 'Carol Example']);
        $body = $this->get($this->publicUrl())->assertOk()->getContent();

        $this->assertStringContainsString("X-WR-CALNAME:Carol Example's Availability", $body);
        $this->assertStringContainsString("NAME:Carol Example's Availability", $body);
    }

    public function test_the_calendar_name_is_plain_availability_without_a_display_name(): void
    {
        Principal::forUsername('carol')->update(['displayname' => '']);
        $body = $this->get($this->publicUrl())->assertOk()->getContent();

        $this->assertStringContainsString('X-WR-CALNAME:Availability', $body);
    }

    public function test_an_incomplete_week_fails_instead_of_showing_free_time(): void
    {
        $day = self::monday() + 86400;
        $this->seedBusy('carol', 'huge', $day + 36000, $day + 39600, ['DESCRIPTION:'.str_repeat('y', 600_000)]);

        $this->get($this->publicUrl())->assertStatus(503)->assertHeader('Retry-After');
    }

    public function test_guessing_tokens_is_limited_per_address_before_any_work(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->get('/api/v1/calendars/availability/feeds/'.str_repeat('b', 47).($i % 10))->assertNotFound();
        }
        $url = $this->publicUrl();

        $response = $this->get($url)->assertStatus(429);
        $this->assertGreaterThan(0, (int) $response->headers->get('Retry-After'));
        $this->assertSame('rate_limited', $response->json('code'));
    }

    public function test_a_calendar_without_busy_time_is_a_valid_empty_feed(): void
    {
        $this->assertSame([], $this->feed($this->publicUrl()));
    }

    public function test_the_calendar_app_routes_do_not_swallow_the_link_path(): void
    {
        $this->withBearer($this->token)->getJson('/api/v1/calendars/availability/feed')->assertStatus(404);
        $this->withBearer($this->token)->getJson(self::LINK)->assertOk();
    }

    /** Monday 00:00 UTC of the current week. */
    private static function monday(): int
    {
        $now = time();

        return gmmktime(0, 0, 0, (int) gmdate('n', $now), (int) gmdate('j', $now) - ((int) gmdate('N', $now) - 1), (int) gmdate('Y', $now));
    }

    private function publicUrl(): string
    {
        $url = $this->withBearer($this->token)->postJson(self::LINK)->json('httpsUrl');
        $this->assertIsString($url);

        return $url;
    }

    /**
     * @return list<array{0: string, 1: string}> DTSTART and DTEND of every VEVENT
     */
    private function feed(string $url): array
    {
        $body = (string) $this->get($url)->assertOk()->getContent();
        $calendar = Reader::read($body);
        $blocks = [];
        foreach ($calendar->select('VEVENT') as $event) {
            $blocks[] = [(string) $event->DTSTART, (string) $event->DTEND];
        }

        return $blocks;
    }

    /**
     * @param  list<string>  $lines
     */
    private function seedBusy(string $owner, string $uid, int $start, int $end, array $lines = [], string $calendar = 'default'): void
    {
        $this->seedEventViaPdo(
            $owner,
            "{$uid}.ics",
            $this->eventIcs($uid, ':'.gmdate('Ymd\THis\Z', $start), ':'.gmdate('Ymd\THis\Z', $end), $lines),
            $calendar,
        );
    }

    private function calendarIdOf(string $uri): int
    {
        return (int) CalendarInstance::query()->where('principaluri', 'principals/carol')->where('uri', $uri)->value('calendarid');
    }
}
