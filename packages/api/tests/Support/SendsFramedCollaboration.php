<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Testing\TestResponse;

trait SendsFramedCollaboration
{
    /**
     * @param  array<string, string>  $headers
     */
    protected function putCollaboration(
        string $url,
        ?string $markdown,
        ?string $yjs = null,
        array $headers = [],
    ): TestResponse {
        $content = self::framedCollabBody($markdown, $yjs);
        $headers = array_merge([
            'CONTENT_LENGTH' => (string) strlen($content),
            'CONTENT_TYPE' => 'application/octet-stream',
            'Accept' => 'application/json',
        ], $headers);

        return $this->call(
            'PUT',
            $url,
            [],
            [],
            [],
            $this->transformHeadersToServerVars($headers),
            $content,
        );
    }

    protected function putCollaborationRaw(string $url, string $content): TestResponse
    {
        return $this->call(
            'PUT',
            $url,
            [],
            [],
            [],
            $this->transformHeadersToServerVars([
                'CONTENT_LENGTH' => (string) strlen($content),
                'CONTENT_TYPE' => 'application/octet-stream',
                'Accept' => 'application/json',
            ]),
            $content,
        );
    }

    protected static function framedCollabBody(?string $markdown, ?string $yjs): string
    {
        $header = json_encode([
            'documentLen' => $markdown === null ? null : strlen($markdown),
            'yjsLen' => $yjs === null ? null : strlen($yjs),
        ], JSON_THROW_ON_ERROR);
        $tail = '';
        if ($markdown !== null) {
            $tail .= $markdown;
        }
        if ($yjs !== null) {
            $tail .= $yjs;
        }

        return pack('n', strlen($header)).$header.$tail;
    }
}
