<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

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

    public function test_removed_move_rest_path_returns_not_found(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/move', [
            'fromFolder' => $this->inboxFolderToken(),
            'toFolder' => 'dHJhc2g',
            'uid' => 1,
        ])->assertNotFound();

        $this->withBearer($this->userBearerToken())->postJson('/api/v1/mail/move', [
            'fromFolder' => $this->inboxFolderToken(),
            'uid' => 1,
        ])->assertNotFound();
    }
}
