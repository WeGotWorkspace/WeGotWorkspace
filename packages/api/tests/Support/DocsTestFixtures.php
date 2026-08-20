<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Drive\DriveService;
use App\Storage\WgwStorage;
use Illuminate\Http\UploadedFile;
use Illuminate\Testing\TestResponse;

/**
 * Shared Docs workspace fixtures: DriveService seeding and GET content helpers.
 */
trait DocsTestFixtures
{
    use DriveTestFixtures;

    protected function setUpDocsFixtures(): void
    {
        $this->setUpDriveFixtures();
    }

    protected function tearDownDocsFixtures(): void
    {
        $this->tearDownDriveFixtures();
    }

    protected function seedDocFile(string $username, string $filename, string $content): string
    {
        app(WgwStorage::class)->files()->put('users/'.$username.'/docs/'.$filename, $content);

        return '/users/'.$username.'/docs/'.$filename;
    }

    protected function storeDoc(
        string $username,
        string $parentPath,
        string $filename,
        string $content,
    ): string {
        $file = UploadedFile::fake()->createWithContent($filename, $content);

        return app(DriveService::class)->handleUpload(
            $this->drivePrincipal($username),
            $file,
            $filename,
            'docs-upload-'.md5($parentPath.'|'.$filename.'|'.$content),
            1,
            1,
            $parentPath,
        );
    }

    protected function getDocContent(string $token, string $path): TestResponse
    {
        return $this->withBearer($token)->get('/api/v1/files/content?path='.$path);
    }
}
