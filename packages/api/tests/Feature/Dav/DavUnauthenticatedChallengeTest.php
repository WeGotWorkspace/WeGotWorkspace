<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Services\Contacts\AddressBookProvisioner;
use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * Unauthenticated DAV requests must get a 401 Basic challenge on every root.
 * Apple Contacts probes the address book home without credentials and aborts
 * the whole sync on a 404 (#1437).
 */
final class DavUnauthenticatedChallengeTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $installRoot = sys_get_temp_dir().'/wgw-dav-challenge-root-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users/alice', 0775, true);
        mkdir($dataDir.'/files/groups', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'alice');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($dataDir);

        $this->seedWgwUser('bob', email: 'bob@example.test', displayName: 'Bob');
        app(AddressBookProvisioner::class)->ensureForPrincipal('principals/alice', 'Alice');
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function unauthenticatedRequests(): iterable
    {
        yield 'calendar home propfind' => ['PROPFIND', '/calendars/alice/'];
        yield 'address book home propfind' => ['PROPFIND', '/addressbooks/alice/'];
        yield 'address book propfind' => ['PROPFIND', '/addressbooks/alice/default/'];
        yield 'principal propfind' => ['PROPFIND', '/principals/alice/'];
        yield 'principals root propfind' => ['PROPFIND', '/principals/'];
        yield 'files home propfind' => ['PROPFIND', '/files/users/alice/'];
        yield 'files root propfind' => ['PROPFIND', '/files/'];
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function protectedHomes(): iterable
    {
        yield 'calendar home' => ['/calendars/alice/'];
        yield 'address book home' => ['/addressbooks/alice/'];
        yield 'principal' => ['/principals/alice/'];
        yield 'files home' => ['/files/users/alice/'];
    }

    #[DataProvider('protectedHomes')]
    public function test_wrong_password_gets_basic_challenge(string $path): void
    {
        $response = $this->dav('PROPFIND', $path, username: 'alice', password: 'wrong');

        $response->assertStatus(401);
        $this->assertStringStartsWith('Basic', (string) $response->headers->get('WWW-Authenticate'));
    }

    /** A wrong password for an account that does not exist answers like one for an account that does. */
    #[DataProvider('protectedHomes')]
    public function test_unknown_user_gets_the_same_challenge(string $path): void
    {
        $path = str_replace('/alice/', '/nobody/', $path);
        $response = $this->dav('PROPFIND', $path, username: 'nobody', password: 'wrong');

        $response->assertStatus(401);
        $this->assertStringStartsWith('Basic', (string) $response->headers->get('WWW-Authenticate'));
    }

    #[DataProvider('protectedHomes')]
    public function test_correct_credentials_read_own_home(string $path): void
    {
        $this->dav('PROPFIND', $path, username: 'alice')->assertStatus(207);
    }

    #[DataProvider('unauthenticatedRequests')]
    public function test_unauthenticated_request_gets_basic_challenge(string $method, string $path): void
    {
        $response = $this->dav($method, $path);

        $response->assertStatus(401);
        $this->assertStringStartsWith('Basic', (string) $response->headers->get('WWW-Authenticate'));
    }

    public function test_other_user_still_cannot_read_address_book_home(): void
    {
        $status = $this->dav('PROPFIND', '/addressbooks/alice/', username: 'bob')->getStatusCode();

        $this->assertContains($status, [403, 404]);
    }

    public function test_owner_can_read_address_book_home(): void
    {
        $this->dav('PROPFIND', '/addressbooks/alice/', username: 'alice')->assertStatus(207);
    }

    private function dav(string $method, string $path, ?string $username = null, string $password = 'secret'): TestResponse
    {
        $server = ['HTTP_DEPTH' => '1'];
        if ($username !== null) {
            $server['HTTP_AUTHORIZATION'] = 'Basic '.base64_encode($username.':'.$password);
        }

        return $this->call($method, $path, [], [], [], $server);
    }
}
