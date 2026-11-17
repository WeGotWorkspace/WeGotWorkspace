<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars\Imip;

use App\Services\Calendars\Imip\ImapFolder;
use App\Services\Calendars\Imip\ImipMailboxObjects;
use PHPUnit\Framework\TestCase;

final class ImipMailboxObjectsTest extends TestCase
{
    public function test_folders_become_rfc_8621_mailboxes_with_parents_and_roles(): void
    {
        $folders = [
            new ImapFolder('INBOX', '/', ['\\haschildren']),
            new ImapFolder('INBOX/Replies', '/', ['\\hasnochildren']),
            new ImapFolder('Sent Items', '/', ['\\sent']),
            new ImapFolder('Old/Sent', '/', ['\\sent']),
            new ImapFolder('Orphan.Child', '.', []),
        ];

        $mailboxes = ImipMailboxObjects::fromFolders($folders);
        $byName = array_column($mailboxes, null, 'name');

        $inbox = $byName['INBOX'];
        $this->assertSame(ImipMailboxObjects::id('INBOX'), $inbox['id']);
        $this->assertSame('inbox', $inbox['role']);
        $this->assertNull($inbox['parentId']);
        $this->assertSame(0, $inbox['sortOrder']);
        $this->assertTrue($inbox['myRights']['mayReadItems']);
        $this->assertFalse($inbox['myRights']['mayDelete']);
        $this->assertSame($inbox['id'], $byName['Replies']['parentId']);
        $this->assertSame('sent', $byName['Sent Items']['role']);
        $this->assertNull($byName['Sent']['role'], 'a role belongs to one Mailbox');
        $this->assertNull($byName['Sent']['parentId'], 'the parent Old is not listed');
        $this->assertSame('Child', $byName['Child']['name']);
        $this->assertSame(
            ['id', 'name', 'parentId', 'role', 'sortOrder', 'myRights'],
            array_keys($inbox),
        );
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{1,255}$/', $inbox['id']);
    }

    public function test_state_changes_with_the_listing(): void
    {
        $one = [new ImapFolder('INBOX', '/', [])];
        $two = [new ImapFolder('INBOX', '/', []), new ImapFolder('Replies', '/', [])];

        $this->assertSame(ImipMailboxObjects::state($one), ImipMailboxObjects::state($one));
        $this->assertNotSame(ImipMailboxObjects::state($one), ImipMailboxObjects::state($two));
    }
}
