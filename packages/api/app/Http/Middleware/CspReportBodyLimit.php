<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Caps what the application keeps from an unauthenticated CSP report.
 *
 * With enable_post_data_reading on (the PHP default), the SAPI has already
 * buffered the body up to post_max_size (32M in .user.ini) before Laravel
 * runs. A declared Content-Length over 8 KiB is rejected here, and the stream
 * read stops at the same cap, so the controller never holds more than 8 KiB.
 * This middleware does not stop the server from reading the request.
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

        // "08192" is within the cap. strlen() on the raw header would reject it.
        $digits = ltrim($declared, '0');
        if ($digits === '') {
            return false;
        }

        return strlen($digits) > 4 || (int) $digits > self::MAX_BODY_BYTES;
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
