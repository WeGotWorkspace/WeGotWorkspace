<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use PHPUnit\Framework\Attributes\RequiresPhpExtension;
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

    public function test_messages_list_requires_folder(): void
    {
        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/messages')
            ->assertStatus(400)
            ->assertJson(['error' => 'mailbox_required']);
    }

    #[RequiresPhpExtension('imap')]
    public function test_messages_list_with_folder_and_credentials_reaches_imap_layer(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/messages?folder='.$this->inboxFolderToken())
            ->assertStatus(503)
            ->assertJson(['error' => 'imap_connect']);
    }

    public function test_message_delete_with_incomplete_id_returns_bad_params(): void
    {
        $this->withBearer($this->userBearerToken())->deleteJson('/api/v1/mail/messages/incomplete-id')
            ->assertStatus(400)
            ->assertJson(['error' => 'bad_params']);
    }

    #[RequiresPhpExtension('imap')]
    public function test_message_show_with_path_id_reaches_imap_layer(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');
        $messageId = $this->inboxFolderToken().':42';

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/messages/'.$messageId)
            ->assertStatus(503)
            ->assertJson(['error' => 'imap_connect']);
    }

    public function test_message_patch_with_missing_uid_returns_bad_params(): void
    {
        $this->withBearer($this->userBearerToken())->patchJson('/api/v1/mail/messages/'.$this->inboxFolderToken().':0', [
            'read' => true,
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'bad_params']);
    }

    public function test_message_attachments_list_requires_folder_when_not_in_path(): void
    {
        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/messages/orphan-id/attachments?uids=1')
            ->assertStatus(400)
            ->assertJson(['error' => 'mailbox_required']);
    }

    public function test_message_attachment_download_validates_uid(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');
        $messageId = $this->inboxFolderToken().':1';

        $this->withBearer($this->userBearerToken())->get(
            '/api/v1/mail/messages/'.$messageId.'/attachments/1?folder='.$this->inboxFolderToken().'&uid=0',
        )
            ->assertStatus(400)
            ->assertJson(['error' => 'bad_params']);
    }

    #[RequiresPhpExtension('imap')]
    public function test_folders_without_credentials_return_not_configured(): void
    {
        $this->withBearer($this->userBearerToken())->getJson('/api/v1/mail/folders')
            ->assertStatus(400)
            ->assertJson(['error' => 'not_configured']);
    }
}
