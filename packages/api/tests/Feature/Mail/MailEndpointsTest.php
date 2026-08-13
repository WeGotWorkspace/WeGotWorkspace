<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use PHPUnit\Framework\Attributes\RequiresPhpExtension;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailEndpointsTest extends WgwDatabaseTestCase
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

    public function test_mail_status_without_server_or_account_config(): void
    {
        $this->clearMailServerSettings();

        $response = $this->withBearer($this->adminBearerToken())->getJson('/api/v1/mail/status');

        $response->assertOk();
        $response->assertJsonStructure([
            'extImap',
            'serversConfigured',
            'accountConfigured',
            'configured',
            'ready',
        ]);
        $this->assertFalse($response->json('serversConfigured'));
        $this->assertFalse($response->json('accountConfigured'));
        $this->assertFalse($response->json('ready'));
    }

    #[RequiresPhpExtension('imap')]
    public function test_mail_folders_returns_not_configured_without_credentials(): void
    {
        $token = $this->userBearerToken();

        $response = $this->withBearer($token)->getJson('/api/v1/mail/folders');

        $response->assertStatus(400);
        $response->assertJson(['error' => 'not_configured']);
    }

    public function test_mail_messages_requires_folder(): void
    {
        $token = $this->userBearerToken();

        $response = $this->withBearer($token)->getJson('/api/v1/mail/messages');

        $response->assertStatus(400);
        $response->assertJson(['error' => 'mailbox_required']);
    }

    public function test_mail_message_delete_requires_folder_and_uid(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->deleteJson('/api/v1/mail/messages/incomplete-id')
            ->assertStatus(400)
            ->assertJson(['error' => 'bad_params']);
    }

    #[RequiresPhpExtension('imap')]
    public function test_mail_move_is_routed_and_validates_params(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->postJson('/api/v1/mail/move', [
            'fromFolder' => 'SU5CT1g',
            'toFolder' => 'SU5CT1guQXJjaGl2ZQ',
            'uid' => 1,
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'not_configured']);
    }
}
