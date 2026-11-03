<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Testing\TestResponse;

/**
 * Reads the short-burst JMAP event source (#1660) in feature tests.
 *
 * Headers go on each call only (not the sticky default headers), so a
 * `Last-Event-ID` or browser id never leaks into the next request.
 */
trait InteractsWithJmapEventSource
{
    protected function eventSource(
        string $token,
        string $types = '*',
        ?string $lastEventId = null,
        ?string $browserId = null,
        string $closeafter = 'state',
        string $ping = '0',
    ): TestResponse {
        $headers = ['Authorization' => 'Bearer '.$token, 'Accept' => 'text/event-stream'];
        if ($lastEventId !== null) {
            $headers['Last-Event-ID'] = $lastEventId;
        }
        if ($browserId !== null) {
            $headers['X-WGW-Browser-Id'] = $browserId;
        }

        return $this->call(
            'GET',
            '/api/v1/jmap/events/'.$types.'/'.$closeafter.'/'.$ping,
            server: $this->transformHeadersToServerVars($headers),
        );
    }

    /**
     * One request; returns the parsed stream.
     *
     * @return array{event: string|null, id: string|null, retry: int|null, data: array<string, mixed>|null}
     */
    protected function readEventSource(string $token, string $types = '*', ?string $lastEventId = null): array
    {
        $response = $this->eventSource($token, $types, $lastEventId)->assertOk();
        $this->assertStringStartsWith('text/event-stream', (string) $response->headers->get('Content-Type'));

        return $this->parseEventStream((string) $response->getContent());
    }

    /**
     * The `changed` map for `$account`, or [] when the response only said `retry:`.
     *
     * @param  array{event: string|null, id: string|null, retry: int|null, data: array<string, mixed>|null}  $stream
     * @return array<string, string>
     */
    protected function changedStates(array $stream, string $account): array
    {
        if ($stream['data'] === null) {
            return [];
        }
        $this->assertSame('StateChange', $stream['data']['@type'] ?? null);
        $changed = $stream['data']['changed'][$account] ?? null;
        $this->assertIsArray($changed);

        return $changed;
    }

    /**
     * Per-type hashes of an event id.
     *
     * @return array<string, string>
     */
    protected function eventIdHashes(string $id): array
    {
        $parts = explode(';', $id);
        $this->assertSame('v1', array_shift($parts));
        $hashes = [];
        foreach ($parts as $part) {
            [$type, $hash] = explode('=', $part, 2);
            $hashes[$type] = $hash;
        }

        return $hashes;
    }

    /**
     * @return array{event: string|null, id: string|null, retry: int|null, data: array<string, mixed>|null}
     */
    protected function parseEventStream(string $body): array
    {
        $this->assertStringEndsWith("\n\n", $body, 'An event-stream response ends with a blank line.');
        $blocks = array_values(array_filter(explode("\n\n", $body), static fn (string $block): bool => $block !== ''));
        $this->assertCount(1, $blocks, 'Short-burst: one block per response.');

        $parsed = ['event' => null, 'id' => null, 'retry' => null, 'data' => null];
        foreach (explode("\n", $blocks[0]) as $line) {
            [$field, $value] = array_pad(explode(': ', $line, 2), 2, '');
            match ($field) {
                'event' => $parsed['event'] = $value,
                'id' => $parsed['id'] = $value,
                'retry' => $parsed['retry'] = (int) $value,
                'data' => $parsed['data'] = json_decode($value, true, flags: JSON_THROW_ON_ERROR),
                default => $this->fail('Unexpected event-stream line: '.$line),
            };
        }

        return $parsed;
    }
}
