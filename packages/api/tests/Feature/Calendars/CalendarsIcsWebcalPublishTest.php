<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarFeedToken;
use App\Models\CalendarSubscription;
use App\Models\Principal;
use App\Services\Calendars\CalendarFeedRateLimiter;
use App\Services\Calendars\HostIpResolver;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Reader;
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

    public function test_personal_calendar_stays_publishable_when_another_user_subscribed_the_same_uri(): void
    {
        $this->seedNamedCalendarFor('bob', 'work', 'Work');
        $this->seedNamedCalendarFor('carol', 'work', 'Work');
        CalendarSubscription::query()->create([
            'id' => (string) Str::uuid(),
            'username' => 'bob',
            'calendar_uri' => 'work',
            'url' => 'https://feeds.example.test/holidays.ics',
            'name' => 'Work',
            'last_fetched_at' => now(),
        ]);

        $this->asBob()->postJson('/api/v1/calendars/work/feed')->assertForbidden();
        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->postJson('/api/v1/calendars/work/feed')
            ->assertCreated();
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

    public function test_group_members_can_publish_group_calendar_feeds(): void
    {
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($team, $bob);

        $this->asBob()->postJson('/api/v1/calendars/group-team/feed')->assertCreated();
        $this->withBearer($this->issueBearerTokenFor('carol'))
            ->postJson('/api/v1/calendars/group-team/feed')
            ->assertNotFound();
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

    public function test_public_feed_omits_people_alarms_vendor_fields_and_meet_urls(): void
    {
        $this->seedEventViaPdo('bob', 'public-detail.ics', $this->publicDetailIcs());

        $this->seedEventViaPdo('bob', 'zoom-only.ics', $this->zoomOnlyIcs());

        $ics = $this->publishAndDownload();
        $events = $this->eventsByUid($ics);
        $event = $events['public-detail@example.test'];

        $this->assertNull($event->ATTENDEE);
        $this->assertNull($event->ORGANIZER);
        $this->assertNull($event->CONTACT);
        $this->assertNull($event->VALARM);
        $this->assertNull($event->ATTACH);
        $this->assertNull($event->{'X-WGW-NOTE'});
        $this->assertNull($event->CONFERENCE);
        $this->assertNull($event->{'X-GOOGLE-CONFERENCE'});
        $this->assertNull($event->{'X-MICROSOFT-SKYPETEAMSMEETINGURL'});
        $this->assertSame('Public standup', $event->SUMMARY->getValue());
        $this->assertSame('Agenda lives on the external site', $event->DESCRIPTION->getValue());
        $this->assertSame('Library', $event->LOCATION->getValue());
        $this->assertSame('https://notes.example.test/agenda', $event->URL->getValue());
        $this->assertStringNotContainsString('attendee-hidden@example.test', $ics);
        $this->assertStringNotContainsString('folded-attendee@example.test', $ics);
        $this->assertStringNotContainsString('organizer-hidden@example.test', $ics);
        $this->assertStringNotContainsString('hidden-contact@example.test', $ics);
        $this->assertStringNotContainsString('vendor-prop-token', $ics);
        $this->assertStringNotContainsString('vendor-param-token', $ics);
        $this->assertStringNotContainsString('board-room', $ics);
        $this->assertStringNotContainsString('secret-token', $ics);
        $this->assertStringNotContainsString('secret-teams', $ics);
        $this->assertStringNotContainsString('secret-attachment', $ics);
        $this->assertStringNotContainsString('BEGIN:VALARM', $ics);
        $this->assertStringNotContainsString('Alarm text token', $ics);

        $zoomOnly = $events['zoom-only@example.test'];
        $this->assertSame('External call', $zoomOnly->SUMMARY->getValue());
        $this->assertNull($zoomOnly->URL);
        $this->assertStringNotContainsString('zoom-only-secret', $ics);
    }

    public function test_private_and_confidential_events_become_busy_placeholders(): void
    {
        $this->seedEventViaPdo('bob', 'private-board.ics', $this->privateBoardIcs());
        $this->seedEventViaPdo('bob', 'confidential-hiring.ics', $this->confidentialHiringIcs());
        $this->seedEventViaPdo('bob', 'not-private.ics', $this->notPrivateClassIcs());

        $ics = $this->publishAndDownload();
        $events = $this->eventsByUid($ics);

        $private = $events['private-board@example.test'];
        $this->assertSame('Busy', $private->SUMMARY->getValue());
        $this->assertNull($private->DESCRIPTION);
        $this->assertNull($private->LOCATION);
        $this->assertNull($private->ATTENDEE);
        $this->assertNull($private->ORGANIZER);
        $this->assertNull($private->CLASS);
        $this->assertNull($private->URL);
        $this->assertSame('private-board@example.test', $private->UID->getValue());
        $this->assertNotNull($private->DTSTART);
        $this->assertNotNull($private->DTEND);
        $this->assertNotNull($private->RRULE);
        $this->assertNotNull($private->EXDATE);
        $this->assertNotNull($private->DTSTAMP);
        $this->assertSame(3, $private->SEQUENCE->getValue());
        $this->assertSame('CANCELLED', $private->STATUS->getValue());
        $this->assertSame('TRANSPARENT', $private->TRANSP->getValue());
        $tzid = $private->DTSTART['TZID'];
        $this->assertNotNull($tzid);
        $this->assertSame('Europe/Amsterdam', $tzid->getValue());
        $this->assertStringNotContainsString('secret-board-notes@example.test', $private->serialize());
        $this->assertStringNotContainsString('secret-room', $private->serialize());

        $confidential = $events['confidential-hiring@example.test'];
        $this->assertSame('Busy', $confidential->SUMMARY->getValue());
        $this->assertNull($confidential->DESCRIPTION);
        $this->assertNull($confidential->CLASS);
        $this->assertNotNull($confidential->{'RECURRENCE-ID'});
        $this->assertStringNotContainsString('hiring-secret', $confidential->serialize());

        $unknownClass = $events['not-private@example.test'];
        $this->assertSame('Busy', $unknownClass->SUMMARY->getValue());
        $this->assertNull($unknownClass->DESCRIPTION);
        $this->assertStringNotContainsString('Not actually private', $ics);
        $this->assertSame('Published Meeting', $events['pub-event@example.test']->SUMMARY->getValue());
    }

    public function test_busy_mode_hides_every_event_and_ignores_a_query_mode(): void
    {
        $this->seedEventViaPdo('bob', 'public-detail.ics', $this->publicDetailIcs());

        $created = $this->asBob()
            ->postJson('/api/v1/calendars/default/feed?mode=full', ['mode' => 'busy'])
            ->assertCreated()
            ->json();
        $this->assertSame('busy', $created['mode']);

        $raw = $this->tokenFromHttpsUrl($created['httpsUrl']);
        $ics = $this->get('/api/v1/calendars/feeds/'.$raw.'?mode=full')->assertOk()->getContent();
        $events = $this->eventsByUid($ics);

        $this->assertSame('Busy', $events['public-detail@example.test']->SUMMARY->getValue());
        $this->assertSame('Busy', $events['pub-event@example.test']->SUMMARY->getValue());
        $this->assertNull($events['public-detail@example.test']->DESCRIPTION);
        $this->assertNull($events['public-detail@example.test']->ATTENDEE);
        $this->assertStringNotContainsString('Public standup', $ics);
        $this->assertStringNotContainsString('Published Meeting', $ics);
        $this->assertStringNotContainsString('Agenda lives on the external site', $ics);
        $this->assertStringNotContainsString('attendee-hidden@example.test', $ics);

        $this->asBob()->getJson('/api/v1/calendars/default/feed')
            ->assertOk()
            ->assertJsonPath('mode', 'busy')
            ->assertJsonPath('httpsUrl', $created['httpsUrl']);
    }

    public function test_publish_mode_rejects_bypasses_and_updates_the_existing_row(): void
    {
        $this->asBob()->postJson('/api/v1/calendars/default/feed?mode=busy')
            ->assertCreated()
            ->assertJsonPath('mode', 'full');

        $this->asBob()->postJson('/api/v1/calendars/default/feed', ['mode' => 'BUSY'])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
        $this->asBob()->postJson('/api/v1/calendars/default/feed', ['mode' => 'private'])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
        $this->asBob()->postJson('/api/v1/calendars/default/feed', ['mode' => ['busy']])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');
        $this->asBob()->postJson('/api/v1/calendars/default/feed', ['mode' => 'busy', 'url' => 'https://evil.example'])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');

        $updated = $this->asBob()->postJson('/api/v1/calendars/default/feed', ['mode' => 'busy'])
            ->assertOk()
            ->json();
        $this->assertSame('busy', $updated['mode']);

        $this->asBob()->postJson('/api/v1/calendars/default/feed')
            ->assertOk()
            ->assertJsonPath('mode', 'busy')
            ->assertJsonPath('httpsUrl', $updated['httpsUrl']);

        $this->asBob()->postJson('/api/v1/calendars/default/feed', ['mode' => 'full'])
            ->assertOk()
            ->assertJsonPath('mode', 'full')
            ->assertJsonPath('httpsUrl', $updated['httpsUrl']);

        $row = CalendarFeedToken::query()->first();
        $this->assertNotNull($row);
        $this->assertSame('full', (string) $row->mode);
    }

    public function test_unknown_stored_mode_publishes_as_busy(): void
    {
        $created = $this->asBob()->postJson('/api/v1/calendars/default/feed')->assertCreated()->json();
        $row = CalendarFeedToken::query()->first();
        $this->assertNotNull($row);
        $row->mode = 'x-custom';
        $row->save();

        $this->asBob()->getJson('/api/v1/calendars/default/feed')
            ->assertOk()
            ->assertJsonPath('mode', 'busy');

        $ics = $this->get('/api/v1/calendars/feeds/'.$this->tokenFromHttpsUrl($created['httpsUrl']))
            ->assertOk()
            ->getContent();
        $this->assertStringNotContainsString('Published Meeting', $ics);
        $this->assertStringContainsString('SUMMARY:Busy', $ics);
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

    private function publishAndDownload(): string
    {
        $created = $this->asBob()->postJson('/api/v1/calendars/default/feed')->assertCreated()->json();
        $raw = $this->tokenFromHttpsUrl($created['httpsUrl']);

        return $this->get('/api/v1/calendars/feeds/'.$raw)->assertOk()->getContent();
    }

    /**
     * @return array<string, VEvent>
     */
    private function eventsByUid(string $ics): array
    {
        $document = Reader::read($ics);
        $this->assertInstanceOf(VCalendar::class, $document);
        $byUid = [];
        foreach ($document->select('VEVENT') as $vevent) {
            $this->assertInstanceOf(VEvent::class, $vevent);
            $uid = $vevent->UID;
            $this->assertNotNull($uid);
            $byUid[$uid->getValue()] = $vevent;
        }

        return $byUid;
    }

    private function publicDetailIcs(): string
    {
        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:public-detail@example.test',
            'DTSTAMP:20261013T120000Z',
            'DTSTART:20261014T100000Z',
            'DTEND:20261014T110000Z',
            'SUMMARY;X-WGW-SECRET=vendor-param-token:Public standup',
            'DESCRIPTION:Agenda lives on the external site',
            'LOCATION:Library',
            'CLASS:PUBLIC',
            'ORGANIZER;CN=Alice:mailto:organizer-hidden@example.test',
            'ATTENDEE;CN=Bob:mailto:attendee-hidden@example.test',
            'ATTENDEE;CN=Carol;PARTSTAT=ACCEPTED:mailto:folded-atten',
            ' dee@example.test',
            'URL:https://notes.example.test/agenda',
            'URL:https://cal.example.test/meet/board-room',
            'URL:https://zoom.example.test/j/123?pwd=secret-token',
            'URL:https://teams.example.test/secret-teams',
            'CONFERENCE;VALUE=URI:https://zoom.example.test/j/123?pwd=secret-token',
            'X-GOOGLE-CONFERENCE:https://cal.example.test/meet/board-room',
            'X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.example.test/secret-teams',
            'ATTACH;FMTTYPE=application/pdf:https://drive.example.test/files/secret-attachment',
            'CONTACT:mailto:hidden-contact@example.test',
            'X-WGW-NOTE:vendor-prop-token',
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            'DESCRIPTION:Alarm text token',
            'TRIGGER:-PT15M',
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
            '',
        ]);
    }

    private function privateBoardIcs(): string
    {
        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:private-board@example.test',
            'DTSTAMP:20261013T120000Z',
            'SEQUENCE:3',
            'STATUS:CANCELLED',
            'TRANSP:TRANSPARENT',
            'DTSTART;TZID=Europe/Amsterdam:20261015T090000',
            'DTEND;TZID=Europe/Amsterdam:20261015T100000',
            'RRULE:FREQ=WEEKLY;COUNT=4',
            'EXDATE;TZID=Europe/Amsterdam:20261022T090000',
            'SUMMARY:Secret board',
            'DESCRIPTION:secret-board-notes@example.test',
            'LOCATION:Vault',
            'CLASS:PRIVATE',
            'ORGANIZER:mailto:private-org@example.test',
            'ATTENDEE:mailto:private-att@example.test',
            'URL:https://cal.example.test/meet/secret-room',
            'END:VEVENT',
            'END:VCALENDAR',
            '',
        ]);
    }

    private function confidentialHiringIcs(): string
    {
        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:confidential-hiring@example.test',
            'DTSTAMP:20261013T120000Z',
            'DTSTART:20261016T150000Z',
            'DTEND:20261016T160000Z',
            'RECURRENCE-ID:20261016T150000Z',
            'SUMMARY:Confidential hiring',
            'DESCRIPTION:hiring-secret',
            'CLASS;X-EXTRA=1:confidential',
            'END:VEVENT',
            'END:VCALENDAR',
            '',
        ]);
    }

    private function notPrivateClassIcs(): string
    {
        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:not-private@example.test',
            'DTSTAMP:20261013T120000Z',
            'DTSTART:20261017T100000Z',
            'DTEND:20261017T110000Z',
            'SUMMARY:Not actually private',
            'CLASS:PRIVATEEVENT',
            'END:VEVENT',
            'END:VCALENDAR',
            '',
        ]);
    }

    private function zoomOnlyIcs(): string
    {
        return implode("\r\n", [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:zoom-only@example.test',
            'DTSTAMP:20261013T120000Z',
            'DTSTART:20261018T100000Z',
            'DTEND:20261018T110000Z',
            'SUMMARY:External call',
            'URL:https://zoom.example.test/j/999?pwd=zoom-only-secret',
            'END:VEVENT',
            'END:VCALENDAR',
            '',
        ]);
    }
}
