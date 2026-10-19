<?php

declare(strict_types=1);

namespace Tests\Unit\Collab;

use App\Exceptions\ApiHttpException;
use App\Services\Collab\FramedPayload;
use App\Services\Collab\YjsBytes;
use App\Services\Collab\YjsPayloadException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Caller-supplied collaboration bodies: every malformed shape is a 400
 * invalid_body, never a partial read.
 */
final class FramedPayloadTest extends TestCase
{
    public function test_a_well_formed_body_splits_into_markdown_yjs_and_title(): void
    {
        $body = self::frame(['documentLen' => 5, 'yjsLen' => 3, 'title' => 'Plan'], "# doc\x01\x02\x03");

        $this->assertSame(
            ['markdown' => '# doc', 'yjs' => "\x01\x02\x03", 'title' => 'Plan'],
            FramedPayload::collaborationFields($body),
        );
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function malformedBodies(): iterable
    {
        yield 'shorter than the length prefix' => ["\x00"];
        yield 'header longer than the body' => [pack('n', 50).'{}'];
        yield 'header is not JSON' => [pack('n', 3).'{x}'];
        yield 'header is a JSON list' => [pack('n', 2).'[]'];
        yield 'documentLen missing' => [self::frame(['yjsLen' => null], '')];
        yield 'yjsLen missing' => [self::frame(['documentLen' => 0], '')];
        yield 'negative length' => [self::frame(['documentLen' => -1, 'yjsLen' => null], '')];
        yield 'length as a string' => [self::frame(['documentLen' => '2', 'yjsLen' => null], 'ab')];
        yield 'lengths do not match the tail' => [self::frame(['documentLen' => 4, 'yjsLen' => null], 'ab')];
        yield 'title is not a string' => [self::frame(['documentLen' => 0, 'yjsLen' => null, 'title' => 7], '')];
    }

    #[DataProvider('malformedBodies')]
    public function test_a_malformed_body_is_400_invalid_body(string $body): void
    {
        try {
            FramedPayload::collaborationFields($body);
            $this->fail('A malformed body was accepted.');
        } catch (ApiHttpException $exception) {
            $this->assertSame(400, $exception->getStatusCode());
            $this->assertSame('invalid_body', $exception->errorCode());
        }
    }

    public function test_yjs_that_is_not_a_list_is_invalid(): void
    {
        try {
            YjsBytes::decode('not a list');
            $this->fail('A non-list yjs value was accepted.');
        } catch (YjsPayloadException $exception) {
            $this->assertSame('invalid_yjs', $exception->error);
            $this->assertSame(400, $exception->status);
        }
    }

    /**
     * @param  array<string, mixed>  $header
     */
    private static function frame(array $header, string $tail): string
    {
        $json = json_encode($header, JSON_THROW_ON_ERROR);

        return pack('n', strlen($json)).$json.$tail;
    }
}
