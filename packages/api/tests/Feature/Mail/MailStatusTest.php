<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WithMailClientEnabled;

final class MailStatusTest extends WgwDatabaseTestCase
{
    use MailTestFixtures;
    use WithMailClientEnabled;

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
        $this->clearMailServerSettings();

        $response = $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status');

        $response->assertOk()
            ->assertJsonPath('serversConfigured', false)
            ->assertJsonPath('accountConfigured', false)
            ->assertJsonPath('ready', false)
            ->assertJsonPath('configured', false);
    }

    public function test_status_with_servers_but_no_user_credentials(): void
    {
        $response = $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status');

        $response->assertOk()
            ->assertJsonPath('serversConfigured', true)
            ->assertJsonPath('accountConfigured', false)
            ->assertJsonPath('ready', false)
            ->assertJsonPath('configured', false);
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
    }

    public function test_status_is_self_scoped_per_user_credentials(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status')
            ->assertOk()
            ->assertJsonPath('accountConfigured', true);

        $this->withBearer($this->adminBearerToken())->getJson('/api/v1/mail/status')
            ->assertOk()
            ->assertJsonPath('accountConfigured', false);
    }

    public function test_status_includes_smtp_endpoint_metadata_when_servers_configured(): void
    {
        $response = $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status');

        $response->assertOk()
            ->assertJsonPath('smtp.host', '127.0.0.1')
            ->assertJsonPath('smtp.port', 587)
            ->assertJsonPath('smtp.security', 'starttls')
            ->assertJsonStructure(['smtp' => ['tcpReachable']]);
    }
}
