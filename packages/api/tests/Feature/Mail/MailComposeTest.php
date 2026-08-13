<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use PHPUnit\Framework\Attributes\RequiresPhpExtension;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailComposeTest extends WgwDatabaseTestCase
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

    public function test_send_without_credentials_returns_smtp_not_configured(): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/messages', [
            'to' => 'recipient@example.test',
            'subject' => 'Hello',
            'body' => 'Body',
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'smtp_not_configured']);
    }

    public function test_send_without_to_returns_to_required(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/messages', [
            'subject' => 'Hello',
            'body' => 'Body',
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'to_required']);
    }

    public function test_send_with_credentials_and_to_reaches_smtp_layer(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/messages', [
            'to' => 'recipient@example.test',
            'subject' => 'Hello',
            'body' => 'Body',
        ]);

        $response->assertStatus(400);
        $this->assertContains($response->json('error'), ['smtp_connect', 'send_failed']);
    }

    #[RequiresPhpExtension('imap')]
    public function test_draft_without_credentials_returns_not_configured(): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/drafts', [
            'subject' => 'Draft',
            'body' => 'Work in progress',
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'not_configured']);
    }

    #[RequiresPhpExtension('imap')]
    public function test_draft_with_credentials_reaches_imap_append_path(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/drafts', [
            'subject' => 'Draft',
            'body' => 'Work in progress',
        ]);

        $this->assertContains($response->status(), [400, 503]);
        $this->assertContains($response->json('error'), [
            'imap_connect',
            'draft_failed',
            'draft_append_failed',
        ]);
    }
}
