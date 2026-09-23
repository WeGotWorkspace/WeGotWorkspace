<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailMessagesTest extends WgwDatabaseTestCase
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

    public function test_removed_message_rest_paths_return_not_found(): void
    {
        $token = $this->userBearerToken();
        $inbox = $this->inboxFolderToken();

        $this->withBearer($token)->getJson('/api/v1/mail/messages')->assertNotFound();
        $this->withBearer($token)->getJson('/api/v1/mail/messages?folder='.$inbox)->assertNotFound();
        $this->withBearer($token)->deleteJson('/api/v1/mail/messages/incomplete-id')->assertNotFound();
        $this->withBearer($token)->getJson('/api/v1/mail/messages/'.$inbox.':42')->assertNotFound();
        $this->withBearer($token)->patchJson('/api/v1/mail/messages/'.$inbox.':0', [
            'read' => true,
        ])->assertNotFound();
        $this->withBearer($token)->getJson('/api/v1/mail/messages/orphan-id/attachments?uids=1')->assertNotFound();
        $this->withBearer($token)->get(
            '/api/v1/mail/messages/'.$inbox.':1/attachments/1?folder='.$inbox.'&uid=0',
        )->assertNotFound();
        $this->withBearer($token)->getJson('/api/v1/mail/folders')->assertNotFound();
    }
}
