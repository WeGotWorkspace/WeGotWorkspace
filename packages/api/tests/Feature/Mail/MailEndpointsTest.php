<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

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

    public function test_removed_mailbox_rest_paths_are_gone(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)->getJson('/api/v1/mail/folders')->assertNotFound();
        $this->withBearer($token)->getJson('/api/v1/mail/messages')->assertNotFound();
        $this->withBearer($token)->postJson('/api/v1/mail/move', [
            'fromFolder' => 'SU5CT1g',
            'toFolder' => 'dHJhc2g',
            'uid' => 1,
        ])->assertNotFound();
    }
}
