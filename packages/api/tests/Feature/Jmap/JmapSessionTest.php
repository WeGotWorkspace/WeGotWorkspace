<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\Capabilities\JmapCapabilitySet;
use App\Services\Jmap\JmapCapabilities;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * JMAP Session resource shape (RFC 8620 §2), cross-checked field-by-field
 * against the shipped client's JmapSession/JmapAccount types
 * (lit-calendar packages/jmap-client/src/core/types.ts, quoted in spec §Ground-truth contracts).
 */
final class JmapSessionTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_session_requires_authentication(): void
    {
        $this->getJson('/api/v1/jmap/session')->assertUnauthorized();
    }

    public function test_session_satisfies_the_client_jmap_session_type(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk();

        $session = $response->json();

        // Every JmapSession field present with the right type.
        foreach (['capabilities', 'accounts', 'primaryAccounts'] as $field) {
            $this->assertIsArray($session[$field], $field);
        }
        foreach (['username', 'apiUrl', 'downloadUrl', 'uploadUrl', 'eventSourceUrl', 'state'] as $field) {
            $this->assertIsString($session[$field], $field);
            $this->assertNotSame('', $session[$field], $field);
        }

        $this->assertSame('bob', $session['username']);
        // Derived session state: document version + enabled-capability digest.
        $this->assertSame(app(JmapCapabilitySet::class)->sessionState(), $session['state']);
        $this->assertStringStartsWith(JmapCapabilities::SESSION_STATE.';', $session['state']);
    }

    public function test_session_capability_placement_follows_draft_27(): void
    {
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();

        // connect() key-checks both URNs on session.capabilities.
        $this->assertArrayHasKey(JmapCapabilities::CORE, $session['capabilities']);
        $this->assertArrayHasKey(JmapCapabilities::CALENDARS, $session['capabilities']);

        $core = $session['capabilities'][JmapCapabilities::CORE];
        foreach ([
            'maxSizeUpload', 'maxConcurrentUpload', 'maxSizeRequest', 'maxConcurrentRequests',
            'maxCallsInRequest', 'maxObjectsInGet', 'maxObjectsInSet', 'collationAlgorithms',
        ] as $field) {
            $this->assertArrayHasKey($field, $core, $field);
        }
        $this->assertSame(JmapCapabilities::MAX_CALLS_IN_REQUEST, $core['maxCallsInRequest']);

        // Session-level calendars capability is the EMPTY object (draft-27 §1.5.1);
        // the six-property object lives at the account level.
        $this->assertSame([], $session['capabilities'][JmapCapabilities::CALENDARS]);

        $account = $session['accounts']['bob'];
        $this->assertSame('bob', $account['name']);
        $this->assertTrue($account['isPersonal']);
        $this->assertFalse($account['isReadOnly']);
        $calendarsCapability = $account['accountCapabilities'][JmapCapabilities::CALENDARS];
        foreach ([
            'maxCalendarsPerEvent', 'minDateTime', 'maxDateTime',
            'maxExpandedQueryDuration', 'maxParticipantsPerEvent', 'mayCreateCalendar',
        ] as $field) {
            $this->assertArrayHasKey($field, $calendarsCapability, $field);
        }
        $this->assertSame(1, $calendarsCapability['maxCalendarsPerEvent']);
        $this->assertTrue($calendarsCapability['mayCreateCalendar']);
    }

    public function test_account_id_is_the_raw_username_in_primary_accounts(): void
    {
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();

        // The adapter derives its accountId from primaryAccounts[calendars URN].
        $this->assertSame('bob', $session['primaryAccounts'][JmapCapabilities::CORE]);
        $this->assertSame('bob', $session['primaryAccounts'][JmapCapabilities::CALENDARS]);
        $this->assertArrayHasKey('bob', $session['accounts']);
    }

    public function test_session_urls_are_absolute(): void
    {
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();

        // The client fetches apiUrl verbatim with no base-URL resolution.
        foreach (['apiUrl', 'downloadUrl', 'uploadUrl', 'eventSourceUrl'] as $field) {
            $this->assertMatchesRegularExpression('#^https?://#', $session[$field], $field);
        }
        $this->assertStringEndsWith('/api/v1/jmap', $session['apiUrl']);
        $this->assertStringContainsString('/jmap/download/{accountId}/{blobId}/{name}?type={type}', $session['downloadUrl']);
        $this->assertStringContainsString('/jmap/upload/{accountId}', $session['uploadUrl']);
        $this->assertStringContainsString('/jmap/events/{types}/{closeafter}/{ping}', $session['eventSourceUrl']);
    }

    public function test_blob_urls_are_live_and_only_push_stays_stubbed(): void
    {
        $token = $this->userBearerToken();

        // Upload/download are real since #438 (JmapBlobsTest covers them);
        // an unknown blobId is 404, not 501.
        $this->withBearer($token)
            ->getJson('/api/v1/jmap/download/bob/blob-1/file.ics')
            ->assertStatus(404);
        // Push (RFC 8620 §7) stays an explicit non-goal.
        $this->withBearer($token)
            ->getJson('/api/v1/jmap/events/CalendarEvent/0/0')
            ->assertStatus(501);
    }
}
