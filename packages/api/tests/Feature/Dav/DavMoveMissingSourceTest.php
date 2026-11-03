<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * A WebDAV MOVE or COPY whose source is missing answers 404 and leaves the
 * destination alone. Sabre deletes an existing destination before it looks up
 * the source, so a retried move used to delete the file it had just moved (#1884).
 */
final class DavMoveMissingSourceTest extends WgwDatabaseTestCase
{
    private const BOB = 'http://localhost/files/users/bob/';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();

        $installRoot = sys_get_temp_dir().'/wgw-move-missing-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users/bob', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'bob');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->configureWgwJwtKeys();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($dataDir);
    }

    public function test_a_retried_move_keeps_the_moved_file(): void
    {
        $this->dav('PUT', 'a.txt', 'moved')->assertSuccessful();
        $this->dav('MOVE', 'a.txt', null, ['HTTP_DESTINATION' => self::BOB.'b.txt'])->assertCreated();

        $this->dav('MOVE', 'a.txt', null, ['HTTP_DESTINATION' => self::BOB.'b.txt'])->assertNotFound();

        $this->assertSame('moved', $this->stored('b.txt'));
    }

    public function test_move_of_a_missing_source_keeps_the_destination(): void
    {
        $this->dav('PUT', 'c.txt', 'keep me')->assertSuccessful();

        $this->dav('MOVE', 'missing.txt', null, ['HTTP_DESTINATION' => self::BOB.'c.txt'])->assertNotFound();

        $this->assertSame('keep me', $this->stored('c.txt'));
    }

    public function test_copy_of_a_missing_source_keeps_the_destination(): void
    {
        $this->dav('PUT', 'd.txt', 'keep me')->assertSuccessful();

        $this->dav('COPY', 'missing.txt', null, ['HTTP_DESTINATION' => self::BOB.'d.txt'])->assertNotFound();

        $this->assertSame('keep me', $this->stored('d.txt'));
    }

    public function test_move_of_a_missing_folder_keeps_the_destination_folder(): void
    {
        $this->dav('MKCOL', 'kept')->assertSuccessful();
        $this->dav('PUT', 'kept/inside.txt', 'inside')->assertSuccessful();

        $this->dav('MOVE', 'gone', null, ['HTTP_DESTINATION' => self::BOB.'kept'])->assertNotFound();

        $this->assertSame('inside', $this->stored('kept/inside.txt'));
    }

    public function test_move_of_a_missing_source_to_a_free_name_is_still_404(): void
    {
        $this->dav('MOVE', 'missing.txt', null, ['HTTP_DESTINATION' => self::BOB.'free.txt'])->assertNotFound();

        $this->assertFalse(Storage::disk('wgw_files')->exists('users/bob/free.txt'));
    }

    public function test_move_and_copy_onto_an_existing_file_still_overwrite(): void
    {
        $this->dav('PUT', 'old.txt', 'old')->assertSuccessful();
        $this->dav('PUT', 'new.txt', 'new')->assertSuccessful();
        $this->dav('PUT', 'copy.txt', 'copied')->assertSuccessful();

        $this->dav('MOVE', 'new.txt', null, ['HTTP_DESTINATION' => self::BOB.'old.txt'])->assertNoContent();
        $this->assertSame('new', $this->stored('old.txt'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/bob/new.txt'));

        $this->dav('COPY', 'copy.txt', null, ['HTTP_DESTINATION' => self::BOB.'old.txt'])->assertNoContent();
        $this->assertSame('copied', $this->stored('old.txt'));
        $this->assertSame('copied', $this->stored('copy.txt'));
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(string $method, string $name, ?string $content = null, array $server = []): TestResponse
    {
        return $this->call($method, '/files/users/bob/'.$name, [], [], [], array_merge([
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('bob:secret'),
            'CONTENT_TYPE' => 'text/plain',
        ], $server), $content);
    }

    private function stored(string $name): string
    {
        return (string) Storage::disk('wgw_files')->get('users/bob/'.$name);
    }
}
