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

    public static function body(): string
    {
        return str_repeat('0123456789', 10);
    }
}
