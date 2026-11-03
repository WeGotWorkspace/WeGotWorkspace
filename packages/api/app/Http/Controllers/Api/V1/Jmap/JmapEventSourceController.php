<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Jmap\Push\JmapPushEventId;
use App\Services\Jmap\Push\JmapPushStateResolver;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * JMAP event source (RFC 8620 §7.3), short-burst only (#1660,
 * docs/architecture/jmap-push.md).
 *
 * Every response ends at once: one `state` event with the types whose state
 * differs from `Last-Event-ID`, plus the new `id`, or only `retry:` when
 * nothing differs. No setting holds the connection open, so a shared host's
 * few PHP-FPM workers stay free for signaling. `closeafter` and `ping` are
 * validated and otherwise moot: the stream always closes before a ping is due.
 */
final class JmapEventSourceController
{
    private const MAX_TYPES_LENGTH = 512;

    public function __construct(private readonly JmapPushStateResolver $states) {}

    public function __invoke(Request $request, string $types, string $closeafter, string $ping): Response
    {
        $requested = $this->parseTypes($types);
        if (! in_array($closeafter, ['state', 'no'], true)) {
            throw new ApiHttpException(400, 'closeafter must be state or no.', 'bad_request');
        }
        if (preg_match('/^\d{1,6}$/', $ping) !== 1) {
            throw new ApiHttpException(400, 'ping must be a whole number of seconds.', 'bad_request');
        }

        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $username = (string) $principal['username'];

        $served = $this->states->enabledTypes($requested);
        $resolved = $this->states->resolve($username, $served);
        $previous = JmapPushEventId::parse($this->lastEventId($request));

        $changed = [];
        $hashes = [];
        foreach ($resolved['states'] as $type => $current) {
            $hashes[$type] = $current['hash'];
            if (($previous[$type] ?? null) !== $current['hash']) {
                $changed[$type] = $current['state'];
            }
        }

        $retry = 'retry: '.$this->retryMs()."\n";
        $body = $changed === []
            ? $retry."\n"
            : "event: state\n"
                .'id: '.JmapPushEventId::encode($hashes)."\n"
                .$retry
                .'data: '.json_encode([
                    '@type' => 'StateChange',
                    'changed' => [$username => $changed],
                ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n\n";

        $response = new Response($body, 200, [
            'Content-Type' => 'text/event-stream; charset=utf-8',
            'Cache-Control' => 'no-cache, no-store, private',
            'X-Accel-Buffering' => 'no',
        ]);
        if ((bool) config('wgw.jmap_push.server_timing', false)) {
            $response->headers->set('Server-Timing', $this->serverTiming($resolved['timings']));
        }

        return $response;
    }

    /**
     * `*` is every type (null); otherwise a comma-separated list of type
     * names. Unknown names are allowed and ignored (RFC 8620 §7.3).
     *
     * @return list<string>|null
     */
    private function parseTypes(string $types): ?array
    {
        if ($types === '*') {
            return null;
        }
        if (strlen($types) > self::MAX_TYPES_LENGTH || preg_match('/^[A-Za-z]+(?:,[A-Za-z]+)*$/', $types) !== 1) {
            throw new ApiHttpException(400, 'types must be * or a comma-separated list of type names.', 'bad_request');
        }

        return array_values(array_unique(explode(',', $types)));
    }

    private function lastEventId(Request $request): ?string
    {
        $id = $request->headers->get('Last-Event-ID');

        return is_string($id) ? trim($id) : null;
    }

    private function retryMs(): int
    {
        $retry = (int) config('wgw.jmap_push.retry_ms', 3000);

        return max(500, min($retry, 600_000));
    }

    /**
     * @param  array<string, float>  $timings
     */
    private function serverTiming(array $timings): string
    {
        $parts = [];
        foreach ($timings as $source => $ms) {
            $parts[] = $source.';dur='.number_format($ms, 2, '.', '');
        }

        return implode(', ', $parts);
    }
}
