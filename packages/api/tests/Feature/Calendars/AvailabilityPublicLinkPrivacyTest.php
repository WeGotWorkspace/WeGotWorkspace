<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarInstance;
use App\Services\Calendars\Availability\AvailabilityCalculator;
use App\Services\Calendars\Availability\AvailabilitySettings;
use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Property;
use Sabre\VObject\Reader;
use Tests\Support\AvailabilityTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #2405 privacy: the public feed carries busy start and end and nothing else.
 * Events are loaded with every property a calendar app can write, and the
 * feed is checked three ways: the exact property list of every component, the
 * absence of every secret string in the raw body, and the UID rule.
 */
final class AvailabilityPublicLinkPrivacyTest extends WgwDatabaseTestCase
{
    use AvailabilityTestFixtures;

    private const SECRETS = [
        'secret-uid-7731', 'Quarterly layoffs', 'Room 4', 'carol@', 'mallory@', 'Bring the NDA', 'meet.example.test',
        'X-WGW', 'ORGANIZER', 'ATTENDEE', 'DESCRIPTION', 'LOCATION', 'ATTACH', 'VALARM', 'RRULE', 'CATEGORIES',
        'TZID', 'VTIMEZONE', 'GEO', 'URL', 'CONFERENCE',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAvailabilityFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownAvailabilityFixtures();
        parent::tearDown();
    }

    public function test_feed_contains_only_busy_start_and_end(): void
    {
        $body = $this->feedBodyWithLoadedEvents();
        $calendar = Reader::read($body);
        $this->assertInstanceOf(VCalendar::class, $calendar);

        $this->assertEqualsCanonicalizing(['PRODID', 'VERSION', 'CALSCALE', 'X-WR-CALNAME', 'REFRESH-INTERVAL', 'X-PUBLISHED-TTL'], array_values(array_unique($this->names($calendar))));
        $events = $calendar->select('VEVENT');
        $this->assertNotEmpty($events);
        foreach ($events as $event) {
            $this->assertEqualsCanonicalizing(
                ['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'TRANSP', 'CLASS'],
                $this->names($event),
            );
            $this->assertSame('Busy', (string) $event->SUMMARY);
            $this->assertSame('OPAQUE', (string) $event->TRANSP);
            $this->assertMatchesRegularExpression('/^\d{8}T\d{6}Z$/', (string) $event->DTSTART);
            $this->assertMatchesRegularExpression('/^\d{8}T\d{6}Z$/', (string) $event->DTEND);
            $this->assertNull($event->DTSTART['TZID']);
        }
        foreach (['VTIMEZONE', 'VTODO', 'VJOURNAL', 'VFREEBUSY', 'VALARM'] as $component) {
            $this->assertCount(0, $calendar->select($component));
        }
    }

    public function test_no_secret_reaches_the_raw_body(): void
    {
        $body = $this->feedBodyWithLoadedEvents();

        foreach (self::SECRETS as $secret) {
            $this->assertStringNotContainsStringIgnoringCase($secret, $body, "leaked: {$secret}");
        }
    }

    public function test_uids_are_derived_from_the_link_not_the_event(): void
    {
        $first = $this->feedBodyWithLoadedEvents();
        preg_match_all('/^UID:(.+)$/m', $first, $uids);
        $this->assertNotEmpty($uids[1]);
        foreach ($uids[1] as $uid) {
            $this->assertMatchesRegularExpression('/^[a-f0-9]{32}@availability$/', trim($uid));
        }
        $this->assertSame(count($uids[1]), count(array_unique($uids[1])));

        // A new link changes every UID: they cannot be correlated across links.
        $token = $this->issueBearerTokenFor('carol');
        $new = $this->withBearer($token)->putJson('/api/v1/calendars/availability/public-link')->json('httpsUrl');
        preg_match_all('/^UID:(.+)$/m', (string) $this->get($new)->assertOk()->getContent(), $renewed);
        $this->assertSame([], array_intersect($uids[1], $renewed[1]));
    }

    public function test_adjacent_and_overlapping_events_cannot_be_told_apart(): void
    {
        $day = self::monday() + 86400;
        foreach ([[36000, 39600], [39600, 43200], [41000, 45000]] as $i => [$from, $to]) {
            $this->seedCarol("m{$i}", $day + $from, $day + $to);
        }
        $calendar = Reader::read($this->feedBody());

        $this->assertCount(1, $calendar->select('VEVENT'));
    }

    public function test_the_public_result_is_the_team_result_without_titles(): void
    {
        $day = self::monday() + 86400;
        $this->seedCarol('x', $day + 36000, $day + 39600, ['SUMMARY:Quarterly layoffs']);
        $this->seedCarol('y', $day + 50000, $day + 52000, ['TRANSP:TRANSPARENT']);
        app(AvailabilitySettings::class)->setEnabled('carol', true);
        app(AvailabilitySettings::class)->setPref('carol', (int) CalendarInstance::query()->where('principaluri', 'principals/carol')->where('uri', 'default')->value('calendarid'), true, AvailabilitySettings::DETAIL_DETAILS);
        $weeks = [self::monday()];

        $team = app(AvailabilityCalculator::class)->busyPeriods('carol', $weeks);
        $public = app(AvailabilityCalculator::class)->publicBusyPeriods('carol', $weeks);

        $this->assertNotNull($team);
        $this->assertSame('Quarterly layoffs', $team->periods()[0]['title'] ?? null);
        $this->assertArrayNotHasKey('title', $public->periods()[0]);
        $this->assertArrayNotHasKey('location', $public->periods()[0]);
        $strip = static fn (array $entries): array => array_map(static fn (array $entry): array => [$entry['utcStart'], $entry['utcEnd']], $entries);
        $this->assertSame($strip($team->entries), $strip($public->entries));
    }

    private function feedBodyWithLoadedEvents(): string
    {
        $day = self::monday() + 86400;
        $loaded = [
            'SUMMARY:Quarterly layoffs', 'LOCATION:Room 4', 'DESCRIPTION:Bring the NDA', 'CLASS:CONFIDENTIAL',
            'ORGANIZER;CN=Carol:mailto:carol@example.test', 'ATTENDEE;CN=Mallory:mailto:mallory@example.test',
            'CATEGORIES:finance', 'GEO:52.37;4.89', 'URL:https://meet.example.test/x', 'CONFERENCE;VALUE=URI:https://meet.example.test/y',
            'X-WGW-SECRET:1', 'ATTACH:https://meet.example.test/file.pdf',
        ];
        $this->seedCarol('secret-uid-7731', $day + 36000, $day + 39600, $loaded);
        $this->seedCarol('series', $day + 50000, $day + 53000, ['SUMMARY:Quarterly layoffs', 'RRULE:FREQ=DAILY;COUNT=3', 'LOCATION:Room 4']);
        $this->seedCarol('zoned', $day + 20 * 86400, $day + 20 * 86400 + 3600, ['SUMMARY:Quarterly layoffs']);

        return $this->feedBody();
    }

    private function feedBody(): string
    {
        $token = $this->issueBearerTokenFor('carol');
        $url = $this->withBearer($token)->postJson('/api/v1/calendars/availability/public-link')->json('httpsUrl');

        return (string) $this->get($url)->assertOk()->getContent();
    }

    /**
     * @param  list<string>  $lines
     */
    private function seedCarol(string $uid, int $start, int $end, array $lines = []): void
    {
        $this->seedEventViaPdo(
            'carol',
            "{$uid}.ics",
            $this->eventIcs($uid, ':'.gmdate('Ymd\THis\Z', $start), ':'.gmdate('Ymd\THis\Z', $end), $lines),
        );
    }

    /**
     * @return list<string>
     */
    private function names(Component $component): array
    {
        $names = [];
        foreach ($component->children() as $child) {
            if ($child instanceof Property) {
                $names[] = $child->name;
            }
        }

        return $names;
    }

    private static function monday(): int
    {
        $now = time();

        return gmmktime(0, 0, 0, (int) gmdate('n', $now), (int) gmdate('j', $now) - ((int) gmdate('N', $now) - 1), (int) gmdate('Y', $now));
    }
}
