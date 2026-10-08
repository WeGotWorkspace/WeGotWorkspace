<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\WebRootDeny;
use PHPUnit\Framework\TestCase;

final class WebRootDenyTest extends TestCase
{
    private string $dataDir = '';

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && is_dir($this->dataDir)) {
            $this->removeTree($this->dataDir);
        }

        parent::tearDown();
    }

    public function test_data_dir_provisioning_writes_a_deny_htaccess_and_probe(): void
    {
        $this->dataDir = sys_get_temp_dir().'/wgw-web-root-deny-'.uniqid('', true);
        mkdir($this->dataDir, 0775, true);

        WebRootDeny::ensure($this->dataDir);

        $htaccess = (string) file_get_contents($this->dataDir.'/.htaccess');
        $this->assertStringContainsString('Require all denied', $htaccess);
        $this->assertSame(WebRootDeny::PROBE, (string) file_get_contents($this->dataDir.'/.probe'));

        file_put_contents($this->dataDir.'/.htaccess', "leave-me\n");
        WebRootDeny::ensure($this->dataDir);
        $this->assertSame("leave-me\n", (string) file_get_contents($this->dataDir.'/.htaccess'));
    }

    private function removeTree(string $dir): void
    {
        $items = scandir($dir);
        if ($items === false) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            if (is_dir($path)) {
                $this->removeTree($path);
            } else {
                unlink($path);
            }
        }
        rmdir($dir);
    }
}
