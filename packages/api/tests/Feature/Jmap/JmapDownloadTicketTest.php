<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Http\Support\RangeResponder;
use App\Models\JmapDownloadTicket;
use App\Models\JmapFileNode;
use App\Models\User;
use App\Services\Auth\JwtTokenService;
use App\Services\Auth\RefreshCookie;
use App\Services\Auth\UserSessionRevoker;
use App\Services\Jmap\Blobs\BlobContent;
use App\Services\Jmap\Blobs\JmapDownloadBlobResolver;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Illuminate\Support\Carbon;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Download tickets (#1500): a native browser download without our
 * Authorization header. Reusable while active, sliding idle expiry capped by
 * an absolute lifetime, bound to one blob, one account, and the issuing
 * session, with the read check re-run on every request.
 */
final class JmapDownloadTicketTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const BODY = 'ticketed file content, twenty-nine';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config([
            'wgw.jmap.download_ticket_idle_minutes' => 30,
            'wgw.jmap.download_ticket_lifetime_hours' => 24,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_ticket_is_reusable_while_active_probe_download_and_resume(): void
    {
        $this->seedPrivateFile('bob', 'report.txt', self::BODY);
        $token = $this->userBearerToken();
        $issued = $this->issueTicket($token, $this->blobIdFor('report.txt', $token), 'report.txt');
        $this->assertArrayHasKey('idleExpires', $issued);
        $this->assertArrayHasKey('absoluteExpires', $issued);
        $path = $this->ticketPath($issued);
        $this->flushHeaders();

        $probe = $this->call('HEAD', $path);
        $probe->assertOk();
        $this->assertSame((string) strlen(self::BODY), $probe->headers->get('Content-Length'));

        $download = $this->get($path)->assertOk();
        $this->assertSame(self::BODY, $download->streamedContent());
        $this->assertStringContainsString('attachment; filename="report.txt"', (string) $download->headers->get('Content-Disposition'));
        $this->assertSame('nosniff', $download->headers->get('X-Content-Type-Options'));

        $resume = $this->withHeader('Range', 'bytes=9-')->get($path);
        $resume->assertStatus(206);
        $this->assertSame(substr(self::BODY, 9), $resume->streamedContent());
    }

    public function test_the_secret_is_stored_hashed_and_grants_nothing_else(): void
    {
        $this->seedPrivateFile('bob', 'a.txt', 'a');
        $token = $this->userBearerToken();
        $path = $this->ticketPath($this->issueTicket($token, $this->blobIdFor('a.txt', $token), 'a.txt'));
        $secret = explode('/', $path)[5];

        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $secret);
        $this->assertSame(0, JmapDownloadTicket::query()->where('secret_hash', $secret)->count());
        $this->assertSame(1, JmapDownloadTicket::query()->where('secret_hash', hash('sha256', $secret))->count());

        $this->flushHeaders();
        $this->withHeader('Authorization', 'Bearer '.$secret)->getJson('/api/v1/jmap/session')->assertUnauthorized();
    }

    public function test_expiry_slides_forward_with_each_request(): void
    {
        Carbon::setTestNow('2026-10-22 10:00:00');
        $this->seedPrivateFile('bob', 'slide.txt', self::BODY);
        $token = $this->userBearerToken();
        $path = $this->ticketPath($this->issueTicket($token, $this->blobIdFor('slide.txt', $token), 'slide.txt'));
        $this->flushHeaders();

        Carbon::setTestNow('2026-10-22 10:20:00');
        $this->get($path)->assertOk();
        // 40 minutes after issue, 20 after the last request.
        Carbon::setTestNow('2026-10-22 10:40:00');
        $this->get($path)->assertOk();
        // Idle 31 minutes since the last request.
        Carbon::setTestNow('2026-10-22 11:11:00');
        $this->get($path)->assertNotFound();
    }

    public function test_ticket_idle_past_its_expiry_is_refused(): void
    {
        Carbon::setTestNow('2026-10-22 10:00:00');
        $this->seedPrivateFile('bob', 'idle.txt', self::BODY);
        $token = $this->userBearerToken();
        $path = $this->ticketPath($this->issueTicket($token, $this->blobIdFor('idle.txt', $token), 'idle.txt'));
        $this->flushHeaders();

        Carbon::setTestNow('2026-10-22 10:31:00');
        $this->get($path)->assertNotFound();
        $this->assertSame(0, JmapDownloadTicket::query()->count());
    }

    public function test_absolute_lifetime_caps_the_sliding_expiry(): void
    {
        config(['wgw.jmap.download_ticket_lifetime_hours' => 1]);
        Carbon::setTestNow('2026-10-22 10:00:00');
        $this->seedPrivateFile('bob', 'life.txt', self::BODY);
        $token = $this->userBearerToken();
        $path = $this->ticketPath($this->issueTicket($token, $this->blobIdFor('life.txt', $token), 'life.txt'));
        $this->flushHeaders();

        foreach (['10:20:00', '10:40:00', '10:59:00'] as $time) {
            Carbon::setTestNow('2026-10-22 '.$time);
            $this->get($path)->assertOk();
        }
        // Two minutes after the last request, but past issue + 1 h.
        Carbon::setTestNow('2026-10-22 11:01:00');
        $this->get($path)->assertNotFound();
    }

    public function test_expiry_never_runs_out_while_a_long_response_streams(): void
    {
        Carbon::setTestNow('2026-10-22 10:00:00');
        $this->app->instance(RangeResponder::class, new RangeResponder(4));
        $this->app->instance(JmapDownloadBlobResolver::class, new class extends JmapDownloadBlobResolver
        {
            public function __construct() {}

            public function resolve(string $username, string $blobId): ?BlobContent
            {
                return $blobId === 'jb-'.str_repeat('a', 40)
                    ? new BlobContent('application/octet-stream', static fn () => ClockAdvancingStream::open())
                    : null;
            }
        });
        $token = $this->userBearerToken();
        $path = $this->ticketPath($this->issueTicket($token, 'jb-'.str_repeat('a', 40), 'slow.bin'));
        $this->flushHeaders();

        // Each 4-byte chunk takes ten minutes: the response lasts 40 minutes.
        $slow = $this->get($path)->assertOk();
        $this->assertSame(str_repeat('x', 16), $slow->streamedContent());
        $this->assertSame('2026-10-22 10:40:00', JmapDownloadTicket::query()->value('last_seen_at')?->format('Y-m-d H:i:s'));

        // A resume right after the long response is accepted although the
        // request that started it began 40 minutes ago.
        Carbon::setTestNow('2026-10-22 10:45:00');
        $this->withHeader('Range', 'bytes=8-')->get($path)->assertStatus(206);
    }

    public function test_ticket_cannot_be_issued_for_another_account_or_a_blob_the_account_cannot_read(): void
    {
        $this->seedPrivateFile('carol', 'secret.txt', 'carol only');
        $carol = $this->carolBearerToken();
        $carolBlob = $this->blobIdFor('secret.txt', $carol, 'carol');
        $bob = $this->userBearerToken();

        $this->withBearer($bob)->postJson('/api/v1/jmap/download-tickets/carol', [
            'blobId' => $carolBlob, 'name' => 'secret.txt',
        ])->assertNotFound();
        $this->withBearer($bob)->postJson('/api/v1/jmap/download-tickets/bob', [
            'blobId' => $carolBlob, 'name' => 'secret.txt',
        ])->assertNotFound();
    }

    public function test_a_name_that_cannot_be_a_url_segment_is_refused(): void
    {
        $this->seedPrivateFile('bob', 'report.txt', self::BODY);
        $token = $this->userBearerToken();
        $blobId = $this->blobIdFor('report.txt', $token);

        foreach (['a/b.txt', 'a\\b.txt', '.', '..'] as $name) {
            $this->withBearer($token)->postJson('/api/v1/jmap/download-tickets/bob', [
                'blobId' => $blobId, 'name' => $name,
            ])->assertStatus(400);
        }
    }

    public function test_ticket_never_serves_bytes_other_than_the_blob_it_was_issued_for(): void
    {
        $this->seedPrivateFile('bob', 'versioned.txt', 'version one');
        $token = $this->userBearerToken();
        $path = $this->ticketPath($this->issueTicket($token, $this->blobIdFor('versioned.txt', $token), 'versioned.txt'));
        $this->flushHeaders();
        $this->get($path)->assertOk();

        // New content → new fnb- id; the ticket's blob is gone.
        app(WgwStorage::class)->files()->put('users/bob/versioned.txt', 'version two!');
        JmapFileNode::query()->where('storage_key', 'users/bob/versioned.txt')->update(['content_sha256' => null]);
        $this->get($path)->assertNotFound();
    }

    public function test_signing_out_ends_the_tickets_of_that_session_only(): void
    {
        $this->seedPrivateFile('bob', 'session.txt', self::BODY);
        $first = $this->login('bob');
        $second = $this->login('bob');
        $blobId = $this->blobIdFor('session.txt', $first['access']);
        $pathOne = $this->ticketPath($this->issueTicket($first['access'], $blobId, 'session.txt'));
        $pathTwo = $this->ticketPath($this->issueTicket($second['access'], $blobId, 'session.txt'));

        $this->flushHeaders();
        $this->withBearer($first['access'])
            ->withUnencryptedCookie(RefreshCookie::NAME, $first['refresh'])
            ->withCredentials()
            ->postJson('/api/v1/auth/revoke')
            ->assertOk();

        $this->flushHeaders();
        $this->get($pathOne)->assertNotFound();
        $this->get($pathTwo)->assertOk();
    }

    public function test_revoking_all_sessions_ends_every_ticket(): void
    {
        $this->seedPrivateFile('bob', 'all.txt', self::BODY);
        $token = $this->userBearerToken();
        $path = $this->ticketPath($this->issueTicket($token, $this->blobIdFor('all.txt', $token), 'all.txt'));

        // Password change and device revocation go through the session revoker.
        app(UserSessionRevoker::class)->revokeAll('bob');

        $this->flushHeaders();
        $this->get($path)->assertNotFound();
    }

    public function test_a_disabled_account_is_refused(): void
    {
        $this->seedPrivateFile('bob', 'disabled.txt', self::BODY);
        $token = $this->userBearerToken();
        $path = $this->ticketPath($this->issueTicket($token, $this->blobIdFor('disabled.txt', $token), 'disabled.txt'));
        User::query()->where('username', 'bob')->update(['enabled' => false]);

        $this->flushHeaders();
        $this->get($path)->assertNotFound();
    }

    public function test_a_share_withdrawn_mid_download_is_refused_at_the_next_range_request(): void
    {
        $this->seedPrivateFile('bob', 'shared.txt', self::BODY);
        $bob = $this->userBearerToken();
        $share = $this->withBearer($bob)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.txt',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();
        $shareId = (string) $share->json('data.id');

        $carol = $this->carolBearerToken();
        $path = $this->ticketPath($this->issueTicket($carol, $this->blobIdFor('shared.txt', $carol, 'carol'), 'shared.txt', 'carol'));
        $this->flushHeaders();
        $first = $this->withHeader('Range', 'bytes=0-8')->get($path);
        $first->assertStatus(206);
        $this->assertSame(substr(self::BODY, 0, 9), $first->streamedContent());

        $this->flushHeaders();
        $this->withBearer($bob)->deleteJson('/api/v1/files/shares/'.$shareId)->assertOk();

        $this->flushHeaders();
        $this->withHeader('Range', 'bytes=9-')->get($path)->assertNotFound();
    }

    public function test_a_token_without_a_session_cannot_issue_a_ticket(): void
    {
        $this->seedPrivateFile('bob', 'legacy.txt', self::BODY);
        $blobId = $this->blobIdFor('legacy.txt', $this->userBearerToken());
        $legacy = app(JwtTokenService::class)->issue([
            'sub' => 'bob',
            'role' => 'user',
            'exp' => time() + 600,
            'uid' => (int) User::query()->where('username', 'bob')->value('id'),
        ]);

        $this->flushHeaders();
        $this->withBearer($legacy)->postJson('/api/v1/jmap/download-tickets/bob', [
            'blobId' => $blobId, 'name' => 'legacy.txt',
        ])->assertForbidden()->assertJsonPath('code', 'session_required');
    }

    /**
     * @return array{url: string, idleExpires: string, absoluteExpires: string}
     */
    private function issueTicket(string $token, string $blobId, string $name, string $account = 'bob'): array
    {
        $this->flushHeaders();

        /** @var array{url: string, idleExpires: string, absoluteExpires: string} $issued */
        $issued = $this->withBearer($token)->postJson('/api/v1/jmap/download-tickets/'.$account, [
            'blobId' => $blobId,
            'name' => $name,
        ])->assertCreated()->json();

        return $issued;
    }

    /**
     * @param  array{url: string}  $issued
     */
    private function ticketPath(array $issued): string
    {
        return (string) parse_url($issued['url'], PHP_URL_PATH);
    }

    /**
     * @return array{access: string, refresh: string}
     */
    private function login(string $username): array
    {
        $this->flushHeaders();
        $response = $this->postJson('/api/v1/auth/token', ['username' => $username, 'password' => 'secret'])->assertOk();

        return ['access' => (string) $response->json('access_token'), 'refresh' => $this->refreshCookieValue($response)];
    }

    private function blobIdFor(string $name, string $token, string $account = 'bob'): string
    {
        $this->flushHeaders();
        $list = $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => $account, 'ids' => null], 'c0']],
        ])->assertOk()->json('methodResponses.0.1.list');
        foreach ($list as $node) {
            if ($node['name'] === $name) {
                return (string) $node['blobId'];
            }
        }
        $this->fail('No FileNode named '.$name);
    }
}

/**
 * A 16-byte stream where every read advances the test clock by ten
 * minutes — a slow download without sleeping.
 */
final class ClockAdvancingStream
{
    /** @var resource|null */
    public $context;

    private int $position = 0;

    private static bool $registered = false;

    /**
     * @return resource|null
     */
    public static function open()
    {
        if (! self::$registered) {
            stream_wrapper_register('wgw-slow', self::class);
            self::$registered = true;
        }
        $stream = fopen('wgw-slow://body', 'rb');

        return $stream === false ? null : $stream;
    }

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        return true;
    }

    public function stream_read(int $count): string
    {
        if ($this->position >= 16) {
            return '';
        }
        Carbon::setTestNow(Carbon::now()->addMinutes(10));
        $this->position += 4;

        return 'xxxx';
    }

    public function stream_eof(): bool
    {
        return $this->position >= 16;
    }

    /**
     * @return array<string, int>
     */
    public function stream_stat(): array
    {
        return ['size' => 16];
    }

    public function stream_seek(int $offset, int $whence): bool
    {
        if ($whence !== SEEK_SET || $offset < 0 || $offset > 16) {
            return false;
        }
        $this->position = $offset;

        return true;
    }

    public function stream_tell(): int
    {
        return $this->position;
    }
}
