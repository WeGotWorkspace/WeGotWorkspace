<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WithMailClientEnabled;

final class MailFoldersTest extends WgwDatabaseTestCase
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

    public function test_create_folder_requires_name(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/folders', [])
            ->assertStatus(400)
            ->assertJson(['error' => 'name_required']);
    }

    public function test_move_inbox_folder_is_rejected(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->patchJson('/api/v1/mail/folders', [
            'folder' => $this->inboxFolderToken(),
            'parentMailbox' => '',
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'cannot_move']);
    }

    public function test_move_starred_virtual_folder_is_rejected(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->patchJson('/api/v1/mail/folders', [
            'folder' => '__starred__',
            'parentMailbox' => '',
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'cannot_move']);
    }

    public function test_delete_inbox_folder_is_rejected(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->deleteJson('/api/v1/mail/folders', [
            'folder' => $this->inboxFolderToken(),
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'cannot_delete']);
    }

    public function test_delete_folder_without_folder_param_is_rejected(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->deleteJson('/api/v1/mail/folders', [])
            ->assertStatus(400)
            ->assertJson(['error' => 'cannot_delete']);
    }
}
