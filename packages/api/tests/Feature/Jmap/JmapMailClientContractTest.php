<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapMailSync;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Mail\MailIdCodec;
use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\RequiresPhpExtension;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\ImapFixture;
use Tests\Support\MailTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * RFC 8621 mail envelope lifecycle against the Dovecot fixture.
 */
final class JmapMailClientContractTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use MailTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setUpMailFixtures();
    }

    private function requireImapFixture(): void
    {
        if (! ImapFixture::available()) {
            $this->markTestSkipped('IMAP fixture is not running (compose profile mail).');
        }
        $this->seedFixtureMailbox('bob');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     * @param  list<string>|null  $using
     */
    private function jmap(array $methodCalls, ?array $using = null): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => $using ?? [JmapCapabilities::CORE, JmapCapabilities::MAIL],
            'methodCalls' => $methodCalls,
        ]);
    }

    #[RequiresPhpExtension('imap')]
    public function test_session_advertises_mail_when_this_user_is_ready(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $this->assertArrayHasKey(JmapCapabilities::MAIL, $session['capabilities']);
        $this->assertArrayHasKey(JmapCapabilities::SUBMISSION, $session['capabilities']);
        $this->assertSame('bob', $session['primaryAccounts'][JmapCapabilities::MAIL]);
    }

    #[RequiresPhpExtension('imap')]
    public function test_full_mail_client_lifecycle_stays_on_the_incremental_path(): void
    {
        $this->requireImapFixture();
        $accountId = 'bob';
        $initial = $this->jmap([
            ['Mailbox/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
        ])->assertOk();
        $initial->assertJsonPath('methodResponses.0.0', 'Mailbox/get');
        $mailboxes = $initial->json('methodResponses.0.1.list');
        $this->assertIsArray($mailboxes);
        $this->assertNotSame([], $mailboxes);
        $inbox = null;
        foreach ($mailboxes as $box) {
            if (($box['role'] ?? '') === 'inbox' || strcasecmp((string) ($box['name'] ?? ''), 'INBOX') === 0) {
                $inbox = $box;
                break;
            }
        }
        $this->assertIsArray($inbox);
        $inboxId = $inbox['id'];
        $emailStateS0 = $initial->json('methodResponses.0.1.state');

        $batch = $this->jmap([
            ['Email/query', ['accountId' => $accountId, 'filter' => ['inMailbox' => $inboxId], 'limit' => 40], 'c1'],
            ['Email/get', [
                'accountId' => $accountId,
                '#ids' => ['resultOf' => 'c1', 'name' => 'Email/query', 'path' => '/ids'],
                'properties' => ['id', 'subject', 'mailboxIds', 'keywords', 'threadId'],
            ], 'c2'],
        ])->assertOk();
        $batch->assertJsonPath('methodResponses.0.0', 'Email/query');
        $batch->assertJsonPath('methodResponses.1.0', 'Email/get');
        $ids = $batch->json('methodResponses.0.1.ids');
        $this->assertIsArray($ids);
        $this->assertNotSame([], $ids);
        $emailId = $ids[0];
        $this->assertSame($emailId, $batch->json('methodResponses.1.1.list.0.id'));
        $this->assertStringContainsString(':', (string) $emailId);

        $flag = $this->jmap([
            ['Email/set', ['accountId' => $accountId, 'update' => [$emailId => ['keywords/$seen' => true]]], 'c3'],
        ])->assertOk();
        $flag->assertJsonPath('methodResponses.0.0', 'Email/set');
        $this->assertArrayHasKey($emailId, $flag->json('methodResponses.0.1.updated') ?? []);

        $changes = $this->jmap([
            ['Email/changes', ['accountId' => $accountId, 'sinceState' => $emailStateS0], 'c4'],
        ])->assertOk();
        $changes->assertJsonPath('methodResponses.0.0', 'Email/changes');
        $this->assertContains($emailId, array_merge(
            $changes->json('methodResponses.0.1.created') ?? [],
            $changes->json('methodResponses.0.1.updated') ?? [],
        ));
    }

    #[RequiresPhpExtension('imap')]
    public function test_stale_uidvalidity_email_get_is_not_found(): void
    {
        $this->requireImapFixture();
        $accountId = 'bob';
        $query = $this->jmap([
            ['Mailbox/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
            ['Email/query', ['accountId' => $accountId, 'limit' => 1], 'c1'],
        ])->assertOk();
        $emailId = $query->json('methodResponses.1.1.ids.0');
        $this->assertIsString($emailId);
        $parsed = MailIdCodec::parseEmailId($emailId);
        $this->assertNotNull($parsed);
        $stale = MailIdCodec::emailId(
            $parsed['mailAccountId'],
            $parsed['mailbox'],
            $parsed['uidvalidity'] + 1,
            $parsed['uid'],
        );
        $get = $this->jmap([
            ['Email/get', ['accountId' => $accountId, 'ids' => [$stale]], 'c2'],
        ])->assertOk();
        $this->assertContains($stale, $get->json('methodResponses.0.1.notFound'));
        $this->assertSame([], $get->json('methodResponses.0.1.list'));
    }

    #[RequiresPhpExtension('imap')]
    public function test_uidvalidity_mismatch_on_cached_row_cannot_calculate_changes(): void
    {
        $this->requireImapFixture();
        $accountId = 'bob';
        $state = $this->jmap([
            ['Mailbox/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        JmapMailSync::query()->where('username', 'bob')->update(['uidvalidity' => 1]);

        $changes = $this->jmap([
            ['Email/changes', ['accountId' => $accountId, 'sinceState' => $state], 'c1'],
        ])->assertOk();
        $changes->assertJsonPath('methodResponses.0.0', 'error');
        $changes->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }

    #[RequiresPhpExtension('imap')]
    public function test_mixed_mailbox_batch_reuses_one_request(): void
    {
        $this->requireImapFixture();
        $accountId = 'bob';
        $boxes = $this->jmap([
            ['Mailbox/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $inbox = $boxes[0]['id'] ?? null;
        $this->assertIsString($inbox);
        $second = $boxes[1]['id'] ?? $inbox;
        $response = $this->jmap([
            ['Email/query', ['accountId' => $accountId, 'filter' => ['inMailbox' => $inbox], 'limit' => 5], 'c1'],
            ['Email/query', ['accountId' => $accountId, 'filter' => ['inMailbox' => $second], 'limit' => 5], 'c2'],
        ])->assertOk();
        $response->assertJsonPath('methodResponses.0.0', 'Email/query');
        $response->assertJsonPath('methodResponses.1.0', 'Email/query');
    }

    #[RequiresPhpExtension('imap')]
    public function test_mixed_domain_batch_shares_one_dispatcher_pass(): void
    {
        $this->requireImapFixture();
        $response = $this->jmap([
            ['Calendar/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ['Mailbox/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
        ], [JmapCapabilities::CORE, JmapCapabilities::CALENDARS, JmapCapabilities::MAIL])->assertOk();
        $response->assertJsonPath('methodResponses.0.0', 'Calendar/get');
        $response->assertJsonPath('methodResponses.1.0', 'Mailbox/get');
        $this->assertNotSame(
            $response->json('methodResponses.0.1.state'),
            $response->json('methodResponses.1.1.state'),
        );
    }

    #[RequiresPhpExtension('imap')]
    public function test_identity_get_is_a_list_and_submission_requires_identity_id(): void
    {
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');
        $accountId = 'bob';
        $identities = $this->jmap([
            ['Identity/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
        ], [JmapCapabilities::CORE, JmapCapabilities::MAIL, JmapCapabilities::SUBMISSION])->assertOk();
        $identities->assertJsonPath('methodResponses.0.0', 'Identity/get');
        $list = $identities->json('methodResponses.0.1.list');
        $this->assertIsArray($list);
        $this->assertNotSame([], $list);
        $identityId = $list[0]['id'];

        $missing = $this->jmap([
            ['EmailSubmission/set', ['accountId' => $accountId, 'create' => ['s0' => ['emailId' => 'x']]], 'c1'],
        ], [JmapCapabilities::CORE, JmapCapabilities::MAIL, JmapCapabilities::SUBMISSION])->assertOk();
        $missing->assertJsonPath('methodResponses.0.1.notCreated.s0.properties.0', 'identityId');
        $this->assertIsString($identityId);
    }

    #[RequiresPhpExtension('imap')]
    public function test_mailbox_set_create_then_destroy(): void
    {
        $this->requireImapFixture();
        $accountId = 'bob';
        $name = 'JmapProbe'.bin2hex(random_bytes(3));
        $create = $this->jmap([
            ['Mailbox/set', ['accountId' => $accountId, 'create' => ['k0' => ['name' => $name]]], 'c0'],
        ])->assertOk();
        $createdId = $create->json('methodResponses.0.1.created.k0.id');
        $this->assertIsString($createdId);

        $destroy = $this->jmap([
            ['Mailbox/set', ['accountId' => $accountId, 'destroy' => [$createdId]], 'c1'],
        ])->assertOk();
        $this->assertContains($createdId, $destroy->json('methodResponses.0.1.destroyed'));
    }

    #[RequiresPhpExtension('imap')]
    public function test_email_set_create_draft_then_changes_are_incremental(): void
    {
        $this->requireImapFixture();
        $accountId = 'bob';
        $before = $this->jmap([
            ['Mailbox/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $boxes = $this->jmap([
            ['Mailbox/get', ['accountId' => $accountId, 'ids' => null], 'c1'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $draftsId = null;
        foreach ($boxes as $box) {
            if (($box['role'] ?? '') === 'drafts') {
                $draftsId = $box['id'];
                break;
            }
        }
        $create = $this->jmap([
            ['Email/set', [
                'accountId' => $accountId,
                'create' => ['d0' => [
                    'mailboxIds' => $draftsId ? [$draftsId => true] : [],
                    'keywords' => ['$draft' => true],
                    'subject' => 'JMAP draft',
                    'from' => [['email' => 'bob@example.test']],
                    'to' => [['email' => 'alice@example.test']],
                    'bodyValues' => ['1' => ['value' => 'hello draft', 'isEncodingProblem' => false, 'isTruncated' => false]],
                    'textBody' => [['partId' => '1', 'type' => 'text/plain']],
                ]],
            ], 'c2'],
        ])->assertOk();
        $createdId = $create->json('methodResponses.0.1.created.d0.id');
        $this->assertIsString($createdId);

        $changes = $this->jmap([
            ['Email/changes', ['accountId' => $accountId, 'sinceState' => $before], 'c3'],
        ])->assertOk();
        $changes->assertJsonPath('methodResponses.0.0', 'Email/changes');
        $this->assertContains($createdId, $changes->json('methodResponses.0.1.created'));
    }

    #[RequiresPhpExtension('imap')]
    public function test_mail_capability_follows_user_mailbox_not_a_kill_switch(): void
    {
        $this->setAppSettings([WgwSettings::MAIL_ENABLED => false]);
        $this->seedMailCredentials('bob', 'bob.mail@example.test', 'mail-secret');
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $this->assertArrayHasKey(JmapCapabilities::MAIL, $session['capabilities']);
        $this->assertArrayHasKey(JmapCapabilities::SUBMISSION, $session['capabilities']);
    }

    public function test_mail_capability_omitted_when_user_has_no_mailbox(): void
    {
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $this->assertArrayNotHasKey(JmapCapabilities::MAIL, $session['capabilities']);
        $this->assertArrayNotHasKey(JmapCapabilities::SUBMISSION, $session['capabilities']);
    }

    #[RequiresPhpExtension('imap')]
    public function test_mailbox_set_rejects_empty_name_and_inbox_destroy(): void
    {
        $this->requireImapFixture();
        $accountId = 'bob';
        $boxes = $this->jmap([
            ['Mailbox/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $inboxId = null;
        foreach ($boxes as $box) {
            if (($box['role'] ?? '') === 'inbox' || strcasecmp((string) ($box['name'] ?? ''), 'INBOX') === 0) {
                $inboxId = $box['id'];
                break;
            }
        }
        $this->assertIsString($inboxId);

        $empty = $this->jmap([
            ['Mailbox/set', ['accountId' => $accountId, 'create' => ['k0' => ['name' => '']]], 'c1'],
        ])->assertOk();
        $empty->assertJsonPath('methodResponses.0.1.notCreated.k0.properties.0', 'name');

        $destroy = $this->jmap([
            ['Mailbox/set', ['accountId' => $accountId, 'destroy' => [$inboxId]], 'c2'],
        ])->assertOk();
        $notDestroyed = $destroy->json('methodResponses.0.1.notDestroyed');
        $this->assertIsArray($notDestroyed);
        $this->assertSame('forbidden', $notDestroyed[$inboxId]['type'] ?? null);
    }
}
