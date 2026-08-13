<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapBlob;
use App\Services\Jmap\Blobs\JmapBlobGarbageCollector;
use App\Services\Jmap\Blobs\JmapBlobReferenceCheckerInterface;
use App\Services\Jmap\Blobs\JmapBlobService;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\ContactsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Real JMAP blob upload/download (RFC 8620 §6, #438): round-trip, account
 * scoping, size limits, expiry + reference-protected GC, content-addressed
 * dedup, and the contacts media integration that supersedes the #437
 * photo-blob deviation.
 */
final class JmapBlobsTest extends WgwDatabaseTestCase
{
    use ContactsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('wgw_data');
        $this->setUpContactsFixtures();
    }

    private function upload(string $contents, string $type = 'application/octet-stream', string $account = 'bob', ?string $token = null): TestResponse
    {
        return $this->call(
            'POST',
            '/api/v1/jmap/upload/'.$account,
            server: $this->transformHeadersToServerVars([
                'Authorization' => 'Bearer '.($token ?? $this->userBearerToken()),
                'Content-Type' => $type,
            ]),
            content: $contents,
        );
    }

    public function test_upload_download_round_trip(): void
    {
        $upload = $this->upload('hello blob world', 'text/plain')->assertStatus(201);

        $this->assertSame('bob', $upload->json('accountId'));
        $blobId = $upload->json('blobId');
        $this->assertMatchesRegularExpression('/^jb-[0-9a-f]{40}$/', $blobId);
        $this->assertSame('text/plain', $upload->json('type'));
        $this->assertSame(strlen('hello blob world'), $upload->json('size'));

        $download = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$blobId.'/note.txt')
            ->assertOk();
        $this->assertSame('hello blob world', $download->getContent());
        // Symfony appends "; charset=utf-8" to text/* types — harmless.
        $this->assertStringStartsWith('text/plain', (string) $download->headers->get('Content-Type'));
        $this->assertStringContainsString('filename="note.txt"', (string) $download->headers->get('Content-Disposition'));
    }

    public function test_download_honours_the_type_query_parameter(): void
    {
        $blobId = $this->upload('binary-ish', 'application/octet-stream')->json('blobId');

        $download = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$blobId.'/cal.ics?type=text/calendar')
            ->assertOk();
        $this->assertStringStartsWith('text/calendar', (string) $download->headers->get('Content-Type'));
    }

    public function test_zero_byte_blobs_are_valid(): void
    {
        // draft-ietf-jmap-filenode-14 requires a blobId even for empty files.
        $upload = $this->upload('')->assertStatus(201);
        $this->assertSame(0, $upload->json('size'));

        $this->withBearer($this->userBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$upload->json('blobId').'/empty.bin')
            ->assertOk();
    }

    public function test_identical_content_dedupes_to_one_blob_id(): void
    {
        $first = $this->upload('same bytes')->json('blobId');
        $second = $this->upload('same bytes')->json('blobId');

        $this->assertSame($first, $second);
        $this->assertSame(1, JmapBlob::query()->where('username', 'bob')->count());
    }

    public function test_upload_and_download_are_account_scoped(): void
    {
        $this->upload('mine', account: 'carol')->assertStatus(404);

        $blobId = $this->upload('bob private data')->json('blobId');
        // carol cannot fetch bob's blob through her own account path...
        $this->withBearer($this->carolBearerToken())
            ->get('/api/v1/jmap/download/carol/'.$blobId.'/x.bin')
            ->assertStatus(404);
        // ...nor through bob's account path (accountId != principal → 404,
        // no existence leak).
        $this->withBearer($this->carolBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$blobId.'/x.bin')
            ->assertStatus(404);
    }

    public function test_oversized_upload_gets_the_rfc_limit_problem(): void
    {
        config(['wgw.jmap.max_size_upload' => 8]);

        $response = $this->upload('nine bytes');
        $response->assertStatus(400);
        $response->assertJsonPath('type', 'urn:ietf:params:jmap:error:limit');
        $response->assertJsonPath('limit', 'maxSizeUpload');
    }

    public function test_session_advertises_the_enforced_max_size_upload(): void
    {
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();

        $advertised = $session['capabilities'][JmapCapabilities::CORE]['maxSizeUpload'];
        $this->assertSame(JmapBlobService::maxSizeUpload(), $advertised);
        $this->assertGreaterThan(0, $advertised);
    }

    public function test_gc_deletes_expired_blobs_but_never_referenced_ones(): void
    {
        $service = app(JmapBlobService::class);
        $expiredId = $this->upload('expired and unreferenced')->json('blobId');
        $referencedId = $this->upload('expired but referenced')->json('blobId');
        $freshId = $this->upload('still fresh')->json('blobId');

        JmapBlob::query()
            ->whereIn('blob_id', [$expiredId, $referencedId])
            ->update(['expires_at' => Carbon::now()->subHour()]);

        $checker = new class($referencedId) implements JmapBlobReferenceCheckerInterface
        {
            public function __construct(private readonly string $protected) {}

            public function isReferenced(string $username, string $blobId): bool
            {
                return $blobId === $this->protected;
            }
        };

        $result = (new JmapBlobGarbageCollector($service, [$checker]))->collect();

        $this->assertSame(['deleted' => 1, 'retained' => 1], $result);
        $this->assertNull($service->retrieve('bob', $expiredId));
        // The domain-referenced blob survives its expiry (filenode hard
        // requirement); the fresh one is untouched.
        $this->assertNotNull($service->retrieve('bob', $referencedId));
        $this->assertNotNull($service->retrieve('bob', $freshId));
    }

    public function test_reupload_refreshes_the_expiry(): void
    {
        $blobId = $this->upload('refresh me')->json('blobId');
        JmapBlob::query()->where('blob_id', $blobId)
            ->update(['expires_at' => Carbon::now()->subHour()]);

        $this->upload('refresh me')->assertStatus(201);

        $row = JmapBlob::query()->where('blob_id', $blobId)->firstOrFail();
        $this->assertTrue($row->expires_at->isFuture());
    }

    public function test_contact_media_accepts_an_envelope_uploaded_blob_id(): void
    {
        // Supersedes the #437 deviation: photos may now come from the
        // envelope upload endpoint instead of POST /contacts/blobs.
        $blobId = $this->upload('fake png bytes', 'image/png')->json('blobId');

        $payload = $this->sampleContactCardPayload();
        $payload['media'] = ['m1' => ['kind' => 'photo', 'blobId' => $blobId]];

        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => [['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => $payload]], 'c0']],
        ])->assertOk();

        $cardId = $response->json('methodResponses.0.1.created.k0.id');
        $this->assertIsString($cardId);

        // On read the photo comes back as a (contacts-store) blobId whose
        // content round-trips through the envelope download endpoint.
        $card = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => [['ContactCard/get', ['accountId' => 'bob', 'ids' => [$cardId]], 'c0']],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $mediaEntry = array_values($card['media'])[0];
        $this->assertIsString($mediaEntry['blobId']);

        $download = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$mediaEntry['blobId'].'/photo.png')
            ->assertOk();
        $this->assertSame('fake png bytes', $download->getContent());
    }

    public function test_non_image_media_type_is_rejected_for_photos(): void
    {
        $blobId = $this->upload('plain text', 'text/plain')->json('blobId');

        $payload = $this->sampleContactCardPayload();
        $payload['media'] = ['m1' => ['kind' => 'photo', 'blobId' => $blobId]];

        $response = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CONTACTS],
            'methodCalls' => [['ContactCard/set', ['accountId' => 'bob', 'create' => ['k0' => $payload]], 'c0']],
        ])->assertOk();

        $this->assertNotNull($response->json('methodResponses.0.1.notCreated.k0'));
    }
}
