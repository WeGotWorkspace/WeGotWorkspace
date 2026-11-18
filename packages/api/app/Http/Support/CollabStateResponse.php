<?php

declare(strict_types=1);

namespace App\Http\Support;

use App\Services\Collab\CollabExternalWrite;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The `?format=yjs` read Notes and Tasks share: `204` with no stored state,
 * the bytes with the state tag, and `X-Wgw-External-Write: 1` when the state
 * is not an ancestor of the text. `X-Wgw-Content-Tag` names the text the
 * state was written from, so a client compares the state with the text only
 * when both reads are one save (#2208).
 */
final class CollabStateResponse
{
    /**
     * @param  array{bytes: string, etag: string, externalWrite: bool, contentTag: string|null}|null  $snapshot
     */
    public static function make(Request $request, ?array $snapshot): Response
    {
        if ($snapshot === null) {
            return response('', 204);
        }

        $headers = [
            'Content-Type' => 'application/octet-stream',
            'ETag' => $snapshot['etag'],
            'X-Content-Type-Options' => 'nosniff',
        ];
        if ($snapshot['contentTag'] !== null) {
            $headers[CollabExternalWrite::CONTENT_TAG_HEADER] = $snapshot['contentTag'];
        }
        if ($snapshot['externalWrite']) {
            // A 304 would hide the signal. The state bytes are unchanged, and
            // the client must still see that they are not an ancestor.
            $headers[CollabExternalWrite::HEADER] = '1';
        }

        $ifNoneMatch = trim((string) $request->headers->get('If-None-Match', ''));
        if (
            ! $snapshot['externalWrite']
            && $ifNoneMatch !== ''
            && OptimisticConcurrency::ifMatchSatisfied($ifNoneMatch, $snapshot['etag'])
        ) {
            return response('', 304, ['ETag' => $snapshot['etag']]);
        }

        return response($snapshot['bytes'], 200, $headers);
    }
}
