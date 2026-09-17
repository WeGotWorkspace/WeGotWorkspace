<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailFoldersTest extends WgwDatabaseTestCase
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

    public function test_removed_folder_rest_paths_return_not_found(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');
        $token = $this->userBearerToken();

        $this->withBearer($token)->postJson('/api/v1/mail/folders', [])->assertNotFound();
        $this->withBearer($token)->patchJson('/api/v1/mail/folders', [
            'folder' => $this->inboxFolderToken(),
            'parentMailbox' => '',
        ])->assertNotFound();
        $this->withBearer($token)->deleteJson('/api/v1/mail/folders', [
            'folder' => $this->inboxFolderToken(),
        ])->assertNotFound();
        $this->withBearer($token)->deleteJson('/api/v1/mail/folders', [])->assertNotFound();
    }
}
