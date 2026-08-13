<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use App\Services\Mail\ImapExtension;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Shared-hosting degradation path: ext-imap is optional (absent on many
 * shared hosts), so mail endpoints must answer 503 `imap_extension_required`
 * — never fatal — and /mail/status must advertise `extImap: false` so the
 * client can disable the Mail app. Pinned via ImapExtension::fakeLoaded()
 * because the extension itself cannot be unloaded at runtime.
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

    public function test_imap_endpoints_return_503_extension_required_even_with_credentials(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');
        $token = $this->userBearerToken();

        $this->withBearer($token)->getJson('/api/v1/mail/folders')
            ->assertStatus(503)
            ->assertJson(['error' => 'imap_extension_required']);

        $this->withBearer($token)->getJson('/api/v1/mail/messages?folder='.$this->inboxFolderToken())
            ->assertStatus(503)
            ->assertJson(['error' => 'imap_extension_required']);
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
}
