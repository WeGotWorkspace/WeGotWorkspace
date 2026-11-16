<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarReplyMailbox;
use App\Services\Admin\AdminUserProvisionerService;
use App\Services\Calendars\HostIpResolver;
use App\Services\Calendars\Imip\ImapEndpoint;
use App\Services\Calendars\Imip\ImapTransport;
use App\Services\Calendars\Imip\ImipEndpointResolver;
use App\Services\Calendars\Imip\ImipMailboxObjects;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\Cache;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\FakeImapServer;
use Tests\Support\WgwDatabaseTestCase;

/**
 * `GET|PUT|DELETE /api/v1/calendars/reply-mailbox` and `POST .../test` (#1589), and
 * Mailbox/get (vendor urn:wgw:jmap:mail) over the same stored mailbox.
 */
final class CalendarReplyMailboxApiTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private string $token = '';

    private FakeImapServer $server;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Cache::flush();
        $this->token = $this->issueBearerTokenFor('bob');
        $this->server = new FakeImapServer(
            messages: [1 => [
                'headers' => "Authentication-Results: mx.receiver.test; dmarc=pass header.from=example.test\r\nFrom: a@example.test\r\n\r\n",
                'structure' => '("TEXT" "PLAIN" NIL NIL NIL "7BIT" 10 1 NIL NIL NIL NIL)',
            ]],
            login: 'bob@example.test',
            password: 'mailbox-pass',
        );
        $this->app->instance(ImapTransport::class, $this->server);
    }

    public function test_nothing_connected_by_default(): void
    {
        $this->withBearer($this->token)->getJson('/api/v1/calendars/reply-mailbox')
            ->assertOk()
            ->assertExactJson(['mailbox' => null]);
    }

    public function test_connect_stores_settings_and_never_returns_the_password(): void
    {
        $this->allowAnyHost();

        $response = $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();

        $response->assertJsonPath('mailbox.host', 'imap.example.test')
            ->assertJsonPath('mailbox.port', 993)
            ->assertJsonPath('mailbox.username', 'bob@example.test')
            ->assertJsonPath('mailbox.folder', 'INBOX')
            ->assertJsonPath('mailbox.passwordSet', true)
            ->assertJsonPath('mailbox.trustedServer', 'mx.receiver.test')
            ->assertJsonPath('mailbox.senderCheck', 'receiving_server')
            ->assertJsonPath('mailbox.active', true)
            ->assertJsonPath('mailbox.lastError', null);
        $this->assertStringNotContainsString('mailbox-pass', (string) $response->getContent());
        $row = CalendarReplyMailbox::query()->find('bob');
        $this->assertSame(1, $row?->uidvalidity, 'reading starts at the connection, not at the first poll');
        $this->assertSame(1, $row?->last_uid);
        $this->assertStringNotContainsString(
            'mailbox-pass',
            (string) $this->withBearer($this->token)->getJson('/api/v1/calendars/reply-mailbox')->getContent(),
        );
    }

    public function test_a_mailbox_whose_server_does_not_stamp_mail_is_checked_by_dkim(): void
    {
        $this->allowAnyHost();
        $this->server->messages[1]['headers'] = "From: a@example.test\r\n\r\n";

        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk()
            ->assertJsonPath('mailbox.trustedServer', null)
            ->assertJsonPath('mailbox.senderCheck', 'dkim')
            ->assertJsonPath('mailbox.lastError', null);
    }

    public function test_first_save_needs_a_password(): void
    {
        $this->allowAnyHost();

        $this->putMailbox([])->assertStatus(400);
        $this->assertSame(0, CalendarReplyMailbox::query()->count());
    }

    public function test_wrong_password_is_422_and_nothing_is_stored(): void
    {
        $this->allowAnyHost();

        $this->putMailbox(['password' => 'wrong'])->assertStatus(422)->assertJsonPath('code', 'auth_failed');
        $this->assertSame(0, CalendarReplyMailbox::query()->count());
    }

    public function test_saving_without_a_password_keeps_the_stored_one(): void
    {
        $this->allowAnyHost();
        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();

        $this->putMailbox(['folder' => 'INBOX'])->assertOk()->assertJsonPath('mailbox.passwordSet', true);
    }

    public function test_changing_the_host_needs_a_new_password(): void
    {
        $this->allowAnyHost();
        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();
        $opens = $this->server->opens;

        $this->putMailbox(['host' => 'imap.attacker.example'])->assertStatus(400);
        $this->putMailbox(['port' => 1993])->assertStatus(400);

        $this->assertSame($opens, $this->server->opens);
    }

    public function test_private_hosts_are_refused_by_default(): void
    {
        config(['wgw.imip_allow_private_hosts' => false]);

        $this->putMailbox(['host' => '127.0.0.1', 'password' => 'mailbox-pass'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'host_not_allowed');
        $this->putMailbox(['host' => '10.1.2.3', 'password' => 'mailbox-pass'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'host_not_allowed');
        $this->assertSame(0, $this->server->opens);
    }

    public function test_invalid_fields_are_400(): void
    {
        $this->allowAnyHost();

        $this->putMailbox(['security' => 'none', 'password' => 'x'])->assertStatus(400);
        $this->putMailbox(['port' => 70000, 'password' => 'x'])->assertStatus(400);
        $this->putMailbox(['host' => 'imap example', 'password' => 'x'])->assertStatus(400);
        $this->putMailbox(['username' => "a\r\nb", 'password' => 'x'])->assertStatus(400);
        $this->assertSame(0, $this->server->opens);
    }

    public function test_logins_from_save_and_test_are_rate_limited(): void
    {
        $this->allowAnyHost();

        for ($i = 0; $i < 10; $i++) {
            $this->putMailbox(['password' => 'wrong'])->assertStatus(422);
        }

        $this->putMailbox(['password' => 'mailbox-pass'])->assertStatus(429)->assertHeader('Retry-After');
    }

    public function test_test_route_needs_a_mailbox_and_refreshes_it(): void
    {
        $this->allowAnyHost();
        $this->withBearer($this->token)->postJson('/api/v1/calendars/reply-mailbox/test')->assertNotFound();

        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();
        CalendarReplyMailbox::query()->update(['enabled' => false, 'last_error_code' => 'auth_failed']);

        $this->withBearer($this->token)->postJson('/api/v1/calendars/reply-mailbox/test')
            ->assertOk()
            ->assertJsonPath('mailbox.active', true)
            ->assertJsonPath('mailbox.lastError', null);
    }

    public function test_mailbox_get_lists_the_stored_mailbox_as_jmap_mailboxes(): void
    {
        $this->allowAnyHost();
        $session = $this->withBearer($this->token)->getJson('/api/v1/jmap/session')->assertOk();
        $this->assertSame(
            ['maxMailboxDepth' => null, 'maxSizeMailboxName' => 255, 'mayCreateTopLevelMailbox' => false],
            $session->json('accounts.bob.accountCapabilities')[JmapCapabilities::MAIL] ?? null,
        );

        $none = $this->mailboxGet(['ids' => null]);
        $this->assertSame([], $none[1]['list'], 'no mailbox connected: no Mailboxes');

        $this->server->list = ['(\\HasChildren) "/" "INBOX"', '(\\HasNoChildren) "/" "INBOX/Replies"', '(\\Sent) "/" "Sent"'];
        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();

        $all = $this->mailboxGet(['ids' => null, 'properties' => ['name', 'parentId', 'role']]);
        $this->assertSame('Mailbox/get', $all[0]);
        $this->assertSame('bob', $all[1]['accountId']);
        $this->assertNotSame('', $all[1]['state']);
        $inboxId = ImipMailboxObjects::id('INBOX');
        $this->assertSame([
            ['id' => $inboxId, 'name' => 'INBOX', 'parentId' => null, 'role' => 'inbox'],
            ['id' => ImipMailboxObjects::id('INBOX/Replies'), 'name' => 'Replies', 'parentId' => $inboxId, 'role' => null],
            ['id' => ImipMailboxObjects::id('Sent'), 'name' => 'Sent', 'parentId' => null, 'role' => 'sent'],
        ], $all[1]['list']);

        $some = $this->mailboxGet(['ids' => [$inboxId, 'Mnope']]);
        $this->assertSame([$inboxId], array_column($some[1]['list'], 'id'));
        $this->assertSame(['Mnope'], $some[1]['notFound']);
    }

    public function test_mailbox_get_is_only_the_callers_own_account(): void
    {
        $this->allowAnyHost();
        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();

        $response = $this->withBearer($this->issueBearerTokenFor('alice'))->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::MAIL],
            'methodCalls' => [['Mailbox/get', ['accountId' => 'bob', 'ids' => null], 'c0']],
        ])->assertOk()->json('methodResponses.0');

        $this->assertSame('error', $response[0]);
        $this->assertSame('accountNotFound', $response[1]['type']);
        $this->assertSame(1, $this->server->opens, 'only bob\'s own save logged in');
    }

    public function test_mailbox_get_counts_as_a_mailbox_login(): void
    {
        $this->allowAnyHost();
        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();
        for ($i = 0; $i < 9; $i++) {
            $this->assertSame('Mailbox/get', $this->mailboxGet(['ids' => null])[0]);
        }

        $limited = $this->mailboxGet(['ids' => null]);
        $this->assertSame('error', $limited[0]);
        $this->assertSame('serverUnavailable', $limited[1]['type']);
        $this->assertGreaterThan(0, $limited[1]['retryAfter']);
    }

    public function test_mailbox_get_says_why_the_mailbox_cannot_be_opened(): void
    {
        $this->allowAnyHost();
        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();
        $this->server->password = 'changed-elsewhere';

        $failed = $this->mailboxGet(['ids' => null]);
        $this->assertSame('error', $failed[0]);
        $this->assertSame('serverFail', $failed[1]['type']);
        $this->assertSame('auth_failed', $failed[1]['code']);
    }

    public function test_a_folder_is_chosen_by_mailbox_id(): void
    {
        $this->allowAnyHost();
        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk()
            ->assertJsonPath('mailbox.folderId', ImipMailboxObjects::id('INBOX'));

        $this->server->list = ['(\\HasNoChildren) "/" "INBOX"', '(\\HasNoChildren) "/" "Calendar replies"'];
        $this->server->folder = 'Calendar replies';
        $this->putMailbox(['folderId' => ImipMailboxObjects::id('Calendar replies')])
            ->assertOk()
            ->assertJsonPath('mailbox.folder', 'Calendar replies')
            ->assertJsonPath('mailbox.folderId', ImipMailboxObjects::id('Calendar replies'));

        $this->putMailbox(['folderId' => 'Mgone'])->assertStatus(422)->assertJsonPath('code', 'folder_missing');
        $this->putMailbox(['folderId' => 'not an id'])->assertStatus(400);
        $this->assertSame('Calendar replies', CalendarReplyMailbox::query()->find('bob')?->folder);
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function mailboxGet(array $args): array
    {
        return $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::MAIL],
            'methodCalls' => [['Mailbox/get', ['accountId' => 'bob', ...$args], 'c0']],
        ])->assertOk()->json('methodResponses.0');
    }

    public function test_disconnect_removes_the_mailbox(): void
    {
        $this->allowAnyHost();
        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();

        $this->withBearer($this->token)->deleteJson('/api/v1/calendars/reply-mailbox')->assertNoContent();

        $this->assertSame(0, CalendarReplyMailbox::query()->count());
    }

    public function test_a_users_mailbox_goes_with_the_user(): void
    {
        $this->allowAnyHost();
        $this->putMailbox(['password' => 'mailbox-pass'])->assertOk();

        $this->app->make(AdminUserProvisionerService::class)->delete('bob');

        $this->assertSame(0, CalendarReplyMailbox::query()->count());
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function putMailbox(array $overrides): TestResponse
    {
        return $this->withBearer($this->token)->putJson('/api/v1/calendars/reply-mailbox', $overrides + [
            'host' => 'imap.example.test',
            'security' => 'ssl',
            'username' => 'bob@example.test',
        ]);
    }

    private function allowAnyHost(): void
    {
        $this->app->instance(ImipEndpointResolver::class, new class(new HostIpResolver) extends ImipEndpointResolver
        {
            public function resolve(string $host, int $port, string $security): ImapEndpoint
            {
                return new ImapEndpoint($host, '192.0.2.10', $port, $security);
            }
        });
    }
}
