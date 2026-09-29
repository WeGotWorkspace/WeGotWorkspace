<?php

declare(strict_types=1);

namespace App\Http\Sabre;

use Illuminate\Http\Response;
use Sabre\HTTP\ResponseInterface;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class SabreHttpResponseConverter
{
    public function toIlluminate(ResponseInterface $sabre): SymfonyResponse
    {
        $status = (int) $sabre->getStatus();
        $headers = $this->flattenHeaders($sabre->getHeaders());
        $body = $sabre->getBody();

        if (is_resource($body)) {
            return new StreamedResponse(function () use ($body): void {
                rewind($body);
                stream_copy_to_stream($body, fopen('php://output', 'wb'));
            }, $status, $headers);
        }

        if (is_callable($body)) {
            return new StreamedResponse($body, $status, $headers);
        }

        return new Response((string) $body, $status, $headers);
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
