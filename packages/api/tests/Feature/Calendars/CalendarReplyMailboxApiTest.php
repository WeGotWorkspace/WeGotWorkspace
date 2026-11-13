<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarReplyMailbox;
use App\Services\Admin\AdminUserProvisionerService;
use App\Services\Calendars\HostIpResolver;
use App\Services\Calendars\Imip\ImapEndpoint;
use App\Services\Calendars\Imip\ImapTransport;
use App\Services\Calendars\Imip\ImipEndpointResolver;
use Illuminate\Support\Facades\Cache;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\FakeImapServer;
use Tests\Support\WgwDatabaseTestCase;

/**
 * `GET|PUT|DELETE /api/v1/calendars/reply-mailbox` and `POST .../test` (#1589).
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
            ->assertJsonPath('mailbox.active', true)
            ->assertJsonPath('mailbox.lastError', null);
        $this->assertStringNotContainsString('mailbox-pass', (string) $response->getContent());
        $this->assertStringNotContainsString(
            'mailbox-pass',
            (string) $this->withBearer($this->token)->getJson('/api/v1/calendars/reply-mailbox')->getContent(),
        );
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
