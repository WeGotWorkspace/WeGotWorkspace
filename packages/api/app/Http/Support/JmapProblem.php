<?php

declare(strict_types=1);

namespace App\Http\Support;

use Illuminate\Http\JsonResponse;

/**
 * RFC 7807 problem responses of the JMAP blob endpoints (#1500).
 */
final class JmapProblem
{
    public const PART_MISMATCH = 'https://wegotworkspace.org/jmap/problem/part-mismatch';

    public const INSUFFICIENT_STORAGE = 'https://wegotworkspace.org/jmap/problem/insufficient-storage';

    /**
     * RFC 8620 §6.1 / §3.6.1: over a server limit.
     */
    public static function limit(string $limit, string $detail): JsonResponse
    {
        return self::respond(400, [
            'type' => 'urn:ietf:params:jmap:error:limit',
            'status' => 400,
            'detail' => $detail,
            'limit' => $limit,
        ]);
    }

    /**
     * @param  array<string, mixed>  $details
     */
    public static function partMismatch(array $details): JsonResponse
    {
        return self::respond(400, [
            'type' => self::PART_MISMATCH,
            'status' => 400,
            'detail' => 'The stored part does not match its declared length or sha256.',
        ] + $details);
    }

    public static function insufficientStorage(): JsonResponse
    {
        return self::respond(507, [
            'type' => self::INSUFFICIENT_STORAGE,
            'status' => 507,
            'detail' => 'The server has no space left to store this data.',
        ]);
    }

    public static function badRequest(string $detail): JsonResponse
    {
        return self::respond(400, ['type' => 'about:blank', 'status' => 400, 'detail' => $detail]);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private static function respond(int $status, array $body): JsonResponse
    {
        return response()->json($body, $status)->header('Content-Type', 'application/problem+json');
    }
}
