<?php

declare(strict_types=1);

namespace Tests\Feature\Mail;

use App\Services\Jmap\JmapCapabilities;
use PHPUnit\Framework\Attributes\RequiresPhpExtension;
use Tests\Support\ImapFixture;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MailImapFixtureListTest extends WgwDatabaseTestCase
{
    use MailTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMailFixtures();
        if (! ImapFixture::available()) {
            $this->markTestSkipped('IMAP fixture is not running (compose profile mail).');
        }
        $this->seedFixtureMailbox('bob');
    }

    #[RequiresPhpExtension('imap')]
    public function test_live_mailbox_get_and_email_query_against_dovecot(): void
    {
        $token = $this->userBearerToken();
        $boxes = $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::MAIL],
            'methodCalls' => [
                ['Mailbox/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ],
        ])->assertOk();
        $boxes->assertJsonPath('methodResponses.0.0', 'Mailbox/get');
        $list = $boxes->json('methodResponses.0.1.list');
        $this->assertIsArray($list);
        $this->assertNotSame([], $list);
        $inboxId = $list[0]['id'] ?? null;
        $this->assertIsString($inboxId);

        $query = $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::MAIL],
            'methodCalls' => [
                ['Email/query', ['accountId' => 'bob', 'filter' => ['inMailbox' => $inboxId], 'limit' => 20], 'c1'],
                ['Email/get', [
                    'accountId' => 'bob',
                    '#ids' => ['resultOf' => 'c1', 'name' => 'Email/query', 'path' => '/ids'],
                    'properties' => ['id', 'subject', 'mailboxIds'],
                ], 'c2'],
            ],
        ])->assertOk();
        $ids = $query->json('methodResponses.0.1.ids');
        $this->assertIsArray($ids);
        $this->assertNotSame([], $ids);
        $this->assertSame($ids[0], $query->json('methodResponses.1.1.list.0.id'));
    }
}
