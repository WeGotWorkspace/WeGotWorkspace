<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Caps an unauthenticated CSP report before the controller reads it.
 *
 * A declared Content-Length over 8 KiB is rejected without reading. Otherwise
 * the body is read in chunks from the request stream and stopped at the cap.
 */
final class CspReportBodyLimit
{
    public const BODY_ATTRIBUTE = 'csp_report_body';

    public const MAX_BODY_BYTES = 8192;

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if ($this->declaredLengthExceedsCap($request)) {
            return $this->tooLarge();
        }

        $resource = $request->getContent(true);
        if (! is_resource($resource)) {
            return $this->tooLarge();
        }

        $body = $this->readCapped($resource);
        if ($body === null) {
            return $this->tooLarge();
        }

        $request->attributes->set(self::BODY_ATTRIBUTE, $body);

        return $next($request);
    }

    private function declaredLengthExceedsCap(Request $request): bool
    {
        $declared = $request->headers->get('Content-Length');
        if (! is_string($declared) || preg_match('/^[0-9]+$/', $declared) !== 1) {
            return false;
        }

        return strlen($declared) > 4 || (int) $declared > self::MAX_BODY_BYTES;
    }

    /**
     * @param  resource  $resource
     */
    private function readCapped($resource): ?string
    {
        $body = '';
        while (! feof($resource)) {
            $chunk = fread($resource, self::MAX_BODY_BYTES);
            if ($chunk === false || $chunk === '') {
                break;
            }
            if (strlen($body) + strlen($chunk) > self::MAX_BODY_BYTES) {
                return null;
            }
            $body .= $chunk;
        }

        return $body;
    }

    private function tooLarge(): JsonResponse
    {
        return response()->json([
            'error' => 'CSP report is larger than 8 KiB.',
            'code' => 'post_too_large',
        ], 413);
    }
}
