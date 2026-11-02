<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * `GET /files/content` streams with Content-Length from the file at stream
 * time and single Range support (#1500), so browsers resume large downloads
 * and media previews seek.
 */
final class DriveContentRangeTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_full_download_sends_length_and_accept_ranges(): void
    {
        $this->seedPrivateFile('bob', 'clip.txt', self::body());

        $response = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/files/content?path=/users/bob/clip.txt')
            ->assertOk();

        $this->assertSame('100', $response->headers->get('Content-Length'));
        $this->assertSame('bytes', $response->headers->get('Accept-Ranges'));
        $this->assertEqualsCanonicalizing(['no-cache', 'private'], array_map('trim', explode(',', (string) $response->headers->get('Cache-Control'))));
        $this->assertStringContainsString('inline; filename="clip.txt"', (string) $response->headers->get('Content-Disposition'));
        $this->assertSame(self::body(), $response->streamedContent());
    }

    /**
     * @return iterable<string, array{0: string, 1: int, 2: string, 3: string|null}>
     */
    public static function ranges(): iterable
    {
        $body = self::body();
        yield 'first bytes' => ['bytes=0-4', 206, 'bytes 0-4/100', substr($body, 0, 5)];
        yield 'middle' => ['bytes=50-59', 206, 'bytes 50-59/100', substr($body, 50, 10)];
        yield 'open-ended' => ['bytes=97-', 206, 'bytes 97-99/100', substr($body, 97)];
        yield 'unsatisfiable' => ['bytes=200-300', 416, 'bytes */100', null];
    }

    #[DataProvider('ranges')]
    public function test_range_requests(string $range, int $status, string $contentRange, ?string $expected): void
    {
        $this->seedPrivateFile('bob', 'clip.txt', self::body());

        $response = $this->withBearer($this->userBearerToken())
            ->withHeader('Range', $range)
            ->get('/api/v1/files/content?path=/users/bob/clip.txt');

        $response->assertStatus($status);
        $this->assertSame($contentRange, $response->headers->get('Content-Range'));
        if ($expected !== null) {
            $this->assertSame($expected, $response->streamedContent());
        }
    }

    public function test_a_file_from_an_earlier_second_has_strong_validators(): void
    {
        $this->seedOlderFile('old.txt', self::body());

        $response = $this->get('/api/v1/files/content?path=/users/bob/old.txt')->assertOk();

        $this->assertMatchesRegularExpression('/^"[0-9a-f]{32}"$/', (string) $response->headers->get('ETag'));
        $this->assertSame('Wed, 01 Jan 2025 00:00:00 GMT', $response->headers->get('Last-Modified'));
        $this->assertSame('no', $response->headers->get('X-Accel-Buffering'));
        $this->assertEqualsCanonicalizing(['no-cache', 'private'], array_map('trim', explode(',', (string) $response->headers->get('Cache-Control'))));
    }

    public function test_a_file_whose_mtime_is_not_yet_in_the_past_has_no_validator(): void
    {
        $this->seedPrivateFile('bob', 'fresh.txt', self::body());
        // Not "now": the request could cross into the next second.
        touch($this->driveDataDir.'/files/users/bob/fresh.txt', time() + 3600);
        clearstatcache();

        $response = $this->withBearer($this->userBearerToken())
            ->withHeaders(['Range' => 'bytes=50-', 'If-Range' => 'Wed, 01 Jan 2025 00:00:00 GMT'])
            ->get('/api/v1/files/content?path=/users/bob/fresh.txt');

        // A second write in this same second could keep size and mtime.
        $response->assertOk();
        $this->assertNull($response->headers->get('ETag'));
        $this->assertNull($response->headers->get('Last-Modified'));
        $this->assertSame(self::body(), $response->streamedContent());
    }

    public function test_if_range_resumes_with_the_etag_or_the_date(): void
    {
        $this->seedOlderFile('resume.txt', self::body());
        $first = $this->get('/api/v1/files/content?path=/users/bob/resume.txt')->assertOk();

        foreach ([(string) $first->headers->get('ETag'), (string) $first->headers->get('Last-Modified')] as $validator) {
            $this->flushHeaders();
            $resume = $this->withBearer($this->userBearerToken())
                ->withHeaders(['Range' => 'bytes=90-', 'If-Range' => $validator])
                ->get('/api/v1/files/content?path=/users/bob/resume.txt');
            $resume->assertStatus(206);
            $this->assertSame(substr(self::body(), 90), $resume->streamedContent());
        }
    }

    public function test_a_changed_file_restarts_the_download_instead_of_resuming(): void
    {
        $this->seedOlderFile('changed.txt', self::body());
        $first = $this->get('/api/v1/files/content?path=/users/bob/changed.txt')->assertOk();
        $etag = (string) $first->headers->get('ETag');
        $lastModified = (string) $first->headers->get('Last-Modified');

        $changed = str_repeat('ABCDEFGHIJ', 10);
        $this->seedOlderFile('changed.txt', $changed, '2025-01-02 00:00:00');

        foreach ([$etag, $lastModified] as $validator) {
            $this->flushHeaders();
            $restart = $this->withBearer($this->userBearerToken())
                ->withHeaders(['Range' => 'bytes=90-', 'If-Range' => $validator])
                ->get('/api/v1/files/content?path=/users/bob/changed.txt');
            $restart->assertOk();
            $this->assertNotSame($etag, $restart->headers->get('ETag'));
            $this->assertSame($changed, $restart->streamedContent());
        }
    }

    public function test_if_none_match_on_the_current_etag_answers_304(): void
    {
        $this->seedOlderFile('cached.txt', self::body());
        $etag = (string) $this->get('/api/v1/files/content?path=/users/bob/cached.txt')->headers->get('ETag');

        $this->flushHeaders();
        $this->withBearer($this->userBearerToken())
            ->withHeader('If-None-Match', $etag)
            ->get('/api/v1/files/content?path=/users/bob/cached.txt')
            ->assertStatus(304)
            ->assertHeader('ETag', $etag)
            ->assertHeader('Cache-Control', 'no-cache, private');
    }

    public static function body(): string
    {
        return str_repeat('0123456789', 10);
    }

    /**
     * Seeds bob's file with an mtime in the past and returns a client
     * already authenticated as bob.
     */
    private function seedOlderFile(string $name, string $content, string $mtime = '2025-01-01 00:00:00'): self
    {
        $this->seedPrivateFile('bob', $name, $content);
        touch($this->driveDataDir.'/files/users/bob/'.$name, (int) strtotime($mtime.' UTC'));
        clearstatcache();

        return $this->withBearer($this->userBearerToken());
    }
}
