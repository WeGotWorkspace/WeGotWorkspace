<?php

declare(strict_types=1);

namespace Tests\Unit\Mail;

use App\Services\Mail\MailFolderOperations;
use App\Services\Mail\MailOperationService;
use ReflectionMethod;
use Tests\TestCase;

final class MailFolderOperationsTest extends TestCase
{
    public function test_folder_id_round_trip(): void
    {
        $encoded = MailOperationService::folderIdEncode('INBOX/Work');
        $this->assertSame('INBOX/Work', MailOperationService::folderIdDecode($encoded));
    }

    public function test_normalize_mailbox_delimiter(): void
    {
        $mail = $this->app->make(MailFolderOperations::class);
        $method = new ReflectionMethod(MailFolderOperations::class, 'normalizeMailboxDelimiter');
        $method->setAccessible(true);

        $this->assertSame('/', $method->invoke($mail, '/'));
        $this->assertSame('.', $method->invoke($mail, ''));
    }

    public function test_mailbox_leaf_segment(): void
    {
        $mail = $this->app->make(MailFolderOperations::class);
        $method = new ReflectionMethod(MailFolderOperations::class, 'mailboxLeafSegment');
        $method->setAccessible(true);

        $this->assertSame('Work', $method->invoke($mail, 'INBOX/Work', '/'));
    }
}
