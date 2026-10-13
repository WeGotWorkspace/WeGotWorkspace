<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\InstallerDatabaseHostGuard;
use App\Services\Installer\InstallerIpv4Resolver;
use PHPUnit\Framework\TestCase;

final class InstallerDatabaseHostGuardTest extends TestCase
{
    public function test_blocks_link_local_literals_mapped_forms_and_resolved_names(): void
    {
        $guard = new InstallerDatabaseHostGuard(new class implements InstallerIpv4Resolver
        {
            public function lookup(string $host): array
            {
                return match ($host) {
                    'metadata.invalid' => ['169.254.169.254'],
                    'db.internal' => ['10.1.2.3'],
                    'localhost' => ['127.0.0.1'],
                    default => [],
                };
            }
        });

        foreach ([
            '169.254.169.254',
            '169.254.0.1',
            '::ffff:169.254.169.254',
            '::ffff:a9fe:a9fe',
            '[::ffff:169.254.1.1]',
            '0:0:0:0:0:ffff:169.254.169.254',
            '0000:0000:0000:0000:0000:ffff:a9fe:a9fe',
            'metadata.invalid',
        ] as $host) {
            $this->assertSame(
                'That database host is not allowed.',
                $guard->blockMessage($this->mysql($host)),
                $host,
            );
        }
    }

    public function test_keeps_localhost_and_private_ranges(): void
    {
        $guard = new InstallerDatabaseHostGuard(new class implements InstallerIpv4Resolver
        {
            public function lookup(string $host): array
            {
                return match ($host) {
                    'db.internal' => ['10.1.2.3', '192.168.0.2'],
                    'localhost' => ['127.0.0.1'],
                    default => [],
                };
            }
        });

        foreach (['127.0.0.1', 'localhost', '10.1.2.3', '172.16.5.5', '192.168.1.9', 'db.internal'] as $host) {
            $this->assertNull($guard->blockMessage($this->mysql($host)), $host);
        }

        $this->assertNull($guard->blockMessage([
            'driver' => 'sqlite',
            'sqlite_path' => './wgw-content/db.sqlite',
        ]));
    }

    /**
     * @return array<string, mixed>
     */
    private function mysql(string $host): array
    {
        return [
            'driver' => 'mysql',
            'mysql_host' => $host,
            'mysql_port' => 3306,
            'mysql_db' => 'wgw',
            'mysql_user' => 'wgw',
            'mysql_password' => 'secret',
        ];
    }
}
