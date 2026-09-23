<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use App\Services\Mail\MailUserRuntime;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailStatusTest extends WgwDatabaseTestCase
{
    use MailTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMailFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownMailFixtures();
        parent::tearDown();
    }

    public function test_status_without_servers_or_account_config(): void
    {
        $response = $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status');

        $response->assertOk()
            ->assertJsonPath('instanceEnabled', true)
            ->assertJsonPath('serversConfigured', false)
            ->assertJsonPath('accountConfigured', false)
            ->assertJsonPath('ready', false)
            ->assertJsonPath('configured', false)
            ->assertJsonPath('error', MailUserRuntime::ERROR_SETTINGS_MISSING);
    }

    public function test_status_with_servers_but_no_user_credentials(): void
    {
        $response = $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status');

        $response->assertOk()
            ->assertJsonPath('serversConfigured', false)
            ->assertJsonPath('accountConfigured', false)
            ->assertJsonPath('ready', false)
            ->assertJsonPath('configured', false)
            ->assertJsonPath('error', MailUserRuntime::ERROR_SETTINGS_MISSING);
    }

    public function test_status_with_servers_and_user_credentials(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $response = $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status');

        $response->assertOk()
            ->assertJsonPath('serversConfigured', true)
            ->assertJsonPath('accountConfigured', true)
            ->assertJsonPath('configured', true)
            ->assertJsonPath('extImap', extension_loaded('imap'));
        if (extension_loaded('imap')) {
            $response->assertJsonPath('error', null);
        }
    }

    public function test_status_is_self_scoped_per_user_credentials(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status')
            ->assertOk()
            ->assertJsonPath('accountConfigured', true);

        $this->withBearer($this->adminBearerToken())->getJson('/api/v1/mail/status')
            ->assertOk()
            ->assertJsonPath('accountConfigured', false)
            ->assertJsonPath('error', MailUserRuntime::ERROR_SETTINGS_MISSING);
    }

    public function test_status_includes_smtp_endpoint_metadata_when_user_mailbox_configured(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret', [
            'smtpHost' => 'smtp.user-a.test',
            'smtpPort' => 2525,
            'smtpSecurity' => 'none',
        ]);

        $response = $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status');

        $response->assertOk()
            ->assertJsonPath('smtp.host', 'smtp.user-a.test')
            ->assertJsonPath('smtp.port', 2525)
            ->assertJsonPath('smtp.security', 'none')
            ->assertJsonStructure(['smtp' => ['tcpReachable']]);
    }

    public function test_status_stays_not_configured_when_user_has_no_mailbox(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->adminBearerToken())->getJson('/api/v1/mail/status')
            ->assertOk()
            ->assertJsonPath('instanceEnabled', true)
            ->assertJsonPath('accountConfigured', false)
            ->assertJsonPath('error', MailUserRuntime::ERROR_SETTINGS_MISSING);
    }
}
