<?php

declare(strict_types=1);

namespace Tests\Unit\Http;

use App\Http\Sabre\SabreHttpResponseConverter;
use Sabre\HTTP\Response as SabreResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Tests\TestCase;

final class SabreHttpResponseConverterTest extends TestCase
{
    public function test_a_full_response_sends_the_whole_stream_from_the_start(): void
    {
        $body = $this->stream('0123456789ABCDEFGHIJ');
        fseek($body, 20);

        $sent = $this->send(new SabreResponse(200, ['Content-Length' => '20'], $body));

        $this->assertSame('0123456789ABCDEFGHIJ', $sent);
    }

    public function test_a_partial_response_keeps_the_range_start_sabre_seeked_to(): void
    {
        // Sabre's CorePlugin seeks to the range start and sets Content-Length
        // to the range length before the response reaches the converter.
        $body = $this->stream('0123456789ABCDEFGHIJ');
        fseek($body, 10);

        $sent = $this->send(new SabreResponse(206, [
            'Content-Length' => '5',
            'Content-Range' => 'bytes 10-14/20',
        ], $body));

        $this->assertSame('ABCDE', $sent);
    }

    public function test_the_body_never_runs_past_content_length(): void
    {
        $body = $this->stream('0123456789');

        $sent = $this->send(new SabreResponse(200, ['Content-Length' => '4'], $body));

        $this->assertSame('0123', $sent);
    }

    public function test_a_response_without_content_length_sends_everything(): void
    {
        $body = $this->stream(str_repeat('x', 3 * 1024 * 1024 + 7));

        $sent = $this->send(new SabreResponse(200, [], $body));

        $this->assertSame(3 * 1024 * 1024 + 7, strlen($sent));
    }

    public function test_memory_stays_flat_while_a_large_file_is_sent(): void
    {
        $size = 48 * 1024 * 1024;
        $path = tempnam(sys_get_temp_dir(), 'wgw-dav-get-');
        $this->assertIsString($path);
        try {
            $file = fopen($path, 'wb');
            $this->assertIsResource($file);
            $block = str_repeat('z', 1024 * 1024);
            for ($i = 0; $i < 48; $i++) {
                fwrite($file, $block);
            }
            fclose($file);
            unset($block);

            $body = fopen($path, 'rb');
            $this->assertIsResource($body);
            $response = (new SabreHttpResponseConverter)->toIlluminate(
                new SabreResponse(200, ['Content-Length' => (string) $size], $body),
            );

            $sentBytes = 0;
            $before = memory_get_usage();
            memory_reset_peak_usage();
            ob_start(static function (string $chunk) use (&$sentBytes): string {
                $sentBytes += strlen($chunk);

                return '';
            }, 64 * 1024);
            try {
                $response->sendContent();
            } finally {
                ob_end_clean();
            }
            $growth = memory_get_peak_usage() - $before;

            $this->assertSame($size, $sentBytes);
            $this->assertLessThan(8 * 1024 * 1024, $growth, 'Sending the body must not hold the file in memory.');
        } finally {
            @unlink($path);
        }
    }

    public function test_string_bodies_stay_plain_responses(): void
    {
        $sabre = new SabreResponse(207, ['Content-Type' => 'application/xml']);
        $sabre->setBody('<multistatus/>');
        $response = (new SabreHttpResponseConverter)->toIlluminate($sabre);

        $this->assertNotInstanceOf(StreamedResponse::class, $response);
        $this->assertSame('<multistatus/>', $response->getContent());
    }

    /**
     * @return resource
     */
    private function stream(string $bytes)
    {
        $stream = fopen('php://temp', 'w+b');
        $this->assertIsResource($stream);
        fwrite($stream, $bytes);
        rewind($stream);

        return $stream;
    }

    private function send(SabreResponse $sabre): string
    {
        $response = (new SabreHttpResponseConverter)->toIlluminate($sabre);
        $this->assertInstanceOf(Response::class, $response);
        ob_start();
        try {
            $response->sendContent();
        } finally {
            $sent = (string) ob_get_clean();
        }

        return $sent;
    }
}
