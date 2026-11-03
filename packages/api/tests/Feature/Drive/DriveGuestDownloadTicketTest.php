<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShareSession;
use App\Models\JmapDownloadTicket;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\WgwStorage;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Download tickets for share-link guests (#1622): a guest asks for a ticket
 * by path and downloads natively, with Range resumes. The ticket lives only
 * as long as the share session and its share.
 */
final class DriveGuestDownloadTicketTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const BODY = 'shared report body, thirty bytes';

    private string $shareId = '';

    private string $publicToken = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config([
            'wgw.jmap.download_ticket_idle_minutes' => 30,
            'wgw.jmap.download_ticket_lifetime_hours' => 24,
        ]);
        $files = app(WgwStorage::class)->files();
        $files->put('users/bob/shared/report.txt', self::BODY);
        $files->put('users/bob/shared/sub/deep.txt', 'deep');
        $files->put('users/bob/private.txt', 'not shared');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_a_guest_downloads_a_shared_file_and_resumes_it(): void
    {
        $guest = $this->guestToken();
        $issued = $this->issue($guest, '/users/bob/shared/report.txt')->assertCreated()->json();
        $this->assertArrayHasKey('idleExpires', $issued);
        $this->assertArrayHasKey('absoluteExpires', $issued);
        $path = $this->ticketPath($issued);
        $this->assertStringEndsWith('/report.txt', $path);
        $this->flushHeaders();

        $download = $this->get($path)->assertOk();
        $this->assertSame(self::BODY, $download->streamedContent());
        $this->assertStringContainsString('attachment; filename="report.txt"', (string) $download->headers->get('Content-Disposition'));
        $this->assertSame('bytes', $download->headers->get('Accept-Ranges'));

        $resume = $this->withHeader('Range', 'bytes=7-')->get($path);
        $resume->assertStatus(206);
        $this->assertSame(substr(self::BODY, 7), $resume->streamedContent());

        $row = JmapDownloadTicket::query()->sole();
        $this->assertStringStartsWith('share:', (string) $row->username);
        $this->assertStringStartsWith('share-session:', (string) $row->session_family);
    }

    public function test_a_file_in_a_subfolder_of_the_share_works(): void
    {
        $guest = $this->guestToken();
        $path = $this->ticketPath($this->issue($guest, '/users/bob/shared/sub/deep.txt')->assertCreated()->json());
        $this->flushHeaders();

        $this->assertSame('deep', $this->get($path)->assertOk()->streamedContent());
    }

    public function test_a_path_outside_the_share_a_folder_or_a_missing_file_is_refused(): void
    {
        $guest = $this->guestToken();

        $this->issue($guest, '/users/bob/private.txt')->assertNotFound();
        $this->issue($guest, '/users/bob/shared/../private.txt')->assertNotFound();
        $this->issue($guest, '/users/bob/shared/sub')->assertNotFound();
        $this->issue($guest, '/users/bob/shared/missing.txt')->assertNotFound();
        $this->flushHeaders();
        $this->withBearer($guest)->postJson('/api/v1/files/download-tickets', [])->assertStatus(400);
        $this->assertSame(0, JmapDownloadTicket::query()->count());
    }

    public function test_revoking_the_share_stops_the_next_request(): void
    {
        $guest = $this->guestToken();
        $path = $this->ticketPath($this->issue($guest, '/users/bob/shared/report.txt')->assertCreated()->json());
        $this->flushHeaders();
        $this->get($path)->assertOk();

        $this->withBearer($this->userBearerToken())->deleteJson('/api/v1/files/shares/'.$this->shareId)->assertSuccessful();
        $this->flushHeaders();

        $this->get($path)->assertNotFound();
        $this->withHeader('Range', 'bytes=7-')->get($path)->assertNotFound();
    }

    public function test_revoking_the_session_stops_the_next_request(): void
    {
        $guest = $this->guestToken();
        $path = $this->ticketPath($this->issue($guest, '/users/bob/shared/report.txt')->assertCreated()->json());
        $this->flushHeaders();
        $this->get($path)->assertOk();

        DriveShareSession::query()->update(['revoked_at' => Carbon::now()]);

        $this->get($path)->assertNotFound();
        $this->assertSame(0, JmapDownloadTicket::query()->count());
    }

    public function test_an_expired_session_ends_its_tickets(): void
    {
        $start = Carbon::now()->startOfSecond();
        $guest = $this->guestToken();
        $path = $this->ticketPath($this->issue($guest, '/users/bob/shared/report.txt')->assertCreated()->json());
        $this->flushHeaders();

        // Each request keeps the ticket's idle window open, but the guest
        // session lasts one hour.
        Carbon::setTestNow($start->copy()->addMinutes(25));
        $this->get($path)->assertOk();
        Carbon::setTestNow($start->copy()->addMinutes(50));
        $this->get($path)->assertOk();
        Carbon::setTestNow($start->copy()->addMinutes(61));
        $this->get($path)->assertNotFound();
    }

    public function test_the_ticket_is_bound_to_the_session_that_issued_it(): void
    {
        $guest = $this->guestToken();
        $path = $this->ticketPath($this->issue($guest, '/users/bob/shared/report.txt')->assertCreated()->json());
        $first = DriveShareSession::query()->sole();
        // A second, live session for the same link.
        $this->guestSessionToken();
        $second = DriveShareSession::query()->whereKeyNot($first->getKey())->sole();
        $row = JmapDownloadTicket::query()->sole();
        $this->assertSame('share-session:'.$first->id, (string) $row->session_family);

        // Pointing the row at the other live session does not carry the
        // first session's ticket over: subject and family must match.
        $row->username = 'share:'.$second->session_key;
        $row->save();
        $this->flushHeaders();

        $this->get($path)->assertNotFound();
    }

    public function test_the_ticket_stops_serving_after_the_content_changes(): void
    {
        $guest = $this->guestToken();
        $path = $this->ticketPath($this->issue($guest, '/users/bob/shared/report.txt')->assertCreated()->json());
        $this->flushHeaders();
        $this->get($path)->assertOk();

        // A WGW write records the new content hash, so the node's blobId moves on.
        app(WgwStorage::class)->files()->put('users/bob/shared/report.txt', 'different bytes now');
        app(FileNodeIndexService::class)->recordContentWrite('users/bob/shared/report.txt', hash('sha256', 'different bytes now'));

        $this->get($path)->assertNotFound();
    }

    public function test_a_signed_in_caller_gets_a_session_bound_ticket_for_its_own_file(): void
    {
        $token = $this->userBearerToken();
        $issued = $this->issue($token, '/users/bob/private.txt')->assertCreated()->json();
        $this->flushHeaders();

        $this->assertSame('not shared', $this->get($this->ticketPath($issued))->assertOk()->streamedContent());
        $row = JmapDownloadTicket::query()->sole();
        $this->assertSame('bob', (string) $row->username);
        $this->assertStringStartsNotWith('share-session:', (string) $row->session_family);
    }

    public function test_a_guest_cannot_use_the_signed_in_ticket_route(): void
    {
        $guest = $this->guestToken();
        $this->flushHeaders();

        $this->withBearer($guest)->postJson('/api/v1/jmap/download-tickets/bob', [
            'blobId' => 'fnb-fn-00000000000000000000000000000000-00000000',
            'name' => 'report.txt',
        ])->assertForbidden();
    }

    public function test_without_a_token_the_route_needs_auth(): void
    {
        $this->flushHeaders();
        $this->postJson('/api/v1/files/download-tickets', ['path' => '/users/bob/shared/report.txt'])->assertUnauthorized();
    }

    private function guestToken(): string
    {
        $owner = $this->userBearerToken();
        $share = $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();
        $this->shareId = (string) $share->json('data.id');
        $this->publicToken = (string) $share->json('data.publicToken');

        return $this->guestSessionToken();
    }

    private function guestSessionToken(): string
    {
        $this->flushHeaders();

        return (string) $this->postJson('/api/v1/files/share-sessions', [
            'token' => $this->publicToken,
        ])->assertOk()->json('access_token');
    }

    private function issue(string $token, string $path): TestResponse
    {
        $this->flushHeaders();

        return $this->withBearer($token)->postJson('/api/v1/files/download-tickets', ['path' => $path]);
    }

    /**
     * @param  array<string, mixed>  $issued
     */
    private function ticketPath(array $issued): string
    {
        return (string) parse_url((string) ($issued['url'] ?? ''), PHP_URL_PATH);
    }
}
