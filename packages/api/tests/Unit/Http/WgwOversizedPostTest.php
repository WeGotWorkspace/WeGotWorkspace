<?php

declare(strict_types=1);

namespace Tests\Unit\Http;

use App\Http\Support\WgwOversizedPost;
use PHPUnit\Framework\TestCase;

final class WgwOversizedPostTest extends TestCase
{
    public function test_ini_bytes_parses_php_shorthand(): void
    {
        $this->assertSame(0, WgwOversizedPost::iniBytes('0'));
        $this->assertSame(8 * 1024 * 1024, WgwOversizedPost::iniBytes('8M'));
        $this->assertSame(32 * 1024 * 1024, WgwOversizedPost::iniBytes('32M'));
        $this->assertSame(1024, WgwOversizedPost::iniBytes('1K'));
    }

    public function test_payload_is_json_post_too_large(): void
    {
        $payload = WgwOversizedPost::payload('8M');

        $this->assertSame('post_too_large', $payload['code']);
        $this->assertSame('Upload too large. Current server post_max_size is 8M.', $payload['error']);
    }

    public function test_exceeds_limit_uses_live_ini(): void
    {
        $original = ini_get('post_max_size');
        ini_set('post_max_size', '8M');
        try {
            $this->assertTrue(WgwOversizedPost::exceedsLimit(null, 9 * 1024 * 1024));
            $this->assertFalse(WgwOversizedPost::exceedsLimit(null, 6 * 1024 * 1024));
        } finally {
            ini_set('post_max_size', (string) $original);
        }
    }
}
