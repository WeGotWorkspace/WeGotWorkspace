<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\RequiresPhpExtension;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailAccessControlTest extends WgwDatabaseTestCase
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

    /**
     * @return iterable<string, array{0: string, 1: string, 2: array<string, mixed>|null}>
     */
    public static function guestMailRoutesProvider(): iterable
    {
        yield 'GET status' => ['GET', '/api/v1/mail/status', null];
        yield 'GET folders' => ['GET', '/api/v1/mail/folders', null];
        yield 'POST folders' => ['POST', '/api/v1/mail/folders', ['name' => 'Projects']];
        yield 'PATCH folders' => ['PATCH', '/api/v1/mail/folders', ['folder' => 'SU5CT1g', 'parentMailbox' => '']];
        yield 'DELETE folders' => ['DELETE', '/api/v1/mail/folders', ['folder' => 'Projects']];
        yield 'GET messages' => ['GET', '/api/v1/mail/messages?folder=SU5CT1g', null];
        yield 'POST messages send' => ['POST', '/api/v1/mail/messages', ['to' => 'a@b.test', 'subject' => 'Hi', 'body' => 'x']];
        yield 'POST drafts' => ['POST', '/api/v1/mail/drafts', ['subject' => 'Draft', 'body' => 'x']];
        yield 'POST move' => ['POST', '/api/v1/mail/move', ['fromFolder' => 'SU5CT1g', 'toFolder' => 'dHJhc2g', 'uid' => 1]];
        yield 'GET message' => ['GET', '/api/v1/mail/messages/SU5CT1g:1', null];
        yield 'PATCH message' => ['PATCH', '/api/v1/mail/messages/SU5CT1g:1', ['read' => true]];
        yield 'DELETE message' => ['DELETE', '/api/v1/mail/messages/SU5CT1g:1', null];
        yield 'GET attachments' => ['GET', '/api/v1/mail/messages/SU5CT1g:1/attachments?folder=SU5CT1g&uids=1', null];
        yield 'GET attachment download' => ['GET', '/api/v1/mail/messages/SU5CT1g:1/attachments/1', null];
    }

    #[DataProvider('guestMailRoutesProvider')]
    public function test_guest_mail_routes_return_unauthorized(string $method, string $uri, ?array $body): void
    {
        if ($method === 'GET') {
            $this->getJson($uri)->assertUnauthorized();
        } else {
            $this->json($method, $uri, $body ?? [])->assertUnauthorized();
        }
    }

    public function test_regular_user_and_admin_each_see_own_mail_status_only(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');
        $this->seedMailCredentials('alice', 'alice.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/status')
            ->assertOk()
            ->assertJsonPath('accountConfigured', true);

        $this->withBearer($this->adminBearerToken())->getJson('/api/v1/mail/status')
            ->assertOk()
            ->assertJsonPath('accountConfigured', true);

        $this->withBearer($this->carolBearerToken())->getJson('/api/v1/mail/status')
            ->assertOk()
            ->assertJsonPath('accountConfigured', false);
    }

    #[RequiresPhpExtension('imap')]
    public function test_mail_routes_use_jwt_principal_not_other_users_credentials(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->adminBearerToken())->getJson('/api/v1/mail/folders')
            ->assertStatus(400)
            ->assertJson(['error' => 'not_configured']);

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/folders')
            ->assertStatus(503)
            ->assertJson(['error' => 'imap_connect']);
    }
}
