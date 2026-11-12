<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Services\Installer\ApiRuntimeEnvService;
use App\Support\WgwEnvLocation;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class WgwEnvLocationTest extends TestCase
{
    private string $root = '';

    private string $apiRoot = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->clearOverride();
        $this->root = sys_get_temp_dir().'/wgw-env-location-'.uniqid('', true);
        $this->apiRoot = $this->root.'/tree/packages/api';
        mkdir($this->apiRoot, 0775, true);
        mkdir($this->root.'/data', 0775, true);
    }

    protected function tearDown(): void
    {
        $this->clearOverride();
        if ($this->root !== '' && is_dir($this->root)) {
            self::removeTree($this->root);
        }

        parent::tearDown();
    }

    public function test_without_a_pointer_the_in_tree_file_applies(): void
    {
        $this->assertNull(WgwEnvLocation::relocated($this->apiRoot));
        $this->assertNull(WgwEnvLocation::relocatedForBoot($this->apiRoot));
        $this->assertSame($this->apiRoot.'/.env', WgwEnvLocation::envFile($this->apiRoot));
    }

    public function test_the_pointer_names_the_file_and_may_carry_comments(): void
    {
        $target = $this->root.'/data/api.env';
        file_put_contents($target, "APP_NAME=x\n");
        file_put_contents(WgwEnvLocation::pointerPath($this->apiRoot), WgwEnvLocation::pointerContents($target));

        $this->assertStringStartsWith('#', (string) file_get_contents(WgwEnvLocation::pointerPath($this->apiRoot)));
        $this->assertSame($target, WgwEnvLocation::relocated($this->apiRoot));
        $this->assertSame($target, WgwEnvLocation::relocatedForBoot($this->apiRoot));
        $this->assertSame($target, WgwEnvLocation::envFile($this->apiRoot));
    }

    public function test_the_variable_wins_over_the_pointer(): void
    {
        file_put_contents(WgwEnvLocation::pointerPath($this->apiRoot), $this->root."/data/api.env\n");
        $override = $this->root.'/data/other.env';
        putenv(WgwEnvLocation::OVERRIDE_KEY.'='.$override);

        $this->assertSame($override, WgwEnvLocation::envFile($this->apiRoot));
    }

    public function test_a_pointer_at_the_default_file_is_the_default(): void
    {
        file_put_contents(WgwEnvLocation::pointerPath($this->apiRoot), $this->apiRoot."/.env\n");

        $this->assertNull(WgwEnvLocation::relocated($this->apiRoot));
    }

    public function test_a_missing_target_stops_the_boot_instead_of_falling_back(): void
    {
        file_put_contents(WgwEnvLocation::pointerPath($this->apiRoot), $this->root."/data/gone.env\n");
        file_put_contents($this->apiRoot.'/.env', "APP_KEY=stale\n");

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('missing or not readable');
        WgwEnvLocation::relocatedForBoot($this->apiRoot);
    }

    #[DataProvider('invalidPointers')]
    public function test_an_invalid_pointer_is_refused(string $pointer): void
    {
        file_put_contents(WgwEnvLocation::pointerPath($this->apiRoot), $pointer);

        $this->expectException(\RuntimeException::class);
        WgwEnvLocation::relocated($this->apiRoot);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function invalidPointers(): array
    {
        return [
            'empty' => ["# only a comment\n"],
            'relative' => ["../data/api.env\n"],
            'dot-dot inside' => ["/srv/app/../data/api.env\n"],
            'dot segment' => ["/srv/./api.env\n"],
            'directory' => ["/srv/data/\n"],
        ];
    }

    public function test_a_relocated_env_is_never_seeded_with_a_new_key(): void
    {
        file_put_contents($this->apiRoot.'/.env.example', "APP_KEY=\n");
        file_put_contents(WgwEnvLocation::pointerPath($this->apiRoot), $this->root."/data/api.env\n");

        $this->assertFalse((new ApiRuntimeEnvService)->seedEnvFromExampleIfMissing($this->apiRoot));
        $this->assertFileDoesNotExist($this->apiRoot.'/.env');
        $this->assertFileDoesNotExist($this->root.'/data/api.env');
    }

    private static function removeTree(string $path): void
    {
        if (is_file($path) || is_link($path)) {
            @unlink($path);

            return;
        }
        foreach (scandir($path) ?: [] as $item) {
            if ($item !== '.' && $item !== '..') {
                self::removeTree($path.'/'.$item);
            }
        }
        @rmdir($path);
    }

    private function clearOverride(): void
    {
        putenv(WgwEnvLocation::OVERRIDE_KEY);
        unset($_ENV[WgwEnvLocation::OVERRIDE_KEY], $_SERVER[WgwEnvLocation::OVERRIDE_KEY]);
    }
}
