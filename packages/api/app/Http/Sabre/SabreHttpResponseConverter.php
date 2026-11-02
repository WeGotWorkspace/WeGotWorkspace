<?php

declare(strict_types=1);

namespace App\Http\Sabre;

use Illuminate\Http\Response;
use Sabre\HTTP\ResponseInterface;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class SabreHttpResponseConverter
{
    private const CHUNK_BYTES = 1024 * 1024;

    public function toIlluminate(ResponseInterface $sabre): SymfonyResponse
    {
        $status = (int) $sabre->getStatus();
        $headers = $this->flattenHeaders($sabre->getHeaders());
        $body = $sabre->getBody();

        if (is_resource($body)) {
            $length = $this->contentLength($headers);

            return new StreamedResponse(function () use ($body, $status, $length): void {
                $this->copyBody($body, $status, $length);
            }, $status, $headers);
        }

        if (is_callable($body)) {
            return new StreamedResponse($body, $status, $headers);
        }

        return new Response((string) $body, $status, $headers);
    }

    /**
     * Sends a stream body in fixed chunks, so memory does not grow with the
     * file (#1839). For a 206, Sabre's CorePlugin has already seeked to the
     * range start, so the position is kept; any other status starts from the
     * beginning. The body never runs past `Content-Length`.
     *
     * @param  resource  $body
     */
    private function copyBody($body, int $status, ?int $length): void
    {
        try {
            if ($status !== 206 && stream_get_meta_data($body)['seekable']) {
                rewind($body);
            }
            $remaining = $length ?? PHP_INT_MAX;
            while ($remaining > 0 && ! feof($body)) {
                $chunk = fread($body, min(self::CHUNK_BYTES, $remaining));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                echo $chunk;
                $remaining -= strlen($chunk);
                if (ob_get_level() === 0) {
                    flush();
                }
            }
        } finally {
            if (is_resource($body)) {
                fclose($body);
            }
        }
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function contentLength(array $headers): ?int
    {
        foreach ($headers as $name => $value) {
            if (strcasecmp($name, 'Content-Length') === 0 && ctype_digit(trim($value))) {
                return (int) trim($value);
            }
        }

        return null;
    }

    /**
     * @param  array<string, string|list<string>>  $headers
     * @return array<string, string>
     */
    private function flattenHeaders(array $headers): array
    {
        $flat = [];
        foreach ($headers as $name => $value) {
            if (is_array($value)) {
                $flat[$name] = implode(', ', $value);
            } else {
                $flat[$name] = $value;
            }
        }

        return $flat;
    }
}
