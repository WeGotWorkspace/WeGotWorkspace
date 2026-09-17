<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Mail\ImapExtension;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Shared-hosting degradation path: ext-imap is optional (absent on many
 * shared hosts), so mail must stay non-fatal. GET /mail/status advertises
 * `extImap: false` and the JMAP session omits the mail URN.
 */
final class MailImapUnavailableTest extends WgwDatabaseTestCase
{
    use MailTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMailFixtures();
        ImapExtension::fakeLoaded(false);
    }

    protected function tearDown(): void
    {
        ImapExtension::fakeLoaded(null);
        $this->tearDownMailFixtures();
        parent::tearDown();
    }

    public function test_status_stays_200_and_reports_ext_imap_false(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status')
            ->assertOk()
            ->assertJsonPath('extImap', false)
            ->assertJsonPath('ready', false)
            ->assertJsonPath('accountConfigured', true);
    }

    public function test_jmap_session_omits_mail_when_ext_imap_is_missing(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $this->assertArrayNotHasKey(JmapCapabilities::MAIL, $session['capabilities']);
        $this->assertArrayNotHasKey(JmapCapabilities::SUBMISSION, $session['capabilities']);
    }
}
