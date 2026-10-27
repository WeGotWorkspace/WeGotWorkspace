<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\WgwApiEnvFile;
use Dotenv\Dotenv;
use PHPUnit\Framework\Attributes\DataProvider;
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

    public function test_read_value_does_not_continue_onto_the_next_line(): void
    {
        $this->assertSame('', WgwApiEnvFile::readValue("APP_URL=\nNEXT=1\n", 'APP_URL'));
        $this->assertSame('', WgwApiEnvFile::readValue("APP_URL= \r\nNEXT=1\r\n", 'APP_URL'));
        $this->assertSame('', WgwApiEnvFile::readValue('APP_URL=', 'APP_URL'));
        $this->assertSame('https://x.example.test', WgwApiEnvFile::readValue("APP_URL=https://x.example.test\r\nNEXT=1\r\n", 'APP_URL'));
    }

    public function test_read_value_accepts_the_line_shapes_dotenv_accepts(): void
    {
        $this->assertSame('local', WgwApiEnvFile::readValue("  export APP_ENV=local\n", 'APP_ENV'));
        $this->assertSame('local', WgwApiEnvFile::readValue("APP_ENV = local\n", 'APP_ENV'));
        $this->assertNull(WgwApiEnvFile::readValue("MY_APP_ENV=local\n", 'APP_ENV'));
    }

    public function test_read_value_never_throws_on_an_unparsable_file(): void
    {
        // A torn line elsewhere must not hide the value callers ask for.
        $this->assertSame('local', WgwApiEnvFile::readValue("reply@example.com\nAPP_ENV=local\n", 'APP_ENV'));
        // An unparsable line for the key itself reads as empty, not as the next line.
        $this->assertSame('', WgwApiEnvFile::readValue("APP_URL=a b\nNEXT=1\n", 'APP_URL'));
    }

    public function test_read_value_uses_the_last_line_like_dotenv(): void
    {
        $content = "APP_ENV=production\nAPP_DEBUG=false\nAPP_ENV=local\n";

        $this->assertSame('local', WgwApiEnvFile::readValue($content, 'APP_ENV'));
        $this->assertSame('', WgwApiEnvFile::readValue("APP_KEY=base64:YWJj\nAPP_KEY=\n", 'APP_KEY'));
    }

    public function test_read_value_drops_an_unquoted_inline_comment(): void
    {
        $this->assertSame('local', WgwApiEnvFile::readValue("APP_ENV=local # dev box\n", 'APP_ENV'));
        $this->assertSame('a', WgwApiEnvFile::readValue("WGW_X=a#b\n", 'WGW_X'));
        $this->assertSame('', WgwApiEnvFile::readValue("WGW_X= # unset\n", 'WGW_X'));
        $this->assertSame('a # b', WgwApiEnvFile::readValue("WGW_X=\"a # b\" # note\n", 'WGW_X'));
    }

    public function test_read_value_round_trips_quoted_values(): void
    {
        foreach (['Team Mail', 'say "hi"', 'back\\slash', "it's", '', 'pa$1ss', 'a\\0b', 'a${APP_NAME}c', '$x', 'pa$$'] as $value) {
            // Append a missing key, then replace an existing one.
            foreach (["APP_NAME=x\n", "MAIL_FROM_NAME=old\nAPP_NAME=x\n"] as $original) {
                $content = WgwApiEnvFile::setLine($original, 'MAIL_FROM_NAME', $value);

                // What Laravel loads at boot: parsed and with ${...} resolved.
                $this->assertSame($value, Dotenv::parse($content)['MAIL_FROM_NAME']);
                $this->assertSame($value, WgwApiEnvFile::readValue($content, 'MAIL_FROM_NAME'));
                $this->assertTrue(WgwApiEnvFile::containsPairs($content, ['MAIL_FROM_NAME' => $value]));
            }
        }
        $this->assertSame('a b', WgwApiEnvFile::readValue("WGW_X='a b'\n", 'WGW_X'));
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

    /**
     * @return array<string, array{string}>
     */
    public static function linesDotenvAccepts(): array
    {
        return [
            'export' => ["APP_NAME=x\nexport APP_URL=https://old.example.test\n"],
            'indent' => ["APP_NAME=x\n  APP_URL=https://old.example.test\n"],
            'spaces around =' => ["APP_NAME=x\nAPP_URL = https://old.example.test\n"],
            'plain line, then export' => ["APP_URL=https://a.example.test\nexport APP_URL=https://old.example.test\n"],
        ];
    }

    #[DataProvider('linesDotenvAccepts')]
    public function test_set_line_rewrites_every_line_read_value_reads(string $content): void
    {
        $this->assertTrue(WgwApiEnvFile::hasKey($content, 'APP_URL'));
        $this->assertFalse(WgwApiEnvFile::hasKey($content, 'URL'));

        $updated = WgwApiEnvFile::setLine($content, 'APP_URL', 'https://new.example.test', quote: false);

        $this->assertSame('https://new.example.test', WgwApiEnvFile::readValue($updated, 'APP_URL'));
        $this->assertStringNotContainsString('old.example.test', $updated);
        $this->assertStringNotContainsString('export', $updated);
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
