<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\WgwEnvLocation;
use PHPUnit\Framework\TestCase;

/**
 * bootstrap/app.php reads the relocated .env (#1484). Runs artisan in a child
 * process: the scheduler and queue workers are artisan commands too, and the
 * web front requires the same bootstrap file.
 */
final class RelocatedEnvBootTest extends TestCase
{
    private string $dir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir().'/wgw-env-boot-'.uniqid('', true);
        mkdir($this->dir, 0700, true);
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir.'/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->dir);

        parent::tearDown();
    }

    public function test_artisan_boots_from_the_relocated_env(): void
    {
        $env = $this->dir.'/api.env';
        file_put_contents($env, "APP_NAME=RelocatedEnvProbe\nAPP_KEY=base64:".base64_encode(random_bytes(32))."\n");

        [$status, $out] = $this->artisan($env);

        $this->assertSame(0, $status, $out);
        $about = json_decode($out, true);
        $this->assertIsArray($about, $out);
        $this->assertSame('RelocatedEnvProbe', $about['environment']['application_name'] ?? null);
    }

    public function test_artisan_refuses_to_boot_when_the_relocated_env_is_gone(): void
    {
        [$status, $out] = $this->artisan($this->dir.'/missing.env');

        $this->assertNotSame(0, $status);
        $this->assertStringContainsString('missing or not readable', $out);
    }

    /**
     * @return array{0: int, 1: string}
     */
    private function artisan(string $envFile): array
    {
        $apiRoot = dirname(__DIR__, 3);
        $environment = getenv();
        // The child must load the probe file, not the test settings.
        unset($environment['APP_NAME'], $environment['APP_ENV'], $environment['APP_KEY']);
        $environment[WgwEnvLocation::OVERRIDE_KEY] = $envFile;

        $process = proc_open(
            [PHP_BINARY, $apiRoot.'/artisan', 'about', '--only=environment', '--json'],
            [1 => ['pipe', 'w'], 2 => ['redirect', 1]],
            $pipes,
            $apiRoot,
            $environment,
        );
        $this->assertIsResource($process);
        $out = (string) stream_get_contents($pipes[1]);
        fclose($pipes[1]);

        return [proc_close($process), $out];
    }
}
