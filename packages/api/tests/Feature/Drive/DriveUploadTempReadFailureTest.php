<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Services\Drive\DriveService;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class DriveUploadTempReadFailureTest extends WgwDatabaseTestCase
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

    public function test_chunked_upload_returns_json_500_when_temp_disk_get_is_false(): void
    {
        $temp = $this->createMock(Filesystem::class);
        $temp->expects($this->once())->method('exists')->willReturn(true);
        $temp->expects($this->once())->method('get')->willReturn(false);
        Storage::set('wgw_data', $temp);

        Route::post('/api/v1/drive/upload-temp-read', function () {
            return app(DriveService::class)->handleUpload(
                ['username' => 'bob', 'role' => 'user'],
                UploadedFile::fake()->createWithContent('notes.txt', 'second-chunk'),
                'notes.txt',
                'temp-read-failure',
                2,
                2,
                '/users/bob',
            );
        });

        $response = $this->post('/api/v1/drive/upload-temp-read');

        $response->assertStatus(500);
        $response->assertHeader('content-type', 'application/json');
        $response->assertJsonPath('code', 'server_error');
        $this->assertIsString($response->json('error'));
        $this->assertStringNotContainsString('<html', (string) $response->getContent());
    }
}
