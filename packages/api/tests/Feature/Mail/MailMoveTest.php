<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use PHPUnit\Framework\Attributes\RequiresPhpExtension;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailMoveTest extends WgwDatabaseTestCase
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

    #[RequiresPhpExtension('imap')]
    public function test_move_without_credentials_returns_not_configured(): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/move', [
            'fromFolder' => $this->inboxFolderToken(),
            'toFolder' => 'dHJhc2g',
            'uid' => 1,
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'not_configured']);
    }

    public function test_move_with_missing_params_returns_bad_params(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/move', [
            'fromFolder' => $this->inboxFolderToken(),
            'uid' => 1,
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'bad_params']);
    }

    public function test_move_to_starred_destination_is_rejected(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/move', [
            'fromFolder' => $this->inboxFolderToken(),
            'toFolder' => '__starred__',
            'uid' => 1,
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'bad_params']);
    }

    #[RequiresPhpExtension('imap')]
    public function test_move_with_system_folder_alias_is_accepted_by_validation(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/move', [
            'fromFolder' => $this->inboxFolderToken(),
            'toFolder' => 'trash',
            'uid' => 1,
        ])
            ->assertStatus(503)
            ->assertJson(['error' => 'imap_connect']);
    }
}
