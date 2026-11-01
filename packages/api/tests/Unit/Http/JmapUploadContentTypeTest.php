<?php

declare(strict_types=1);

namespace Tests\Unit\Http;

use App\Http\Support\JmapUploadContentType;
use PHPUnit\Framework\TestCase;

final class JmapUploadContentTypeTest extends TestCase
{
    public function test_a_json_typed_upload_is_hidden_from_the_json_preparse(): void
    {
        foreach (['application/json', 'application/ld+json; charset=utf-8'] as $type) {
            $server = JmapUploadContentType::mask([
                'REQUEST_METHOD' => 'POST', 'REQUEST_URI' => '/api/v1/jmap/upload/bob?x=1', 'CONTENT_TYPE' => $type,
            ]);

            $this->assertSame('application/octet-stream', $server['CONTENT_TYPE']);
            $this->assertSame($type, $server[JmapUploadContentType::SERVER_KEY]);
        }
    }

    public function test_other_requests_are_left_alone(): void
    {
        $other = ['REQUEST_METHOD' => 'POST', 'REQUEST_URI' => '/api/v1/jmap', 'CONTENT_TYPE' => 'application/json'];
        $this->assertSame($other, JmapUploadContentType::mask($other));

        $plain = ['REQUEST_METHOD' => 'POST', 'REQUEST_URI' => '/api/v1/jmap/upload/bob', 'CONTENT_TYPE' => 'text/plain'];
        $this->assertSame($plain, JmapUploadContentType::mask($plain));
    }
}
