<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\WgwApiEnvFile;
use Tests\TestCase;

final class WgwApiEnvFileTest extends TestCase
{
    public function test_read_value_unquotes_and_trims(): void
    {
        $content = <<<'ENV'
WGW_DB_CONNECTION=sqlite
WGW_DB_DATABASE="./wgw-content/db.sqlite"
APP_URL="https://team.example.test"
ENV;

        $this->assertSame('sqlite', WgwApiEnvFile::readValue($content, 'WGW_DB_CONNECTION'));
        $this->assertSame('./wgw-content/db.sqlite', WgwApiEnvFile::readValue($content, 'WGW_DB_DATABASE'));
        $this->assertSame('https://team.example.test', WgwApiEnvFile::readValue($content, 'APP_URL'));
        $this->assertNull(WgwApiEnvFile::readValue($content, 'MISSING'));
    }

    public function test_set_line_updates_existing_key_and_appends_missing_key(): void
    {
        $original = "APP_KEY=\nWGW_DB_CONNECTION=sqlite\n";

        $updated = WgwApiEnvFile::setLine($original, 'WGW_DB_CONNECTION', 'mysql');
        $this->assertStringContainsString("WGW_DB_CONNECTION=mysql\n", $updated);
        $this->assertStringNotContainsString('WGW_DB_CONNECTION=sqlite', $updated);

        $appended = WgwApiEnvFile::setLine($updated, 'WGW_DB_DATABASE', 'wgw');
        $this->assertStringContainsString("WGW_DB_DATABASE=wgw\n", $appended);
    }

    public function test_has_real_database_config_compares_against_example(): void
    {
        $dir = sys_get_temp_dir().'/wgw-api-env-file-'.uniqid('', true);
        mkdir($dir, 0775, true);

        file_put_contents($dir.'/.env.example', <<<'ENV'
WGW_DB_CONNECTION=sqlite
WGW_DB_DATABASE=./wgw-content/db.sqlite
ENV);
        file_put_contents($dir.'/.env', <<<'ENV'
WGW_DB_CONNECTION=sqlite
WGW_DB_DATABASE=./wgw-content/db.sqlite
ENV);
        file_put_contents($dir.'/.env.mysql', <<<'ENV'
WGW_DB_CONNECTION=mysql
WGW_DB_DATABASE=wgw
ENV);

        $this->assertFalse(WgwApiEnvFile::hasRealDatabaseConfig($dir.'/.env'));
        $this->assertTrue(WgwApiEnvFile::hasRealDatabaseConfig($dir.'/.env.mysql'));
        $this->assertTrue(WgwApiEnvFile::hasDatabaseConfigKeys($dir.'/.env'));
        $this->assertTrue(WgwApiEnvFile::hasDatabaseConfigKeys($dir.'/.env.mysql'));
    }

    public function test_strip_invalid_lines_drops_bare_emails_and_keeps_assignments(): void
    {
        $content = <<<'ENV'
APP_KEY=base64:abc
# WGW_VAPID_SUBJECT=mailto:noreply@localhost
reply@example.com
WGW_DB_CONNECTION=sqlite

ENV;

        $this->assertSame(
            "APP_KEY=base64:abc\n# WGW_VAPID_SUBJECT=mailto:noreply@localhost\nWGW_DB_CONNECTION=sqlite\n",
            WgwApiEnvFile::stripInvalidLines($content),
        );
    }
}
