<?php

declare(strict_types=1);

namespace Tests\Unit\Http;

use App\Http\Support\WgwOversizedPost;
use Illuminate\Http\Request;
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

    public function test_declared_content_length_is_null_when_missing(): void
    {
        $hadContentLength = array_key_exists('CONTENT_LENGTH', $_SERVER);
        $previous = $_SERVER['CONTENT_LENGTH'] ?? null;
        unset($_SERVER['CONTENT_LENGTH'], $_SERVER['HTTP_CONTENT_LENGTH']);
        try {
            $this->assertNull(WgwOversizedPost::declaredContentLength());
            $this->assertSame(0, WgwOversizedPost::contentLength());
            $this->assertFalse(WgwOversizedPost::exceedsLimit());
        } finally {
            if ($hadContentLength) {
                $_SERVER['CONTENT_LENGTH'] = $previous;
            }
        }
    }

    public function test_empty_body_looks_discarded_for_chunked_transfer(): void
    {
        $request = Request::create('/api/v1/contacts/cards/import', 'POST', [], [], [], [
            'HTTP_TRANSFER_ENCODING' => 'chunked',
            'CONTENT_TYPE' => 'text/vcard',
        ], '');
        $request->server->remove('CONTENT_LENGTH');
        $request->headers->remove('Content-Length');

        $this->assertNull(WgwOversizedPost::declaredContentLength($request));
        $this->assertFalse(WgwOversizedPost::exceedsLimit($request));
        $this->assertTrue(WgwOversizedPost::isChunkedTransfer($request));
        $this->assertTrue(WgwOversizedPost::emptyBodyLooksDiscarded($request));
    }

    public function test_empty_body_does_not_look_discarded_when_length_is_zero(): void
    {
        $request = Request::create('/api/v1/contacts/cards/import', 'POST', [], [], [], [
            'CONTENT_LENGTH' => '0',
            'CONTENT_TYPE' => 'text/vcard',
        ], '');

        $this->assertSame(0, WgwOversizedPost::declaredContentLength($request));
        $this->assertFalse(WgwOversizedPost::emptyBodyLooksDiscarded($request));
    }

    public function test_abort_if_exceeded_returns_when_under_limit(): void
    {
        $original = ini_get('post_max_size');
        $hadContentLength = array_key_exists('CONTENT_LENGTH', $_SERVER);
        $previous = $_SERVER['CONTENT_LENGTH'] ?? null;
        ini_set('post_max_size', '8M');
        $_SERVER['CONTENT_LENGTH'] = (string) (1024);
        try {
            WgwOversizedPost::abortIfExceeded();
            $this->assertTrue(true);
        } finally {
            ini_set('post_max_size', (string) $original);
            if ($hadContentLength) {
                $_SERVER['CONTENT_LENGTH'] = $previous;
            } else {
                unset($_SERVER['CONTENT_LENGTH']);
            }
        }
    }
}
